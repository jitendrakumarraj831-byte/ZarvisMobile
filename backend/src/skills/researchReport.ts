import type { SkillDefinition } from "../domain/types.js";
import type { ContentGenerator } from "../ai/contentGenerator.js";

const SYSTEM_PROMPT =
  "You write short structured research overviews on a topic (a few labeled sections, e.g. " +
  "Overview / Key Points / Open Questions). Since you have no live web search, base this on " +
  "general knowledge only, and say so explicitly in a closing line noting this is a starting " +
  "point, not sourced or current research, and recommending the user verify specifics with " +
  "a live search for anything time-sensitive. Reply with just the report and that closing " +
  "line, nothing else.";

/** `research.report` reference skill — distinct from `docs.summarize` (condenses text the
 * user already has) — see SKILLS.md "Current catalogue". */
export function createResearchReportSkill(generator: ContentGenerator): SkillDefinition {
  return {
    id: "research.report",
    name: "Research Report",
    description: "Write a short research overview on a topic, e.g. \"give me a research overview of renewable energy trends in India\".",
    category: "RESEARCH",
    capabilities: ["research overview", "research report", "background on"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 1, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["prompt"], properties: { prompt: "string" } },
    handler: async (input) => {
      const prompt = String(input.values.prompt ?? "").trim();
      if (!prompt) {
        return { kind: "failure", reason: "missing_prompt", userMessage: "What topic should I research?" };
      }
      const report = await generator.generate(prompt);
      return { kind: "success", output: { report }, summary: report };
    },
  };
}

export { SYSTEM_PROMPT as RESEARCH_REPORT_SYSTEM_PROMPT };
