import type { SkillCategory } from "../domain/types.js";

/**
 * User-facing agents. An agent is not a second brain: it is a named view over the SkillRegistry
 * (the skills of its categories) with plain-language copy, so "Ask Agent" in Chat runs the same
 * Orchestrator with the tool list narrowed to that agent's skills. What an agent "can do" is read
 * from the registry at request time (agents/agentCatalog.ts); only the wording lives here.
 */
export type AgentId = "personal" | "research" | "documents" | "creative" | "business" | "developer";

export interface AgentProfile {
  id: AgentId;
  name: string;
  tagline: string;
  description: string;
  /** Skills of these registry categories belong to the agent. */
  categories: SkillCategory[];
  /** One sentence added to the planner's instructions when a turn is run with this agent. */
  focus: string;
  quickActions: Array<{ label: string; prompt: string }>;
  integrations: Array<{ id: "github"; required: boolean; why: string }>;
  limitations: string[];
}

export const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    id: "personal",
    name: "Personal",
    tagline: "Plans, tasks and everyday help",
    description: "Your everyday assistant. It answers questions, searches the web when a question needs live information and breaks a goal into tracked steps.",
    categories: ["AUTOMATION", "WEB"],
    focus: "Act as the user's everyday personal assistant: answer directly, search the web when the question needs live information, and use workflows to break larger goals into tracked steps.",
    quickActions: [
      { label: "Plan a goal in steps", prompt: "Create a workflow for this goal and break it into clear steps: " },
      { label: "Find the latest on…", prompt: "Search the web and cite the sources you use: " },
      { label: "What's on my plate?", prompt: "List my tracked workflows and tell me which need attention." },
    ],
    integrations: [],
    limitations: [
      "It does not run tasks by itself in the background; a task step runs when you start it.",
      "It cannot use your phone (calls, contacts, notifications). Those are Android-only.",
    ],
  },
  {
    id: "research",
    name: "Research",
    tagline: "Search, compare and outline, with sources",
    description: "Looks things up on the live web and keeps the sources. Comparisons, reports and outlines are written from general knowledge and are labelled when they are not live-sourced.",
    categories: ["WEB", "RESEARCH"],
    focus: "Act as a careful research assistant. Use web search for anything current or factual and rely on its real sources. Never invent a source or a citation; say clearly when something comes from general knowledge instead of a live search.",
    quickActions: [
      { label: "Search with sources", prompt: "Search the web and cite the sources you use: " },
      { label: "Compare options", prompt: "Compare these options and say which claims come from live search: " },
      { label: "Research outline", prompt: "Give me a research outline of the questions worth investigating about: " },
    ],
    integrations: [],
    limitations: [
      "Only web search is live. Compare, report and outline use general knowledge and say so.",
      "Sources are the links the search provider returns; ZARVIS does not open and read each page.",
    ],
  },
  {
    id: "documents",
    name: "Documents",
    tagline: "Summarize and explain your files",
    description: "Reads the text of a file you attach (PDF, Word, text, images) and summarizes it or answers questions about it.",
    categories: ["DOCUMENTS"],
    focus: "Act as a document assistant. Work only from the text the user attached or pasted, and say when something is not in it.",
    quickActions: [
      { label: "Summarize a file", prompt: "Summarize the attached document clearly and explain the important points in simple language." },
      { label: "Action items", prompt: "What are the action items in the attached document?" },
      { label: "Explain the numbers", prompt: "Explain the important numbers in the attached document." },
    ],
    integrations: [],
    limitations: [
      "It reads extracted text only. Layout, handwriting and scanned pages without text may be missed.",
      "A file is read when you attach it. ZARVIS keeps the extracted text, not the original file, if you save it to Files.",
    ],
  },
  {
    id: "creative",
    name: "Creative",
    tagline: "Messages, poems and idea lists",
    description: "Drafts a message, a poem or a list of ideas in the tone you ask for.",
    categories: ["CREATIVE"],
    focus: "Act as a creative writing assistant. Draft in the tone and length the user asks for.",
    quickActions: [
      { label: "Write a message", prompt: "Write a warm, concise message about: " },
      { label: "Write a poem", prompt: "Write a short poem about: " },
      { label: "Brainstorm ideas", prompt: "Brainstorm ideas for: " },
    ],
    integrations: [],
    limitations: [
      "It writes text only. Image generation is not part of this version.",
      "A draft is not sent or posted anywhere.",
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "Replies, posts and invoice drafts",
    description: "Drafts a customer reply, a social post or an invoice from details you provide.",
    categories: ["BUSINESS"],
    focus: "Act as a business writing assistant. Draft from the facts the user gives; do not invent customers, prices or legal terms.",
    quickActions: [
      { label: "Customer reply", prompt: "Draft a polite customer reply to: " },
      { label: "Social post", prompt: "Write a social media post about: " },
      { label: "Invoice draft", prompt: "Draft an invoice for these items: " },
    ],
    integrations: [],
    limitations: [
      "Drafts only. ZARVIS does not email, post, invoice or collect payment.",
      "A draft is not legal or tax advice.",
    ],
  },
  {
    id: "developer",
    name: "Developer",
    tagline: "Analyze a repository, then change it only after you confirm",
    description: "Reads a GitHub repository (read-only) and, after you approve the exact change, opens a pull request from a new branch. It never merges.",
    categories: ["DEVELOPER", "GITHUB"],
    focus: "Act as a careful developer assistant. Analyze first, propose a bounded change, and never claim tests passed unless a real result says so.",
    quickActions: [
      { label: "Analyze a repository", prompt: "Analyze this repository and tell me what needs fixing: " },
      { label: "Explain code", prompt: "Explain this code step by step: " },
      { label: "Debug an error", prompt: "Find and fix the bug in this code or error: " },
    ],
    integrations: [
      { id: "github", required: false, why: "Private repositories and pull requests run as your own GitHub account. Public repositories can be analyzed without it." },
    ],
    limitations: [
      "ZARVIS does not run your tests. A pull request shows the tests your repository's own checks report on GitHub.",
      "Implementing a change needs the Pro plan, your own connected GitHub account and your approval of the exact action.",
      "At most 6 text files per change; nothing is merged automatically.",
    ],
  },
];

export function findAgent(id: unknown): AgentProfile | undefined {
  return typeof id === "string" ? AGENT_PROFILES.find((agent) => agent.id === id) : undefined;
}
