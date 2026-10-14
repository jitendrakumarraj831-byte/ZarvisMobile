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
 *
 * A reply is parsed on the main thread while a screen is composed, so malformed or hostile text must never throw or stall:
 * - The rule and fence checks scan characters. They used to be regexes with a repeated group, which the JVM matches by recursion:
 *   a line of a few thousand hyphens (how many depends on the thread's stack) threw StackOverflowError, and ``` followed by 50,000 spaces
 *   and a backtick stalled for many seconds.
 * - The inline scan finds each rule's next match once, instead of searching the rest of the line again after every match (quadratic),
 *   and a link label or address has a length limit, so an unclosed `[` cannot make every later `[` scan to the end of the line.
 * - A line longer than [MAX_STYLED_LINE_CHARS], a reply longer than [MAX_PARSED_CHARS], or one with more than [MAX_RENDERED_ITEMS] lines or
 *   list items (each becomes a view on the screen) is shown as plain text: every character is still there, only its styling is not applied.
 * - Whatever still goes wrong inside the parser (a stack overflow, an exception from the regex engine) gives the same plain text, not a crash.
 */
object Markdown {
    /** A single line longer than this is shown as plain text (nothing is cut). Ordinary paragraphs are a few hundred characters. */
    const val MAX_STYLED_LINE_CHARS = 20_000

    /** A reply longer than this is shown as plain text (nothing is cut). That is about 25,000 tokens, more than a chat answer. */
    const val MAX_PARSED_CHARS = 100_000

    /** More lines and list items than this (a runaway list, say) are shown as one plain text. A long answer is a few hundred. Code lines do not count. */
    const val MAX_RENDERED_ITEMS = 2_000

    /** A link's text, and its address after the scheme, are limited so a stray `[` cannot scan the whole line. Longer ones stay text, and the address is still a bare link. */
    private const val MAX_LINK_LABEL = 500
    private const val MAX_LINK_ADDRESS = 2_048

    // The characters a regex `\s` means. Kept as it was so the checks behave as before.
    private fun isSpace(c: Char): Boolean = c == ' ' || c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r'

    private fun isLanguageChar(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_' || c == '+' || c == '#' || c == '.' || c == '-'

    /**
     * `---`, `***`, `___`: three or more of one mark, with white space allowed between and around them. A scan, not a regex: this line
     * can be thousands of characters long.
     */
    private fun isRule(line: String): Boolean {
        var mark = ' '
        var count = 0
        for (c in line) {
            when {
                isSpace(c) -> Unit
                c == '-' || c == '*' || c == '_' -> {
                    if (count == 0) mark = c else if (c != mark) return false
                    count++
                }
                else -> return false
            }
        }
        return count >= 3
    }

    /**
     * The language after an opening fence (possibly empty), or `null` when the line does not open one. It names the language first and may
     * carry more ("```js title=x"), but a backtick after it means inline code, not a fence. Text that is not a language ("``` ~~x~~") may
     * follow the fence after a space; the fence then has no language.
     */
    private fun fenceLanguage(line: String): String? {
        var i = 0
        while (i < line.length && isSpace(line[i])) i++
        if (!line.startsWith("```", i)) return null
        i += 3
        val afterFence = i
        while (i < line.length && isSpace(line[i])) i++
        val start = i
        while (i < line.length && isLanguageChar(line[i])) i++
        if (i == line.length || (isSpace(line[i]) && line.indexOf('`', i) < 0)) return line.substring(start, i)
        return if (afterFence < line.length && isSpace(line[afterFence]) && line.indexOf('`', afterFence) < 0) "" else null
    }

    /** Only a bare ``` (with white space around it) closes a fence. */
    private fun isFenceClose(line: String): Boolean = line.trim { isSpace(it) } == "```"

    private val QUOTE = Regex("""^\s*>\s?(.*)$""")
    private val HEADING = Regex("""^\s*(#{1,6})\s+(.*)$""")
    private val BULLET = Regex("""^\s*[-*•]\s+(.*)$""")
    private val NUMBERED = Regex("""^\s*(\d{1,3})[.)]\s+(.*)$""")

    /** The blocks of a reply. It never throws: if parsing fails the reply is returned as one plain line. */
    fun parse(text: String): List<MdBlock> = parseWith(text, ::parseBlocks)

    /** [parse] with the parser as a parameter, so a test can make it fail and see the fallback. */
    internal fun parseWith(text: String, parser: (String) -> List<MdBlock>): List<MdBlock> {
        if (text.length > MAX_PARSED_CHARS) return plainBlocks(text)
        return try {
            val blocks = parser(text)
            if (renderedItems(blocks) > MAX_RENDERED_ITEMS) plainBlocks(text) else blocks
        } catch (_: StackOverflowError) {
            plainBlocks(text)
        } catch (_: RuntimeException) {
            plainBlocks(text)
        }
    }

    /** How many views the blocks become: one per line, list item or quoted line (a code block is one, however long; a gap is only space). */
    private fun renderedItems(blocks: List<MdBlock>): Int = blocks.sumOf { block ->
        when (block) {
            is MdBlock.ListBlock -> block.items.size
            is MdBlock.Quote -> block.lines.size
            MdBlock.Gap -> 0
            else -> 1
        }
    }

    private fun plainBlocks(text: String): List<MdBlock> = if (text.isBlank()) emptyList() else listOf(MdBlock.Line(listOf(MdSpan(text))))

    private fun parseBlocks(text: String): List<MdBlock> {
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
            val openCode = codeLines
            if (openCode != null) {
                if (isFenceClose(line)) {
                    out += MdBlock.Code(codeLanguage, openCode.joinToString("\n"))
                    codeLines = null
                } else {
                    openCode.add(line)
                }
                continue
            }
            val fence = fenceLanguage(line)
            if (fence != null) {
                closeList()
                closeQuote()
                codeLanguage = fence
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
            if (isRule(line)) {
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
    private val LINK = InlineRule(Kind.LINK, Regex("\\[([^\\]]{1,$MAX_LINK_LABEL})]\\((https?://[^\\s)]{1,$MAX_LINK_ADDRESS})\\)"))
    private val BOLD = InlineRule(Kind.BOLD, Regex("""\*\*(.+?)\*\*"""))
    private val STRIKE = InlineRule(Kind.STRIKE, Regex("""~~([^\s~](?:[^~]*[^\s~])?)~~"""))

    // *italic*: the asterisks must hug the text, so "2 * 3 * 4" and bullets stay literal.
    private val ITALIC = InlineRule(Kind.ITALIC, Regex("""(?<![*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])"""))
    private val BARE = InlineRule(Kind.BARE, Regex("""https?://[^\s<>"'`)]+"""))
    private val ALL = listOf(CODE, LINK, BOLD, STRIKE, ITALIC, BARE)
    private val INSIDE_LINK = listOf(CODE, BOLD, STRIKE, ITALIC)
    private const val TRAILING_PUNCTUATION = ".,;:!?"

    /** The styled runs of one line. It never throws: a line it cannot read, or one over [MAX_STYLED_LINE_CHARS], comes back as plain text. */
    fun parseInline(text: String): List<MdSpan> {
        if (text.isEmpty()) return emptyList()
        if (text.length > MAX_STYLED_LINE_CHARS) return listOf(MdSpan(text))
        return try {
            inline(text, MdSpan(""))
        } catch (_: StackOverflowError) {
            listOf(MdSpan(text))
        } catch (_: RuntimeException) {
            listOf(MdSpan(text))
        }
    }

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
        // Each rule's next match is kept until the scan moves past it. Searching every rule again from the new position after each match
        // rescans the rest of the line for the rules that have no match left, which is quadratic on a long line.
        val upcoming = arrayOfNulls<MatchResult>(rules.size)
        val finished = BooleanArray(rules.size)
        var pos = 0
        while (pos < text.length) {
            var best: MatchResult? = null
            var bestRule: InlineRule? = null
            for (i in rules.indices) {
                if (finished[i]) continue
                var found = upcoming[i]
                if (found == null || found.range.first < pos) {
                    found = rules[i].regex.find(text, pos)
                    upcoming[i] = found
                    if (found == null) {
                        finished[i] = true
                        continue
                    }
                }
                if (best == null || found.range.first < best.range.first) {
                    best = found
                    bestRule = rules[i]
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
