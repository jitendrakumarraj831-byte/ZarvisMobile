import { describe, expect, it } from "vitest";
import type { AIProvider, AIRequest, AIResponse } from "../../src/ai/provider.js";
import type { ModelGateway } from "../../src/ai/modelGateway.js";
import { buildContainer } from "../../src/container.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";

/** A planner that names the tools it is told to, whether or not they were offered. */
function scriptedPlanner(steps: Array<{ skillId: string; input: Record<string, unknown> } | { text: string }>) {
  const requests: AIRequest[] = [];
  let index = 0;
  const provider: AIProvider & { defaultModelConfig(): { provider: string; model: string } } = {
    id: "scripted",
    defaultModelConfig: () => ({ provider: "scripted", model: "scripted-v1" }),
    async generate(request): Promise<AIResponse> {
      requests.push(request);
      const step = steps[Math.min(index, steps.length - 1)]!;
      index += 1;
      const usage = { promptTokens: 1, completionTokens: 1 };
      if ("text" in step) return { message: { role: "assistant", content: step.text }, toolCalls: [], usage };
      return { message: { role: "assistant", content: "" }, toolCalls: [{ id: `call-${index}`, skillId: step.skillId, input: step.input }], usage };
    },
    async *streamGenerate() {
      yield { delta: "", done: true };
    },
  };
  return { provider: provider as unknown as ModelGateway, requests };
}

async function run(utterance: string, steps: Parameters<typeof scriptedPlanner>[0]) {
  const planner = scriptedPlanner(steps);
  const store = new InMemoryStore();
  const container = buildContainer(store, { modelGateway: planner.provider, githubClientFactory: (token) => new MockGitHubClient({ token }) });
  const user = await store.createUser("offered@example.com", "x");
  const account = await store.createAccountForUser(user.id);
  const result = await container.orchestrator.runTurn({ accountId: account.id, utterance, locale: "en" });
  return { result, planner };
}

describe("the orchestrator runs only the tools it offered this turn", () => {
  it("does not run a hidden skill the model names: nothing executes, nothing is charged, and the model can still answer", async () => {
    // developer.analyze_repo is offered only when the user asks to inspect a repository; "tell me a joke" does not.
    const { result, planner } = await run("tell me a joke", [{ skillId: "developer.analyze_repo", input: { repoUrl: "https://github.com/octocat/hello-world" } }, { text: "Why did the developer go broke? He used up all his cache." }]);

    expect(planner.requests[0]!.tools!.map((tool) => tool.name)).not.toContain("developer.analyze_repo");
    expect(result.toolCalls).toEqual([]);
    expect(result.message).toBe("Why did the developer go broke? He used up all his cache.");
    // The model was told the tool is unavailable before it answered.
    const secondRequest = planner.requests[1]!;
    expect(secondRequest.messages.at(-1)).toMatchObject({ role: "tool" });
    expect(secondRequest.messages.at(-1)!.content).toContain("not available");
  });

  it("does not run a skill that does not exist", async () => {
    const { result } = await run("tell me a joke", [{ skillId: "system.delete_everything", input: {} }, { text: "Here is a joke." }]);
    expect(result.toolCalls).toEqual([]);
    expect(result.message).toBe("Here is a joke.");
  });

  it("still runs an offered skill, as before", async () => {
    const { result } = await run("analyze my github project https://github.com/octocat/hello-world", [
      { skillId: "developer.analyze_repo", input: { repoUrl: "https://github.com/octocat/hello-world" } },
      { text: "Done." },
    ]);
    expect(result.toolCalls.map((call) => call.skillId)).toEqual(["developer.analyze_repo"]);
  });
});
