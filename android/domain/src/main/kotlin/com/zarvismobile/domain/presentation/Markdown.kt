package com.zarvismobile.domain.presentation

/** One run of text that has the same look. [link] is set only for an http(s) address. */
data class MdSpan(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val strike: Boolean = false,
    val code: Boolean = false,
    val link: String? = null,
)

/** A block of a reply. Blank lines are [Gap]s; every other line is its own block, as on the website. */
sealed interface MdBlock {
    /** `#` to `######`. [level] is 1 to 3: deeper headings share the smallest size, as on the website. */
    data class Heading(val level: Int, val spans: List<MdSpan>) : MdBlock

    data class Line(val spans: List<MdSpan>) : MdBlock

    /** A run of `-`, `*` or `•` items, or of `1.` / `1)` items ([start] is the first number). */
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<List<MdSpan>>) : MdBlock

    /** Lines starting with `>`. A blank quoted line is an empty list. */
    data class Quote(val lines: List<List<MdSpan>>) : MdBlock

    /** A fenced block. [language] is whatever followed the opening fence, possibly empty. The code is shown exactly as written. */
    data class Code(val language: String, val code: String) : MdBlock

    data object Rule : MdBlock

    data object Gap : MdBlock
}

/**
 * A safe subset of Markdown for chat replies: headings, rules, bullet and numbered lists, block quotes, fenced code,
 * bold, italic, strikethrough, inline code and http(s) links. It is the same subset the website draws
 * (`web/logic.js` formatReplyHtml), minus tables, which stay as the plain text lines they arrived as.
 *
 * Nothing here can run or fetch anything: the parser only returns text with styles. A link is kept only when it starts
 * with `http://` or `https://`; anything else (`javascript:`, `file:`) stays visible as the text it was. HTML in a
 * reply is just characters. An unclosed fence shows the rest of the reply as code.
 */
object Markdown {
    private val FENCE = Regex("""^\s*```\s*([\w+#.-]*)\s*$""")
    private val QUOTE = Regex("""^\s*>\s?(.*)$""")
    private val RULE = Regex("""^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$""")
    private val HEADING = Regex("""^\s*(#{1,6})\s+(.*)$""")
    private val BULLET = Regex("""^\s*[-*•]\s+(.*)$""")
    private val NUMBERED = Regex("""^\s*(\d{1,3})[.)]\s+(.*)$""")

    fun parse(text: String): List<MdBlock> {
        val out = mutableListOf<MdBlock>()
        var items: MutableList<List<MdSpan>>? = null
        var ordered = false
        var start = 1
        var quote: MutableList<List<MdSpan>>? = null
        var codeLanguage = ""
        var codeLines: MutableList<String>? = null

        fun closeList() {
            items?.let { out += MdBlock.ListBlock(ordered, start, it.toList()) }
            items = null
        }
        fun closeQuote() {
            quote?.let { out += MdBlock.Quote(it.toList()) }
            quote = null
        }
        fun gap() {
            if (out.isNotEmpty() && out.last() != MdBlock.Gap) out += MdBlock.Gap
        }

        for (line in text.split("\r\n", "\n")) {
            val fence = FENCE.matchEntire(line)
            val openCode = codeLines
            if (openCode != null) {
                if (fence != null) {
                    out += MdBlock.Code(codeLanguage, openCode.joinToString("\n"))
                    codeLines = null
                } else {
                    openCode.add(line)
                }
                continue
            }
            if (fence != null) {
                closeList()
                closeQuote()
                codeLanguage = fence.groupValues[1]
                codeLines = mutableListOf()
                continue
            }
            val quoted = QUOTE.matchEntire(line)
            if (quoted != null) {
                closeList()
                val body = quoted.groupValues[1].trim()
                val lines = quote ?: mutableListOf<List<MdSpan>>().also { quote = it }
                lines.add(if (body.isEmpty()) emptyList() else parseInline(body))
                continue
            }
            closeQuote()
            if (RULE.matches(line)) {
                closeList()
                out += MdBlock.Rule
                continue
            }
            val heading = HEADING.matchEntire(line)
            if (heading != null) {
                closeList()
                out += MdBlock.Heading(minOf(heading.groupValues[1].length, 3), parseInline(heading.groupValues[2].trim()))
                continue
            }
            val bullet = BULLET.matchEntire(line)
            val numbered = NUMBERED.matchEntire(line)
            if (bullet != null || numbered != null) {
                val wantsOrdered = bullet == null
                if (items == null || ordered != wantsOrdered) {
                    closeList()
                    items = mutableListOf()
                    ordered = wantsOrdered
                    start = numbered?.groupValues?.get(1)?.toInt() ?: 1
                }
                items!!.add(parseInline((bullet?.groupValues?.get(1) ?: numbered!!.groupValues[2]).trim()))
                continue
            }
            closeList()
            if (line.isBlank()) gap() else out += MdBlock.Line(parseInline(line.trim()))
        }
        closeList()
        closeQuote()
        codeLines?.let { out += MdBlock.Code(codeLanguage, it.joinToString("\n")) }
        while (out.isNotEmpty() && out.last() == MdBlock.Gap) out.removeAt(out.lastIndex)
        return out
    }

