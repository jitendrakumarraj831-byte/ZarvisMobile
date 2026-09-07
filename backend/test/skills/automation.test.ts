import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { TaskService } from "../../src/tasks/taskService.js";
import { createAutomationCancelWorkflowSkill } from "../../src/skills/automationCancelWorkflow.js";
import { createAutomationCreateWorkflowSkill } from "../../src/skills/automationCreateWorkflow.js";
import { createAutomationListWorkflowsSkill } from "../../src/skills/automationListWorkflows.js";

const context = { accountId: "acc-1" };

describe("automation.create_workflow skill", () => {
  let taskService: TaskService;

  beforeEach(() => {
    taskService = new TaskService(new InMemoryStore());
  });

  it("fails cleanly when there is no goal", async () => {
    const skill = createAutomationCreateWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goal: "", steps: "check email" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_goal" });
  });

  it("fails cleanly when there are no steps", async () => {
    const skill = createAutomationCreateWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goal: "Weekly report", steps: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_steps" });
  });

  it("creates a real, listable task with the parsed steps", async () => {
    const skill = createAutomationCreateWorkflowSkill(taskService);
    const result = await skill.handler(
      { values: { goal: "Morning routine", steps: "check email, then draft replies, then send a summary" } },
      context,
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.stepCount).toBe(3);
      const task = await taskService.get(String(result.output.taskId));
      expect(task?.steps.map((s) => s.description)).toEqual(["check email", "draft replies", "send a summary"]);
      expect(task?.steps.every((s) => s.status === "PENDING")).toBe(true);
    }
  });

  it("falls back to one step when the text has no separator", async () => {
    const skill = createAutomationCreateWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goal: "Goal", steps: "just one thing" } }, context);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.stepCount).toBe(1);
    }
  });
});

describe("automation.list_workflows skill", () => {
  it("reports no workflows when there are none", async () => {
    const taskService = new TaskService(new InMemoryStore());
    const skill = createAutomationListWorkflowsSkill(taskService);
    const result = await skill.handler({ values: {} }, context);
    expect(result).toMatchObject({ kind: "success", summary: "You don't have any workflows yet." });
  });

  it("lists only the calling account's own tasks", async () => {
    const taskService = new TaskService(new InMemoryStore());
    await taskService.create("acc-1", "My workflow");
    await taskService.create("acc-2", "Someone else's workflow");
    const skill = createAutomationListWorkflowsSkill(taskService);
    const result = await skill.handler({ values: {} }, context);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.summary).toContain("My workflow");
      expect(result.summary).not.toContain("Someone else's workflow");
    }
  });
});

describe("automation.cancel_workflow skill", () => {
  it("fails cleanly when there is nothing to match", async () => {
    const taskService = new TaskService(new InMemoryStore());
    const skill = createAutomationCancelWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goalMatch: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_goal_match" });
  });

  it("fails cleanly when no active workflow matches", async () => {
    const taskService = new TaskService(new InMemoryStore());
    const skill = createAutomationCancelWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goalMatch: "nonexistent" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "not_found" });
  });

  it("cancels a matching workflow by fuzzy, case-insensitive goal text", async () => {
    const taskService = new TaskService(new InMemoryStore());
    const created = await taskService.create("acc-1", "Email summary workflow");
    const skill = createAutomationCancelWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goalMatch: "email summary" } }, context);
    expect(result).toMatchObject({ kind: "success", summary: 'Cancelled workflow "Email summary workflow".' });
    const task = await taskService.get(created.id);
    expect(task?.status).toBe("CANCELLED");
  });

  it("never matches or cancels another account's workflow", async () => {
    const taskService = new TaskService(new InMemoryStore());
    const otherTask = await taskService.create("acc-2", "Email summary workflow");
    const skill = createAutomationCancelWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goalMatch: "email summary" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "not_found" });
    const task = await taskService.get(otherTask.id);
    expect(task?.status).toBe("PENDING");
  });

  it("does not match a workflow that is already done or cancelled", async () => {
    const taskService = new TaskService(new InMemoryStore());
    const created = await taskService.create("acc-1", "Old workflow");
    await taskService.cancel(created.id);
    const skill = createAutomationCancelWorkflowSkill(taskService);
    const result = await skill.handler({ values: { goalMatch: "old workflow" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "not_found" });
  });
});
