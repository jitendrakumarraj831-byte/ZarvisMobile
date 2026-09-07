import { describe, expect, it } from "vitest";
import { MockContentGenerator } from "../../src/ai/contentGenerator.js";
import { createResearchCompareSkill } from "../../src/skills/researchCompare.js";
import { createResearchOutlineSkill } from "../../src/skills/researchOutline.js";
import { createResearchReportSkill } from "../../src/skills/researchReport.js";

const context = { accountId: "acc-1" };

describe("research.compare skill", () => {
  const skill = createResearchCompareSkill(new MockContentGenerator("comparison"));

  it("fails cleanly when there is no prompt", async () => {
    const result = await skill.handler({ values: { prompt: "  " } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("returns a comparison as both output and summary", async () => {
    const result = await skill.handler(
      { values: { prompt: "iPhone 15 vs Galaxy S24 on price, camera, and battery" } },
      context,
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.comparison).toBe(result.summary);
      expect(String(result.output.comparison)).toContain("iPhone 15 vs Galaxy S24");
    }
  });
});

describe("research.report skill", () => {
  const skill = createResearchReportSkill(new MockContentGenerator("research report"));

  it("fails cleanly when there is no prompt", async () => {
    const result = await skill.handler({ values: { prompt: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("returns a report", async () => {
    const result = await skill.handler({ values: { prompt: "renewable energy trends in India" } }, context);
    expect(result.kind).toBe("success");
  });
});

describe("research.outline skill", () => {
  const skill = createResearchOutlineSkill(new MockContentGenerator("research outline"));

  it("fails cleanly when there is no prompt", async () => {
    const result = await skill.handler({ values: { prompt: undefined } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("returns a research outline", async () => {
    const result = await skill.handler(
      { values: { prompt: "switching careers to data science" } },
      context,
    );
    expect(result.kind).toBe("success");
  });
});