    private enum class Kind { CODE, LINK, BOLD, STRIKE, ITALIC, BARE }

    private class InlineRule(val kind: Kind, val regex: Regex)

    // Order matters only for two matches that start at the same character: the first one here wins.
    private val CODE = InlineRule(Kind.CODE, Regex("""`([^`]+)`"""))
    private val LINK = InlineRule(Kind.LINK, Regex("""\[([^\]]+)]\((https?://[^\s)]+)\)"""))
    private val BOLD = InlineRule(Kind.BOLD, Regex("""\*\*(.+?)\*\*"""))
    private val STRIKE = InlineRule(Kind.STRIKE, Regex("""~~([^\s~](?:[^~]*[^\s~])?)~~"""))

    // *italic*: the asterisks must hug the text, so "2 * 3 * 4" and bullets stay literal.
    private val ITALIC = InlineRule(Kind.ITALIC, Regex("""(?<![*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])"""))
    private val BARE = InlineRule(Kind.BARE, Regex("""https?://[^\s<>"'`)]+"""))
    private val ALL = listOf(CODE, LINK, BOLD, STRIKE, ITALIC, BARE)
    private val INSIDE_LINK = listOf(CODE, BOLD, STRIKE, ITALIC)
    private const val TRAILING_PUNCTUATION = ".,;:!?"

    /** The styled runs of one line. */
    fun parseInline(text: String): List<MdSpan> = inline(text, MdSpan(""))

    private fun inline(text: String, base: MdSpan): List<MdSpan> {
        val spans = mutableListOf<MdSpan>()
        fun plain(piece: String) {
            if (piece.isEmpty()) return
            val last = spans.lastOrNull()
            if (last != null && !last.code && last.bold == base.bold && last.italic == base.italic && last.strike == base.strike && last.link == base.link) {
                spans[spans.lastIndex] = last.copy(text = last.text + piece)
            } else {
                spans += base.copy(text = piece)
            }
        }
        val rules = if (base.link == null) ALL else INSIDE_LINK
        var pos = 0
        while (pos < text.length) {
            var best: MatchResult? = null
            var bestRule: InlineRule? = null
            for (rule in rules) {
                val found = rule.regex.find(text, pos) ?: continue
                if (best == null || found.range.first < best.range.first) {
                    best = found
                    bestRule = rule
                }
            }
            if (best == null || bestRule == null) {
                plain(text.substring(pos))
                break
            }
            plain(text.substring(pos, best.range.first))
            pos = best.range.last + 1
            when (bestRule.kind) {
                Kind.CODE -> spans += base.copy(text = best.groupValues[1], code = true)
                Kind.BOLD -> spans += inline(best.groupValues[1], base.copy(bold = true))
                Kind.STRIKE -> spans += inline(best.groupValues[1], base.copy(strike = true))
                Kind.ITALIC -> spans += inline(best.groupValues[1], base.copy(italic = true))
                Kind.LINK -> spans += inline(best.groupValues[1], base.copy(link = best.groupValues[2]))
                Kind.BARE -> {
                    val address = best.value.trimEnd { it in TRAILING_PUNCTUATION }
                    if (address.length <= address.indexOf("://") + 3) {
                        plain(best.value) // "https://." names no host
                    } else {
                        spans += base.copy(text = address, link = address)
                        // What was trimmed ("." after a sentence's address) goes back to being text.
                        pos -= best.value.length - address.length
                    }
                }
            }
        }
        return spans
    }
}
