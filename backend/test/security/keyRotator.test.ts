import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KEY_COOLDOWN_MS, KeyRotator, MAX_KEYS_PER_SERVICE, parseKeyList } from "../../src/security/keyRotator.js";
import { logger } from "../../src/security/redact.js";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function rotator(keys: string[], now = clock().now) {
  let list = keys;
  const pool = new KeyRotator({ name: "TEST", keys: () => list, now });
  return { pool, setKeys: (next: string[]) => (list = next) };
}

describe("parseKeyList", () => {
  it("reads a comma-separated list, then the single-key variable, each key once", () => {
    expect(parseKeyList("k1,k2", "k3")).toEqual(["k1", "k2", "k3"]);
    expect(parseKeyList("k1, k2 ,k1", "k2")).toEqual(["k1", "k2"]);
    expect(parseKeyList(undefined, "only")).toEqual(["only"]);
    expect(parseKeyList(undefined, undefined)).toEqual([]);
  });

  it("trims each entry and ignores empty ones", () => {
    expect(parseKeyList(" k1 ,\nk2\n,, k3 ,\n")).toEqual(["k1", "k2", "k3"]);
    expect(parseKeyList("  ,  ")).toEqual([]);
  });

  it("never splits a key at a line break or space inside it: a broken key stays one key, for the adapter to refuse", () => {
    expect(parseKeyList("sk-or-v1-abcdefgh\nijkl")).toEqual(["sk-or-v1-abcdefgh\nijkl"]);
    expect(parseKeyList(undefined, "half one")).toEqual(["half one"]);
  });

  it("removes quotes pasted around the list or a key", () => {
    expect(parseKeyList('"k1,k2"')).toEqual(["k1", "k2"]);
    expect(parseKeyList("'k1', \"k2\"")).toEqual(["k1", "k2"]);
  });

  it("keeps at most the per-service limit", () => {
    const many = Array.from({ length: MAX_KEYS_PER_SERVICE + 5 }, (_, i) => `key-${i}`).join(",");
    expect(parseKeyList(many)).toHaveLength(MAX_KEYS_PER_SERVICE);
  });
});

