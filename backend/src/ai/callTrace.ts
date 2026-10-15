import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * One request-scoped record per upstream AI provider call made while a user turn runs: the
 * planner's steps AND the calls skills make on their own (web search grounding, generation).
 * Retries inside one provider call are counted in `httpRequests`, not as separate records.
 * Collected through AsyncLocalStorage so skills need no tracing parameter.
 *
 * When the ModelGateway falls back from one provider to another, the failed attempt and the
 * fallback attempt are two records that share one `modelCallId` (one logical call) and name their
 * own `provider`; the second carries `fallback: true` and the reason. A switch is therefore
 * always visible in the turn's log line.
 */
export interface ModelCallRecord {
  modelCallId: string;
  kind: "planner" | "generation" | "search" | "vision";
  configuredModel: string;
  /** The model that answered; differs from configuredModel after a fallback. Absent on failure. */
  servedModel?: string;
  httpRequests: number;
  outcome: "ok" | "error";
  /** Provider HTTP status of the final failed attempt. */
  status?: number;
  /** Why the call failed, as the provider said it: which quota and which model. */
  failure?: { code: string; quotaType?: string; quotaId?: string; quotaMetric?: string; model?: string };
  /** The provider that made this upstream call (`google`, `openrouter`). */
  provider?: string;
  /** True when this call answered a request that had already failed on its primary provider. */
  fallback?: boolean;
  fallbackReason?: string;
  /** Wall-clock time of this attempt, set by the gateway. */
  latencyMs?: number;
}

/** What a gateway attempt runs inside: records started in it are tagged and collected. */
export interface AttemptContext {
  provider: string;
  fallback: boolean;
  fallbackReason?: string;
  records: ModelCallRecord[];
}

const current = new AsyncLocalStorage<ModelCallRecord[]>();
const attempt = new AsyncLocalStorage<AttemptContext>();

/** Runs `fn` with a fresh call log; every provider call inside it is recorded there. */
export function withModelCallLog<T>(log: ModelCallRecord[], fn: () => Promise<T>): Promise<T> {
  return current.run(log, fn);
}

/** Runs `fn` as one gateway attempt: records it starts get the attempt's provider and fallback tags. */
export function withAttemptContext<T>(context: AttemptContext, fn: () => T): T {
  return attempt.run(context, fn);
}

/** Starts one upstream call. Returns its record (already in the active log, if any). */
export function beginModelCall(
  kind: ModelCallRecord["kind"],
  configuredModel: string,
  modelCallId?: string,
  provider?: string,
): ModelCallRecord {
  const scope = attempt.getStore();
  const record: ModelCallRecord = { modelCallId: modelCallId ?? randomUUID(), kind, configuredModel, httpRequests: 0, outcome: "error" };
  const owner = scope?.provider ?? provider;
  if (owner) record.provider = owner;
  if (scope?.fallback) {
    record.fallback = true;
    if (scope.fallbackReason) record.fallbackReason = scope.fallbackReason;
  }
  current.getStore()?.push(record);
  scope?.records.push(record);
  return record;
}
