import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GooglePlayBillingVerifier, MockPlayBillingVerifier } from "../../src/billing/playBillingVerifier.js";

describe("MockPlayBillingVerifier", () => {
  it("accepts any non-empty token", async () => {
    const verifier = new MockPlayBillingVerifier();
    const result = await verifier.verifyPurchaseToken("token-abc", "zarvis_pro_monthly");
    expect(result).toEqual({ valid: true, planId: "zarvis_pro_monthly", orderId: "mock-order-token-ab" });
  });

  it("rejects an empty token", async () => {
    const verifier = new MockPlayBillingVerifier();
    expect(await verifier.verifyPurchaseToken("", "zarvis_pro_monthly")).toEqual({ valid: false });
  });
});

describe("GooglePlayBillingVerifier", () => {
  let serviceAccountJson: string;

  beforeAll(() => {
    // A real service account key is an RSA private key — generate one so jwt.sign(..., { algorithm: "RS256" })
    // has something structurally valid to sign with, without needing a real Google credential.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    serviceAccountJson = JSON.stringify({
      client_email: "test@test-project.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws if the service account JSON is missing required fields", () => {
    expect(() => new GooglePlayBillingVerifier(JSON.stringify({}), "com.zarvismobile.app")).toThrow(
      /missing client_email or private_key/,
    );
  });

  it("exchanges the service account for an access token, then verifies the purchase", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 });
      }
      expect(url).toBe(
        "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.zarvismobile.app/purchases/subscriptions/zarvis_pro_monthly/tokens/purchase-token-123",
      );
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fake-access-token");
      return new Response(
        JSON.stringify({ paymentState: 1, orderId: "GPA.1234", expiryTimeMillis: String(Date.now() + 86_400_000) }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const verifier = new GooglePlayBillingVerifier(serviceAccountJson, "com.zarvismobile.app");
    const result = await verifier.verifyPurchaseToken("purchase-token-123", "zarvis_pro_monthly");

    expect(result).toEqual({ valid: true, planId: "zarvis_pro_monthly", orderId: "GPA.1234" });
    expect(calls).toHaveLength(2);
  });

  it("caches the access token across calls instead of re-authenticating every time", async () => {
    let tokenExchanges = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          tokenExchanges += 1;
          return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ paymentState: 1, expiryTimeMillis: String(Date.now() + 86_400_000) }),
          { status: 200 },
        );
      }),
    );

    const verifier = new GooglePlayBillingVerifier(serviceAccountJson, "com.zarvismobile.app");
    await verifier.verifyPurchaseToken("token-1", "zarvis_pro_monthly");
    await verifier.verifyPurchaseToken("token-2", "zarvis_pro_monthly");

    expect(tokenExchanges).toBe(1);
  });

  it("fails closed when the subscription is expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ paymentState: 1, expiryTimeMillis: String(Date.now() - 86_400_000) }),
          { status: 200 },
        );
      }),
    );

    const verifier = new GooglePlayBillingVerifier(serviceAccountJson, "com.zarvismobile.app");
    const result = await verifier.verifyPurchaseToken("token-1", "zarvis_pro_monthly");
    expect(result).toEqual({ valid: false });
  });

  it("fails closed when the Play Developer API returns a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const verifier = new GooglePlayBillingVerifier(serviceAccountJson, "com.zarvismobile.app");
    expect(await verifier.verifyPurchaseToken("token-1", "zarvis_pro_monthly")).toEqual({ valid: false });
  });

  it("fails closed when the OAuth token exchange itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid_grant", { status: 400 })));

    const verifier = new GooglePlayBillingVerifier(serviceAccountJson, "com.zarvismobile.app");
    expect(await verifier.verifyPurchaseToken("token-1", "zarvis_pro_monthly")).toEqual({ valid: false });
  });

  it("rejects an empty purchaseToken or productId without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const verifier = new GooglePlayBillingVerifier(serviceAccountJson, "com.zarvismobile.app");
    expect(await verifier.verifyPurchaseToken("", "zarvis_pro_monthly")).toEqual({ valid: false });
    expect(await verifier.verifyPurchaseToken("token", "")).toEqual({ valid: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
