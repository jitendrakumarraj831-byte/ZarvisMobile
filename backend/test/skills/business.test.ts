import { describe, expect, it } from "vitest";
import type { AIProvider, AIRequest, AIResponse, AIResponseChunk } from "../../src/ai/provider.js";
import { AIContentGenerator, MockContentGenerator } from "../../src/skills/business/contentGenerator.js";
import { createBusinessCustomerReplySkill } from "../../src/skills/businessCustomerReply.js";
import { createBusinessDraftInvoiceSkill, parseInvoiceLineItems } from "../../src/skills/businessDraftInvoice.js";
import { createBusinessSocialPostSkill } from "../../src/skills/businessSocialPost.js";

const context = { accountId: "acc-1" };

class FakeAIProvider implements AIProvider {
  readonly id = "fake";
  lastRequest: AIRequest | undefined;

  constructor(private readonly reply: string) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    this.lastRequest = request;
    return {
      message: { role: "assistant", content: this.reply },
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }

  async *streamGenerate(): AsyncIterable<AIResponseChunk> {
    yield { delta: this.reply, done: true };
  }
}

describe("business.social_post skill", () => {
  it("fails cleanly when there is no prompt", async () => {
    const skill = createBusinessSocialPostSkill(new MockContentGenerator("social media post"));
    const result = await skill.handler({ values: { prompt: "  " } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_prompt" });
  });

  it("returns the generated post as both output and summary", async () => {
    const skill = createBusinessSocialPostSkill(new MockContentGenerator("social media post"));
    const result = await skill.handler({ values: { prompt: "new cupcake flavor" } }, context);
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.post).toBe(result.summary);
      expect(String(result.output.post)).toContain("new cupcake flavor");
    }
  });

  it("passes the prompt straight through to a real AIProvider when one is configured", async () => {
    const provider = new FakeAIProvider("Fresh cupcakes just dropped! 🧁 #bakery");
    const generator = new AIContentGenerator(provider, { provider: "fake", model: "v1" }, "system prompt");
    const skill = createBusinessSocialPostSkill(generator);
    const result = await skill.handler({ values: { prompt: "new cupcake flavor" } }, context);
    expect(result).toMatchObject({ kind: "success", summary: "Fresh cupcakes just dropped! 🧁 #bakery" });
    expect(provider.lastRequest?.messages).toEqual([{ role: "user", content: "new cupcake flavor" }]);
    expect(provider.lastRequest?.tools).toBeUndefined();
  });
});

describe("business.customer_reply skill", () => {
  const skill = createBusinessCustomerReplySkill(new MockContentGenerator("customer reply"));

  it("fails cleanly when there is no customer message", async () => {
    const result = await skill.handler({ values: { customerMessage: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_customer_message" });
  });

  it("drafts a reply", async () => {
    const result = await skill.handler({ values: { customerMessage: "My order arrived late." } }, context);
    expect(result.kind).toBe("success");
  });
});

describe("business.draft_invoice skill", () => {
  const skill = createBusinessDraftInvoiceSkill();

  it("fails cleanly when there is no client", async () => {
    const result = await skill.handler({ values: { client: "", items: "5 chairs at 2000 each" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_client" });
  });

  it("fails cleanly when there are no items", async () => {
    const result = await skill.handler({ values: { client: "Sharma Traders", items: "" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "missing_items" });
  });

  it("fails cleanly, with guidance, when the items text can't be parsed at all", async () => {
    const result = await skill.handler({ values: { client: "Sharma Traders", items: "some chairs" } }, context);
    expect(result).toMatchObject({ kind: "failure", reason: "unparseable_items" });
  });

  it("computes correct totals across multiple line items", async () => {
    const result = await skill.handler(
      { values: { client: "Sharma Traders", items: "5 chairs at 2000 each, 2 tables at 5000 each" } },
      context,
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.total).toBe(20000); // 5*2000 + 2*5000
      expect(result.output.lineItems).toHaveLength(2);
      expect(result.summary).toContain("Sharma Traders");
    }
  });

  it("never partially charges for a request that mixes a parseable and an unparseable item", async () => {
    // The unparseable segment is dropped, not guessed at — the resulting invoice reflects
    // only what was actually understood, never a fabricated line item (Product Principle #4).
    const result = await skill.handler(
      { values: { client: "Sharma Traders", items: "5 chairs at 2000 each, some random junk" } },
      context,
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.output.lineItems).toHaveLength(1);
      expect(result.output.total).toBe(10000);
    }
  });
});

describe("parseInvoiceLineItems", () => {
  it("parses a single item", () => {
    expect(parseInvoiceLineItems("5 chairs at 2000 each")).toEqual([
      { description: "chairs", quantity: 5, unitPrice: 2000, lineTotal: 10000 },
    ]);
  });

  it("parses multiple items joined by 'and' or commas", () => {
    const items = parseInvoiceLineItems("3 t-shirts at 450, 1 jacket at 1200 and 2 caps at 300 each");
    expect(items).toEqual([
      { description: "t-shirts", quantity: 3, unitPrice: 450, lineTotal: 1350 },
      { description: "jacket", quantity: 1, unitPrice: 1200, lineTotal: 1200 },
      { description: "caps", quantity: 2, unitPrice: 300, lineTotal: 600 },
    ]);
  });

  it("accepts a currency symbol or prefix before the price", () => {
    expect(parseInvoiceLineItems("2 lamps at ₹1500 each")[0]?.unitPrice).toBe(1500);
    expect(parseInvoiceLineItems("2 lamps at Rs 1500 each")[0]?.unitPrice).toBe(1500);
  });

  it("returns an empty list for text with no matching shape", () => {
    expect(parseInvoiceLineItems("some chairs and tables")).toEqual([]);
  });
});
