"use client";

/**
 * useVoiceAssistant
 *
 * Continuous browser voice loop for the Zarvis web client, built on
 * webkitSpeechRecognition/SpeechRecognition + speechSynthesis.
 *
 * Fixes addressed here:
 *  - Mic flicker: a single `isListeningRef` + `isStartingRef` lock guarantees
 *    only one recognition session is ever active, and every restart goes
 *    through a throttled `setTimeout` instead of firing synchronously from
 *    `onend` (which is what causes the rapid on/off loop).
 *  - Wake word ("Hello Zarvis" / "Hello Jarvis" / Hindi variants): detected
 *    locally so the reply is instant, no network round trip required.
 *  - Feedback loop: recognition is stopped before speechSynthesis speaks and
 *    only resumes in the utterance's `onend`, so the mic never hears its own
 *    reply.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API types are not part of the default TS DOM lib in all
// setups, so declare the minimal surface we use.
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string; confidence: number };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export type VoiceAssistantStatus = "idle" | "listening" | "speaking" | "processing" | "error";

export interface VoiceApiResponse {
  isWakeWord: boolean;
  transcript: string;
  reply: string | null;
  action?: string;
  lang?: string;
}

export interface UseVoiceAssistantOptions {
  /** BCP-47 recognition language. Defaults to Indian English. */
  lang?: string;
  /** Backend endpoint that classifies/handles non-wake-word transcripts. */
  apiEndpoint?: string;
  /** Delay before the mic is restarted after it stops (debounce/throttle). Prevents flicker. */
  restartDelayMs?: number;
  /** Called for every recognized chunk (interim + final). */
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  /** Called when the wake word is detected, before the reply is spoken. */
  onWakeWord?: (transcript: string) => void;
  /** Start listening automatically on mount. Defaults to true. */
  autoStart?: boolean;
}

export interface UseVoiceAssistantResult {
  status: VoiceAssistantStatus;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  error: string | null;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  speak: (text: string) => Promise<void>;
}

const WAKE_WORD_REPLY = "Yes boss, boliye!";

// English + Hindi/Hinglish wake-word variants.
const WAKE_WORD_PATTERNS: RegExp[] = [
  /\bhell?o+\s+zar[uv]is\b/i,
  /\bh[ae]y\s+zar[uv]is\b/i,
  /\bhell?o+\s+jar[uv]is\b/i,
  /\bh[ae]y\s+jar[uv]is\b/i,
  /हेलो\s*जार्विस/,
  /है(?:ल्लो|लो)?\s*जार्विस/,
  /हे\s*जार्विस/,
];

function containsWakeWord(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return WAKE_WORD_PATTERNS.some((pattern) => pattern.test(normalized));
}

const DEFAULT_RESTART_DELAY_MS = 400;

