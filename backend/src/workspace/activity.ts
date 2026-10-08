import { taskLifecycle, type Task } from "../domain/types.js";
import type { ActivityEntry, Project, ToolExecutionRecord, WorkspaceFileSummary, WorkspaceNote } from "../domain/workspace.js";
import type { Conversation } from "../store/store.js";

const clip = (text: string, max = 140) => (text.length > max ? text.slice(0, max - 1) + "…" : text);

function toneFor(status: string): ActivityEntry["tone"] {
  if (status === "COMPLETED") return "ok";
  if (status === "CONFIRMATION_REQUIRED" || status === "PERMISSION_REQUIRED" || status === "USER_ACTION_REQUIRED") return "pending";
  if (status === "FAILED" || status === "DENIED" || status === "UNSUPPORTED") return "error";
  return "neutral";
}

const STATUS_WORDS: Record<string, string> = {
  COMPLETED: "Completed",
  FAILED: "Couldn't complete",
  DENIED: "Not done",
  CONFIRMATION_REQUIRED: "Waiting for your confirmation",
  PERMISSION_REQUIRED: "Needs permission",
  USER_ACTION_REQUIRED: "Needs your input",
  UNSUPPORTED: "Not available",
};

const TASK_WORDS: Record<string, string> = {
  QUEUED: "Queued (not started)",
  RUNNING: "Running",
  EXECUTING: "Running a tool",
  VERIFYING: "Checking the result",
  WAITING: "Waiting for you to start the next step",
  CONFIRMATION_REQUIRED: "Waiting for your approval",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  BLOCKED: "Blocked",
};

export interface ActivitySources {
  executions?: ToolExecutionRecord[];
  tasks?: Task[];
  files?: WorkspaceFileSummary[];
  notes?: WorkspaceNote[];
  conversations?: Conversation[];
  projects?: Project[];
}

/**
 * One merged, newest-first feed of what really happened, built only from stored records:
 * tool executions, task updates, saved files and notes, chats and projects. A pending
 * confirmation that was later approved is represented by the execution it produced, not twice.
 */
export function buildActivity(sources: ActivitySources, limit: number): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const executed = new Set((sources.executions ?? []).filter((e) => e.status !== "CONFIRMATION_REQUIRED" && e.confirmationId).map((e) => e.confirmationId));

  for (const e of sources.executions ?? []) {
    if (e.status === "CONFIRMATION_REQUIRED" && e.confirmationId && executed.has(e.confirmationId)) continue;
    entries.push({
      id: "tool:" + e.id,
      type: "tool",
      title: e.skillName,
      detail: STATUS_WORDS[e.status] ?? e.status,
      tone: toneFor(e.status),
      at: e.createdAt.toISOString(),
      ref: { kind: "execution", id: e.id, ...(e.projectId ? { projectId: e.projectId } : {}) },
    });
  }
  for (const t of sources.tasks ?? []) {
    const lifecycle = taskLifecycle(t);
    entries.push({
      id: "task:" + t.id,
      type: "task",
      title: clip(t.goal),
      detail: TASK_WORDS[lifecycle] ?? lifecycle,
      tone: lifecycle === "COMPLETED" ? "ok" : lifecycle === "FAILED" || lifecycle === "BLOCKED" ? "error" : lifecycle === "CONFIRMATION_REQUIRED" ? "pending" : "neutral",
      at: (t.updatedAt ?? t.createdAt).toISOString(),
      ref: { kind: "task", id: t.id, ...(t.projectId ? { projectId: t.projectId } : {}) },
    });
  }
  for (const f of sources.files ?? []) {
    entries.push({
      id: "file:" + f.id,
      type: "file",
      title: clip(f.name),
      detail: f.source === "generated" ? "Saved output" : "Uploaded file",
      tone: "ok",
      at: f.createdAt.toISOString(),
      ref: { kind: "file", id: f.id, ...(f.projectId ? { projectId: f.projectId } : {}) },
    });
  }
  for (const n of sources.notes ?? []) {
    if (n.kind === "memory" && !n.projectId) continue; // personal memory is listed under Memory, not in the feed
    entries.push({
      id: "note:" + n.id,
      type: "note",
      title: clip(n.content),
      detail: { decision: "Decision", memory: "Project memory", note: "Note", research: "Research note" }[n.kind],
      tone: "neutral",
      at: n.createdAt.toISOString(),
      ref: { kind: "note", id: n.id, ...(n.projectId ? { projectId: n.projectId } : {}) },
    });
  }
  for (const c of sources.conversations ?? []) {
    entries.push({
      id: "chat:" + c.id,
      type: "chat",
      title: clip(c.title ?? "Chat"),
      detail: "Chat",
      tone: "neutral",
      at: c.updatedAt.toISOString(),
      ref: { kind: "conversation", id: c.id, ...(c.projectId ? { projectId: c.projectId } : {}) },
    });
  }
  for (const p of sources.projects ?? []) {
    entries.push({
      id: "project:" + p.id,
      type: "project",
      title: clip(p.name),
      detail: p.status === "ARCHIVED" ? "Archived project" : "Project",
      tone: "neutral",
      at: p.updatedAt.toISOString(),
      ref: { kind: "project", id: p.id },
    });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
