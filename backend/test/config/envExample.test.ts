import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalogJson } from "../../src/ai/modelCatalog.js";
import { resolveAIConfig } from "../../src/config/aiConfig.js";
import { resolveTtsConfig } from "../../src/config/ttsConfig.js";

/**
 * `backend/.env.example` is documentation operators copy from. It must (1) never hold a real
 * secret, (2) only document variables the code actually reads, and (3) contain examples that the
 * startup validation accepts. Otherwise the documentation rots or, worse, leaks.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const example = readFileSync(join(root, ".env.example"), "utf8");
const envSource = readFileSync(join(root, "src/config/env.ts"), "utf8");
const lines = example.split("\n");

/** Every `NAME=value` line, whether commented out or not. */
const assignments = lines
  .map((line) => /^(#\s*)?([A-Z][A-Z0-9_]+)=(.*)$/.exec(line))
  .filter((match): match is RegExpExecArray => match !== null)
  .map((match) => ({ commented: Boolean(match[1]), name: match[2]!, value: match[3]!.trim() }));

describe("backend/.env.example", () => {
  it("assigns no value to a secret: every credential line is empty", () => {
    const secretNames = /(_API_KEY|_SECRET|_TOKEN|PASSWORD|_ENCRYPTION_KEY|SERVICE_ACCOUNT_JSON|CA_CERT)$|^(POSTGRES_URL|DATABASE_URL)$/;
    const offenders = assignments.filter((entry) => !entry.commented && secretNames.test(entry.name) && entry.value !== "").map((entry) => entry.name);
    expect(offenders).toEqual([]);
  });

  it("contains nothing that looks like a real key", () => {
    expect(example).not.toMatch(/sk-or-v1-[A-Za-z0-9]{10,}/);
    expect(example).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(example).not.toMatch(/\bgh[pousr]_[A-Za-z0-9]{20,}/);
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./);
  });

  it("documents the AI variables, and every one of them is read by config/env.ts", () => {
    const documented = [...new Set(assignments.map((entry) => entry.name).filter((name) => /^(OPENROUTER_|AI_)/.test(name)))].sort();
    expect(documented).toEqual(
      [
        "AI_FALLBACK_PROVIDER",
        "AI_MODEL_CATALOG_JSON",
        "AI_PRIMARY_PROVIDER",
        "AI_QUOTA_COOLDOWN_MS",
        "OPENROUTER_API_KEY",
        "OPENROUTER_BASE_URL",
        "OPENROUTER_MODEL",
        "OPENROUTER_MODEL_CAPABILITIES",
        "OPENROUTER_MODEL_CONTEXT_TOKENS",
        "OPENROUTER_TIMEOUT_MS",
      ].sort(),
    );
    for (const name of documented) expect(envSource, `${name} is documented but never read`).toContain(`process.env.${name}`);
  });

  it("documents the voice variables, every one of them is read by config/env.ts, and the commented values are the ones the voice config accepts without a warning", () => {
    const documented = [...new Set(assignments.map((entry) => entry.name).filter((name) => /^TTS_/.test(name)))].sort();
    expect(documented).toEqual(["TTS_EN_VOICE", "TTS_HINGLISH_VOICE", "TTS_HI_VOICE", "TTS_PROVIDER"]);
    for (const name of documented) expect(envSource, `${name} is documented but never read`).toContain(`process.env.${name}`);

    const uncomment = (name: string) => assignments.find((entry) => entry.name === name && entry.commented)?.value.replace(/\s+#.*$/, "");
    const config = resolveTtsConfig({
      ttsProvider: uncomment("TTS_PROVIDER"),
      ttsHindiVoice: uncomment("TTS_HI_VOICE"),
      ttsEnglishVoice: uncomment("TTS_EN_VOICE"),
      ttsHinglishVoice: uncomment("TTS_HINGLISH_VOICE"),
    });
    expect(config).toEqual({ provider: "edge", voices: { hindi: "hi-IN-SwaraNeural", english: "en-US-JennyNeural", hinglish: "hi-IN-SwaraNeural" } });
  });

  it("no longer documents the Gemini voice, which is gone", () => {
    expect(example).not.toMatch(/GEMINI_TTS|GOOGLE_TTS|TTS_PRIMARY_PROVIDER/);
  });

  it("the commented defaults and the catalog example are accepted by the startup validation", () => {
    const uncomment = (name: string) => assignments.find((entry) => entry.name === name && entry.commented)?.value.replace(/\s+#.*$/, "");
    const catalogLine = uncomment("AI_MODEL_CATALOG_JSON")!;
    // The example is one JSON array in single quotes.
    const catalogJson = catalogLine.replace(/^'/, "").replace(/'$/, "");
    expect(() => parseCatalogJson(catalogJson)).not.toThrow();

    const config = resolveAIConfig({
      geminiModel: "gemini-3.6-flash",
      aiPrimaryProvider: uncomment("AI_PRIMARY_PROVIDER"),
      aiFallbackProvider: uncomment("AI_FALLBACK_PROVIDER"),
      openRouterBaseUrl: uncomment("OPENROUTER_BASE_URL"),
      openRouterModel: uncomment("OPENROUTER_MODEL"),
      openRouterModelContextTokens: uncomment("OPENROUTER_MODEL_CONTEXT_TOKENS"),
      openRouterTimeoutMs: uncomment("OPENROUTER_TIMEOUT_MS"),
      aiQuotaCooldownMs: uncomment("AI_QUOTA_COOLDOWN_MS"),
      aiModelCatalogJson: catalogJson,
    });
    expect(config.preferredPrimary).toBe("google");
    expect(config.preferredFallback).toBe("openrouter");
  });
});
