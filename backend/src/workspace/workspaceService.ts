import { randomUUID } from "node:crypto";
import { findAgent } from "../agents/agentProfiles.js";
import { taskLifecycle } from "../domain/types.js";
import {
  MAX_FILE_TEXT_CHARS,
  type ActivityEntry,
  type NoteSource,
  type Project,
  type ProjectStatus,
  type WorkspaceFile,
  type WorkspaceFileKind,
  type WorkspaceNote,
  type WorkspaceNoteKind,
} from "../domain/workspace.js";
import type { Store } from "../store/store.js";
import { isOpen, taskView } from "../tasks/taskView.js";
import { buildActivity } from "./activity.js";
import { LIMITS } from "./limits.js";
import { conversationView, executionView, fileSummaryView, fileView, noteView, projectView } from "./views.js";

/** A refusal the route can send as-is: the status, a stable code and a message that says what is wrong. */
export class WorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const NOTE_KINDS: WorkspaceNoteKind[] = ["decision", "memory", "note", "research"];
const PROJECT_STATUSES: ProjectStatus[] = ["ACTIVE", "ARCHIVED"];

function text(value: unknown, field: string, max: number, { required = false, fallback = "" }: { required?: boolean; fallback?: string } = {}): string {
  if (value === undefined || value === null) {
    if (required) throw new WorkspaceError(400, "invalid_request", `${field} is required.`);
    return fallback;
  }
  if (typeof value !== "string") throw new WorkspaceError(400, "invalid_request", `${field} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new WorkspaceError(400, "invalid_request", `${field} is required.`);
  if (trimmed.length > max) throw new WorkspaceError(400, "invalid_request", `${field} must be at most ${max} characters.`);
  return trimmed;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export class WorkspaceService {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---- Projects ----------------------------------------------------------------------------

  async createProject(accountId: string, body: Record<string, unknown>): Promise<Project> {
    const name = text(body.name, "name", LIMITS.projectName, { required: true });
    const description = text(body.description, "description", LIMITS.projectDescription);
    const goal = text(body.goal, "goal", LIMITS.projectGoal);
    const agentId = this.agentIdOf(body.agentId);
    const active = await this.store.listProjects(accountId, { status: "ACTIVE" });
    if (active.length >= LIMITS.maxProjects) {
      throw new WorkspaceError(409, "limit_reached", `You can keep up to ${LIMITS.maxProjects} active projects. Archive or delete one first.`);
    }
    const now = this.now();
    return this.store.createProject({ id: randomUUID(), accountId, name, description, goal, status: "ACTIVE", ...(agentId ? { agentId } : {}), createdAt: now, updatedAt: now });
  }

  async updateProject(accountId: string, projectId: string, body: Record<string, unknown>): Promise<Project> {
    const project = await this.requireProject(accountId, projectId);
    const next: Project = { ...project, updatedAt: this.now() };
    if (body.name !== undefined) next.name = text(body.name, "name", LIMITS.projectName, { required: true });
    if (body.description !== undefined) next.description = text(body.description, "description", LIMITS.projectDescription);
    if (body.goal !== undefined) next.goal = text(body.goal, "goal", LIMITS.projectGoal);
    if (body.agentId !== undefined) {
      const agentId = this.agentIdOf(body.agentId);
      if (agentId) next.agentId = agentId;
      else delete next.agentId;
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !PROJECT_STATUSES.includes(body.status as ProjectStatus)) {
        throw new WorkspaceError(400, "invalid_request", "status must be ACTIVE or ARCHIVED.");
      }
      next.status = body.status as ProjectStatus;
    }
    return this.store.updateProject(next);
  }

  async deleteProject(accountId: string, projectId: string): Promise<void> {
    if (!(await this.store.deleteProject(accountId, projectId))) throw new WorkspaceError(404, "project_not_found", "Project not found.");
  }

  async requireProject(accountId: string, projectId: string): Promise<Project> {
    const project = await this.store.getProject(accountId, projectId);
    if (!project) throw new WorkspaceError(404, "project_not_found", "Project not found.");
    return project;
  }

  /** Every project with real counts of what is stored in it. */
  async listProjects(accountId: string, status?: ProjectStatus) {
    const [projects, conversations, tasks, files, notes] = await Promise.all([
      this.store.listProjects(accountId, status ? { status } : {}),
      this.store.listConversations(accountId, 500),
      this.store.listTasksForAccount(accountId),
      this.store.listFiles(accountId),
      this.store.listNotes(accountId),
    ]);
    return projects.map((project) => ({
      ...projectView(project),
      counts: {
        conversations: conversations.filter((c) => c.projectId === project.id).length,
        tasks: tasks.filter((t) => t.projectId === project.id).length,
        openTasks: tasks.filter((t) => t.projectId === project.id && isOpen(t)).length,
        files: files.filter((f) => f.projectId === project.id).length,
        decisions: notes.filter((n) => n.projectId === project.id && n.kind === "decision").length,
        memory: notes.filter((n) => n.projectId === project.id && n.kind === "memory").length,
        research: notes.filter((n) => n.projectId === project.id && n.kind === "research").length,
        notes: notes.filter((n) => n.projectId === project.id && n.kind === "note").length,
      },
    }));
  }

  /**
   * Everything stored for one project, and what "Continue work" would pick up: the last chat, the open tasks
   * and the actions still waiting for an approval. All of it is read back from storage.
   */
  async projectDetail(accountId: string, projectId: string) {
    const project = await this.requireProject(accountId, projectId);
    const now = this.now();
    const [conversations, allTasks, files, notes, executions] = await Promise.all([
      this.store.listConversations(accountId, 100, { projectId }),
      this.store.listTasksForAccount(accountId),
      this.store.listFiles(accountId, { projectId }),
      this.store.listNotes(accountId, { projectId }),
      this.store.listExecutions(accountId, { projectId, limit: 60 }),
    ]);
    const tasks = allTasks.filter((t) => t.projectId === projectId);
    const openTasks = tasks.filter(isOpen);

    // An action is "pending" only while its confirmation is still pending and unexpired on the server.
    const pendingActions: Array<{ executionId: string; skillName: string; action: string; confirmationId: string; riskLevel: string; actionClass: string; expiresAt: string }> = [];
    for (const execution of executions) {
      if (pendingActions.length >= 5) break;
      if (execution.status !== "CONFIRMATION_REQUIRED" || !execution.confirmationId) continue;
      const confirmation = await this.store.getConfirmation(accountId, execution.confirmationId);
      if (confirmation && confirmation.status === "PENDING" && confirmation.expiresAt.getTime() > now.getTime()) {
        pendingActions.push({ executionId: execution.id, skillName: execution.skillName, action: confirmation.action, confirmationId: confirmation.id, riskLevel: confirmation.riskLevel, actionClass: confirmation.actionClass, expiresAt: confirmation.expiresAt.toISOString() });
      }
    }

    const activity = buildActivity({ executions, tasks, files, notes, conversations }, 40);
    return {
      project: projectView(project),
      counts: {
        conversations: conversations.length,
        tasks: tasks.length,
        openTasks: openTasks.length,
        files: files.length,
        decisions: notes.filter((n) => n.kind === "decision").length,
        memory: notes.filter((n) => n.kind === "memory").length,
        research: notes.filter((n) => n.kind === "research").length,
        notes: notes.filter((n) => n.kind === "note").length,
      },
      conversations: conversations.map(conversationView),
      tasks: tasks.map((t) => taskView(t, now)),
      files: files.map(fileSummaryView),
      notes: notes.map(noteView),
      executions: executions.map(executionView),
      activity,
      continue: {
        lastConversation: conversations[0] ? conversationView(conversations[0]) : null,
        openTasks: openTasks.map((t) => ({ id: t.id, goal: t.goal, lifecycle: taskLifecycle(t) })),
        pendingActions,
        lastActivityAt: activity[0]?.at ?? project.updatedAt.toISOString(),
      },
    };
  }

  async moveConversation(accountId: string, conversationId: string, projectId: unknown) {
    if (projectId !== null && typeof projectId !== "string") throw new WorkspaceError(400, "invalid_request", "projectId must be a project id or null.");
    if (typeof projectId === "string") await this.requireProject(accountId, projectId);
    const moved = await this.store.setConversationProject(accountId, conversationId, projectId);
    if (!moved) throw new WorkspaceError(404, "conversation_not_found", "Conversation not found.");
    return conversationView(moved);
  }

  // ---- Notes (decisions, project memory, research notes) and personal memory ---------------

  async createNote(accountId: string, body: Record<string, unknown>): Promise<WorkspaceNote> {
    if (typeof body.kind !== "string" || !NOTE_KINDS.includes(body.kind as WorkspaceNoteKind)) {
      throw new WorkspaceError(400, "invalid_request", `kind must be one of ${NOTE_KINDS.join(", ")}.`);
    }
    const kind = body.kind as WorkspaceNoteKind;
    const content = text(body.content, "content", LIMITS.noteContent, { required: true });
    const projectId = body.projectId === undefined || body.projectId === null ? undefined : String(body.projectId);
    if (projectId) await this.requireProject(accountId, projectId);
    if ((kind === "decision" || kind === "note") && !projectId) {
      throw new WorkspaceError(400, "invalid_request", `A ${kind} belongs to a project: projectId is required.`);
    }
    if ((await this.store.listNotes(accountId)).length >= LIMITS.maxNotes) {
      throw new WorkspaceError(409, "limit_reached", `You can keep up to ${LIMITS.maxNotes} notes. Delete some first.`);
    }
    const { sources, executionId } = await this.verifiedSources(accountId, kind, body);
    const now = this.now();
    const note = await this.store.createNote({
      id: randomUUID(), accountId, ...(projectId ? { projectId } : {}), kind, content, enabled: true, sources, ...(executionId ? { executionId } : {}), createdAt: now, updatedAt: now,
    });
    if (projectId) await this.touchProject(accountId, projectId);
    return note;
  }

  async updateNote(accountId: string, noteId: string, body: Record<string, unknown>): Promise<WorkspaceNote> {
    const note = await this.store.getNote(accountId, noteId);
    if (!note) throw new WorkspaceError(404, "note_not_found", "Note not found.");
    const next: WorkspaceNote = { ...note, updatedAt: this.now() };
    if (body.content !== undefined) next.content = text(body.content, "content", LIMITS.noteContent, { required: true });
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new WorkspaceError(400, "invalid_request", "enabled must be true or false.");
      if (note.kind !== "memory") throw new WorkspaceError(400, "invalid_request", "Only memory can be paused.");
      next.enabled = body.enabled;
    }
    const saved = await this.store.updateNote(next);
    if (saved.projectId) await this.touchProject(accountId, saved.projectId);
    return saved;
  }

  async deleteNote(accountId: string, noteId: string): Promise<void> {
    if (!(await this.store.deleteNote(accountId, noteId))) throw new WorkspaceError(404, "note_not_found", "Note not found.");
  }

  async listNotes(accountId: string, filter: { projectId?: string | null; kind?: string }): Promise<WorkspaceNote[]> {
    if (filter.kind !== undefined && !NOTE_KINDS.includes(filter.kind as WorkspaceNoteKind)) {
      throw new WorkspaceError(400, "invalid_request", `kind must be one of ${NOTE_KINDS.join(", ")}.`);
    }
    return this.store.listNotes(accountId, { ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}), ...(filter.kind ? { kind: filter.kind as WorkspaceNoteKind } : {}) });
  }

  /**
   * A research note may carry sources, but only real ones: each URL must appear in the results of a web
   * search the account actually ran (the execution it names). A citation cannot be made up.
   */
  private async verifiedSources(accountId: string, kind: WorkspaceNoteKind, body: Record<string, unknown>): Promise<{ sources: NoteSource[]; executionId?: string }> {
    const requested = body.sources;
    const executionId = typeof body.executionId === "string" ? body.executionId : undefined;
    if ((requested === undefined || (Array.isArray(requested) && requested.length === 0)) && !executionId) return { sources: [] };
    if (kind !== "research") throw new WorkspaceError(400, "invalid_request", "Only a research note can carry sources.");
    if (!executionId) throw new WorkspaceError(400, "unverified_sources", "Sources must come from a search ZARVIS ran: executionId is required.");
    const execution = await this.store.getExecution(accountId, executionId);
    if (!execution || execution.skillId !== "web.search" || execution.status !== "COMPLETED") {
      throw new WorkspaceError(400, "unverified_sources", "That search was not found, so its sources can't be saved.");
    }
    const real = new Map<string, string>();
    for (const item of Array.isArray(execution.output?.results) ? (execution.output!.results as unknown[]) : []) {
      const r = item as { url?: unknown; title?: unknown };
      if (typeof r?.url === "string") real.set(r.url, typeof r.title === "string" ? r.title : r.url);
    }
    if (requested === undefined) return { sources: [], executionId };
    if (!Array.isArray(requested) || requested.length > LIMITS.noteSources) {
      throw new WorkspaceError(400, "invalid_request", `sources must be a list of at most ${LIMITS.noteSources} links.`);
    }
    const sources: NoteSource[] = [];
    for (const item of requested) {
      const url = typeof item === "string" ? item : (item as { url?: unknown })?.url;
      if (typeof url !== "string" || url.length > LIMITS.sourceUrl || !isHttpUrl(url)) throw new WorkspaceError(400, "invalid_request", "Each source needs a valid http(s) link.");
      if (!real.has(url)) throw new WorkspaceError(400, "unverified_sources", "A source was not in the results of that search, so it was not saved.");
      sources.push({ title: real.get(url)!.slice(0, LIMITS.sourceTitle), url });
    }
    return { sources, executionId };
  }

  async memoryOverview(accountId: string) {
    const account = await this.store.getAccount(accountId);
    const [notes, projects] = await Promise.all([this.store.listNotes(accountId, { kind: "memory" }), this.store.listProjects(accountId)]);
    return {
      enabled: account?.memoryEnabled !== false,
      personal: notes.filter((n) => !n.projectId).map(noteView),
      projects: projects
        .map((project) => ({ id: project.id, name: project.name, status: project.status, items: notes.filter((n) => n.projectId === project.id).map(noteView) }))
        .filter((project) => project.items.length > 0),
      limits: { conversationMessages: LIMITS.conversationWindow, memoryItemsUsed: LIMITS.memoryInPrompt },
    };
  }

  async setMemoryEnabled(accountId: string, enabled: unknown): Promise<boolean> {
    if (typeof enabled !== "boolean") throw new WorkspaceError(400, "invalid_request", "enabled must be true or false.");
    return (await this.store.setMemoryEnabled(accountId, enabled)).memoryEnabled !== false;
  }

  async forgetPersonalMemory(accountId: string): Promise<number> {
    return this.store.deletePersonalMemory(accountId);
  }

  // ---- Files -------------------------------------------------------------------------------

  /** Saves already-extracted or generated text. The original binary of an upload is never kept. */
  async saveFile(
    accountId: string,
    input: { name: unknown; text: unknown; projectId?: unknown; mimeType?: string; kind?: WorkspaceFileKind; source: WorkspaceFile["source"]; sizeBytes?: number; note?: string },
  ): Promise<WorkspaceFile> {
    const name = text(input.name, "name", LIMITS.fileName, { required: true });
    const body = typeof input.text === "string" ? input.text.trim() : "";
    if (!body) throw new WorkspaceError(400, "invalid_request", "There is no text to save.");
    if (body.length > MAX_FILE_TEXT_CHARS) throw new WorkspaceError(413, "document_too_long", `Text is limited to ${MAX_FILE_TEXT_CHARS} characters.`);
    const projectId = input.projectId === undefined || input.projectId === null ? undefined : String(input.projectId);
    if (projectId) await this.requireProject(accountId, projectId);
    if ((await this.store.listFiles(accountId)).length >= LIMITS.maxFiles) {
      throw new WorkspaceError(409, "limit_reached", `You can keep up to ${LIMITS.maxFiles} files. Delete some first.`);
    }
    const file = await this.store.createFile({
      id: randomUUID(),
      accountId,
      ...(projectId ? { projectId } : {}),
      name,
      mimeType: input.mimeType ?? "text/plain",
      kind: input.kind ?? "text",
      source: input.source,
      sizeBytes: input.sizeBytes ?? Buffer.byteLength(body, "utf8"),
      text: body,
      ...(input.note ? { note: input.note } : {}),
      createdAt: this.now(),
    });
    if (projectId) await this.touchProject(accountId, projectId);
    return file;
  }

  async getFile(accountId: string, fileId: string): Promise<WorkspaceFile> {
    const file = await this.store.getFile(accountId, fileId);
    if (!file) throw new WorkspaceError(404, "file_not_found", "File not found.");
    return file;
  }

  async updateFile(accountId: string, fileId: string, body: Record<string, unknown>): Promise<WorkspaceFile> {
    const file = await this.getFile(accountId, fileId);
    const next = { ...file };
    if (body.name !== undefined) next.name = text(body.name, "name", LIMITS.fileName, { required: true });
    if (body.projectId !== undefined) {
      if (body.projectId === null) delete next.projectId;
      else {
        await this.requireProject(accountId, String(body.projectId));
        next.projectId = String(body.projectId);
      }
    }
    return this.store.updateFile(next);
  }

  async deleteFile(accountId: string, fileId: string): Promise<void> {
    if (!(await this.store.deleteFile(accountId, fileId))) throw new WorkspaceError(404, "file_not_found", "File not found.");
  }

  // ---- Activity ----------------------------------------------------------------------------

  async activity(accountId: string, options: { projectId?: string; limit: number }): Promise<ActivityEntry[]> {
    const { projectId, limit } = options;
    if (projectId) await this.requireProject(accountId, projectId);
    const per = 60;
    const [executions, tasks, files, notes, conversations, projects] = await Promise.all([
      this.store.listExecutions(accountId, { ...(projectId ? { projectId } : {}), limit: per }),
      this.store.listTasksForAccount(accountId),
      this.store.listFiles(accountId, { ...(projectId ? { projectId } : {}), limit: per }),
      this.store.listNotes(accountId, projectId ? { projectId } : {}),
      this.store.listConversations(accountId, per, projectId ? { projectId } : {}),
      projectId ? Promise.resolve([]) : this.store.listProjects(accountId),
    ]);
    return buildActivity(
      {
        executions,
        tasks: tasks.filter((t) => !projectId || t.projectId === projectId).slice(-per),
        files,
        notes: notes.slice(-per),
        conversations,
        projects: projects.slice(0, 20),
      },
      limit,
    );
  }

  // ---- helpers -----------------------------------------------------------------------------

  private agentIdOf(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const agent = findAgent(value);
    if (!agent) throw new WorkspaceError(400, "invalid_agent", "Unknown agent.");
    return agent.id;
  }

  private async touchProject(accountId: string, projectId: string): Promise<void> {
    const project = await this.store.getProject(accountId, projectId);
    if (project) await this.store.updateProject({ ...project, updatedAt: this.now() });
  }
}
