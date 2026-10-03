/**
 * Central redaction facade — see SECURITY.md "Logging redaction". Every structured log
 * line and every persisted ToolExecution record passes through this before it is written,
 * both here and (conceptually) on the Android client's logging facade.
 *
 * Two independent layers, because either alone has a hole:
 *
 * 1. By key name. A field called `password`, `apiKey`, `authorization`, ... is replaced whatever
 *    it holds.
 * 2. By value. A secret that ends up inside a *string* under an innocent key (an upstream error
 *    message that echoes a credential, a URL, a header dump) is replaced when it looks like a
 *    known credential, and always when it is one of the secrets this process was configured
 *    with ({@link registerSecret}).
 */
const SENSITIVE_KEY_PATTERN = /password|otp|token|secret|authorization|cardnumber|cvv|pin|api[-_ ]?key|apikey|x-goog|credential|cookie|private[-_ ]?key|bearer/i;
const REDACTED = "[REDACTED]";

/** Shapes of credentials we never want in a log line, wherever they appear. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{16,}/g, // OpenRouter
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // an Authorization header value
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // a JWT
];

/** A secret shorter than this is not registered: replacing common short strings would corrupt logs. */
const MIN_REGISTERED_SECRET_LENGTH = 8;
const registeredSecrets = new Set<string>();

/**
 * Registers a configured secret (an API key) so that any exact occurrence of it is redacted from
 * every later log line, whatever shape it has. Call it with the value once it is known.
 */
export function registerSecret(value: string | undefined): void {
  const secret = value?.trim();
  if (secret && secret.length >= MIN_REGISTERED_SECRET_LENGTH) registeredSecrets.add(secret);
}

/** Forgets every registered secret. For tests only. */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

export function redactString(text: string): string {
  let out = text;
  for (const secret of registeredSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val);
    }
    return result;
  }
  return value;
}

/** Structured, redaction-safe logger. Use instead of console.* directly for anything request-scoped. */
export const logger = {
  info(message: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: "info", message, ...(data ? { data: redact(data) } : {}) }));
  },
  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", message, ...(data ? { data: redact(data) } : {}) }));
  },
  error(message: string, data?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: "error", message, ...(data ? { data: redact(data) } : {}) }));
  },
};
