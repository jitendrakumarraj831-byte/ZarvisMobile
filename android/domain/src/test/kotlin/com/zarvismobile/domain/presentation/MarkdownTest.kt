package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Mirrors the cases in web/tests/logic.test.js for formatReplyHtml, so both clients read a reply the same way. */
class MarkdownTest {
    private fun line(vararg spans: MdSpan) = MdBlock.Line(spans.toList())
    private fun plain(text: String) = MdSpan(text)

    @Test
    fun `plain text is one line`() {
        assertEquals(listOf(line(plain("Hello there"))), Markdown.parse("Hello there"))
        assertEquals(emptyList(), Markdown.parse(""))
    }

    @Test
    fun `bold, italic, strike and inline code`() {
        val spans = Markdown.parseInline("a **b** *c* ~~d~~ `e` f")
        assertEquals(
            listOf(
                plain("a "), MdSpan("b", bold = true), plain(" "), MdSpan("c", italic = true), plain(" "),
                MdSpan("d", strike = true), plain(" "), MdSpan("e", code = true), plain(" f"),
            ),
            spans,
        )
    }

    @Test
    fun `styles nest`() {
        assertEquals(
            listOf(MdSpan("bold and ", bold = true), MdSpan("both", bold = true, italic = true), MdSpan(" here", bold = true)),
            Markdown.parseInline("**bold and *both* here**"),
        )
    }

    @Test
    fun `markdown inside inline code stays literal`() {
        assertEquals(listOf(MdSpan("**not bold**", code = true)), Markdown.parseInline("`**not bold**`"))
    }

    @Test
    fun `stars that are not emphasis stay as written`() {
        assertEquals(listOf(plain("2 * 3 * 4")), Markdown.parseInline("2 * 3 * 4"))
        assertEquals(listOf(plain("2 ~ 3 ~ 4")), Markdown.parseInline("2 ~ 3 ~ 4"))
    }

    @Test
    fun `headings`() {
        assertEquals(
            listOf(
                MdBlock.Heading(1, listOf(plain("One"))),
                MdBlock.Heading(2, listOf(plain("Two"))),
                MdBlock.Heading(3, listOf(plain("Three"))),
                MdBlock.Heading(3, listOf(plain("Small"))), // #### and deeper share the smallest size
            ),
            Markdown.parse("# One\n## Two\n### Three\n#### Small"),
        )
    }

    @Test
    fun `bullet and numbered lists, with the first number kept`() {
        assertEquals(
            listOf(MdBlock.ListBlock(false, 1, listOf(listOf(plain("a")), listOf(plain("b")), listOf(plain("c"))))),
            Markdown.parse("- a\n* b\n• c"),
        )
        assertEquals(
            listOf(MdBlock.ListBlock(true, 3, listOf(listOf(plain("x")), listOf(plain("y"))))),
            Markdown.parse("3. x\n4) y"),
        )
    }

    @Test
    fun `a bullet list followed by a numbered one is two lists`() {
        val blocks = Markdown.parse("- a\n1. b")
        assertEquals(2, blocks.size)
        assertEquals(false, (blocks[0] as MdBlock.ListBlock).ordered)
        assertEquals(true, (blocks[1] as MdBlock.ListBlock).ordered)
    }

    @Test
    fun `fenced code is kept exactly, with its language`() {
        val blocks = Markdown.parse("```js\nconst a = \"<b>\";\n  # not a heading\n```\nafter")
        assertEquals(MdBlock.Code("js", "const a = \"<b>\";\n  # not a heading"), blocks[0])
        assertEquals(line(plain("after")), blocks[1])
    }

    @Test
    fun `an unclosed fence shows the rest of the reply as code`() {
        assertEquals(
            listOf(line(plain("Here:")), MdBlock.Code("", "line 1\nline 2")),
            Markdown.parse("Here:\n```\nline 1\nline 2"),
        )
    }

    @Test
    fun `quotes are not read inside a fence`() {
        assertEquals(listOf(MdBlock.Code("", "> not a quote")), Markdown.parse("```\n> not a quote\n```"))
    }

    @Test
    fun `block quotes keep their blank lines and their formatting`() {
        val blocks = Markdown.parse("> Note **this**\n>\n> and that\nplain")
        assertEquals(
            listOf(
                MdBlock.Quote(listOf(listOf(plain("Note "), MdSpan("this", bold = true)), emptyList(), listOf(plain("and that")))),
                line(plain("plain")),
            ),
            blocks,
        )
    }

