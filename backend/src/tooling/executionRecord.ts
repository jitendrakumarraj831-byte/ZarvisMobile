import type { SkillDefinition, SkillExecutionContext, ToolCall, ToolExecutionOutcome } from "../domain/types.js";
import type { ToolExecutionRecord } from "../domain/workspace.js";
import { explainOutcome } from "./explainOutcome.js";
import { toStructuredResult } from "./toolResult.js";

/** Where the pipeline writes the ledger of what it really ran. Kept as a port so tests need no store. */
export interface ExecutionLogPort {
  record(record: ToolExecutionRecord): Promise<void>;
}

const MAX_STRING = 8_000;
const MAX_ITEMS = 40;
const MAX_DEPTH = 5;
const MAX_JSON_BYTES = 40_000;
const SUMMARY_MAX = 600;
const PREVIEW_STRING = 200;

/** Inputs that can be whole documents or secrets: the ledger keeps their size, never their content. */
const WITHHELD_INPUT_KEYS = /^(text|content|body|document|password|token|secret)$/i;

/** Copies a value with every string, list and level bounded, so one execution cannot fill the database. */
export function boundValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? value.slice(0, MAX_STRING - 1) + "…" : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => boundValue(item, depth + 1));
  if (typeof value === "object" && value !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      const bounded = boundValue(item, depth + 1);
      if (bounded !== undefined) out[key] = bounded;
    }
    return out;
  }
  return undefined;
}

/** The bounded output of a successful run, or a marker when even the bounded copy is too large. */
export function boundOutput(output: Record<string, unknown>): Record<string, unknown> {
  const bounded = boundValue(output) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(bounded), "utf8") <= MAX_JSON_BYTES) return bounded;
  return { truncated: true, keys: Object.keys(output).slice(0, MAX_ITEMS) };
}

/** A short, safe description of what a tool was asked: a query, a repository URL, the size of a document. */
export function previewInput(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values).slice(0, 8)) {
    if (typeof value === "string") {
      out[key] = WITHHELD_INPUT_KEYS.test(key) ? `[${value.length} characters]` : value.length > PREVIEW_STRING ? value.slice(0, PREVIEW_STRING - 1) + "…" : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (value !== undefined && value !== null) {
      out[key] = "[" + (Array.isArray(value) ? "list" : "object") + "]";
    }
  }
  return out;
}

/** The ledger row for one pipeline outcome, or undefined for a call that named no registered skill. */
export function buildExecutionRecord(
  skill: SkillDefinition | undefined,
  call: ToolCall,
  context: SkillExecutionContext,
  outcome: ToolExecutionOutcome,
  now: Date,
): ToolExecutionRecord | undefined {
  if (!skill) return undefined;
  const message = explainOutcome(outcome);
  const structured = toStructuredResult(skill.id, skill, outcome, message);
  return {
    id: call.id,
    accountId: context.accountId,
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.taskId ? { taskId: context.taskId } : {}),
    skillId: skill.id,
    skillName: skill.name,
    category: skill.category,
    status: structured.status,
    summary: message.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX),
    ...(outcome.kind === "success" ? { output: boundOutput(outcome.result.output) } : {}),
    ...(structured.verificationEvidence ? { evidence: structured.verificationEvidence } : {}),
    inputPreview: previewInput(call.input.values),
    ...(outcome.kind === "confirmation_required"
      ? { confirmationId: outcome.confirmation.id }
      : context.confirmationGrant ? { confirmationId: context.confirmationGrant.confirmationId } : {}),
    creditsCharged: outcome.kind === "success" ? outcome.chargedCredits : 0,
    createdAt: now,
  };
}
