import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredSecrets, logger, redact, redactString, registerSecret } from "../../src/security/redact.js";

afterEach(() => {
  clearRegisteredSecrets();
  vi.restoreAllMocks();
});

describe("redact: by key name", () => {
  it("replaces the value of any sensitive key, whatever it holds, at any depth", () => {
    expect(
      redact({
        password: "p",
        apiKey: "k1",
        api_key: "k2",
        "x-goog-api-key": "k3",
        Authorization: "Bearer abc",
        cookie: "c",
        nested: { token: "t", list: [{ secret: "s" }, { fine: "visible" }] },
        modelCallId: "visible-id",
      }),
    ).toEqual({
      password: "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      "x-goog-api-key": "[REDACTED]",
      Authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      nested: { token: "[REDACTED]", list: [{ secret: "[REDACTED]" }, { fine: "visible" }] },
      modelCallId: "visible-id",
    });
  });
});

describe("redact: by value (a secret inside a string under an innocent key)", () => {
  const openRouterKey = `sk-or-v1-${"ab12".repeat(10)}`;
  const googleKey = `AIza${"Sy0".repeat(11)}`;

  it.each([
    ["an OpenRouter key", `upstream said: invalid key ${openRouterKey} for user`],
    ["a Google API key", `request to ?key=${googleKey} failed`],
    ["an Authorization header value", "headers: Authorization: Bearer abcdef1234567890XYZ"],
    ["a GitHub token", `token ghp_${"A1b2".repeat(6)} was rejected`],
    ["a JWT", `jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c leaked`],
  ])("scrubs %s", (_label, text) => {
    const cleaned = redactString(text);
    expect(cleaned).toContain("[REDACTED]");
    expect(cleaned).not.toContain(openRouterKey);
    expect(cleaned).not.toContain(googleKey);
    expect(cleaned).not.toMatch(/ghp_[A-Za-z0-9]{10}/);
    expect(cleaned).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(cleaned).not.toContain("abcdef1234567890XYZ");
  });

  it("scrubs strings inside arrays and nested objects, and leaves ordinary text alone", () => {
    expect(redact({ list: [`x ${openRouterKey}`], deep: { error: `y ${googleKey}` } })).toEqual({ list: ["x [REDACTED]"], deep: { error: "y [REDACTED]" } });
    expect(redactString("Bearer tokens are fine to mention, as is sk-short")).toBe("Bearer tokens are fine to mention, as is sk-short");
    expect(redactString("model gemini-3.6-flash answered in 120ms")).toBe("model gemini-3.6-flash answered in 120ms");
  });

  it("does not mistake an ordinary hyphenated identifier for a key", () => {
    const text = "task-force-and-the-long-tail-of-a-hyphenated-identifier, risk-assessment-for-the-quarterly-review-meeting, disk-usage-report-for-the-current-partition";
    expect(redactString(text)).toBe(text);
    // ...while a real key at the start of a token is still caught, even after punctuation.
    expect(redactString(`(sk-or-v1-${"ab12".repeat(10)})`)).toBe("([REDACTED])");
  });

  it("scrubs the secrets this process was configured with, whatever shape they have", () => {
    registerSecret("my-unusual-credential-9f8e7d");
    expect(redactString("provider echoed my-unusual-credential-9f8e7d twice: my-unusual-credential-9f8e7d")).toBe("provider echoed [REDACTED] twice: [REDACTED]");
    expect(redact({ detail: "x my-unusual-credential-9f8e7d" })).toEqual({ detail: "x [REDACTED]" });
  });

  it("ignores empty or very short values, which would corrupt ordinary log text", () => {
    registerSecret(undefined);
    registerSecret("   ");
    registerSecret("abc");
    expect(redactString("abc abc abc")).toBe("abc abc abc");
  });
});

describe("the logger applies both layers to everything it writes", () => {
  it("never writes a registered key or a key-shaped string, in any log method", () => {
    registerSecret("registered-key-ZZZZ-1234");
    const written: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(String(args[0]));
      });
    }
    const echoed = `sk-or-v1-${"cd34".repeat(10)}`;
    logger.info("a", { error: `bad registered-key-ZZZZ-1234 and ${echoed}`, apiKey: "plain" });
    logger.warn("b", { nested: { message: `Bearer ${"q".repeat(20)}` } });
    logger.error("c", { list: [echoed] });

    const all = written.join("\n");
    expect(all).not.toContain("registered-key-ZZZZ-1234");
    expect(all).not.toContain(echoed);
    expect(all).not.toContain("plain");
    expect(all).not.toMatch(/Bearer q{10}/);
    expect(all.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
