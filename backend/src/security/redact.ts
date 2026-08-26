/**
 * Central redaction facade — see SECURITY.md "Logging redaction". Every structured log
 * line and every persisted ToolExecution record passes through this before it is written,
 * both here and (conceptually) on the Android client's logging facade.
 */
const SENSITIVE_KEY_PATTERN = /password|otp|token|secret|authorization|cardnumber|cvv|pin/i;
const REDACTED = "[REDACTED]";

export function redact(value: unknown): unknown {
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
