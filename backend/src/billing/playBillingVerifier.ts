import jwt from "jsonwebtoken";

export interface PlayPurchaseVerification {
  valid: boolean;
  planId?: string;
  orderId?: string;
}

export interface PlayBillingVerifier {
  verifyPurchaseToken(purchaseToken: string, productId: string): Promise<PlayPurchaseVerification>;
}

/**
 * No live Play Console listing exists for this repository yet (MASTER_SPEC.md §32), so
 * this mock accepts any non-empty token as a stand-in for the real Play Developer API
 * verification call. Swapping in a real verifier is additive — implement
 * [PlayBillingVerifier]; see SUBSCRIPTIONS.md "Billing integration point".
 */
export class MockPlayBillingVerifier implements PlayBillingVerifier {
  async verifyPurchaseToken(purchaseToken: string, productId: string): Promise<PlayPurchaseVerification> {
    if (!purchaseToken) {
      return { valid: false };
    }
    return { valid: true, planId: productId, orderId: `mock-order-${purchaseToken.slice(0, 8)}` };
  }
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

interface GoogleSubscriptionPurchase {
  // 0 = Pending, 1 = Received, 2 = Free trial, 3 = Pending deferred upgrade/downgrade — see
  // https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions
  paymentState?: number;
  orderId?: string;
  expiryTimeMillis?: string;
}

/**
 * Real Google Play Developer API verifier — activated in container.ts whenever
 * `PLAY_BILLING_SERVICE_ACCOUNT_JSON` is configured, exactly mirroring how `GeminiProvider`
 * activates on `GEMINI_API_KEY` (providerFactory.ts) and `MockAIProvider` stays the default
 * otherwise; see SUBSCRIPTIONS.md "Billing integration point" and MASTER_SPEC.md §32.
 *
 * **Stated honestly:** written against Google's documented Play Developer API v3 contract
 * (developers.google.com/android-publisher) and unit-tested against mocked HTTP responses
 * shaped like that documentation (`test/billing/playBillingVerifier.test.ts`) — this
 * repository has no real Play Console app, subscription product, or service account to
 * exercise it against end to end, so the Google API integration itself is unverified
 * against the live service. Fails closed (`{ valid: false }`) on any parse error, HTTP
 * error, or unexpected response shape rather than ever risking a false positive — a wrong
 * "not valid" costs a support ticket; a wrong "valid" gives away paid access for free.
 */
export class GooglePlayBillingVerifier implements PlayBillingVerifier {
  private readonly credentials: ServiceAccountCredentials;
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    serviceAccountJson: string,
    private readonly packageName: string,
  ) {
    const parsed = JSON.parse(serviceAccountJson) as Partial<ServiceAccountCredentials>;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("PLAY_BILLING_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
    }
    this.credentials = { client_email: parsed.client_email, private_key: parsed.private_key };
  }

  async verifyPurchaseToken(purchaseToken: string, productId: string): Promise<PlayPurchaseVerification> {
    if (!purchaseToken || !productId) return { valid: false };
    try {
      const accessToken = await this.getAccessToken();
      const url =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(this.packageName)}/purchases/subscriptions/` +
        `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return { valid: false };
      const body = (await res.json()) as GoogleSubscriptionPurchase;
      const isPaid = body.paymentState === 1 || body.paymentState === 2;
      const notExpired = typeof body.expiryTimeMillis === "string" && Number(body.expiryTimeMillis) > Date.now();
      if (!isPaid || !notExpired) return { valid: false };
      return { valid: true, planId: productId, orderId: body.orderId };
    } catch {
      return { valid: false };
    }
  }

  /** JWT Bearer Token Flow for service accounts — https://developers.google.com/identity/protocols/oauth2/service-account */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.accessToken;
    }
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: this.credentials.client_email,
        scope: ANDROID_PUBLISHER_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      this.credentials.private_key,
      { algorithm: "RS256" },
    );
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google OAuth token exchange failed: ${res.status} ${text}`.trim());
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}
