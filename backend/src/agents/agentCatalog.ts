import { resolveEntitlement } from "../domain/entitlementResolver.js";
import type { SkillDefinition } from "../domain/types.js";
import type { GitHubAccessService } from "../github/githubAccess.js";
import type { Store } from "../store/store.js";
import type { EntitlementPort } from "../tooling/ports.js";
import type { SkillRegistry } from "../tooling/skillRegistry.js";
import { requiresConfirmation } from "../tooling/toolPipeline.js";
import { executionView, projectView } from "../workspace/views.js";
import { AGENT_PROFILES, findAgent, type AgentProfile } from "./agentProfiles.js";

/**
 * The agent pages' data. An agent is a view over the SkillRegistry (see agentProfiles.ts): what it can do,
 * what each skill needs and costs, and whether this account may use it come from the registry and the
 * entitlement resolver at request time. Recent results are this account's stored executions of those skills;
 * current work is the projects set to work mainly with this agent.
 */
export class AgentCatalog {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly entitlements: EntitlementPort,
    private readonly store: Store,
    private readonly github: GitHubAccessService,
  ) {}

  private skillsOf(profile: AgentProfile): SkillDefinition[] {
    return this.registry.all().filter((skill) => !skill.executesOnDevice && profile.categories.includes(skill.category));
  }

  async list(accountId: string) {
    const snapshot = await this.entitlements.snapshot(accountId);
    return AGENT_PROFILES.map((profile) => this.summary(profile, snapshot));
  }

  private summary(profile: AgentProfile, snapshot: Awaited<ReturnType<EntitlementPort["snapshot"]>>) {
    const now = new Date();
    const skills = this.skillsOf(profile);
    return {
      id: profile.id,
      name: profile.name,
      tagline: profile.tagline,
      description: profile.description,
      skillCount: skills.length,
      available: skills.filter((skill) => resolveEntitlement(snapshot, skill, now).allowed).length,
    };
  }

  async detail(accountId: string, agentId: string) {
    const profile = findAgent(agentId);
    if (!profile) return undefined;
    const snapshot = await this.entitlements.snapshot(accountId);
    const now = new Date();
    const skills = this.skillsOf(profile);
    const [recent, projects, github] = await Promise.all([
      this.store.listExecutions(accountId, { skillIds: skills.map((s) => s.id), limit: 8 }),
      this.store.listProjects(accountId, { status: "ACTIVE" }),
      profile.integrations.some((i) => i.id === "github") ? this.github.status(accountId) : Promise.resolve(undefined),
    ]);
    return {
      ...this.summary(profile, snapshot),
      skills: skills.map((skill) => {
        const decision = resolveEntitlement(snapshot, skill, now);
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          riskLevel: skill.riskLevel,
          actionClass: skill.actionClass,
          asksConfirmation: requiresConfirmation(skill),
          usageCost: skill.usageCost,
          requiredEntitlement: skill.requiredEntitlement,
          requiredPermissions: skill.requiredPermissions,
          upgradeRequired: !decision.allowed && decision.reason !== "OUT_OF_CREDITS",
          outOfCredits: !decision.allowed && decision.reason === "OUT_OF_CREDITS",
        };
      }),
      quickActions: profile.quickActions,
      integrations: profile.integrations.map((integration) => ({
        ...integration,
        status: github ? { available: github.available, connected: github.connected, login: github.login } : null,
      })),
      permissions: {
        device: [...new Set(skills.flatMap((skill) => skill.requiredPermissions))],
        alwaysAsksFirst: skills.filter(requiresConfirmation).map((skill) => skill.name),
      },
      limitations: profile.limitations,
      recentResults: recent.map(executionView),
      currentWork: { projects: projects.filter((p) => p.agentId === profile.id).map(projectView) },
    };
  }
}
