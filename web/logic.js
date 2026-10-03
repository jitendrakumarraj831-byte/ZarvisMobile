/**
 * Pure, DOM-free helpers for the ZARVIS web client. Loaded by index.html before app.js
 * (exposed as `window.ZarvisLogic`) and required directly by the Node tests in web/tests/,
 * so the rules the UI depends on are verified without a browser.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZarvisLogic = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Server codes meaning "this session is definitively over" (backend AuthErrorCode). */
  const SESSION_ENDED_CODES = ["session_invalid", "session_revoked", "refresh_token_reused"];

  /**
   * Classifies a failed refresh. Only an explicit session_* code ends the session; anything
   * else (network error, 5xx, a proxy page, a 401 without a code) is treated as "unreachable"
   * and must never cause the account to be replaced.
   */
  function classifyRefreshFailure(status, code) {
    if (status === 401 && SESSION_ENDED_CODES.includes(code)) return "session_ended";
    return "unreachable";
  }

  /** Incremental SSE parser: returns complete events and the unparsed remainder. */
  function parseSseEvents(buffer, flush = false) {
    const parts = buffer.split("\n\n");
    let rest = parts.pop() ?? "";
    if (flush && rest.trim()) {
      parts.push(rest);
      rest = "";
    }
    const events = [];
    for (const raw of parts) {
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        // A malformed frame is dropped rather than rendered as if it were real content.
      }
    }
    return { events, rest };
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatInlineMarkdown(escapedLine) {
    // Code spans first, so bold/links inside them stay literal.
    const codes = [];
    let line = escapedLine.replace(/`([^`]+)`/g, (_, code) => {
      codes.push(code);
      return `\u0000${codes.length - 1}\u0000`;
    });
    line = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // *italic*: the asterisks must hug the text, so "2 * 3 * 4" and bullets stay literal.
      .replace(/(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])/g, "$1<em>$2</em>")
      // [label](https://…) — only http(s); the text is already escaped, so no quote can
      // close the attribute.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // Bare links not already inside an href.
      .replace(/(^|[\s(])(https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<)])+?)(?=[.,;:!?]*(?:\s|$|\)|&quot;|&#39;|&lt;|&gt;))/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return line.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  /**
   * A safe subset of Markdown: headings, horizontal rules, bullet and numbered lists, fenced
   * code blocks, bold, italic, inline code and http(s) links. All input is escaped first; nothing else is
   * interpreted as HTML. An unclosed fence (e.g. mid-stream) renders the rest as code.
   */
  function formatReplyHtml(text) {
    const lines = escapeHtml(text).split(/\r?\n/);
    const html = [];
    let list = null; // "ul" | "ol" | null
    let code = null; // { lang, lines } while inside a fence
    const closeList = () => {
      if (list) html.push(`</${list}>`);
      list = null;
    };
    for (const line of lines) {
      const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
      if (code) {
        if (fence) {
          html.push(`<pre class="reply-code"${code.lang ? ` data-lang="${code.lang}"` : ""}><code>${code.lines.join("\n")}</code></pre>`);
          code = null;
        } else {
          code.lines.push(line);
        }
        continue;
      }
      if (fence) {
        closeList();
        code = { lang: fence[1], lines: [] };
        continue;
      }
      // A line of only ---, *** or ___ (spaces allowed between) is a horizontal rule.
      if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        closeList();
        html.push('<hr class="reply-rule">');
        continue;
      }
      const heading = line.match(/^\s*(#{1,3})\s+(.*)$/);
      if (heading) {
        closeList();
        html.push(`<div class="reply-heading reply-h${heading[1].length}">${formatInlineMarkdown(heading[2])}</div>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/);
      if (bullet || numbered) {
        const kind = bullet ? "ul" : "ol";
        if (list !== kind) {
          closeList();
          html.push(kind === "ul" ? '<ul class="reply-list">' : `<ol class="reply-list reply-ol"${numbered && numbered[1] !== "1" ? ` start="${Number(numbered[1])}"` : ""}>`);
          list = kind;
        }
        html.push(`<li>${formatInlineMarkdown(bullet ? bullet[1] : numbered[2])}</li>`);
        continue;
      }
      closeList();
      if (!line.trim()) html.push('<div class="reply-spacer" aria-hidden="true"></div>');
      else html.push(`<div class="reply-line">${formatInlineMarkdown(line)}</div>`);
    }
    closeList();
    if (code) html.push(`<pre class="reply-code"${code.lang ? ` data-lang="${code.lang}"` : ""}><code>${code.lines.join("\n")}</code></pre>`);
    return html.join("");
  }

  /**
   * Keeps concurrently-fetched audio segments playing in request order: segment N may
   * download while N-1 plays, but may only *schedule* audio after N-1 finished scheduling.
   */
  function createOrderedSegments() {
    let tail = Promise.resolve();
    return {
      /** Returns { ready: Promise (resolves when it's this segment's turn), done: () => void }. */
      next() {
        let release;
        const done = new Promise((resolve) => {
          release = resolve;
        });
        const ready = tail;
        tail = tail.then(() => done);
        return { ready, done: () => release() };
      },
    };
  }

  const CAPABILITY_STATUS_LABELS = { WORKING: "Working", PARTIAL: "Partial", PLANNED: "Planned", UNSUPPORTED: "Unsupported" };

  const TOOL_STATUS_LABELS = {
    COMPLETED: "Completed",
    DENIED: "Not done",
    PERMISSION_REQUIRED: "Needs permission",
    USER_ACTION_REQUIRED: "Needs your input",
    CONFIRMATION_REQUIRED: "Waiting for your confirmation",
    UNSUPPORTED: "Not available",
    FAILED: "Couldn't complete",
  };

  function capabilityStatusLabel(status) {
    return CAPABILITY_STATUS_LABELS[status] || "Unknown";
  }

  function toolStatusLabel(status) {
    return TOOL_STATUS_LABELS[status] || "Unknown";
  }

  /**
   * What the web Permission Center says about one capability right now. Only the microphone
   * is a browser permission this client uses; its live state comes from the Permissions API.
   */
  function webAccessSummary(capability, microphoneState) {
    const web = capability.platforms.web;
    const androidAlternative = capability.platforms.android.status === "UNSUPPORTED" || capability.platforms.android.status === "PLANNED"
      ? ""
      : " Available in the ZARVIS Android app.";
    // The registry's own reason, verbatim — never a generic "not available".
    if (web.status === "UNSUPPORTED") return web.note + androidAlternative;
    if (web.status === "PLANNED") return "Not available on the web yet. " + web.note + androidAlternative;
    if (capability.id === "microphone") {
      if (microphoneState === "granted") return "Allowed by this browser.";
      if (microphoneState === "denied") return "Blocked in this browser's site settings.";
      if (microphoneState === "prompt") return "The browser will ask the first time you tap Speak.";
      return "The browser decides when you tap Speak (its permission state isn't readable here).";
    }
    return "No standing permission — you choose a file each time.";
  }

  /**
   * Which message a failed turn shows, from the server's structured error (an SSE `error`
   * event or a JSON error body). An exhausted AI quota is not a connection problem, and
   * retrying it today cannot succeed, so it gets its own copy and no Retry action.
   */
  function turnFailureKind(payload) {
    const code = payload && (payload.code || payload.type);
    if (code === "AI_QUOTA_EXCEEDED") return "aiQuota";
    if (code === "AI_RATE_LIMITED" || code === "rate_limited") return "aiBusy";
    if (code === "turn_in_progress") return "turnBusy";
    if (code === "payload_too_large") return "tooLarge";
    return "bootError";
  }

  /**
   * What the server's `/health` `provider` means for the Settings and Metrics pages. Truthful
   * for every value the server can report: Gemini or OpenRouter answering, or nothing configured
   * (the development mock and the production fail-closed `none` both read "Not configured").
   */
  function aiProviderStatus(provider) {
    if (provider === "google") return { configured: true, label: "Gemini", sentence: "Google Gemini is answering your requests." };
    if (provider === "openrouter") return { configured: true, label: "OpenRouter", sentence: "OpenRouter is answering your requests." };
    return { configured: false, label: "Not configured", sentence: "No AI provider is configured on this server, so answers are limited." };
  }

  /** API base URL. A `?api=` override may only point at this same origin: the client sends
   * its access and refresh tokens to that base, so a crafted link must never be able to aim
   * them at another host (CSP connect-src 'self' blocks that too; this does not rely on it). */
  function resolveApiBase(search, origin) {
    const fallback = origin + "/api/v1";
    const override = new URLSearchParams(search).get("api");
    if (!override) return fallback;
    try {
      const url = new URL(override, origin);
      if (url.origin !== origin) return fallback;
      return (url.origin + url.pathname).replace(/\/$/, "");
    } catch {
      return fallback;
    }
  }

  /** The idempotency key of one logical user turn: created once per submission and reused by
   * its Retry, so the server never executes the same turn twice (backend routes/orchestrator.ts). */
  function createClientTurnId(cryptoImpl) {
    const c = cryptoImpl || (typeof crypto !== "undefined" ? crypto : undefined);
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function riskLabel(risk) {
    return { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk", VERY_HIGH: "Very high risk" }[risk] || risk;
  }

  return {
    SESSION_ENDED_CODES,
    classifyRefreshFailure,
    parseSseEvents,
    escapeHtml,
    formatReplyHtml,
    createOrderedSegments,
    capabilityStatusLabel,
    toolStatusLabel,
    webAccessSummary,
    riskLabel,
    turnFailureKind,
    aiProviderStatus,
    createClientTurnId,
    resolveApiBase,
  };
});
