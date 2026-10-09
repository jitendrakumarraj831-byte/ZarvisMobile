/** Server-enforced bounds for the workspace: one place, so the API, the tests and the UI copy agree. */
export const LIMITS = {
  projectName: 120,
  projectDescription: 2_000,
  projectGoal: 1_000,
  /** Active projects per account. */
  maxProjects: 100,
  noteContent: 2_000,
  /** Notes of every kind per account. */
  maxNotes: 500,
  noteSources: 10,
  sourceUrl: 2_000,
  sourceTitle: 300,
  fileName: 200,
  /** Saved files per account. */
  maxFiles: 200,
  /** The newest memory items given to the model per scope (also the cap shown in the UI). */
  memoryInPrompt: 20,
  /** Messages of the open chat the model sees on a turn. */
  conversationWindow: 40,
} as const;