    @Test
    fun `a line of dashes, stars or underscores is a rule, not a list`() {
        assertEquals(listOf(MdBlock.Rule, MdBlock.Rule, MdBlock.Rule), Markdown.parse("---\n***\n_ _ _"))
    }

    @Test
    fun `links are kept only for http and https`() {
        val spans = Markdown.parseInline("See [docs](https://ex.com/a?b=1&c=2) or https://x.org/p.")
        assertEquals(
            listOf(plain("See "), MdSpan("docs", link = "https://ex.com/a?b=1&c=2"), plain(" or "), MdSpan("https://x.org/p", link = "https://x.org/p"), plain(".")),
            spans,
        )
        val bad = Markdown.parseInline("[bad](javascript:alert(1))")
        assertTrue(bad.none { it.link != null }, bad.toString())
        assertEquals("[bad](javascript:alert(1))", bad.joinToString("") { it.text })
        assertTrue(Markdown.parseInline("[f](file:///etc/passwd)").none { it.link != null })
    }

    @Test
    fun `a bare address stops at a quote and at trailing punctuation`() {
        val spans = Markdown.parseInline("go https://a.b/\"onmouseover=alert(1) now, or (https://c.d/e).")
        assertEquals("https://a.b/", spans.first { it.link != null }.link)
        assertEquals(listOf("https://a.b/", "https://c.d/e"), spans.mapNotNull { it.link })
        assertEquals("go https://a.b/\"onmouseover=alert(1) now, or (https://c.d/e).", spans.joinToString("") { it.text })
    }

    @Test
    fun `a link label can be styled but a link inside a link is not nested`() {
        val spans = Markdown.parseInline("[**bold** https://x.y](https://z.w)")
        assertTrue(spans.all { it.link == "https://z.w" }, spans.toString())
    }

    @Test
    fun `html in a reply is just text`() {
        val blocks = Markdown.parse("<img src=x onerror=alert(1)> **bold** `code`\n- item <b>")
        assertEquals(
            MdBlock.Line(listOf(plain("<img src=x onerror=alert(1)> "), MdSpan("bold", bold = true), plain(" "), MdSpan("code", code = true))),
            blocks[0],
        )
        assertEquals(MdBlock.ListBlock(false, 1, listOf(listOf(plain("item <b>")))), blocks[1])
    }

    @Test
    fun `a table stays as the plain text lines it arrived as`() {
        val blocks = Markdown.parse("| Item | Qty |\n|--|--|\n| Tea | 2 |")
        assertEquals(3, blocks.size)
        assertTrue(blocks.all { it is MdBlock.Line })
    }

    @Test
    fun `blank lines become one gap and never lead or trail`() {
        assertEquals(listOf(line(plain("a")), MdBlock.Gap, line(plain("b"))), Markdown.parse("\n\na\n\n\n\nb\n\n"))
    }

    @Test
    fun `windows line endings and Hindi text`() {
        val blocks = Markdown.parse("## योजना\r\n- पहला **ज़रूरी**\r\n- दूसरा")
        assertEquals(MdBlock.Heading(2, listOf(plain("योजना"))), blocks[0])
        assertEquals(MdBlock.ListBlock(false, 1, listOf(listOf(plain("पहला "), MdSpan("ज़रूरी", bold = true)), listOf(plain("दूसरा")))), blocks[1])
    }

    @Test
    fun `an address with no host is not a link`() {
        assertTrue(Markdown.parseInline("see https://. now").none { it.link != null })
    }

    @Test
    fun `parsing a very long reply is fast and does not blow up`() {
        val long = buildString { repeat(2000) { append("- item $it with **bold** and `code` and https://example.com/$it\n") } }
        val started = System.nanoTime()
        val blocks = Markdown.parse(long)
        val ms = (System.nanoTime() - started) / 1_000_000
        assertEquals(1, blocks.size)
        assertTrue(ms < 3_000, "took $ms ms")
    }

    @Test
    fun `an opening fence can carry more than the language, and only a bare fence closes it`() {
        assertEquals(
            listOf(MdBlock.Code("js", "const a = 1;\n```ts"), line(plain("after"))),
            Markdown.parse("```js title=x\nconst a = 1;\n```ts\n```\nafter"),
        )
    }
}
