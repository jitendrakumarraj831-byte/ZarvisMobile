package com.zarvismobile.domain.presentation

/**
 * A reply as the phone's own voice should read it. Replies arrive with Markdown, links and emoji, and a voice reads some of that
 * out ("asterisk asterisk"). The server's voice removes it before speaking (backend/src/tts/ssml.ts `speakableText`); the phone's
 * voice, used when the server's cannot speak or for text that must stay on the phone, gets the same words through the same rules.
 */
object SpeakableText {
    /**
     * The words of [text] without its Markdown: fenced code is skipped, inline code, links and emphasis keep their words, headings and
     * bullets lose their marks, bare URLs and emoji are dropped. Plain text passes through unchanged.
     */
    fun of(text: String): String {
        var t = sanitize(text)
        t = FENCED_CODE.replace(t, " ")
        t = INLINE_CODE.replace(t, "$1")
        t = LINK.replace(t, "$1")
        t = BARE_URL.replace(t, " ")
        t = STRONG.replace(t, "$2")
        t = STAR_EMPHASIS.replace(t, "$1$2")
        t = UNDERSCORE_EMPHASIS.replace(t, "$1$2")
        t = HEADING_MARK.replace(t, "")
        t = RULE.replace(t, " ")
        t = BULLET.replace(t, "")
        t = withoutEmoji(t)
        t = SPACES.replace(t, " ")
        t = SPACE_AROUND_NEWLINE.replace(t, "\n")
        t = BLANK_LINES.replace(t, "\n\n")
        return t.trim()
    }

    /**
     * [text] cut into pieces of at most [maxChars] (the phone's engine refuses longer input), each ending at a sentence or a line where
     * there is one, else at a space. Nothing is dropped except the whitespace between pieces.
     */
    fun pieces(text: String, maxChars: Int): List<String> {
        require(maxChars > 0) { "maxChars must be positive" }
        val pieces = mutableListOf<String>()
        var rest = text.trim()
        while (rest.length > maxChars) {
            val window = rest.substring(0, maxChars)
            val sentenceEnd = window.indexOfLast { it in SENTENCE_ENDS }
            val cut = when {
                sentenceEnd >= maxChars / 2 -> sentenceEnd + 1
                window.lastIndexOf(' ') > 0 -> window.lastIndexOf(' ')
                else -> maxChars
            }
            rest.substring(0, cut).trim().takeIf { it.isNotEmpty() }?.let(pieces::add)
            rest = rest.substring(cut).trim()
        }
        if (rest.isNotEmpty()) pieces += rest
        return pieces
    }

    /** Control characters a voice does not read (the vertical tab from a PDF is the usual one) become spaces; line endings become `\n`. */
    private fun sanitize(text: String): String {
        val out = StringBuilder(text.length)
        for (ch in text) {
            val code = ch.code
            val unsupported = code <= 8 || code == 11 || code == 12 || code in 14..31 || code == 0xFFFE || code == 0xFFFF
            out.append(if (unsupported) ' ' else ch)
        }
        return out.toString().replace("\r\n", "\n").replace('\r', '\n')
    }

    /** Emoji (and the joiners and variation selector that build them) become spaces. By code point: works on every Java version. */
    private fun withoutEmoji(text: String): String {
        val out = StringBuilder(text.length)
        var i = 0
        while (i < text.length) {
            val codePoint = text.codePointAt(i)
            val emoji = codePoint in 0x1F000..0x1FAFF || codePoint in 0x2600..0x27BF || codePoint == 0xFE0F || codePoint == 0x200D
            if (emoji) out.append(' ') else out.appendCodePoint(codePoint)
            i += Character.charCount(codePoint)
        }
        return out.toString()
    }

    private val SENTENCE_ENDS = setOf('.', '!', '?', '।', '…', '\n')

    private val FENCED_CODE = Regex("```[\\s\\S]*?```")
    private val INLINE_CODE = Regex("`([^`\\n]+)`")
    private val LINK = Regex("!?\\[([^\\]\\n]*)\\]\\([^)\\s]*\\)")
    private val BARE_URL = Regex("https?://\\S+", RegexOption.IGNORE_CASE)
    private val STRONG = Regex("(\\*\\*|__)(?=\\S)(.+?)(?<=\\S)\\1")
    private val STAR_EMPHASIS = Regex("(^|[\\s(])\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?=$|[\\s).,!?;:])")
    private val UNDERSCORE_EMPHASIS = Regex("(^|[\\s(])_(?=\\S)([^_\\n]+?)(?<=\\S)_(?=$|[\\s).,!?;:])")
    private val HEADING_MARK = Regex("^[ \\t]{0,3}#{1,6}[ \\t]+", RegexOption.MULTILINE)
    private val RULE = Regex("^[ \\t]*([-*_])\\1{2,}[ \\t]*$", RegexOption.MULTILINE)
    private val BULLET = Regex("^[ \\t]*[-*•][ \\t]+", RegexOption.MULTILINE)
    private val SPACES = Regex("[ \\t]+")
    private val SPACE_AROUND_NEWLINE = Regex(" ?\\n ?")
    private val BLANK_LINES = Regex("\\n{3,}")
}