export function useVoiceAssistant(options: UseVoiceAssistantOptions = {}): UseVoiceAssistantResult {
  const {
    lang = "en-IN",
    apiEndpoint = "/api/voice",
    restartDelayMs = DEFAULT_RESTART_DELAY_MS,
    onTranscript,
    onWakeWord,
    autoStart = true,
  } = options;

  const [status, setStatus] = useState<VoiceAssistantStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // State locks — these, not React state, are the source of truth inside
  // recognition callbacks, since those callbacks close over stale state.
  const isListeningRef = useRef(false);
  const isStartingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const shouldRunRef = useRef(autoStart);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const scheduleRestart = useCallback(
    (delay: number) => {
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        safeStart();
      }, delay);
    },
    // safeStart is defined below and stable across renders (see its own
    // useCallback with an empty-ish dep list); referenced via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearRestartTimer]
  );

  const safeStart = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (!shouldRunRef.current) return;
    if (isSpeakingRef.current) return; // never listen while we're talking
    if (isListeningRef.current || isStartingRef.current) return; // already active/starting

    isStartingRef.current = true;
    try {
      recognition.start();
    } catch (err) {
      isStartingRef.current = false;
      // start() throws InvalidStateError if a session is already running —
      // that's a benign race between our lock and the browser's internal
      // state; anything else is a real error worth surfacing.
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) {
        setError(err instanceof Error ? err.message : "Failed to start recognition");
      }
    }
  }, []);

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    clearRestartTimer();
    const recognition = recognitionRef.current;
    if (recognition && (isListeningRef.current || isStartingRef.current)) {
      recognition.stop();
    }
  }, [clearRestartTimer]);

  const start = useCallback(() => {
    shouldRunRef.current = true;
    safeStart();
  }, [safeStart]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis || !text) {
          resolve();
          return;
        }

        // Pause recognition before speaking so the mic never hears the reply.
        isSpeakingRef.current = true;
        clearRestartTimer();
        const recognition = recognitionRef.current;
        if (recognition && (isListeningRef.current || isStartingRef.current)) {
          try {
            recognition.stop();
          } catch {
            /* already stopped — nothing to do */
          }
        }

        window.speechSynthesis.cancel(); // drop any stale queued utterances
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = /[ऀ-ॿ]/.test(text) ? "hi-IN" : lang;
        utterance.rate = 1;
        utterance.pitch = 1;

        const finish = () => {
          isSpeakingRef.current = false;
          setStatus("idle");
          resolve();
          // Resume listening only after the reply has fully finished playing.
          if (shouldRunRef.current) {
            scheduleRestart(restartDelayMs);
          }
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        setStatus("speaking");
        window.speechSynthesis.speak(utterance);
      }),
    [lang, restartDelayMs, clearRestartTimer, scheduleRestart]
  );

  const processTranscript = useCallback(
    async (finalText: string) => {
      setStatus("processing");
      try {
        const res = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: finalText, lang }),
        });
        if (!res.ok) throw new Error(`Voice API responded with ${res.status}`);
        const data: VoiceApiResponse = await res.json();

        if (data.isWakeWord) {
          onWakeWord?.(finalText);
        }
        if (data.reply) {
          await speak(data.reply);
        } else if (shouldRunRef.current) {
          scheduleRestart(restartDelayMs);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process transcript");
        if (shouldRunRef.current) {
          scheduleRestart(restartDelayMs);
        }
      }
    },
    [apiEndpoint, lang, onWakeWord, restartDelayMs, scheduleRestart, speak]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const RecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      setIsSupported(false);
      setError("Speech recognition is not supported in this browser.");
      return;
    }
    setIsSupported(true);

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      isListeningRef.current = true;
      isStartingRef.current = false;
      setStatus("listening");
      setError(null);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      isStartingRef.current = false;

      // Expected/benign in continuous mode — onend will handle the restart.
      if (event.error === "no-speech" || event.error === "aborted") return;

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRunRef.current = false;
        clearRestartTimer();
        setStatus("error");
        setError("Microphone permission denied.");
        return;
      }

      setStatus("error");
      setError(event.error);
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      isStartingRef.current = false;
      clearRestartTimer();

      // Only auto-restart if we're not mid-reply and the caller still wants
      // to be listening. This throttled restart — instead of an immediate
      // synchronous recognition.start() — is what stops the flicker loop.
      if (shouldRunRef.current && !isSpeakingRef.current) {
        setStatus("idle");
        scheduleRestart(restartDelayMs);
      } else if (!shouldRunRef.current) {
        setStatus("idle");
      }
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      const latest = finalText || interimText;
      if (latest) {
        setTranscript(latest);
        onTranscript?.(latest, Boolean(finalText));
      }

      if (!finalText) return;

      if (containsWakeWord(finalText)) {
        onWakeWord?.(finalText);
        void speak(WAKE_WORD_REPLY);
        return;
      }

      void processTranscript(finalText);
    };

    recognitionRef.current = recognition;

    if (autoStart) {
      safeStart();
    }

    return () => {
      shouldRunRef.current = false;
      clearRestartTimer();
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
    // Recognition is intentionally (re)built only when `lang` changes; the
    // callbacks above read everything else through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return {
    status,
    isListening: status === "listening",
    isSpeaking: status === "speaking",
    transcript,
    error,
    isSupported,
    start,
    stop,
    speak,
  };
}

export default useVoiceAssistant;
