/**
 * Two small protections for the voice service, which is not ours and has no promises attached:
 *
 * - `Semaphore`: at most N syntheses in flight in this process, a short queue behind them, and a
 *   fast "busy" beyond that. Each synthesis holds a socket and a decoder, so this bounds memory
 *   and keeps one noisy moment from becoming a flood towards the service.
 * - `CircuitBreaker`: after a few requests in a row fail for reasons that are the service's (it is
 *   unreachable, refusing us, slow), further requests fail at once for half a minute instead of
 *   each waiting out a timeout, then one request is let through to see whether it is back. The web
 *   client keeps asking for the next sentence after a plain failure, so without this a down
 *   service costs every sentence of every reply a full timeout.
 *
 * Both are per process, like the rate limiter: honest and cheap, not global.
 */
import { TtsProviderError, abortError } from "./provider.js";

export class Semaphore {
  private active = 0;
  private readonly waiting: Array<{ grant: () => void; reject: (error: Error) => void; remove: () => void }> = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  /** Resolves with a function that gives the slot back (safe to call twice). Rejects when the queue is full, or on abort. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.waiting.length >= this.maxQueue) {
      return Promise.reject(new TtsProviderError("Voice synthesis is busy; try again in a moment", "UNAVAILABLE", true, { retryAfterMs: 1000 }));
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(this.releaser());
        },
        reject,
        remove: () => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
        },
      };
      const onAbort = () => {
        entry.remove();
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next.grant(); // the slot goes straight to the next in line
      else this.active -= 1;
    };
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  private probing = false;

  constructor(
    private readonly threshold: number,
    private readonly openMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws `UNAVAILABLE` while open. After the pause, exactly one caller is let through as the probe. */
  allow(): void {
    if (this.openedAt === undefined) return;
    const remaining = this.openedAt + this.openMs - this.now();
    if (remaining > 0 || this.probing) {
      throw new TtsProviderError("Voice synthesis is temporarily unavailable", "UNAVAILABLE", true, { retryAfterMs: Math.max(1000, remaining) });
    }
    this.probing = true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.probing = false;
  }

  failure(): void {
    if (this.probing) {
      this.probing = false;
      this.openedAt = this.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  /** The request ended without telling us anything about the service (it was cancelled, or the text was unspeakable). */
  neutral(): void {
    this.probing = false;
  }

  get isOpen(): boolean {
    return this.openedAt !== undefined;
  }
}
