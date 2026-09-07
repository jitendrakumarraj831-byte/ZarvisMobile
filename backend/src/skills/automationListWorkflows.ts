import type { SkillDefinition } from "../domain/types.js";
import type { TaskService } from "../tasks/taskService.js";

/** `automation.list_workflows` reference skill — see SKILLS.md "Current catalogue". The
 * account's tasks were previously only reachable through the UI's own task list (`GET
 * /api/v1/tasks`, called directly by both clients); this is the natural-language path to
 * the same data. */
export function createAutomationListWorkflowsSkill(taskService: TaskService): SkillDefinition {
  return {
    id: "automation.list_workflows",
    name: "List Workflows",
    description: "List your active workflows/tasks, e.g. \"what workflows do I have running?\".",
    category: "AUTOMATION",
    capabilities: ["list workflows", "my workflows", "my tasks", "running tasks", "active tasks"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 0, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: [] },
    handler: async (_input, context) => {
      const tasks = await taskService.listForAccount(context.accountId);
      if (tasks.length === 0) {
        return { kind: "success", output: { tasks: [] }, summary: "You don't have any workflows yet." };
      }
      const summary = tasks
        .map((task) => `"${task.goal}" (${task.status.toLowerCase()}, ${task.steps.length} step(s))`)
        .join("; ");
      return {
        kind: "success",
        output: { tasks: tasks.map((task) => ({ id: task.id, goal: task.goal, status: task.status })) },
        summary: `You have ${tasks.length} workflow(s): ${summary}.`,
      };
    },
  };
}
