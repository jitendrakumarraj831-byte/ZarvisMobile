package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Malformed and adversarial replies. A reply is drawn on the main thread while the screen is composed, so `Markdown.parse` must
 * neither throw nor stall whatever a model (or a pasted message) puts in it.
 *
 * The first version of the rule check was a regex with a repeated group, and a line of a few thousand hyphens, underscores or asterisks
 * (or a long `- - -` run) made it throw StackOverflowError; where exactly depends on the thread's stack. The Chat screen would have
 * crashed, and again when reopened with the same restored reply. Other lines made the parser stall (an unclosed `[` repeated,
 * ``` followed by tens of thousands of spaces). These tests run the real [Markdown] against those lines and against a flood of every
 * token it understands.
 */
class MarkdownRobustnessTest {
    /** Parses, failing the test if it throws or is slow. The limit is far above what the code needs; it only catches a stall. */
    private fun parseFast(text: String): List<MdBlock> {
        val started = System.nanoTime()
        val blocks = Markdown.parse(text)
        val ms = (System.nanoTime() - started) / 1_000_000
        assertTrue(ms < SLOW_MS, "parsing ${text.length} characters took $ms ms")
        return blocks
    }

    /** The words of a block as one string, markup removed, so a test can see that no text was lost. */
    private fun textOf(blocks: List<MdBlock>): String = blocks.joinToString("\n") { block ->
        when (block) {
            is MdBlock.Line -> block.spans.joinToString("") { it.text }
            is MdBlock.Heading -> block.spans.joinToString("") { it.text }
            is MdBlock.ListBlock -> block.items.joinToString("\n") { item -> item.joinToString("") { it.text } }
            is MdBlock.Quote -> block.lines.joinToString("\n") { line -> line.joinToString("") { it.text } }
            is MdBlock.Code -> block.code
            MdBlock.Rule, MdBlock.Gap -> ""
        }
    }

    // ---- Lines made only of rule characters ------------------------------------------------------------------------------------

    @Test
    fun `2000 hyphens are one rule`() = assertEquals(listOf(MdBlock.Rule), parseFast("-".repeat(2_000)))

    @Test
    fun `5000 underscores are one rule`() = assertEquals(listOf(MdBlock.Rule), parseFast("_".repeat(5_000)))

    @Test
    fun `2000 asterisks are one rule`() = assertEquals(listOf(MdBlock.Rule), parseFast("*".repeat(2_000)))

    @Test
    fun `1000 hyphens, 2000 underscores and 5000 asterisks are each one rule`() {
        assertEquals(listOf(MdBlock.Rule), parseFast("-".repeat(1_000)))
        assertEquals(listOf(MdBlock.Rule), parseFast("_".repeat(2_000)))
        assertEquals(listOf(MdBlock.Rule), parseFast("*".repeat(5_000)))
    }

    @Test
    fun `20000 characters of repeated rule syntax are one rule`() {
        for (unit in listOf("- ", "* ", "_ ", "-", "*", "_", "- - ", "\t-", " * ", "---\t")) {
            val line = unit.repeat(20_000 / unit.length)
            assertEquals(listOf(MdBlock.Rule), parseFast(line), "unit '${unit.replace("\t", "\\t")}'")
        }
    }

    @Test
    fun `a rule needs three marks of one kind`() {
        assertEquals(listOf(MdBlock.Rule), parseFast("---"))
        assertEquals(listOf(MdBlock.Rule), parseFast("  - - -  "))
        assertEquals(listOf(MdBlock.Rule), parseFast("***"))
        assertEquals(listOf(MdBlock.Rule), parseFast("___"))
        assertTrue(Markdown.parse("--").none { it == MdBlock.Rule })
        assertTrue(Markdown.parse("-*_").none { it == MdBlock.Rule })
        assertTrue(Markdown.parse("--- x").none { it == MdBlock.Rule })
    }

    @Test
    fun `a long run of rule characters with text after it is text, and none of it is lost`() {
        // (Runs of asterisks are left out: `**` is bold markup, so some of those characters are rightly consumed.)
        for (line in listOf("-".repeat(5_000) + "x", "_".repeat(5_000) + "x", "-".repeat(4_000) + " word")) {
            assertEquals(line, textOf(parseFast(line)), "starts '${line.take(4)}'")
        }
        parseFast("*".repeat(3_000) + " word")
        // A bullet whose text is itself a run of bullets: the first marker is the list's, the rest is the item's text.
        val item = "- ".repeat(4_999) + "x"
        val list = parseFast("- $item").single() as MdBlock.ListBlock
        assertEquals(item, list.items.single().joinToString("") { it.text })
    }

    // ---- A flood of every token the parser knows ---------------------------------------------------------------------------------

    @Test
    fun `a flood of any markdown token neither throws nor stalls`() {
        for (token in FLOOD_TOKENS) {
            for (size in listOf(2_000, 15_000, 30_000)) {
                parseFast(token.repeat(maxOf(1, size / token.length)))
            }
        }
    }

    @Test
    fun `a flood of tokens on many short lines neither throws nor stalls`() {
        for (token in FLOOD_TOKENS) {
            parseFast((token + "\n").repeat(maxOf(1, 20_000 / (token.length + 1))))
        }
    }

    @Test
    fun `a fence line followed by thousands of spaces and a backtick is not slow`() {
        parseFast("```" + " ".repeat(50_000) + "`")
        parseFast("``` js" + " ".repeat(50_000) + "`")
        parseFast(" ".repeat(50_000) + "```" + " ".repeat(50_000) + "x`")
    }

    @Test
    fun `thousands of unclosed brackets are not slow`() {
        parseFast("[".repeat(60_000))
        parseFast("[a](https://x".repeat(4_000))
        parseFast("[a]".repeat(10_000) + "(")
    }

    // ---- Empty and malformed input -------------------------------------------------------------------------------------------------

    @Test
    fun `empty and blank input is no blocks`() {
        assertEquals(emptyList(), Markdown.parse(""))
        assertEquals(emptyList(), Markdown.parse("   "))
        assertEquals(emptyList(), Markdown.parse("\n\n\n"))
        assertEquals(emptyList(), Markdown.parse("\r\n"))
        assertEquals(emptyList(), Markdown.parseInline(""))
    }

    @Test
    fun `malformed markdown is shown, not rejected`() {
        for (text in listOf(
            "**unclosed", "*", "**", "***", "[unclosed", "[a](", "[a](https://", "[a]()", "`", "``", "~~", "~~ ~~", "> ", ">", "#", "# ", "1.",
            "1. ", "- ", "| a | b |", "\u0000abc", "lone surrogate \uD83D here", "emoji 😀 **bold 😀**", "हिंदी **मोटा** *तिरछा*", "a\r\nb\rc",
            "<script>alert(1)</script>", "[x](javascript:alert(1))", "```", "```\n", "``` `",
        )) {
            parseFast(text)
        }
        // Nothing but the markers can be consumed: the words are still there.
        assertTrue(textOf(Markdown.parse("**unclosed bold")).contains("unclosed bold"))
        assertTrue(textOf(Markdown.parse("[a](https://example.com")).contains("example.com"))
        assertTrue(textOf(Markdown.parse("लाइन **अधूरा")).contains("अधूरा"))
    }

    @Test
    fun `an unsafe link stays visible text and is never a link`() {
        val spans = Markdown.parse("[click](javascript:alert(1)) and [file](file:///etc/passwd)").flatMap { (it as MdBlock.Line).spans }
        assertTrue(spans.none { it.link != null }, "no link span expected: $spans")
        assertTrue(spans.joinToString("") { it.text }.contains("javascript:alert(1)"))
    }

    // ---- Normal replies still read the same ----------------------------------------------------------------------------------------

    @Test
    fun `an ordinary reply keeps every kind of formatting`() {
        val blocks = parseFast(REPLY)
        assertEquals(1, blocks.count { it is MdBlock.Heading })
        assertEquals(2, blocks.count { it is MdBlock.ListBlock })
        assertEquals(1, blocks.count { it is MdBlock.Quote })
        assertEquals(1, blocks.count { it == MdBlock.Rule })
        val code = blocks.filterIsInstance<MdBlock.Code>().single()
        assertEquals("kotlin", code.language)
        assertTrue(code.code.contains("val rule = \"----------\""), "rule-like text inside a fence is code: ${code.code}")
        val spans = blocks.filterIsInstance<MdBlock.Line>().flatMap { it.spans }
        assertTrue(spans.any { it.bold && it.text == "the plan" })
        assertTrue(spans.any { it.italic && it.text == "emphasis" })
        assertTrue(spans.any { it.strike && it.text == "old" })
        assertTrue(spans.any { it.code && it.text == "code" })
        assertTrue(spans.any { it.link == "https://example.com/docs" && it.text == "docs" })
        assertTrue(spans.any { it.link == "https://example.org" })
    }

    @Test
    fun `a long reply keeps its formatting`() {
        val section = "This is **bold**, this is *italic*, this is `code`, and this is a [link](https://example.com/x)."
        val reply = (1..400).joinToString("\n\n") { "## Section $it\n\n$section\n\n- one\n- two\n" }
        assertTrue(reply.length in 40_000..90_000, "the sample should be a long, ordinary reply: ${reply.length}")
        val blocks = parseFast(reply)
        assertEquals(400, blocks.count { it is MdBlock.Heading })
        assertEquals(400, blocks.count { it is MdBlock.ListBlock })
        val lines = blocks.filterIsInstance<MdBlock.Line>()
        assertEquals(400, lines.size)
        assertTrue(lines.all { line -> line.spans.any { it.bold } && line.spans.any { it.italic } && line.spans.any { it.code } && line.spans.any { it.link == "https://example.com/x" } })
    }

    @Test
    fun `a fenced code block keeps every line exactly, rule-like ones included`() {
        val body = (1..2_000).joinToString("\n") { "line $it ${"-".repeat(it % 50)}" } + "\n" + "-".repeat(5_000) + "\n" + "* ".repeat(500)
        val blocks = parseFast("intro\n```text\n$body\n```\noutro")
        val code = blocks.filterIsInstance<MdBlock.Code>().single()
        assertEquals("text", code.language)
        assertEquals(body, code.code)
        assertEquals(1, blocks.count { it is MdBlock.Code })
        assertTrue(blocks.none { it == MdBlock.Rule })
    }

    @Test
    fun `which lines open a fence, and with what language`() {
        // The fence check is a character scan now; these are the forms the earlier regex accepted and refused.
        val opens = mapOf(
            "```" to "", "```kotlin" to "kotlin", "``` kotlin " to "kotlin", "  ```py" to "py", "```js title=x" to "js", "```c++" to "c++",
            "```c#" to "c#", "```a.b-c_d" to "a.b-c_d", "``` ~~s~~" to "", "```  " to "", "``` js text" to "js",
        )
        for ((line, language) in opens) {
            val code = Markdown.parse("$line\nbody\n```").singleOrNull() as? MdBlock.Code
            assertEquals(MdBlock.Code(language, "body"), code, "'$line'")
        }
        for (line in listOf("```js`x", "``` `x`", "```js{1}", "text ```", "```~~", "``` js`", "``", "`` `")) {
            assertTrue(Markdown.parse("$line\nbody").none { it is MdBlock.Code }, "'$line' should not open a fence")
        }
    }

    @Test
    fun `an unclosed fence shows the rest of the reply as code`() {
        val blocks = parseFast("```kotlin\nval x = 1\n" + "-".repeat(3_000))
        val code = blocks.filterIsInstance<MdBlock.Code>().single()
        assertEquals("kotlin", code.language)
        assertEquals("val x = 1\n" + "-".repeat(3_000), code.code)
    }

    // ---- A reply that is still arriving ----------------------------------------------------------------------------------------------

    @Test
    fun `every prefix of a reply parses, so a reply drawn while it streams in never breaks`() {
        val full = Markdown.parse(REPLY)
        for (end in 0..REPLY.length) {
            Markdown.parse(REPLY.substring(0, end)) // must not throw at any cut: mid-word, inside ** or [ or a fence
        }
        assertEquals(full, Markdown.parse(REPLY.substring(0, REPLY.length)))
        // A cut inside an opening marker shows the marker as text, then formats once the rest arrives.
        assertTrue(textOf(Markdown.parse("see **the pl")).contains("the pl"))
    }

    private companion object {
        /** Far above what the code needs (a few milliseconds); a stall or a quadratic blow-up is what this catches. */
        const val SLOW_MS = 3_000L

        val FLOOD_TOKENS = listOf(
            "*", "**", "***", "_", "__", "___", "-", "--", "---", "- ", "* ", "_ ", "- - ", "~", "~~", "~~a ", "`", "``", "```", "```\n", "` ",
            "[", "]", "[]", "](", "[a](", "[a](https://x", "[a](https://x) ", "[a]", "http://", "https://", "https://a.b ", "> ", ">", ">>", "#",
            "# ", "###### ", "1. ", "1) ", "99. ", "**a ", "*a ", "*a", "*a*", "**a**", "***a***", "\\", " ", "\t", "\r", "\n", "\u0000", "\uD83D",
            "😀", "हिंदी ", "• ", "|a|b|\n", "<b>x</b>", "javascript:", "word ", "a**b", "a*b", "~a~",
        )

        val REPLY = """
            # Plan

            Here is **the plan**, with *emphasis*, ~~old~~ and `code`. See [docs](https://example.com/docs) or https://example.org.

            1. First
            2. Second
            - bullet one
            - bullet two

            > a quoted line

            ---

            ```kotlin
            val rule = "----------"
            fun main() { println("**not bold**") }
            ```

            Done.
        """.trimIndent()
    }
}
