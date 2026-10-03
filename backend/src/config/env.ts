const DEV_ONLY_JWT_SECRET = "dev-only-insecure-secret-do-not-use-in-production";

/**
 * `JWT_SECRET` is the one env var whose absence is a silent auth bypass rather than a
 * missing feature: unlike the provider keys below (unset → an honestly-labeled mock), every
 * server signs and verifies tokens with this secret, so a production deploy that forgets to
 * set it would still "work" — every token it issues would just be forgeable by anyone who
 * has read this source file. Refusing to start is the only safe behavior once
 * `NODE_ENV=production` (what Vercel's serverless runtime, and any conventional prod
 * deployment, sets); local dev and `vitest run` (`NODE_ENV` unset or "test") keep the
 * fallback so `npm run dev`/`npm test` need no setup, per .env.example.
 */
function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is not set. Refusing to start in production with the publicly-known dev " +
        "fallback secret — set JWT_SECRET to a real, random value (see .env.example).",
    );
  }
  return DEV_ONLY_JWT_SECRET;
}

/** Central place environment variables are read — see ../../.env.example. */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: resolveJwtSecret(),
  /** Postgres connection string. Leave unset to use the in-memory store (local dev/tests only —
   * see store/inMemoryStore.ts; it does not survive process restarts or serverless cold starts). */
  databaseUrl: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  /** Direct provider credentials. Never expose these to the mobile/web clients. */
  geminiApiKey: process.env.GEMINI_API_KEY,
  /** Google has retired `gemini-2.5-flash` for new API users. The production logs showed
   * a 404 for that model, with Google's API explicitly directing new users to
   * `gemini-3.6-flash`. Keep `GEMINI_MODEL` configurable, but automatically replace the
   * known retired default if an old Vercel environment variable is still set, so a stale
   * `GEMINI_MODEL=gemini-2.5-flash` cannot keep production broken after deployment.
   * Gemini 3.6 Flash is a stable model documented by Google. */
  geminiModel:
    process.env.GEMINI_MODEL?.trim() === "gemini-2.5-flash"
      ? "gemini-3.6-flash"
      : process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
  /** Gemini's native-audio-output model — the same underlying voice technology behind the
   * Gemini app's voice mode, called via a plain generateContent request (see
   * ai/geminiTts.ts and AI_ARCHITECTURE.md "Native audio voice"), not the separate Google
   * Cloud Text-to-Speech product. Uses the same GEMINI_API_KEY, no extra credential. */
  geminiTtsModel:
    process.env.GEMINI_TTS_MODEL?.trim() === "gemini-2.5-flash-preview-tts" || !process.env.GEMINI_TTS_MODEL?.trim()
      ? "gemini-3.8-flash-lite-tts"
      : process.env.GEMINI_TTS_MODEL.trim(),
  /** One of Gemini's fixed prebuilt voice names (e.g. Kore, Puck, Charon, Aoede, Fenrir). */
  geminiTtsVoice: process.env.GEMINI_TTS_VOICE || "Kore",
  /**
   * OpenRouter, the AI Model Gateway's second provider (see ../../AI_MODEL_GATEWAY.md). Server-side
   * only, like every provider key: never sent to a client, a log or an error response.
   * Absent = no OpenRouter; the gateway then answers through Gemini alone.
   */
  openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || undefined,
  /**
   * The settings below are read raw. `config/aiConfig.ts` validates and resolves them once at
   * startup, so a typo stops the server with a clear message instead of misrouting requests.
   */
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL,
  openRouterModel: process.env.OPENROUTER_MODEL,
  openRouterModelCapabilities: process.env.OPENROUTER_MODEL_CAPABILITIES,
  openRouterModelContextTokens: process.env.OPENROUTER_MODEL_CONTEXT_TOKENS,
  openRouterTimeoutMs: process.env.OPENROUTER_TIMEOUT_MS,
  /** `gemini` (default) or `openrouter`. */
  aiPrimaryProvider: process.env.AI_PRIMARY_PROVIDER,
  /** `openrouter` / `gemini` (default: the provider that is not the primary) or `none`. */
  aiFallbackProvider: process.env.AI_FALLBACK_PROVIDER,
  /** Optional JSON array describing every model and its capabilities; see ai/modelCatalog.ts. */
  aiModelCatalogJson: process.env.AI_MODEL_CATALOG_JSON,
  aiQuotaCooldownMs: process.env.AI_QUOTA_COOLDOWN_MS,
  isProduction: process.env.NODE_ENV === "production",
  /** GitHub REST API base URL (override only for GitHub Enterprise Server or a local test stub). */
  githubApiBaseUrl: process.env.GITHUB_API_BASE_URL?.trim() || "https://api.github.com",
  /** base64 32-byte AES key for per-user integration credentials (security/secretBox.ts). */
  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
  playBillingServiceAccountJson: process.env.PLAY_BILLING_SERVICE_ACCOUNT_JSON,
  /** Must match the Android app's applicationId — see android/app/build.gradle.kts. */
  playBillingPackageName: process.env.PLAY_BILLING_PACKAGE_NAME || "com.zarvismobile.app",
  /** Comma-separated list of allowed browser origins for CORS; defaults cover the product domain + local dev. */
  corsOrigins: (
    process.env.CORS_ORIGINS ||
    "https://zarvismobile.com,https://www.zarvismobile.com,http://localhost:3000,http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
