/** Central place environment variables are read — see ../../.env.example. */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET || "dev-only-insecure-secret-do-not-use-in-production",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5",
  openaiApiKey: process.env.OPENAI_API_KEY,
  githubAppId: process.env.GITHUB_APP_ID,
  githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  playBillingServiceAccountJson: process.env.PLAY_BILLING_SERVICE_ACCOUNT_JSON,
};
