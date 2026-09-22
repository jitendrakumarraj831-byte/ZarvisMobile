import { describe, expect, it, vi } from "vitest";

/**
 * Reproduces, without a live database, the exact production symptom this test guards
 * against: a single transient failure on a warm serverless instance's first schema-creation
 * query used to poison every request that instance ever served afterward (see
 * PostgresStore.ensureSchema's fix comment). Mocks `pg`'s `Pool` so the very first `query()`
 * call (schema creation) rejects once, then succeeds on every call after — simulating a
 * cold-start connection blip that has since cleared.
 */
const queryMock = vi.fn();

vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: queryMock,
      connect: vi.fn(),
    })),
  };
});

describe("PostgresStore.ensureSchema retry behavior", () => {
  it("retries schema creation on the next call after a transient failure, instead of staying poisoned forever", async () => {
    const { PostgresStore } = await import("../../src/store/postgresStore.js");

    let call = 0;
    queryMock.mockImplementation((sql: string) => {
      call += 1;
      if (call === 1) {
        // The schema-creation query (first call) fails once — a stand-in for a transient
        // connection blip on cold start.
        return Promise.reject(new Error("Connection terminated unexpectedly"));
      }
      // Every call after that succeeds — schema creation on retry, then the real INSERT.
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const store = new PostgresStore("postgres://user:pass@example.com:5432/db");

    await expect(store.createUser("first-attempt@example.com", "hash")).rejects.toThrow(
      "Connection terminated unexpectedly",
    );

    // Without the fix, this second call would re-await the same cached rejected promise and
    // fail identically forever, even though the underlying connection has recovered.
    await expect(store.createUser("second-attempt@example.com", "hash")).resolves.toMatchObject({
      email: "second-attempt@example.com",
    });

    expect(call).toBeGreaterThanOrEqual(3); // failed schema attempt, retried schema attempt, then the INSERT(s)
  });
});
