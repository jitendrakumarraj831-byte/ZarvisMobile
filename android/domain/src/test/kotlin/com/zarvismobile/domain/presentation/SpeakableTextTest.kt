package com.zarvismobile.domain.presentation

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * What the phone's own voice reads of a reply. The cases are the server voice's (backend/test/tts/ssml.test.ts `speakableText`):
 * both voices must say the same words.
 */
class SpeakableTextTest {
    @Test
    fun `plain text passes through unchanged, in English and Hindi`() {
        assertEquals("How are you today?", SpeakableText.of("How are you today?"))
        assertEquals("आप कैसे हैं? मैं ठीक हूँ।", SpeakableText.of("आप कैसे हैं? मैं ठीक हूँ।"))
        assertEquals("It costs 3.5 dollars, 5 * 3 = 15.", SpeakableText.of("It costs 3.5 dollars, 5 * 3 = 15."))
    }

    @Test
    fun `the words of emphasis, headings, bullets, inline code and links are kept`() {
        assertEquals(
            "This is very important and quite new, and also this.",
            SpeakableText.of("This is **very** important and *quite* new, and _also_ this."),
        )
        assertEquals(
            "Plan\n\nfirst step\nsecond step\n\nRun npm test now. See the docs please.",
            SpeakableText.of("# Plan\n\n- first step\n* second step\n\nRun `npm test` now. See [the docs](https://example.com/docs) please."),
        )
    }

    @Test
    fun `fenced code, bare URLs and emoji are not read aloud`() {
        assertEquals("Here is the fix:\n\nDone.", SpeakableText.of("Here is the fix:\n```ts\nconst x = 1;\n```\nDone."))
        assertEquals("Open now", SpeakableText.of("Open https://example.com/a?b=c now"))
        assertEquals("Great job team", SpeakableText.of("Great job 🎉🙂 team"))
    }

    @Test
    fun `snake_case words and maths are not mistaken for emphasis`() {
        assertEquals("use snake_case_names and a * b * c", SpeakableText.of("use snake_case_names and a * b * c"))
    }

    @Test
    fun `horizontal rules go and blank space collapses`() {
        assertEquals("one\n\ntwo words", SpeakableText.of("one\n\n\n\n---\n\ntwo   words"))
        assertEquals("one\ntwo", SpeakableText.of("one\r\ntwo"))
    }

    @Test
    fun `text that is only syntax leaves nothing to say`() {
        assertEquals("", SpeakableText.of("```\ncode only\n```"))
        assertEquals("", SpeakableText.of("🎉🎉"))
        assertEquals("", SpeakableText.of("   "))
    }

    @Test
    fun `a short reply is one piece`() {
        assertEquals(listOf("Hello there."), SpeakableText.pieces("Hello there.", 4000))
        assertEquals(emptyList(), SpeakableText.pieces("   ", 4000))
    }

    @Test
    fun `a long reply is cut at sentences, every piece within the limit, and nothing is lost`() {
        val sentence = "यह एक लंबा वाक्य है जो बार बार आता है। "
        val text = (sentence.repeat(300) + "And the last words.").trim()
        val pieces = SpeakableText.pieces(text, 4000)

        assertTrue(pieces.size > 1)
        assertTrue(pieces.all { it.length <= 4000 }, "every piece fits the phone's engine")
        assertTrue(pieces.dropLast(1).all { it.endsWith("।") }, "pieces end at a sentence")
        assertEquals(text.filterNot(Char::isWhitespace), pieces.joinToString("").filterNot(Char::isWhitespace))
    }

    @Test
    fun `text without sentence ends is cut at spaces, and a single endless word is cut hard`() {
        val words = "word ".repeat(50).trim()
        val atSpaces = SpeakableText.pieces(words, 32)
        assertTrue(atSpaces.all { it.length <= 32 && !it.startsWith(" ") && !it.endsWith(" ") })
        assertEquals(words, atSpaces.joinToString(" "))

        val endless = "x".repeat(100)
        assertEquals(listOf("x".repeat(40), "x".repeat(40), "x".repeat(20)), SpeakableText.pieces(endless, 40))
    }
}
