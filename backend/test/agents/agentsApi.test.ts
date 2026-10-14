import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_PROFILES } from "../../src/agents/agentProfiles.js";
import { buildContainer } from "../../src/container.js";
import { MockGitHubClient } from "../../src/github/githubClient.js";
import { buildServer } from "../../src/server.js";
import { auth, harness, newGuest, say, STORES, type Guest, type Harness } from "../helpers/api.js";

describe("agent profiles", () => {
  it("name six agents and give each a real set of categories", () => {
    expect(AGENT_PROFILES.map((a) => a.id)).toEqual(["personal", "research", "documents", "creative", "business", "developer"]);
    for (const agent of AGENT_PROFILES) {
      expect(agent.categories.length).toBeGreaterThan(0);
      expect(agent.quickActions.length).toBeGreaterThan(0);
      expect(agent.limitations.length).toBeGreaterThan(0);
    }
  });
});

describe.each(STORES)("agents (API, %s)", (_label, makeStore) => {
  let h: Harness;
  let me: Guest;

  beforeEach(async () => {
    h = harness(makeStore());
    me = await newGuest(h.app);
  });

  it("needs a signed-in account", async () => {
    expect((await request(h.app).get("/api/v1/agents")).status).toBe(401);
    expect((await request(h.app).get("/api/v1/agents/research")).status).toBe(401);
  });

  it("lists the agents with how many of their skills this account can use", async () => {
    const res = await request(h.app).get("/api/v1/agents").set(auth(me));
    expect(res.body.agents.map((a: { id: string }) => a.id)).toEqual(AGENT_PROFILES.map((a) => a.id));
    const developer = res.body.agents.find((a: { id: string }) => a.id === "developer");
    expect(developer.skillCount).toBe(2); // developer.analyze_repo and developer.implement, read from the registry
    expect(developer.available).toBe(1); // implement needs the Pro plan; this trial account can analyze only
  });

  it("an agent page is built from the registry: skills, what asks first, integrations, limits", async () => {
    const res = await request(h.app).get("/api/v1/agents/developer").set(auth(me));
    expect(res.status).toBe(200);
    const implement = res.body.skills.find((s: { id: string }) => s.id === "developer.implement");
    expect(implement).toMatchObject({ asksConfirmation: true, requiredEntitlement: "PRO", upgradeRequired: true, riskLevel: "HIGH" });
    const analyze = res.body.skills.find((s: { id: string }) => s.id === "developer.analyze_repo");
    expect(analyze).toMatchObject({ asksConfirmation: false, upgradeRequired: false });
    expect(res.body.permissions.alwaysAsksFirst).toEqual(["Implement Repository Change"]);
    expect(res.body.integrations).toEqual([expect.objectContaining({ id: "github", required: false, status: expect.objectContaining({ connected: false }) })]);
    expect(res.body.limitations.join(" ")).toContain("does not run your tests");
    expect(res.body.recentResults).toEqual([]);
    expect(res.body.currentWork.projects).toEqual([]);
  });

  it("shows the account's own recent results and projects, never another account's", async () => {
    await say(h.app, me, "search the web for the best phones and find results");
    const project = (await request(h.app).post("/api/v1/projects").set(auth(me)).send({ name: "Phones", agentId: "research" })).body.id;
    const research = await request(h.app).get("/api/v1/agents/research").set(auth(me));
    expect(research.body.recentResults).toHaveLength(1);
    expect(research.body.recentResults[0]).toMatchObject({ skillId: "web.search", status: "COMPLETED" });
    expect(research.body.currentWork.projects.map((p: { id: string }) => p.id)).toEqual([project]);
    const stranger = await newGuest(h.app);
    const theirs = await request(h.app).get("/api/v1/agents/research").set(auth(stranger));
    expect(theirs.body.recentResults).toEqual([]);
    expect(theirs.body.currentWork.projects).toEqual([]);
    expect((await request(h.app).get("/api/v1/agents/nobody").set(auth(me))).status).toBe(404);
  });

  it("Ask Agent: a turn run as one agent only offers that agent's skills to the planner", async () => {
    const offered: string[][] = [];
    const provider = (h.container.orchestrator as unknown as { provider: { generate: (r: { tools?: Array<{ name: string }> }) => Promise<unknown> } }).provider;
    const original = provider.generate.bind(provider);
    provider.generate = async (request) => {
      offered.push((request.tools ?? []).map((t) => t.name).sort());
      return original(request);
    };
    await say(h.app, me, "please write a short poem about the monsoon", { agentId: "creative" });
    expect(offered[0]).toEqual(["creative.brainstorm", "creative.write_message", "creative.write_poem"]);
    offered.length = 0;
    await say(h.app, me, "please write a short poem about the rain", {});
    expect(offered[0]!.length).toBeGreaterThan(5);
    expect(offered[0]).toContain("web.search");
  });

  it("an unknown agent is refused, not silently replaced by 'all skills'", async () => {
    const res = await request(h.app).post("/api/v1/orchestrator/turn").set(auth(me)).send({ utterance: "hello there", agentId: "wizard" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_agent");
    const sse = await request(h.app).post("/api/v1/orchestrator/turn-stream").set(auth(me)).send({ utterance: "hello there", agentId: "wizard" });
    expect(sse.status).toBe(400);
  });

  it("reports the agent and project on the stream's meta event, and real stage events for a tool", async () => {
    const project = (await request(h.app).post("/api/v1/projects").set(auth(me)).send({ name: "Stream" })).body.id;
    const res = await request(h.app)
      .post("/api/v1/orchestrator/turn-stream")
      .set(auth(me))
      .send({ utterance: "search the web for the best phones and find results", agentId: "research", projectId: project })
      .buffer(true)
      .parse((r, cb) => { let text = ""; r.setEncoding("utf8"); r.on("data", (c: string) => (text += c)); r.on("end", () => cb(null, text)); });
    const events = String(res.body).split("\n\n").filter(Boolean).map((block) => {
      const name = /event: (\w+)/.exec(block)![1]!;
      return { name, data: JSON.parse(/data: (.*)/.exec(block)![1]!) };
    });
    expect(events.find((e) => e.name === "meta")!.data).toMatchObject({ projectId: project, agentId: "research" });
    const progress = events.filter((e) => e.name === "progress").map((e) => e.data);
    const started = progress.find((p) => p.type === "tool_started");
    expect(started).toMatchObject({ skillId: "web.search", skillName: "Web Search", riskLevel: "LOW", actionClass: "READ_ONLY" });
    expect(started.inputPreview.query).toContain("best phones");
    const stages = progress.filter((p) => p.type === "tool_stage").map((p) => p.stage);
    expect(stages).toEqual(["validated", "permitted", "entitled", "prepared", "executing", "verifying"]);
    const finished = progress.find((p) => p.type === "tool_finished");
    expect(finished).toMatchObject({ status: "COMPLETED" });
    // Order is real: started, then its stages, then finished.
    const order = progress.map((p) => p.type);
    expect(order.indexOf("tool_started")).toBeLessThan(order.indexOf("tool_stage"));
    expect(order.lastIndexOf("tool_stage")).toBeLessThan(order.indexOf("tool_finished"));
  });
});

describe("developer: pull request checks come from GitHub", () => {
  it("returns GitHub's own check results, counts them, and never says ZARVIS ran the tests", async () => {
    const container = buildContainer(undefined, { githubClientFactory: (token) => new MockGitHubClient({ token }) });
    const app = buildServer(container);
    const me = await newGuest(app);
    const ok = await request(app).get("/api/v1/developer/pr-status?repoUrl=https://github.com/acme/demo&number=7").set(auth(me));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ source: "github", testsRunByZarvis: false, summary: { total: 1, passed: 1, failed: 0, pending: 0 } });
    expect(ok.body.pullRequest).toMatchObject({ number: 7, state: "open", merged: false });
    expect((await request(app).get("/api/v1/developer/pr-status?repoUrl=https://github.com/acme/demo&number=0").set(auth(me))).status).toBe(400);
    expect((await request(app).get("/api/v1/developer/pr-status?repoUrl=https://evil.example/a/b&number=1").set(auth(me))).body.code).toBe("invalid_repo_url");
    expect((await request(app).get("/api/v1/developer/pr-status?repoUrl=https://github.com/acme/demo&number=1")).status).toBe(401);
  });
});
