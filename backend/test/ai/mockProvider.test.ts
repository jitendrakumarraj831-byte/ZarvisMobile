import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../../src/ai/mockProvider.js";
import type { ToolDefinition } from "../../src/ai/provider.js";

const invoiceTool: ToolDefinition = {
  name: "business.draft_invoice",
  description: "Draft an invoice from a plain description of the items, e.g. invoice bill billing",
  inputSchema: { requiredFields: ["client", "items"], properties: { client: "string", items: "string" } },
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
});
