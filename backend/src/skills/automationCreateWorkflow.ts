import type { SkillDefinition } from "../domain/types.js";
import type { TaskService } from "../tasks/taskService.js";

/**
 * Splits a plain-text step description into individual steps — "then"/newline/comma
 * separated, e.g. "check email, then draft replies, then send summary". Falls back to the
 * whole text as one step rather than failing outright when no separator is found: an
 * unstructured description is still a valid (if coarse) single-step workflow, unlike
 * `business.draft_invoice`'s line items, which have no meaningful fallback when unparseable.
 */
function splitSteps(stepsText: string): string[] {
  const steps = stepsText
    .split(/,|\bthen\b|\n/i)
    .map((step) => step.trim())
    .filter(Boolean);
  return steps.length > 0 ? steps : [stepsText.trim()];
}

/**
 * `automation.create_workflow` reference skill — the Automation Agent's first real skill
 * (MASTER_SPEC.md §28 Phase 9, §18 Task Engine). Translates a described multi-step goal into
 * a real `Task` with `PENDING` `TaskStep`s via the already-implemented Task Engine, so it's
 * immediately visible and controllable (pause/resume/cancel/retry) in both clients' task
 * views. **Stated honestly, not glossed over:** this creates and tracks the workflow's
 * steps — it does not execute them. Automatic step-by-step execution is a separate, larger
 * piece of work than this reference skill (see `TaskService.create`'s own doc comment and
 * MASTER_SPEC.md §18); claiming otherwise here would be exactly the "fake success" Product
 * Principle #4 forbids.
 */
export function createAutomationCreateWorkflowSkill(taskService: TaskService): SkillDefinition {
  return {
    id: "automation.create_workflow",
    name: "Create Workflow",
    description:
      "Set up a multi-step workflow to track, e.g. \"create a workflow: check email, then draft replies, then send a summary\".",
    category: "AUTOMATION",
    capabilities: ["workflow", "automate", "automation", "multi-step"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 1, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["goal", "steps"], properties: { goal: "string", steps: "string" } },
    handler: async (input, context) => {
      const goal = String(input.values.goal ?? "").trim();
      const stepsText = String(input.values.steps ?? "").trim();
      if (!goal) {
        return { kind: "failure", reason: "missing_goal", userMessage: "What's the overall goal for this workflow?" };
      }
      if (!stepsText) {
        return {
          kind: "failure",
          reason: "missing_steps",
          userMessage: "What are the steps? e.g. \"check email, then draft replies, then send a summary\".",
        };
      }
      const stepDescriptions = splitSteps(stepsText);
      const task = await taskService.create(context.accountId, goal, "LOW", stepDescriptions);
      return {
        kind: "success",
        output: { taskId: task.id, goal: task.goal, stepCount: task.steps.length },
        summary: `Created workflow "${task.goal}" with ${task.steps.length} step(s) — track it in your task list.`,
      };
    },
  };
}
