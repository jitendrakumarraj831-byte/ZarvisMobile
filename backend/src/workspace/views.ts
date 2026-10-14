import type { Conversation } from "../store/store.js";
import type { Project, ToolExecutionRecord, WorkspaceFile, WorkspaceFileSummary, WorkspaceNote } from "../domain/workspace.js";

/** The JSON shapes the API returns: dates as ISO strings, absent optional ids as null. */

export function projectView(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    goal: project.goal,
    status: project.status,
    agentId: project.agentId ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function noteView(note: WorkspaceNote) {
  return {
    id: note.id,
    projectId: note.projectId ?? null,
    kind: note.kind,
    content: note.content,
    enabled: note.enabled,
    sources: note.sources,
    executionId: note.executionId ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export function fileSummaryView(file: WorkspaceFileSummary) {
  return {
    id: file.id,
    projectId: file.projectId ?? null,
    name: file.name,
    mimeType: file.mimeType,
    kind: file.kind,
    source: file.source,
    sizeBytes: file.sizeBytes,
    textLength: file.textLength,
    note: file.note ?? null,
    createdAt: file.createdAt.toISOString(),
  };
}

export function fileView(file: WorkspaceFile) {
  const { text, ...rest } = file;
  return { ...fileSummaryView({ ...rest, textLength: text.length }), text };
}

export function conversationView(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title ?? null,
    projectId: conversation.projectId ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function executionView(record: ToolExecutionRecord) {
  return {
    id: record.id,
    conversationId: record.conversationId ?? null,
    projectId: record.projectId ?? null,
    taskId: record.taskId ?? null,
    skillId: record.skillId,
    skillName: record.skillName,
    category: record.category,
    status: record.status,
    summary: record.summary,
    output: record.output ?? null,
    evidence: record.evidence ?? null,
    inputPreview: record.inputPreview ?? null,
    confirmationId: record.confirmationId ?? null,
    creditsCharged: record.creditsCharged,
    createdAt: record.createdAt.toISOString(),
  };
}
