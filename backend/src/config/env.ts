const DEV_ONLY_JWT_SECRET = "dev-only-insecure-secret-do-not-use-in-production";

/**
 * `JWT_SECRET` is the one env var whose absence is a silent auth bypass rather than a
 * missing feature: unlike the provider keys below (unset → an honestly-labeled mock), every
 * server signs and verifies tokens with this secret, so a production deploy that forgets to
 * set it would still "work" — every token it issues would just be forgeable by anyone who
 * has read this source file. Refusing to start is the only safe behavior once
 * `NODE_ENV=production` (what Vercel's serverless runtime, and any conventional prod
 * deployment, sets); local dev and `vitest run` (`NODE_ENV` unset or `"test"`) keep the
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
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  /** Gemini's native-audio-output model — the same underlying voice technology behind the
   * Gemini app's voice mode, called via a plain generateContent request (see
   * ai/geminiTts.ts and AI_ARCHITECTURE.md "Native audio voice"), not the separate Google
   * Cloud Text-to-Speech product. Uses the same GEMINI_API_KEY, no extra credential. */
  geminiTtsModel: process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts",
  /** One of Gemini's fixed prebuilt voice names (e.g. Kore, Puck, Charon, Aoede, Fenrir). */
  geminiTtsVoice: process.env.GEMINI_TTS_VOICE || "Kore",
  githubAppId: process.env.GITHUB_APP_ID,
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  playBillingServiceAccountJson: process.env.PLAY_BILLING_SERVICE_ACCOUNT_JSON,
  /** Official production domain — see MASTER_SPEC.md §12a (Web Client Architecture). */
  publicAppUrl: process.env.PUBLIC_APP_URL || "https://zarvismobile.com",
  /** Comma-separated list of allowed browser origins for CORS; defaults cover the product domain + local dev. */
  corsOrigins: (
    process.env.CORS_ORIGINS ||
    "https://zarvismobile.com,https://www.zarvismobile.com,http://localhost:3000,http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
