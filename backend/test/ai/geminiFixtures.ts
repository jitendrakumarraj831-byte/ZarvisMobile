/** The shape Gemini actually returns for an exhausted free-tier daily quota. */
export function quotaBody(quotaId: string, retryDelay = "21s"): string {
  return JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
              quotaId,
              quotaValue: "250",
            },
          ],
        },
        { "@type": "type.googleapis.com/google.rpc.Help", links: [] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
      ],
    },
  });
}

export const DAILY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";
export const PER_MINUTE = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
