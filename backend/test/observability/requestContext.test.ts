import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { correlationFields, correlationOf, requestIdMiddleware, runWithCorrelation } from "../../src/observability/requestContext.js";

function run(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requestIdMiddleware(req, res, next);
  return { req, setHeader, next };
}

describe("correlation scope", () => {
  it("is empty outside any scope, and carries the ids inside one", () => {
    expect(correlationFields()).toEqual({});
    runWithCorrelation({ requestId: "r1", turnId: "t1" }, () => {
      expect(correlationFields()).toEqual({ requestId: "r1", turnId: "t1" });
    });
    expect(correlationFields()).toEqual({});
  });

  it("nested scopes add to the outer ids instead of replacing them, and ignore empty values", async () => {
    await runWithCorrelation({ requestId: "r1", vercelId: "iad1::abc" }, async () => {
      await runWithCorrelation({ turnId: "t1", clientTurnId: undefined }, async () => {
        await Promise.resolve();
        expect(correlationFields()).toEqual({ requestId: "r1", vercelId: "iad1::abc", turnId: "t1" });
      });
      expect(correlationFields()).toEqual({ requestId: "r1", vercelId: "iad1::abc" });
    });
  });

  it("keeps concurrent scopes apart", async () => {
    const seen: string[] = [];
    await Promise.all(
      ["a", "b", "c"].map((id) =>
        runWithCorrelation({ turnId: id }, async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          seen.push(`${id}:${correlationFields().turnId}`);
        }),
      ),
    );
    expect(seen.sort()).toEqual(["a:a", "b:b", "c:c"]);
  });
});

describe("requestIdMiddleware", () => {
  it("gives each request its own id, answers it in X-Request-Id and continues", () => {
    const a = run();
    const b = run();
    const idA = correlationOf(a.req).requestId!;
    expect(idA).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationOf(b.req).requestId).not.toBe(idA);
    expect(a.setHeader).toHaveBeenCalledWith("X-Request-Id", idA);
    expect(a.next).toHaveBeenCalledOnce();
  });

  it("keeps the platform's own request id only when it is well-formed, so a forged header cannot inject log content", () => {
    expect(correlationOf(run({ "x-vercel-id": "fra1::iad1::q4k2z-1730000000000-ab12cd34ef56" }).req).vercelId).toBe("fra1::iad1::q4k2z-1730000000000-ab12cd34ef56");
    expect(correlationOf(run({ "x-vercel-id": 'x"},"level":"error' }).req).vercelId).toBeUndefined();
    expect(correlationOf(run({ "x-vercel-id": "a".repeat(500) }).req).vercelId).toBeUndefined();
  });

  it("never trusts a client-supplied request id", () => {
    const { req } = run({ "x-request-id": "attacker-chosen" });
    expect(correlationOf(req).requestId).not.toBe("attacker-chosen");
  });

  it("returns a copy, so a caller cannot change another's ids", () => {
    const { req } = run();
    const copy = correlationOf(req);
    copy.requestId = "changed";
    expect(correlationOf(req).requestId).not.toBe("changed");
    expect(correlationOf({ headers: {} } as unknown as Request)).toEqual({});
  });
});
