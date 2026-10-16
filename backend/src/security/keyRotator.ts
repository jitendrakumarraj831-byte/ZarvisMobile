import { logger, registerSecret } from "./redact.js";

/**
 * Several API keys for one service, used one at a time: the active key answers until the service refuses
 * it for a reason that is about that key, then the next key that is not resting takes over at once.
 *
 * Only three failures are about a key, so only they rotate it:
 * - `rate_limited`: this key's per-minute window is full (HTTP 429). Another key has its own window.
 * - `quota_exhausted`: this key's daily quota or credit balance is spent. Another account's is not.
 * - `auth_rejected`: the service refused this key (revoked, mistyped, not allowed). The others may be fine.
 *
 * A network failure, an outage, a timeout or a refused request is the same for every key of the service:
 * trying the next key would only repeat it and keep the user waiting, so the caller moves on to the next
 * service instead (the AI Model Gateway's provider chain, the voice chain).
 *
 * A refused key rests for a while (its cooldown) and is then eligible again. While every key is resting,
 * the one that recovers first is still asked: one request, exactly as a deployment with a single key
 * always asks it. A service is therefore never refused without being asked.
 *
 * State is kept per key value, in this process only (like the rate limiter): a key list that changes
 * keeps the state of the keys that stay. Nothing here logs, returns or compares a key outside memory:
 * logs and status name a key by its 1-based slot in the configured list ("key 2 of 3").
 */
export type KeyFailureReason = "rate_limited" | "quota_exhausted" | "auth_rejected";

/** One key handed out for one request. `slot` is 1-based, for logs; the key itself never leaves the process. */
export interface KeyLease {
  readonly key: string;
  readonly slot: number;
  readonly total: number;
}

export interface KeySlotStatus {
  slot: number;
  /** `ready`: may be asked; `cooling`: rate limited or out of quota; `rejected`: the service refused the key. */
  state: "ready" | "cooling" | "rejected";
  active: boolean;
  /** When a resting key becomes eligible again (ISO time). */
  until?: string;
  reason?: KeyFailureReason;
}

export interface KeyRotatorStatus {
  total: number;
  available: number;
  /** The slot requests start with. Absent without keys. */
  activeSlot?: number;
  /** How many times requests moved from one key to another since the process started. */
  rotations: number;
  slots: KeySlotStatus[];
}

export interface KeyRotatorOptions {
  /** Upper-case service name for logs, e.g. GROQ, GEMINI, ELEVENLABS. */
  name: string;
  /**
   * The keys, in order. A function: it is read whenever a key is needed, so a key configured after start
   * (or a test that sets one late) is picked up without rebuilding anything.
   */
  keys: () => readonly string[];
  now?: () => number;
  /** Rest periods per reason (milliseconds); defaults below. */
  cooldownMs?: Partial<Record<KeyFailureReason, number>>;
}

/** How long a refused key rests when the service does not say. */
export const DEFAULT_KEY_COOLDOWN_MS: Readonly<Record<KeyFailureReason, number>> = {
  // A per-minute window: about a minute, or what the service advised.
  rate_limited: 60_000,
  // A spent daily quota or credit balance does not come back in minutes. Probed again after this long.
  quota_exhausted: 15 * 60_000,
  // A refused key is an operator problem; it is asked again now and then in case the account was fixed.
  auth_rejected: 30 * 60_000,
};
/** A service-advised wait is followed, but never beyond these. */
const MAX_RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;
/** More keys than this for one service is a configuration mistake; the rest are ignored. */
export const MAX_KEYS_PER_SERVICE = 25;

interface Rest {
  until: number;
  reason: KeyFailureReason;
}

export class KeyRotator {
  readonly name: string;
  private readonly now: () => number;
  private readonly cooldowns: Record<KeyFailureReason, number>;
  private readonly resting = new Map<string, Rest>();
  private activeKey: string | undefined;
  private rotations = 0;
  /** The key list as last read, to notice a change (and forget keys that left it). */
  private seen = "";

  constructor(private readonly options: KeyRotatorOptions) {
    this.name = options.name;
    this.now = options.now ?? Date.now;
    this.cooldowns = { ...DEFAULT_KEY_COOLDOWN_MS, ...options.cooldownMs };
  }

  /** Number of configured keys right now. */
  get size(): number {
    return this.list().length;
  }

  hasKeys(): boolean {
    return this.size > 0;
  }

  /**
   * The key a request should start with: the active key while it is not resting, otherwise the next
   * one that is not, otherwise the one that recovers first. For callers that make one request with
   * one key and do not rotate on their own (they follow the rotation the main caller drives).
   */
  current(): string | undefined {
    return this.plan()[0]?.key;
  }

  /**
   * The keys to try for one request, in order: every key that is not resting, starting with the active
   * one and wrapping around. When every key is resting, only the one that recovers first.
   */
  plan(): KeyLease[] {
    const keys = this.list();
    if (keys.length === 0) return [];
    const now = this.now();
    const start = Math.max(0, this.activeKey === undefined ? 0 : keys.indexOf(this.activeKey));
    const ordered = [...keys.slice(start), ...keys.slice(0, start)];
    const ready = ordered.filter((key) => !this.restOf(key, now));
    if (ready.length > 0) return ready.map((key) => this.lease(keys, key));
    const soonest = ordered.reduce((best, key) => (this.restOf(key, now)!.until < this.restOf(best, now)!.until ? key : best));
    return [this.lease(keys, soonest)];
  }

