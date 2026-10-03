/**
 * A misconfigured AI setting (an unknown provider name, malformed model catalog JSON, a
 * non-HTTPS OpenRouter URL, ...). Raised while the container is built, so a bad value stops the
 * server with a clear, secret-free reason instead of surfacing later as a confusing AI failure.
 *
 * Messages name environment variables and the problem only. They never include a configured
 * value: a mistyped variable can easily hold a key or a token.
 */
export class AIConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid AI configuration: ${problems.join("; ")}`);
    this.name = "AIConfigError";
  }
}
