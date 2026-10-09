import { describe, expect, it, vi } from "vitest";
import { buildContainer } from "../../src/container.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/**
 * Cancelling a workflow from chat (`automation.cancel_workflow`) must stop a step that is running, exactly like cancelling
 * it on the Tasks page. That needs the skill and the Tasks API to hold the same TaskService, the one that has the runner.
 */
describe("automation.cancel_workflow and the task runner", () => {
  it("aborts the in-flight step of the task it cancels", async () => {
    const store = new InMemoryStore();
    const container = buildContainer(store);
    const user = await store.createUser("cancel-skill@test.dev", "x");
    const accountId = (await store.createAccountForUser(user.id)).id;
    const task = await container.taskService.create(accountId, "Weekly email summary", "LOW", ["Collect", "Write"]);
    const abort = vi.spyOn(container.taskRunner, "abort");

    const skill = container.registry.find("automation.cancel_workflow");
    expect(skill).toBeDefined();
    const result = await skill!.handler({ values: { goalMatch: "email summary" } }, { accountId });

    expect(result.kind).toBe("success");
    expect(abort).toHaveBeenCalledWith(task.id);
    expect((await store.getTask(task.id))!.lifecycle).toBe("CANCELLED");
  });

  it("the skills and the Tasks API share one TaskService (so one set of rules)", async () => {
    const container = buildContainer(new InMemoryStore());
    // Creating through the skill is visible through the service the API uses, and the service has the runner bound.
    const user = await container.store.createUser("shared@test.dev", "x");
    const accountId = (await container.store.createAccountForUser(user.id)).id;
    const create = container.registry.find("automation.create_workflow")!;
    const made = await create.handler({ values: { goal: "Morning routine", steps: "check email, then draft replies" } }, { accountId });
    expect(made.kind).toBe("success");
    const tasks = await container.taskService.listForAccount(accountId);
    expect(tasks.map((t) => t.goal)).toEqual(["Morning routine"]);
    // The service can run (a runner is bound); a runner-less service would refuse with task_execution_unavailable.
    await expect(container.taskService.resume(tasks[0]!.id)).resolves.toBeDefined();
  });
});
