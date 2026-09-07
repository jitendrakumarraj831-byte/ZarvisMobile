import type { SkillDefinition } from "../domain/types.js";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Parses free-text line items like "5 chairs at 2000 each, 2 tables at 5000 each" into
 * structured [InvoiceLineItem]s. Deterministic, no AI provider needed — unlike
 * `business.social_post`/`business.customer_reply`, invoice math has one correct answer,
 * so a real parser is both simpler and more reliable here than a generative one.
 * Segments that don't match the expected "<qty> <description> at <price>[ each]" shape are
 * silently skipped rather than guessed at — see the skill handler below for what happens
 * when that leaves zero items.
 */
export function parseInvoiceLineItems(itemsText: string): InvoiceLineItem[] {
  const segments = itemsText
    .split(/,|\band\b/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const pattern = /^(\d+)\s+(.+?)\s+at\s+(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)\s*(?:each)?$/i;
  const items: InvoiceLineItem[] = [];
  for (const segment of segments) {
    const match = segment.match(pattern);
    if (!match) continue;
    const quantity = Number(match[1]);
    const unitPrice = Number(match[3]);
    items.push({
      description: match[2]!.trim(),
      quantity,
      unitPrice,
      lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    });
  }
  return items;
}

/** `business.draft_invoice` reference skill — see SKILLS.md "Current catalogue". */
export function createBusinessDraftInvoiceSkill(): SkillDefinition {
  return {
    id: "business.draft_invoice",
    name: "Draft Invoice",
    description:
      "Draft an invoice from a plain description of the items, e.g. \"invoice Sharma Traders for 5 chairs at 2000 each and 2 tables at 5000 each\".",
    category: "BUSINESS",
    capabilities: ["invoice", "bill", "billing"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 1, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["client", "items"], properties: { client: "string", items: "string" } },
    handler: async (input) => {
      const client = String(input.values.client ?? "").trim();
      const itemsText = String(input.values.items ?? "").trim();
      if (!client) {
        return { kind: "failure", reason: "missing_client", userMessage: "Who is this invoice for?" };
      }
      if (!itemsText) {
        return {
          kind: "failure",
          reason: "missing_items",
          userMessage: "What items should I put on the invoice, e.g. \"5 chairs at 2000 each\"?",
        };
      }
      const lineItems = parseInvoiceLineItems(itemsText);
      if (lineItems.length === 0) {
        return {
          kind: "failure",
          reason: "unparseable_items",
          userMessage:
            "I couldn't work out the items from that — try the shape \"<quantity> <item> at <price>\", " +
            "e.g. \"5 chairs at 2000 each, 2 tables at 5000 each\".",
        };
      }
      const total = Math.round(lineItems.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
      return {
        kind: "success",
        output: { client, lineItems, total },
        summary: `Invoice for ${client}: ${lineItems.length} item(s), total ₹${total}.`,
      };
    },
  };
}
