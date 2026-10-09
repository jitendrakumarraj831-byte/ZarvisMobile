/**
 * Workspace records: projects, the notes/decisions/memory kept in them, saved files and the
 * ledger of real tool executions. Everything here is persisted by the Store; the web client
 * shows exactly these records and nothing it cannot read back from the server.
 */

export type ProjectStatus = "ACTIVE" | "ARCHIVED";

export interface Project {
  id: string;
  accountId: string;
  name: string;
  description: string;
  goal: string;
  status: ProjectStatus;
  /** The agent (agents/agentProfiles.ts) the project is mainly worked with; informational. */
  agentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * - `decision`: something the user decided in a project.
 * - `memory`: a fact ZARVIS may use. With a projectId it is that project's memory, without one it is the user's personal memory.
 * - `note`: free note in a project.
 * - `research`: a note the user saved from research; `sources` are real links taken from a stored search execution.
 */
export type WorkspaceNoteKind = "decision" | "memory" | "note" | "research";

export interface NoteSource {
  title: string;
  url: string;
}

export interface WorkspaceNote {
  id: string;
  accountId: string;
  projectId?: string;
  kind: WorkspaceNoteKind;
  content: string;
  /** Memory only: a paused memory stays listed but is not given to the model. */
  enabled: boolean;
  sources: NoteSource[];
  /** The tool execution the note was taken from, when it was saved from one. */
  executionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceFileKind = "document" | "image" | "text";
export type WorkspaceFileSource = "upload" | "generated";

/**
 * A file the user keeps in ZARVIS. Only the text ZARVIS extracted (or generated) is stored: the
 * original binary is not kept, and the UI says so.
 */
export interface WorkspaceFile {
  id: string;
  accountId: string;
  projectId?: string;
  name: string;
  mimeType: string;
  kind: WorkspaceFileKind;
  source: WorkspaceFileSource;
  /** Size of the original upload in bytes (generated files: the size of the text). */
  sizeBytes: number;
  /** Extracted or generated text, at most MAX_FILE_TEXT_CHARS. */
  text: string;
  /** For an image: the analysis text is `text`; this says so, so the UI never shows it as the picture. */
  note?: string;
  createdAt: Date;
}

/** A file as listed: everything but the text, which can be 60,000 characters. */
export type WorkspaceFileSummary = Omit<WorkspaceFile, "text"> & { textLength: number };

export const MAX_FILE_TEXT_CHARS = 60_000;

/** One recorded tool execution (every ToolPipeline.execute outcome that was evaluated). */
export interface ToolExecutionRecord {
  /** The toolCallId of the execution. */
  id: string;
  accountId: string;
  conversationId?: string;
  projectId?: string;
  taskId?: string;
  skillId: string;
  skillName: string;
  category: string;
  /** Blueprint §10 structured status: COMPLETED, FAILED, CONFIRMATION_REQUIRED, ... */
  status: string;
  /** What the user was told (userSafeMessage), bounded. */
  summary: string;
  /** Bounded copy of the skill output of a successful run (sources, report text, PR link ...). */
  output?: Record<string, unknown>;
  /** The pipeline's verification evidence: facts it observed, never assertions. */
  evidence?: Record<string, unknown>;
  /** Short, bounded preview of the tool input (a query, a repository URL ...). */
  inputPreview?: Record<string, unknown>;
  /** Set when the execution ran under, or is waiting for, a server-issued confirmation. */
  confirmationId?: string;
  creditsCharged: number;
  createdAt: Date;
}

export interface ActivityEntry {
  id: string;
  type: "tool" | "task" | "file" | "note" | "chat" | "project";
  title: string;
  detail: string;
  /** A tone the UI can colour: ok, error, pending or neutral. */
  tone: "ok" | "error" | "pending" | "neutral";
  at: string;
  /** What to open. */
  ref: { kind: string; id: string; projectId?: string };
}
