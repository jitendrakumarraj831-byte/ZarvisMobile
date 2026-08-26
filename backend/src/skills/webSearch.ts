import type { SkillDefinition } from "../domain/types.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

/**
 * No live search API credential is wired in this pass — see MASTER_SPEC.md §12 (Web Agent
 * Architecture) and §29/§32. This mock returns clearly-labeled placeholder results so the
 * full pipeline (validation -> permission -> entitlement -> execution -> verification) is
 * exercised for real; a live provider is additive behind the same [SearchProvider] contract.
 */
export class MockSearchProvider implements SearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    return [
      {
        title: `Mock result 1 for "${query}"`,
        url: "https://example.com/result-1",
        snippet: "This is a placeholder result — no live search provider is configured in this build.",
      },
      {
        title: `Mock result 2 for "${query}"`,
        url: "https://example.com/result-2",
        snippet: "Wire a real SearchProvider adapter to replace this mock (see AI_ARCHITECTURE.md).",
      },
    ];
  }
}

/** `web.search` reference skill — see SKILLS.md "Current catalogue". */
export function createWebSearchSkill(provider: SearchProvider): SkillDefinition {
  return {
    id: "web.search",
    name: "Web Search",
    description: "Search the web and return sourced results, e.g. \"find the best phone under 20000\".",
    category: "WEB",
    capabilities: ["search", "find", "compare", "research", "look up"],
    requiredPermissions: [],
    requiredEntitlement: "FREE",
    usageCost: { value: 2, unit: "credits" },
    riskLevel: "LOW",
    requiresConfirmation: false,
    executesOnDevice: false,
    inputSchema: { requiredFields: ["query"], properties: { query: "string" } },
    handler: async (input) => {
      const query = String(input.values.query ?? "").trim();
      if (!query) {
        return { kind: "failure", reason: "missing_query", userMessage: "What would you like me to search for?" };
      }
      const results = await provider.search(query);
      if (results.length === 0) {
        return { kind: "failure", reason: "no_results", userMessage: `I couldn't find anything for "${query}".` };
      }
      return {
        kind: "success",
        output: { query, results },
        summary: `Found ${results.length} result(s) for "${query}". Top: ${results[0]!.title} (${results[0]!.url})`,
      };
    },
  };
}
