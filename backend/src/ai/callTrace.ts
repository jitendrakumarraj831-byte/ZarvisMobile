import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * One request-scoped record per logical AI provider call made while a user turn runs: the
 * planner's steps AND the calls skills make on their own (web search grounding, generation).
 * Retries inside one logical call are counted in `httpRequests`, not as separate calls.
 * Collected through AsyncLocalStorage so skills need no tracing parameter.
 */
export interface ModelCallRecord {
  modelCallId: string;
  kind: "planner" | "generation" | "search";
  configuredModel: string;
  /** The model that answered; differs from configuredModel after a fallback. Absent on failure. */
  servedModel?: string;
  httpRequests: number;
  outcome: "ok" | "error";
  /** Provider HTTP status of the final failed attempt. */
  status?: number;
  /** Why the call failed, as the provider said it: which quota and which model. */
  failure?: { code: string; quotaType?: string; quotaId?: string; quotaMetric?: string; model?: string };
}

const current = new AsyncLocalStorage<ModelCallRecord[]>();

/** Runs `fn` with a fresh call log; every provider call inside it is recorded there. */
export function withModelCallLog<T>(log: ModelCallRecord[], fn: () => Promise<T>): Promise<T> {
  return current.run(log, fn);
}

/** Starts one logical call. Returns its record (already in the active log, if any). */
export function beginModelCall(kind: ModelCallRecord["kind"], configuredModel: string, modelCallId?: string): ModelCallRecord {
  const record: ModelCallRecord = { modelCallId: modelCallId ?? randomUUID(), kind, configuredModel, httpRequests: 0, outcome: "error" };
  current.getStore()?.push(record);
  return record;
}