  /** True when a key other than `key` could be asked right now. Lets a caller skip waiting out a rate limit. */
  hasAlternative(key: string): boolean {
    const now = this.now();
    return this.list().some((other) => other !== key && !this.restOf(other, now));
  }

  /** The service answered with this key: it becomes (or stays) the active key, and any rest it had is over. */
  reportSuccess(lease: KeyLease): void {
    this.resting.delete(lease.key);
    if (this.activeKey === lease.key) return;
    const previous = this.activeKey;
    this.activeKey = lease.key;
    if (previous === undefined) return;
    this.rotations += 1;
    const keys = this.list();
    const from = keys.indexOf(previous);
    logger.info("API key rotated", {
      service: this.name,
      ...(from >= 0 ? { fromSlot: from + 1 } : {}),
      toSlot: lease.slot,
      of: lease.total,
    });
  }

  /**
   * The service refused this key for a reason that is about the key: it rests, and the next request (or
   * the caller's next attempt) starts with another key. Returns how long it rests.
   */
  reportFailure(lease: KeyLease, reason: KeyFailureReason, retryAfterMs?: number): number {
    const restMs = this.restFor(reason, retryAfterMs);
    const now = this.now();
    this.resting.set(lease.key, { until: now + restMs, reason });
    // Before any success the first key asked was the active one in all but name: the next key's success is a rotation.
    this.activeKey ??= lease.key;
    // With one key there is nothing to rotate to, and the caller logs the failure itself.
    if (lease.total < 2) return restMs;
    const available = this.list().filter((key) => !this.restOf(key, now)).length;
    const fields = { service: this.name, slot: lease.slot, of: lease.total, reason, cooldownMs: restMs, available };
    if (available === 0) logger.warn("Every API key of this service is resting; the one that recovers first will still be asked", fields);
    else logger.warn("API key resting; the next key takes over", fields);
    return restMs;
  }

  status(): KeyRotatorStatus {
    const keys = this.list();
    const now = this.now();
    const first = this.plan()[0];
    const slots = keys.map((key, index): KeySlotStatus => {
      const rest = this.restOf(key, now);
      return {
        slot: index + 1,
        state: !rest ? "ready" : rest.reason === "auth_rejected" ? "rejected" : "cooling",
        active: first?.key === key,
        ...(rest ? { until: new Date(rest.until).toISOString(), reason: rest.reason } : {}),
      };
    });
    return {
      total: keys.length,
      available: slots.filter((slot) => slot.state === "ready").length,
      ...(first ? { activeSlot: first.slot } : {}),
      rotations: this.rotations,
      slots,
    };
  }

  /** True when some key is currently refused by the service (HTTP 401/403). For `/health`. */
  hasRejectedKey(): boolean {
    const now = this.now();
    return this.list().some((key) => this.restOf(key, now)?.reason === "auth_rejected");
  }

  private lease(keys: readonly string[], key: string): KeyLease {
    return { key, slot: keys.indexOf(key) + 1, total: keys.length };
  }

  /** The key's current rest, or undefined when it may be asked (an expired rest is forgotten). */
  private restOf(key: string, now: number): Rest | undefined {
    const rest = this.resting.get(key);
    if (!rest) return undefined;
    if (rest.until <= now) {
      this.resting.delete(key);
      return undefined;
    }
    return rest;
  }

  private restFor(reason: KeyFailureReason, retryAfterMs: number | undefined): number {
    const advised = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : undefined;
    if (reason === "rate_limited") return Math.min(Math.max(1_000, advised ?? this.cooldowns.rate_limited), MAX_RATE_LIMIT_COOLDOWN_MS);
    // A spent quota rests at least the default; a longer advised wait (a reset time) is followed.
    return Math.min(Math.max(this.cooldowns[reason], advised ?? 0), MAX_COOLDOWN_MS);
  }

  private list(): readonly string[] {
    const keys = this.options.keys();
    const joined = keys.join("\n");
    if (joined !== this.seen) {
      this.seen = joined;
      for (const key of keys) registerSecret(key);
      // A key that left the list takes its state with it.
      for (const key of [...this.resting.keys()]) if (!keys.includes(key)) this.resting.delete(key);
      if (this.activeKey !== undefined && !keys.includes(this.activeKey)) this.activeKey = undefined;
    }
    return keys;
  }
}

/**
 * The keys of one service from its environment variables: a comma-separated list (`GROQ_KEYS=k1,k2`) and
 * the single-key variable older deployments use (`GROQ_API_KEY`), in that order, each key once. Only a comma
 * separates keys. Each entry is trimmed and loses quotes pasted around it; empty entries are ignored.
 *
 * Whitespace INSIDE an entry is kept on purpose: a key pasted with a line break in it must stay one broken key,
 * which the adapter refuses before anything is sent, not become two half keys that are sent to the provider.
 * Returns at most {@link MAX_KEYS_PER_SERVICE} keys.
 */
export function parseKeyList(...sources: Array<string | readonly string[] | undefined>): string[] {
  const keys: string[] = [];
  for (const source of sources) {
    if (source === undefined) continue;
    const tokens = typeof source === "string" ? source.split(",") : source;
    for (const token of tokens) {
      const key = token.trim().replace(/^["']+|["']+$/g, "");
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys.slice(0, MAX_KEYS_PER_SERVICE);
}
