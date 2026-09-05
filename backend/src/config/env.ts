/** Central place environment variables are read — see ../../.env.example. */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET || "dev-only-insecure-secret-do-not-use-in-production",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
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
