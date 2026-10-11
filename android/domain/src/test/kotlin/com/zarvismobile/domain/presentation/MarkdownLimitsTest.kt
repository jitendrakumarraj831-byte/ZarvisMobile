package com.zarvismobile.domain.presentation

import java.util.regex.PatternSyntaxException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The limits and the fallback of [Markdown]. Past a limit a reply is shown as plain text: every character is still there, only its
 * styling is not applied. If the parser itself fails, the same plain text is returned and nothing is thrown.
 */
class MarkdownLimitsTest {
    private fun spansOf(blocks: List<MdBlock>): List<MdSpan> = blocks.filterIsInstance<MdBlock.Line>().flatMap { it.spans }

    @Test
    fun `a line at the limit is still styled`() {
        val line = "a **b** ".repeat(Markdown.MAX_STYLED_LINE_CHARS / 8)
        assertEquals(Markdown.MAX_STYLED_LINE_CHARS, line.length)
        val spans = Markdown.parseInline(line)
        assertEquals(Markdown.MAX_STYLED_LINE_CHARS / 8, spans.count { it.bold && it.text == "b" })
    }

    @Test
    fun `a line over the limit is plain text, all of it`() {
        val line = "a **b** ".repeat(Markdown.MAX_STYLED_LINE_CHARS / 8) + "z"
        assertEquals(Markdown.MAX_STYLED_LINE_CHARS + 1, line.length)
        assertEquals(listOf(MdSpan(line)), Markdown.parseInline(line))
        // Through parse(): the marks are shown as written, the line is neither cut nor dropped.
        val blocks = Markdown.parse(line)
        assertEquals(line, spansOf(blocks).joinToString("") { it.text })
        assertTrue(spansOf(blocks).none { it.bold })
    }

    @Test
    fun `one long line does not change how the other lines are read`() {
        val long = "x".repeat(Markdown.MAX_STYLED_LINE_CHARS + 5)
        val blocks = Markdown.parse("# Title\n$long\nafter **bold**")
        assertEquals(MdBlock.Heading(1, listOf(MdSpan("Title"))), blocks.first())
        assertEquals(long, (blocks[1] as MdBlock.Line).spans.single().text)
        assertTrue((blocks[2] as MdBlock.Line).spans.any { it.bold && it.text == "bold" })
    }

    @Test
    fun `a reply just under the size limit is still formatted`() {
        // About 1,000 lines of 100 characters: a very long answer, but one that is neither too big nor too many lines.
        val unit = "Line with **bold** text, " + "x".repeat(74) + "\n"
        val reply = unit.repeat(Markdown.MAX_PARSED_CHARS / unit.length)
        assertTrue(reply.length <= Markdown.MAX_PARSED_CHARS && reply.length > Markdown.MAX_PARSED_CHARS - unit.length)
        assertTrue(Markdown.parse(reply).filterIsInstance<MdBlock.Line>().all { line -> line.spans.any { it.bold } })
    }

    @Test
    fun `a reply over the size limit is plain text, all of it`() {
        val unit = "Line with **bold** text, " + "x".repeat(74) + "\n"
        val reply = unit.repeat(Markdown.MAX_PARSED_CHARS / unit.length + 1)
        assertTrue(reply.length > Markdown.MAX_PARSED_CHARS)
        val blocks = Markdown.parse(reply)
        val line = blocks.single() as MdBlock.Line
        assertEquals(reply, line.spans.single().text)
        assertTrue(line.spans.none { it.bold })
    }

    @Test
    fun `a runaway list, quote or run of lines is plain text, all of it`() {
        val n = Markdown.MAX_RENDERED_ITEMS + 1
        for (reply in listOf("- item\n".repeat(n), "1. item\n".repeat(n), "> quoted\n".repeat(n), "a line\n".repeat(n), "# h\n".repeat(n))) {
            val line = Markdown.parse(reply).single() as MdBlock.Line
            assertEquals(reply, line.spans.single().text, "starts '${reply.take(6)}'")
        }
    }

    @Test
    fun `a long list at the limit is still a list, and code lines do not count`() {
        val atLimit = "- item\n".repeat(Markdown.MAX_RENDERED_ITEMS)
        assertEquals(Markdown.MAX_RENDERED_ITEMS, (Markdown.parse(atLimit).single() as MdBlock.ListBlock).items.size)
        val code = (1..10_000).joinToString("\n") { "line $it" }
        assertEquals(MdBlock.Code("", code), Markdown.parse("```\n$code\n```").single())
    }

    @Test
    fun `a link whose text or address is over the limit is not a link, and the address is still reachable as a bare link`() {
        val longLabel = "[" + "a".repeat(600) + "](https://example.com)"
        val spans = Markdown.parseInline(longLabel)
        assertTrue(spans.none { it.link != null && it.text.startsWith("aaa") })
        assertTrue(spans.any { it.link == "https://example.com" })
        assertEquals(longLabel.length, spans.sumOf { it.text.length }, "no characters are dropped")

        val labelAtLimit = "[" + "a".repeat(500) + "](https://example.com)"
        assertEquals("https://example.com", Markdown.parseInline(labelAtLimit).single().link)

        // The limit counts the characters after "https://".
        val addressAtLimit = "https://" + "a".repeat(2_048)
        assertEquals(addressAtLimit, Markdown.parseInline("[x]($addressAtLimit)").single().link)
        val addressOver = addressAtLimit + "a"
        assertTrue(Markdown.parseInline("[x]($addressOver)").none { it.text == "x" && it.link != null })
    }

    @Test
    fun `if the parser fails the reply comes back as plain text`() {
        val text = "a **b**\n\n- c"
        for (failure in listOf<Throwable>(StackOverflowError(), IllegalStateException("boom"), PatternSyntaxException("bad", "x", 0), IndexOutOfBoundsException())) {
            val blocks = Markdown.parseWith(text) { throw failure }
            assertEquals(listOf<MdBlock>(MdBlock.Line(listOf(MdSpan(text)))), blocks, failure::class.simpleName)
        }
        assertEquals(emptyList(), Markdown.parseWith("  \n ") { throw StackOverflowError() })
    }

    @Test
    fun `a fatal error is not hidden by the fallback`() {
        assertFailsWith<OutOfMemoryError> { Markdown.parseWith("x") { throw OutOfMemoryError() } }
    }
}
