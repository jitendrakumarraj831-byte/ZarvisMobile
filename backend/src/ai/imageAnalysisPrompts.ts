/**
 * The image analysis prompt, shared by every vision-capable provider so the same upload gets the
 * same instructions whichever model answers. The wording is the one `api/routes/documents.ts`
 * has always sent to Gemini.
 */
export const IMAGE_ANALYSIS_SYSTEM_PROMPT =
  "You analyze user-uploaded images. Describe what is visible, read important text, identify tables or objects, and answer as a useful assistant. Be factual and concise. Do not invent details that are not visible.";

export const IMAGE_ANALYSIS_USER_PROMPT =
  "Analyze this uploaded image so another assistant can answer the user's questions about it. Include visible text and important visual details.";

export const IMAGE_ANALYSIS_MAX_OUTPUT_TOKENS = 4096;
