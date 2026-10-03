import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for third-party credentials at rest (blueprint §18 "encrypt
 * secrets"). Output format: base64(iv[12] | authTag[16] | ciphertext), prefixed "v1:".
 */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /**
   * `INTEGRATION_ENCRYPTION_KEY` (base64, 32 bytes) is required in production; without it
   * integrations that store credentials are reported unavailable instead of storing them
   * weakly. Local dev/tests derive a key from the JWT secret so they need no setup.
   */
  static fromEnv(configuredKey: string | undefined, jwtSecret: string, isProduction: boolean): SecretBox | null {
    if (configuredKey) {
      const key = Buffer.from(configuredKey, "base64");
      if (key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
      return new SecretBox(key);
    }
    if (isProduction) return null;
    return new SecretBox(createHash("sha256").update(`zarvis-dev-integration-key:${jwtSecret}`).digest());
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  decrypt(payload: string): string {
    if (!payload.startsWith("v1:")) throw new Error("Unknown secret format");
    const raw = Buffer.from(payload.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}
