import type { SkillDefinition, Task } from "../domain/types.js";
import { TaskError, type TaskService } from "../tasks/taskService.js";

const CANCELLABLE_STATUSES = new Set<Task["status"]>(["PENDING", "RUNNING", "PAUSED"]);

/** `automation.cancel_workflow` reference skill — see SKILLS.md "Current catalogue".
 * Deliberately never accepts a raw task id from the user: it only searches (case-
 * insensitively, by goal text) within the *calling account's own* workflows via
 * `TaskService.listForAccount`, then cancels the id it found itself — so this skill can
 * never be pointed at another account's task regardless of what `TaskService.cancel`
 * itself does or doesn't check. */
export function createAutomationCancelWorkflowSkill(taskService: TaskService): SkillDefinition {
  return {
    id: "automation.cancel_workflow",
    name: "Cancel Workflow",
    description: "Cancel a running workflow by describing it, e.g. \"cancel my email summary workflow\".",
    category: "AUTOMATION",
    capabilities: ["cancel workflow", "stop workflow", "cancel task", "stop task"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 0, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["goalMatch"], properties: { goalMatch: "string" } },
    handler: async (input, context) => {
      const goalMatch = String(input.values.goalMatch ?? "").trim();
      if (!goalMatch) {
        return { kind: "failure", reason: "missing_goal_match", userMessage: "Which workflow should I cancel?" };
      }
      const tasks = await taskService.listForAccount(context.accountId);
      const candidates = tasks
        .filter((task) => CANCELLABLE_STATUSES.has(task.status))
        .filter((task) => task.goal.toLowerCase().includes(goalMatch.toLowerCase()))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const target = candidates[0];
      if (!target) {
        return {
          kind: "failure",
          reason: "not_found",
          userMessage: `I couldn't find an active workflow matching "${goalMatch}".`,
        };
      }

      try {
        await taskService.cancel(target.id);
      } catch (err) {
        if (err instanceof TaskError) {
          return { kind: "failure", reason: "cancel_failed", userMessage: err.message };
        }
        throw err;
      }
      return {
        kind: "success",
        output: { taskId: target.id, goal: target.goal },
        summary: `Cancelled workflow "${target.goal}".`,
      };
    },
  };
}
