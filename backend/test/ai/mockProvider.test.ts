import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../../src/ai/mockProvider.js";
import type { ToolDefinition } from "../../src/ai/provider.js";

const invoiceTool: ToolDefinition = {
  name: "business.draft_invoice",
  description: "Draft an invoice from a plain description of the items, e.g. invoice bill billing",
  inputSchema: { requiredFields: ["client", "items"], properties: { client: "string", items: "string" } },
};

const createWorkflowTool: ToolDefinition = {
  name: "automation.create_workflow",
  description: "Set up a multi-step workflow to track, e.g. workflow automate automation multi-step",
  inputSchema: { requiredFields: ["goal", "steps"], properties: { goal: "string", steps: "string" } },
};

const cancelWorkflowTool: ToolDefinition = {
  name: "automation.cancel_workflow",
  description: "Cancel a running workflow by describing it, e.g. cancel workflow stop workflow cancel task stop task",
  inputSchema: { requiredFields: ["goalMatch"], properties: { goalMatch: "string" } },
};

function request(utterance: string, tools: ToolDefinition[]) {
  return {
    systemPrompt: "",
    messages: [{ role: "user" as const, content: utterance }],
    tools,
    modelConfig: { provider: "mock", model: "mock-v1" },
  };
}

describe("MockAIProvider field-filling heuristics", () => {
  it("splits a multi-field skill's input instead of cramming the whole utterance into every field", async () => {
    // Regression test for a real bug this exact phrasing triggered live: `client` and
    // `items` both ended up holding the entire utterance, so `client` became
    // "invoice Sharma Traders for 5 chairs at 2000 each..." instead of "Sharma Traders",
    // and only the last line item parsed since the first was buried in that same string.
    const provider = new MockAIProvider();
    const response = await provider.generate(
      request("invoice Sharma Traders for 5 chairs at 2000 each and 2 tables at 5000 each", [invoiceTool]),
    );
    expect(response.toolCalls).toHaveLength(1);
    const input = response.toolCalls[0]!.input;
    expect(input.client).toBe("Sharma Traders");
    expect(input.items).toBe("5 chairs at 2000 each and 2 tables at 5000 each");
  });

  it("falls back to the whole utterance for the client field if no digit is present", async () => {
    const provider = new MockAIProvider();
    const response = await provider.generate(request("invoice Sharma Traders", [invoiceTool]));
    expect(response.toolCalls[0]!.input.client).toBe("Sharma Traders");
  });

  it("strips the trigger phrase for automation.create_workflow's goal and steps", async () => {
    // Regression test for a second, live-caught instance of the same bug class: goal and
    // steps both got the entire "create a workflow: ..." utterance, so the first parsed
    // step came out as "create a workflow: check email" instead of "check email", and
    // automation.cancel_workflow's fuzzy match against the resulting goal text depends on
    // that prefix actually being gone (see the next test).
    const provider = new MockAIProvider();
    const response = await provider.generate(
      request("create a workflow: check email, then draft replies, then send a summary", [createWorkflowTool]),
    );
    const input = response.toolCalls[0]!.input;
    expect(input.goal).toBe("check email, then draft replies, then send a summary");
    expect(input.steps).toBe("check email, then draft replies, then send a summary");
  });

  it("strips the cancel/stop trigger and trailing 'workflow' for automation.cancel_workflow's goalMatch", async () => {
    const provider = new MockAIProvider();
    const response = await provider.generate(request("cancel my check email workflow", [cancelWorkflowTool]));
    expect(response.toolCalls[0]!.input.goalMatch).toBe("check email");
  });
});