describe("KeyRotator", () => {
  it("starts with the first key and keeps using it while it works", () => {
    const { pool } = rotator(["a", "b", "c"]);
    expect(pool.plan().map((lease) => lease.key)).toEqual(["a", "b", "c"]);
    pool.reportSuccess(pool.plan()[0]!);
    expect(pool.current()).toBe("a");
    expect(pool.status()).toMatchObject({ total: 3, available: 3, activeSlot: 1, rotations: 0 });
  });

  it("rotates to the next key at once when the active key is rate limited, and sticks with the new one", () => {
    const time = clock();
    const { pool } = rotator(["a", "b", "c"], time.now);
    const [first] = pool.plan();
    pool.reportFailure(first!, "rate_limited");
    expect(pool.plan().map((lease) => lease.key)).toEqual(["b", "c"]);
    pool.reportSuccess(pool.plan()[0]!);
    expect(pool.current()).toBe("b");
    expect(pool.status().rotations).toBe(1);
    // After its rest the first key is eligible again, but the active key stays first (no ping-pong).
    time.advance(DEFAULT_KEY_COOLDOWN_MS.rate_limited);
    expect(pool.plan().map((lease) => lease.key)).toEqual(["b", "c", "a"]);
  });

  it("wraps around from the active key", () => {
    const { pool } = rotator(["a", "b", "c"]);
    pool.reportSuccess({ key: "c", slot: 3, total: 3 });
    expect(pool.plan().map((lease) => lease.slot)).toEqual([3, 1, 2]);
  });

  it("follows a service-advised wait for a rate limit, within bounds", () => {
    const time = clock();
    const { pool } = rotator(["a", "b"], time.now);
    expect(pool.reportFailure(pool.plan()[0]!, "rate_limited", 5_000)).toBe(5_000);
    time.advance(5_000);
    expect(pool.status().available).toBe(2);
    // A tiny or absurd advice is clamped.
    expect(pool.reportFailure(pool.plan()[0]!, "rate_limited", 10)).toBe(1_000);
    expect(pool.reportFailure(pool.plan()[0]!, "rate_limited", 99 * 60 * 60_000)).toBe(15 * 60_000);
  });

  it("rests a spent quota at least the default, longer when the service names a later reset", () => {
    const { pool } = rotator(["a", "b"]);
    expect(pool.reportFailure(pool.plan()[0]!, "quota_exhausted", 1_000)).toBe(DEFAULT_KEY_COOLDOWN_MS.quota_exhausted);
    expect(pool.reportFailure(pool.plan()[0]!, "quota_exhausted", 2 * 60 * 60_000)).toBe(2 * 60 * 60_000);
  });

  it("asks only the key that recovers first while every key is resting (one request, like a single key)", () => {
    const time = clock();
    const { pool } = rotator(["a", "b", "c"], time.now);
    pool.reportFailure({ key: "a", slot: 1, total: 3 }, "quota_exhausted");
    pool.reportFailure({ key: "b", slot: 2, total: 3 }, "rate_limited", 2_000);
    pool.reportFailure({ key: "c", slot: 3, total: 3 }, "auth_rejected");
    expect(pool.plan().map((lease) => lease.key)).toEqual(["b"]);
    expect(pool.status().available).toBe(0);
  });

  it("asks a single key every time, even while it rests", () => {
    const { pool } = rotator(["solo"]);
    pool.reportFailure(pool.plan()[0]!, "rate_limited");
    expect(pool.plan().map((lease) => lease.key)).toEqual(["solo"]);
    expect(pool.hasAlternative("solo")).toBe(false);
  });

  it("says whether another key could be asked right now", () => {
    const { pool } = rotator(["a", "b"]);
    expect(pool.hasAlternative("a")).toBe(true);
    pool.reportFailure({ key: "b", slot: 2, total: 2 }, "rate_limited");
    expect(pool.hasAlternative("a")).toBe(false);
  });

  it("a success ends that key's rest", () => {
    const { pool } = rotator(["a", "b"]);
    pool.reportFailure({ key: "a", slot: 1, total: 2 }, "auth_rejected");
    expect(pool.hasRejectedKey()).toBe(true);
    pool.reportSuccess({ key: "a", slot: 1, total: 2 });
    expect(pool.hasRejectedKey()).toBe(false);
    expect(pool.status().available).toBe(2);
  });

  it("reports each slot without ever exposing a key", () => {
    const time = clock(0);
    const { pool } = rotator(["secret-one", "secret-two", "secret-three"], time.now);
    pool.reportFailure({ key: "secret-one", slot: 1, total: 3 }, "auth_rejected");
    pool.reportFailure({ key: "secret-two", slot: 2, total: 3 }, "rate_limited", 4_000);
    const status = pool.status();
    expect(status).toEqual({
      total: 3,
      available: 1,
      activeSlot: 3,
      rotations: 0,
      slots: [
        { slot: 1, state: "rejected", active: false, until: new Date(DEFAULT_KEY_COOLDOWN_MS.auth_rejected).toISOString(), reason: "auth_rejected" },
        { slot: 2, state: "cooling", active: false, until: new Date(4_000).toISOString(), reason: "rate_limited" },
        { slot: 3, state: "ready", active: true },
      ],
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("logs rotations and rests by slot, never by key", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    try {
      const { pool } = rotator(["sk-live-AAAA", "sk-live-BBBB"]);
      pool.reportSuccess(pool.plan()[0]!);
      pool.reportFailure(pool.plan()[0]!, "quota_exhausted");
      pool.reportSuccess(pool.plan()[0]!);
      const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
      expect(logged).not.toContain("sk-live");
      expect(warn).toHaveBeenCalledWith("API key resting; the next key takes over", expect.objectContaining({ service: "TEST", slot: 1, of: 2, reason: "quota_exhausted", available: 1 }));
      expect(info).toHaveBeenCalledWith("API key rotated", { service: "TEST", fromSlot: 1, toSlot: 2, of: 2 });
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it("reads the key list on every use: a key added later is used, a removed key's state goes with it", () => {
    const { pool, setKeys } = rotator([]);
    expect(pool.hasKeys()).toBe(false);
    expect(pool.plan()).toEqual([]);
    setKeys(["late"]);
    expect(pool.current()).toBe("late");
    pool.reportFailure(pool.plan()[0]!, "auth_rejected");
    setKeys(["fresh"]);
    expect(pool.hasRejectedKey()).toBe(false);
    expect(pool.current()).toBe("fresh");
    // The resting state of a key that comes back was forgotten when it left.
    setKeys(["late", "fresh"]);
    expect(pool.status().available).toBe(2);
  });
});
