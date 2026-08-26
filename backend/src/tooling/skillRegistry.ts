import type { SkillCategory, SkillDefinition } from "../domain/types.js";
import { assertValidSkillId } from "../domain/types.js";

/**
 * In-memory catalogue of every registered skill, mirroring android/domain/tooling/SkillRegistry.kt.
 * Drives GET /api/v1/skills (the live "What can you do?" catalogue) and the Orchestrator's
 * tool-calling loop — see SKILLS.md.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    assertValidSkillId(skill.id);
    if (this.skills.has(skill.id)) {
      throw new Error(`Duplicate skill id: '${skill.id}' is already registered`);
    }
    this.skills.set(skill.id, skill);
  }

  find(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  all(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  byCategory(category: SkillCategory): SkillDefinition[] {
    return this.all().filter((skill) => skill.category === category);
  }
}
