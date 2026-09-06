import { describe, expect, it } from "vitest";
import { MockContentGenerator } from "../../src/ai/contentGenerator.js";
import { createCreativeBrainstormSkill } from "../../src/skills/creativeBrainstorm.js";
import { createCreativeWriteMessageSkill } from "../../src/skills/creativeWriteMessage.js";
import { createCreativeWritePoemSkill } from "../../src/skills/creativeWritePoem.js";

const context = { accountId: "acc-1" };

describe("creative.write_message skill", () => {
  const skill = createCreativeWriteMessageSkill(new MockContentGenerator("message"));

  it("fails cleanly when there is no prompt", async () => {
    const result = await skill.handler({ values: { prompt: "  " } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("drafts a message and returns it as both output and summary", async () => {
    const result = await skill.handler(
      { values: { prompt: "a warm birthday message for my mom who loves gardening" } },
      context,
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.message).toBe(result.summary);
      expect(String(result.output.message)).toContain("birthday message for my mom");
    }
  });
});

describe("creative.write_poem skill", () => {
  const skill = createCreativeWritePoemSkill(new MockContentGenerator("poem"));

  it("fails cleanly when there is no prompt", async () => {
    const result = await skill.handler({ values: { prompt: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("writes a poem on the given theme", async () => {
    const result = await skill.handler({ values: { prompt: "the monsoon" } }, context);
    expect(result.kind).toBe("success");
  });
});

describe("creative.brainstorm skill", () => {
  const skill = createCreativeBrainstormSkill(new MockContentGenerator("brainstorm"));

  it("fails cleanly when there is no prompt", async () => {
    const result = await skill.handler({ values: { prompt: undefined } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("returns brainstormed ideas", async () => {
    const result = await skill.handler({ values: { prompt: "names for my new puppy" } }, context);
    expect(result.kind).toBe("success");
  });
});
