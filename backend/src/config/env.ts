import { parseKeyList } from "../security/keyRotator.js";

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

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Every provider accepts several keys: `<PROVIDER>_KEYS` is a comma-separated list, tried in order (the next
 * key takes over when one is rate limited, out of quota or refused; see security/keyRotator.ts). The
 * single-key variable older deployments use (`<PROVIDER>_API_KEY`) still works: its key is added after the list.
 */
const keyLists = {
  groq: parseKeyList(process.env.GROQ_KEYS, process.env.GROQ_API_KEY),
  gemini: parseKeyList(process.env.GEMINI_KEYS, process.env.GEMINI_API_KEY),
  openRouter: parseKeyList(process.env.OPENROUTER_KEYS, process.env.OPENROUTER_API_KEY),
  openAi: parseKeyList(process.env.OPENAI_KEYS, process.env.OPENAI_API_KEY),
  elevenLabs: parseKeyList(process.env.ELEVENLABS_KEYS, process.env.ELEVENLABS_API_KEY),
};

/** Central place environment variables are read — see ../../.env.example. */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: resolveJwtSecret(),
  /** Postgres connection string. Leave unset to use the in-memory store (local dev/tests only —
   * see store/inMemoryStore.ts; it does not survive process restarts or serverless cold starts). */
  databaseUrl: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  /**
   * Direct provider credentials. Never expose these to the mobile/web clients. Each `...Keys` field is the whole
   * list (GEMINI_KEYS, then GEMINI_API_KEY), which the AI Model Gateway rotates through; each `...ApiKey` field is
   * its first key, for the callers that use one key (web search grounding, the Gemini voice).
   */
  geminiKeys: keyLists.gemini,
  geminiApiKey: keyLists.gemini[0],
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
  /**
   * Gemini models tried after GEMINI_MODEL inside the same request (comma-separated, at most 5): when it
   * does not exist, is overloaded, or its own free-tier quota (Google counts it per model) is spent.
   * Default: gemini-3.8-flash. Read raw; `config/aiConfig.ts` validates it.
   */
  geminiFallbackModels: process.env.GEMINI_FALLBACK_MODELS,
  /**
   * Voice output (see ../tts/edgeTtsProvider.ts): Microsoft Edge's neural voices. It needs no key,
   * so there is no secret here. Read raw; `config/ttsConfig.ts` validates and resolves them, and a
   * bad value is reported and replaced by the default rather than stopping the server.
   * `TTS_PROVIDER` is `gemini` (default: Gemini's voice first, needs GEMINI_API_KEY), `elevenlabs` (needs
   * ELEVENLABS_API_KEY), `edge` or `none` (no spoken replies).
   */
  ttsProvider: process.env.TTS_PROVIDER,
  ttsHindiVoice: process.env.TTS_HI_VOICE,
  ttsEnglishVoice: process.env.TTS_EN_VOICE,
  /** The voice for Hindi written in Latin letters (Hinglish). Defaults to the Hindi voice. */
  ttsHinglishVoice: process.env.TTS_HINGLISH_VOICE,
  /**
   * The voices behind the main one, asked in order when the one before fails before any sound: a chain
   * such as `gemini,edge`. Default: Edge behind Gemini, Gemini behind Edge, `gemini,edge` behind ElevenLabs;
   * `none` turns it off.
   * The model and voice are Gemini's own names. Read raw; `config/ttsConfig.ts` resolves them.
   */
  ttsFallbackProvider: process.env.TTS_FALLBACK_PROVIDER,
  geminiTtsModel: process.env.GEMINI_TTS_MODEL,
  geminiTtsVoice: process.env.GEMINI_TTS_VOICE,
  /**
   * ElevenLabs' voice (`TTS_PROVIDER=elevenlabs`, or listed in TTS_FALLBACK_PROVIDER). The key is a secret,
   * server-side only; without it the ElevenLabs voice is skipped. The voice id and model are ElevenLabs' own names.
   */
  elevenLabsKeys: keyLists.elevenLabs,
  elevenLabsApiKey: keyLists.elevenLabs[0],
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  elevenLabsModel: process.env.ELEVENLABS_MODEL,
  /**
   * OpenRouter, the AI Model Gateway's second provider (see ../../AI_MODEL_GATEWAY.md). Server-side
   * only, like every provider key: never sent to a client, a log or an error response.
   * Absent = no OpenRouter; the gateway then answers through Gemini alone.
   */
  openRouterKeys: keyLists.openRouter,
  openRouterApiKey: keyLists.openRouter[0],
  /**
   * The settings below are read raw. `config/aiConfig.ts` validates and resolves them once at
   * startup, so a typo stops the server with a clear message instead of misrouting requests.
   */
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL,
  openRouterModel: process.env.OPENROUTER_MODEL,
  openRouterModelCapabilities: process.env.OPENROUTER_MODEL_CAPABILITIES,
  openRouterModelContextTokens: process.env.OPENROUTER_MODEL_CONTEXT_TOKENS,
  openRouterTimeoutMs: process.env.OPENROUTER_TIMEOUT_MS,
  /**
   * OpenRouter's model list is read live (default on; `off` disables it): the configured model is checked
   * against it, a model that disappeared is replaced by a compatible one, and capabilities come from the
   * provider's own metadata. The settings below bound what that may choose; see ai/openRouterModels.ts.
   */
  openRouterDiscovery: process.env.OPENROUTER_DISCOVERY,
  /** Comma-separated model ids tried (in one request) when the main model fails. Free models only unless OPENROUTER_ALLOW_PAID. */
  openRouterFallbackModels: process.env.OPENROUTER_FALLBACK_MODELS,
  /** `true` lets live discovery choose models that cost money. Off by default: only `:free` and zero-priced models. */
  openRouterAllowPaid: process.env.OPENROUTER_ALLOW_PAID,
  /** Price ceilings in US dollars per million tokens, sent to OpenRouter as `provider.max_price` and checked against the list. */
  openRouterMaxPricePrompt: process.env.OPENROUTER_MAX_PRICE_PROMPT,
  openRouterMaxPriceCompletion: process.env.OPENROUTER_MAX_PRICE_COMPLETION,
  /** Upper bound on tokens one OpenRouter reply may generate (cost control). */
  openRouterMaxOutputTokens: process.env.OPENROUTER_MAX_OUTPUT_TOKENS,
  /** `allow` or `deny`: whether providers that may store or train on prompts can serve a request (OpenRouter's `provider.data_collection`). Unset = OpenRouter's account setting. */
  openRouterDataCollection: process.env.OPENROUTER_DATA_COLLECTION,
  /**
   * The third provider: any OpenAI-compatible Chat Completions endpoint (OpenAI's own by default). Used
   * only when both the key and OPENAI_MODEL are set. Server-side only, like every provider key.
   */
  openAiKeys: keyLists.openAi,
  openAiApiKey: keyLists.openAi[0],
  openAiBaseUrl: process.env.OPENAI_BASE_URL,
  openAiModel: process.env.OPENAI_MODEL,
  /** What OPENAI_MODEL can do besides text and streaming. Default `tools`; `none` = text only. */
  openAiModelCapabilities: process.env.OPENAI_MODEL_CAPABILITIES,
  openAiModelContextTokens: process.env.OPENAI_MODEL_CONTEXT_TOKENS,
  openAiTimeoutMs: process.env.OPENAI_TIMEOUT_MS,
  /** Upper bound on tokens one reply from the OpenAI-compatible endpoint may generate (cost control). */
  openAiMaxOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS,
  /**
   * Groq, the first provider of the default chain (its OpenAI-compatible endpoint). GROQ_KEYS (and/or
   * GROQ_API_KEY) turns it on; GROQ_MODEL defaults to a production model that calls tools (config/aiConfig.ts).
   * The other settings are read raw and validated there, like the OPENAI_* ones.
   */
  groqKeys: keyLists.groq,
  groqApiKey: keyLists.groq[0],
  groqBaseUrl: process.env.GROQ_BASE_URL,
  groqModel: process.env.GROQ_MODEL,
  /** What GROQ_MODEL can do besides text and streaming. Default `tools`; `none` = text only. */
  groqModelCapabilities: process.env.GROQ_MODEL_CAPABILITIES,
  groqModelContextTokens: process.env.GROQ_MODEL_CONTEXT_TOKENS,
  groqTimeoutMs: process.env.GROQ_TIMEOUT_MS,
  /** Upper bound on tokens one Groq reply may generate. */
  groqMaxOutputTokens: process.env.GROQ_MAX_OUTPUT_TOKENS,
  /** `groq` (default), `gemini`, `openrouter` or `openai`. */
  aiPrimaryProvider: process.env.AI_PRIMARY_PROVIDER,
  /**
   * The fallback chain, in order: one provider or several (`openrouter,openai`), or `none`.
   * Default: every provider that is not the primary, in the order groq, openrouter, gemini, openai.
   */
  aiFallbackProvider: process.env.AI_FALLBACK_PROVIDER,
  /** Optional JSON array describing every model and its capabilities; see ai/modelCatalog.ts. */
  aiModelCatalogJson: process.env.AI_MODEL_CATALOG_JSON,
  aiQuotaCooldownMs: process.env.AI_QUOTA_COOLDOWN_MS,
  /** Google OAuth Web client id for "Sign in with Google". Unset = the sign-in card honestly offers email only. */
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  /** Override only for a local test stub; defaults to Google's published signing keys. */
  googleJwksUrl: process.env.GOOGLE_JWKS_URL?.trim() || undefined,
  /** Razorpay (UPI / cards / netbanking / wallets, INR). Unset = payments honestly reported as unavailable. */
  razorpayKeyId: process.env.RAZORPAY_KEY_ID?.trim() || undefined,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET?.trim() || undefined,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || undefined,
  /** Override only for a local test stub; defaults to Razorpay's API. */
  razorpayApiBaseUrl: process.env.RAZORPAY_API_BASE_URL?.trim() || "https://api.razorpay.com/v1",
  /** Whole-rupee prices and the credits each paid period grants. Tune per market; amounts are server-side only. */
  proMonthlyInr: positiveInt(process.env.PRICE_PRO_MONTHLY_INR, 499),
  proYearlyInr: positiveInt(process.env.PRICE_PRO_YEARLY_INR, 4999),
  proMonthlyCredits: positiveInt(process.env.PRO_CREDITS_MONTHLY, 1000),
  proYearlyCredits: positiveInt(process.env.PRO_CREDITS_YEARLY, 12000),
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
