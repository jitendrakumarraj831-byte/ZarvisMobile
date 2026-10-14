import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";

/**
 * Verifies a "Sign in with Google" ID token (a JWT from Google Identity Services) locally:
 * RS256 signature against Google's published keys, then issuer, audience (our OAuth client id),
 * expiry and a verified email. Only identity (sub, email, name, picture) is read; ZARVIS never
 * receives access to the user's Gmail, Drive or contacts.
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 */
export interface GoogleProfile {
  /** Google's stable account id; unlike the email it never changes. */
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTokenError";
  }
}

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_MS = 60_000;

export class GoogleIdTokenVerifier {
  private keys = new Map<string, Jwk>();
  private keysExpireAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly jwksUrl = GOOGLE_JWKS_URL,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async verify(idToken: unknown): Promise<GoogleProfile> {
    if (typeof idToken !== "string" || idToken.length > 8192) throw new GoogleTokenError("Missing or oversized token");
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new GoogleTokenError("Malformed token");
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    const header = parseJson<{ alg?: string; kid?: string }>(headerB64);
    const claims = parseJson<Record<string, unknown>>(payloadB64);
    // Only RS256: never "none" or an HMAC alg that a forger could pick.
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new GoogleTokenError("Unsupported token algorithm");

    const jwk = await this.keyFor(header.kid);
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${headerB64}.${payloadB64}`), key, Buffer.from(signatureB64, "base64url"));
    if (!ok) throw new GoogleTokenError("Bad token signature");

    const nowMs = this.now();
    if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw new GoogleTokenError("Wrong issuer");
    if (claims.aud !== this.clientId) throw new GoogleTokenError("Token was issued for a different app");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs - CLOCK_SKEW_MS) throw new GoogleTokenError("Token expired");
    if (typeof claims.iat === "number" && claims.iat * 1000 > nowMs + CLOCK_SKEW_MS) throw new GoogleTokenError("Token issued in the future");
    if (typeof claims.sub !== "string" || !claims.sub) throw new GoogleTokenError("Token has no subject");
    if (typeof claims.email !== "string" || !claims.email) throw new GoogleTokenError("Token has no email");
    if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleTokenError("Google has not verified this email");

    return {
      sub: claims.sub,
      email: claims.email.trim().toLowerCase(),
      name: typeof claims.name === "string" ? claims.name.slice(0, 120) : undefined,
      picture: typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture.slice(0, 500) : undefined,
    };
  }

  private async keyFor(kid: string): Promise<Jwk> {
    const fresh = this.now() < this.keysExpireAt;
    const cached = this.keys.get(kid);
    if (fresh && cached) return cached;
    await this.refreshKeys();
    const key = this.keys.get(kid);
    if (!key) throw new GoogleTokenError("Unknown signing key");
    return key;
  }

  private async refreshKeys(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.jwksUrl, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new GoogleTokenError("Could not reach Google to verify the sign-in");
    }
    if (!res.ok) throw new GoogleTokenError("Could not load Google's signing keys");
    const body = (await res.json()) as { keys?: Jwk[] };
    this.keys = new Map((body.keys ?? []).filter((k) => typeof k.kid === "string").map((k) => [k.kid as string, k]));
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1]);
    this.keysExpireAt = this.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge * 1000 : 60 * 60 * 1000);
  }
}

function parseJson<T>(b64url: string): T {
  try {
    return JSON.parse(Buffer.from(b64url, "base64url").toString("utf8")) as T;
  } catch {
    throw new GoogleTokenError("Malformed token");
  }
}
