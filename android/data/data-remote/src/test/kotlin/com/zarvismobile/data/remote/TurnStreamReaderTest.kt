package com.zarvismobile.data.remote

import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnStreamReaderTest {
    private fun read(stream: String): Pair<TurnStreamEvent?, List<TurnStreamEvent>> {
        val seen = mutableListOf<TurnStreamEvent>()
        val last = TurnStreamReader.read(Buffer().writeUtf8(stream)) { seen += it }
        return last to seen
    }

    @Test
    fun eachStageTheServerReachesIsReadAndTheTurnEndsWithItsAnswer() {
        val (last, seen) = read(
            "event: meta\ndata: {\"conversationId\":\"c1\",\"turnId\":\"t1\"}\n\n" +
                ": keep-alive\n\n" +
                "event: progress\ndata: {\"type\":\"thinking\",\"step\":1}\n\n" +
                "event: progress\ndata: {\"type\":\"tool_started\",\"skillId\":\"web.search\",\"toolCallId\":\"x\",\"skillName\":\"Web search\"}\n\n" +
                "event: progress\ndata: {\"type\":\"tool_stage\",\"skillId\":\"web.search\",\"stage\":\"fetching\"}\n\n" +
                "event: progress\ndata: {\"type\":\"tool_finished\",\"skillId\":\"web.search\",\"status\":\"COMPLETED\"}\n\n" +
                "event: delta\ndata: {\"text\":\"Here you go.\"}\n\n" +
                "event: done\ndata: {\"message\":\"Here you go.\",\"toolCalls\":[],\"conversationId\":\"c1\",\"turnId\":\"t1\"}\n\n" +
                "event: progress\ndata: {\"type\":\"thinking\",\"step\":2}\n\n",
        )
        assertEquals(
            listOf(
                TurnStreamEvent.Meta("c1"),
                TurnStreamEvent.Thinking(1),
                TurnStreamEvent.ToolStarted("web.search", "Web search"),
                TurnStreamEvent.ToolFinished("web.search", "COMPLETED"),
            ),
            seen.dropLast(1),
        )
        assertTrue(last is TurnStreamEvent.Done)
        assertEquals("Here you go.", (last as TurnStreamEvent.Done).response.message)
        assertEquals("nothing after the answer is read", last, seen.last())
    }

    @Test
    fun aFailedTurnCarriesTheServersErrorBody() {
        val body = """{"type":"AI_RATE_LIMITED","code":"AI_RATE_LIMITED","error":"busy","retryable":true,"turnId":"t1"}"""
        val (last, _) = read("event: error\ndata: $body\n\n")
        assertEquals(TurnStreamEvent.Failed(body), last)
        assertTrue(AiServiceErrors.classify(429, (last as TurnStreamEvent.Failed).body)!!.retryable)
    }

    @Test
    fun aStreamThatEndsBeforeTheAnswerGivesNothing() {
        assertNull(read("event: progress\ndata: {\"type\":\"thinking\",\"step\":1}\n\n").first)
        assertNull(read("event: done\ndata: {\"message\":\"cut off").first)
        assertNull("a proxy's page is not an answer", read("<html>Bad gateway</html>\n").first)
    }

    @Test
    fun dataSplitOverSeveralLinesIsJoinedAndUnreadableEventsAreSkipped() {
        val (last, seen) = read(
            "event: progress\ndata: not json\n\n" +
                "event: progress\ndata: {\"type\":\"tool_started\"}\n\n" +
                "event: done\ndata: {\"message\":\"two\",\ndata: \"toolCalls\":[],\"conversationId\":null}\n\n",
        )
        assertEquals("two", (last as TurnStreamEvent.Done).response.message)
        assertEquals(listOf(last), seen)
    }
}
