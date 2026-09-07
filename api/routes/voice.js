"use strict";

/**
 * POST /api/voice
 *
 * Receives a browser speech-recognition transcript from the Zarvis web
 * client, detects the wake word ("Hello Zarvis" / "Hello Jarvis" and Hindi
 * variants) plus a small set of built-in commands, and returns a clean JSON
 * reply the client speaks back via speechSynthesis.
 *
 * Mount in your Express app with:
 *   const voiceRouter = require("./routes/voice");
 *   app.use("/api/voice", voiceRouter);
 */

const express = require("express");

const router = express.Router();

const WAKE_WORD_REPLY = "Yes boss, boliye!";

// English + Hindi/Hinglish wake-word variants ("Hello Zarvis", "Hey Jarvis",
// "हेलो जार्विस", ...). Kept in sync with web/hooks/useVoiceAssistant.ts.
const WAKE_WORD_PATTERNS = [
  /\bhell?o+\s+zar[uv]is\b/i,
  /\bh[ae]y\s+zar[uv]is\b/i,
  /\bhell?o+\s+jar[uv]is\b/i,
  /\bh[ae]y\s+jar[uv]is\b/i,
  /हेलो\s*जार्विस/,
  /है(?:ल्लो|लो)?\s*जार्विस/,
  /हे\s*जार्विस/,
];

// Small built-in command set; real intent handling belongs in a skills/
// orchestrator layer, but a few local commands keep the route useful
// standalone and demonstrate the response shape.
const COMMAND_HANDLERS = [
  {
    action: "get_time",
    match: /\b(what'?s the time|current time|time please|समय क्या है)\b/i,
    handle: () => ({
      reply: `It's ${new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })}.`,
    }),
  },
  {
    action: "stop_listening",
    match: /\b(stop listening|go to sleep|band karo|चुप हो जाओ)\b/i,
    handle: () => ({ reply: "Okay boss, going quiet." }),
  },
];

function normalizeTranscript(text) {
  return text.replace(/\s+/g, " ").trim();
}

function detectWakeWord(text) {
  return WAKE_WORD_PATTERNS.some((pattern) => pattern.test(text));
}

function matchCommand(text) {
  return COMMAND_HANDLERS.find((entry) => entry.match.test(text));
}

router.post("/", (req, res) => {
  const { transcript, lang } = req.body || {};

  if (typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({
      error: "`transcript` is required and must be a non-empty string.",
    });
  }

  const normalized = normalizeTranscript(transcript);
  const responseLang = typeof lang === "string" && lang ? lang : "en-IN";

  if (detectWakeWord(normalized)) {
    return res.json({
      isWakeWord: true,
      transcript: normalized,
      reply: WAKE_WORD_REPLY,
      action: "wake",
      lang: responseLang,
    });
  }

  const command = matchCommand(normalized);
  if (command) {
    const { reply } = command.handle(normalized);
    return res.json({
      isWakeWord: false,
      transcript: normalized,
      reply,
      action: command.action,
      lang: responseLang,
    });
  }

  return res.json({
    isWakeWord: false,
    transcript: normalized,
    reply: null,
    action: "unhandled",
    lang: responseLang,
  });
});

module.exports = router;
