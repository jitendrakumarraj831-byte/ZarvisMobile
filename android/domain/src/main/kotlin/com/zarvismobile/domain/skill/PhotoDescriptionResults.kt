package com.zarvismobile.domain.skill

/**
 * Turns the answer of `POST /api/v1/documents/extract` for one photo into a [PhotoDescription],
 * with honest text for every failure. Pure, so it is tested on the JVM; the Android code only does
 * the I/O (reading and shrinking the photo, the HTTP call) and hands the status and the server's
 * `error` / `code` field to [fromHttp].
 *
 * The server's answers (backend api/routes/documents.ts, documents/processUpload.ts):
 * 200 `{text, kind:"image"}`; 413 file too large; 422 unreadable or empty; 429 quota or rate limit;
 * 503 `image_analysis_unavailable` (no configured AI model can see images) or `ai_unavailable`.
 */
object PhotoDescriptionResults {

    fun fromHttp(status: Int, errorCode: String?, text: String?): PhotoDescription = when {
        status in 200..299 -> {
            val described = text?.trim().orEmpty()
            if (described.isEmpty()) {
                PhotoDescription.Failed("empty", "The AI model did not return a description for this photo. Try another photo.")
            } else {
                PhotoDescription.Described(described)
            }
        }
        status == 401 || status == 403 ->
            PhotoDescription.Failed("signed_out", "Your ZARVIS session has ended. Open ZARVIS, sign in again and retry. The photo was not described.")
        status == 413 || errorCode == "file_too_large" ->
            PhotoDescription.Failed("too_large", "That photo is too large for ZARVIS to describe. Pick a smaller one.")
        status == 429 && (errorCode == "ai_quota_exceeded" || errorCode == "AI_QUOTA_EXCEEDED") ->
            PhotoDescription.Failed("ai_quota", "ZARVIS has reached today's AI usage limit, so the photo was not described. Nothing was charged. Please try again later.")
        status == 429 ->
            PhotoDescription.Failed("rate_limited", "ZARVIS is getting too many requests right now. Wait a moment and try again. The photo was not described.")
        status == 503 && errorCode == "image_analysis_unavailable" ->
            PhotoDescription.Failed("image_analysis_unavailable", "No AI model that can see images is set up on the ZARVIS server, so the photo could not be described.")
        status == 503 ->
            PhotoDescription.Failed("ai_unavailable", "The AI service is temporarily unavailable, so the photo was not described. Please try again.")
        status == 415 || status == 422 || errorCode == "extraction_failed" || errorCode == "empty_document" ->
            PhotoDescription.Failed("unreadable", "ZARVIS could not read that photo. Try a different one (JPEG, PNG, WebP or HEIC).")
        else ->
            PhotoDescription.Failed("failed", "The photo could not be described (the server answered $status). Please try again.")
    }

    /** The phone could not reach the server at all (offline, timeout): said as such, not blamed on the photo. */
    fun networkFailure(): PhotoDescription =
        PhotoDescription.Failed("network", "ZARVIS could not reach its server, so the photo was not described. Check your connection and try again.")

    /** Something unexpected broke (for example an answer that is not the usual JSON): said plainly, never swallowed. */
    fun unexpected(): PhotoDescription =
        PhotoDescription.Failed("failed", "Something went wrong while describing the photo, so it was not described. Please try again.")

    /** The photo could not be opened or decoded on the phone, so nothing was sent. */
    fun unreadableOnDevice(): PhotoDescription =
        PhotoDescription.Failed("unreadable", "ZARVIS could not open that photo on your phone, so nothing was sent. Try a different one.")
}
