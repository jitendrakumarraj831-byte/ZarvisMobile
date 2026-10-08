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

  // ---- Chat page: chat list, day labels, slash commands, refine prompts, export, navigation ----
  // The server stores conversations but has no "list my conversations" endpoint, so the chat list is an
  // index of the conversations this browser has opened (id, title, last activity). Opening one loads its
  // real messages from the server; nothing about a conversation is kept here beyond that index.

  const CHAT_INDEX_MAX = 50;
  const NEW_CHAT_TITLE = "New chat";

  /** A one-line chat title from the first thing the user wrote: first non-empty line, markdown markers dropped. */
  function deriveChatTitle(text, max = 48) {
    const first = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
    const plain = first.replace(/^[#>*\-\s]+/, "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
    if (!plain) return NEW_CHAT_TITLE;
    const chars = Array.from(plain);
    return chars.length > max ? chars.slice(0, max - 1).join("").trimEnd() + "…" : plain;
  }

  function sortChats(list) {
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Reads the stored chat list defensively: anything malformed is dropped, never trusted. */
  function parseChatIndex(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const chats = [];
    for (const item of data) {
      if (!item || typeof item.id !== "string" || !/^[\w-]{1,80}$/.test(item.id) || seen.has(item.id)) continue;
      const updatedAt = Number(item.updatedAt);
      if (!Number.isFinite(updatedAt)) continue;
      seen.add(item.id);
      chats.push({ id: item.id, title: deriveChatTitle(item.title), updatedAt });
    }
    return sortChats(chats).slice(0, CHAT_INDEX_MAX);
  }

  /** Adds or refreshes one chat. A title is only replaced when the caller passes one. */
  function upsertChat(list, entry) {
    const previous = list.find((chat) => chat.id === entry.id);
    const title = entry.title ? deriveChatTitle(entry.title) : previous ? previous.title : NEW_CHAT_TITLE;
    const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : previous ? previous.updatedAt : Date.now();
    return sortChats([{ id: entry.id, title, updatedAt }, ...list.filter((chat) => chat.id !== entry.id)]).slice(0, CHAT_INDEX_MAX);
  }

  function removeChat(list, id) {
    return list.filter((chat) => chat.id !== id);
  }

  function filterChats(list, query) {
    const q = String(query || "").trim().toLowerCase();
    return q ? list.filter((chat) => chat.title.toLowerCase().includes(q)) : list;
  }

  const startOfDay = (ms) => {
    const day = new Date(ms);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };

  /** today | yesterday | week (the 5 days before that) | older. Calendar days, not 24-hour blocks. */
  function dayBucket(ms, now = Date.now()) {
    const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return days < 7 ? "week" : "older";
  }

  const DAY_BUCKET_LABELS = { today: "Today", yesterday: "Yesterday", week: "Previous 7 days", older: "Older" };

  /** The chat list grouped under Today / Yesterday / Previous 7 days / Older, newest first. */
  function groupChatsByDay(list, now = Date.now()) {
    const groups = [];
    for (const chat of sortChats(list)) {
      const key = dayBucket(chat.updatedAt, now);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        group = { key, label: DAY_BUCKET_LABELS[key], items: [] };
        groups.push(group);
      }
      group.items.push(chat);
    }
    return groups;
  }

  function dayKey(ms) {
    const day = new Date(ms);
    return day.getFullYear() + "-" + (day.getMonth() + 1) + "-" + day.getDate();
  }

  /** The label on a day divider inside a thread: Today, Yesterday, or the date. */
  function dayLabel(ms, now = Date.now(), locale) {
    const bucket = dayBucket(ms, now);
    if (bucket === "today") return "Today";
    if (bucket === "yesterday") return "Yesterday";
    return new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  }

  /** Commands in the composer's "/" menu. `prompt` ones fill the box so the wording stays editable;
   * `action` ones run something the app really does. */
  const SLASH_COMMANDS = [
    { name: "research", label: "Research a topic", hint: "Search the web and cite sources", kind: "prompt", icon: "i-globe", prompt: "Search the web and cite the sources you use: " },
    { name: "write", label: "Write a message", hint: "A warm, concise message", kind: "prompt", icon: "i-pen", prompt: "Write a warm, concise message about: " },
    { name: "summarize", label: "Summarize a file", hint: "Attach a document or an image", kind: "action", icon: "i-file", action: "attach" },
    { name: "plan", label: "Plan a task", hint: "Break a goal into clear steps", kind: "prompt", icon: "i-task", prompt: "Create a workflow for this goal and break it into clear steps: " },
    { name: "explain", label: "Explain simply", hint: "Step by step, in simple words", kind: "prompt", icon: "i-sparkle", prompt: "Explain this in simple words, step by step: " },
    { name: "code", label: "Generate code", hint: "Apps, websites, scripts", kind: "prompt", icon: "i-code", prompt: "Generate code for: " },
    { name: "translate", label: "Translate", hint: "Into Hindi, keeping the tone", kind: "prompt", icon: "i-lang", prompt: "Translate this into Hindi and keep the tone: " },
    { name: "reply", label: "Customer reply", hint: "A polite business reply", kind: "prompt", icon: "i-briefcase", prompt: "Draft a polite customer reply to: " },
    { name: "voice", label: "Speak", hint: "Use your voice instead of typing", kind: "action", icon: "i-mic", action: "voice" },
    { name: "new", label: "New chat", hint: "Start a fresh conversation", kind: "action", icon: "i-plus", action: "new" },
    { name: "history", label: "Chat history", hint: "Open an earlier chat", kind: "action", icon: "i-memory", action: "history" },
    { name: "export", label: "Export this chat", hint: "Save it as a Markdown file", kind: "action", icon: "i-download", action: "export" },
    { name: "shortcuts", label: "Keyboard shortcuts", hint: "Every shortcut in one list", kind: "action", icon: "i-bolt", action: "shortcuts" },
  ];

  /** The menu shows only while the whole box is "/" plus the start of a command name. */
  function matchSlashCommands(text, commands = SLASH_COMMANDS) {
    const match = /^\/([a-z-]*)$/i.exec(String(text ?? ""));
    if (!match) return [];
    const q = match[1].toLowerCase();
    if (!q) return commands;
    const starts = commands.filter((command) => command.name.startsWith(q));
    const rest = commands.filter((command) => !command.name.startsWith(q) && (command.name.includes(q) || command.label.toLowerCase().includes(q)));
    return [...starts, ...rest];
  }

  /** One-tap follow-ups under the latest reply. Each is an ordinary message about "your last answer";
   * the conversation history sent with every turn is what gives it meaning. */
  function refineActions(lang) {
    const last = lang === "hi"
      ? { id: "english", label: "In English", prompt: "Say your last answer again in English." }
      : { id: "hindi", label: "In Hindi", prompt: "Say your last answer again in Hindi." };
    return [
      { id: "shorter", label: "Shorter", prompt: "Make your last answer shorter, keeping only the key points." },
      { id: "simpler", label: "Simpler", prompt: "Explain your last answer in simpler words." },
      { id: "detail", label: "More detail", prompt: "Go into more detail on your last answer." },
      { id: "checklist", label: "As a checklist", prompt: "Turn your last answer into a clear checklist." },
      last,
    ];
  }

  /** messages: [{ role: "user" | "assistant", text, time? }]. `time` is whatever the caller already formatted. */
  function chatToMarkdown(messages, { title, exportedAt } = {}) {
    const lines = ["# " + (title || "ZARVIS chat"), ""];
    if (exportedAt) lines.push("_Exported " + exportedAt + "_", "");
    for (const message of messages) {
      const who = message.role === "user" ? "You" : "ZARVIS";
      lines.push("**" + who + "**" + (message.time ? " · " + message.time : ""), "", String(message.text ?? "").trim(), "");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  function chatToText(messages, { title } = {}) {
    const lines = [title || "ZARVIS chat", ""];
    for (const message of messages) {
      const who = message.role === "user" ? "You" : "ZARVIS";
      lines.push(who + (message.time ? " (" + message.time + ")" : "") + ":", String(message.text ?? "").trim(), "");
    }
    return lines.join("\n").trimEnd() + "\n";
  }

  /** A file name that is safe on every OS, from the chat title. */
  function exportFileName(title, ext = "md") {
    const base = String(title || "zarvis-chat").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return (base || "zarvis-chat") + "." + ext;
  }

  /** "g" then a letter jumps to a page (like GitHub). Only pages that exist. */
  const GO_SHORTCUTS = { h: "home", c: "chat", a: "activity", k: "capabilities", p: "plans", s: "settings" };

  function goShortcutTarget(key) {
    const target = GO_SHORTCUTS[String(key || "").toLowerCase()];
    return target || null;
  }

  /** Where an in-text link points: "plans", "activity", "settings:voice", "history". null for anything unknown,
   * so a typo in copy can never become a link that does nothing. */
  const GO_VIEWS = ["home", "chat", "activity", "capabilities", "plans", "settings", "developer", "metrics"];

  function parseGoTarget(target) {
    const [name, sub, extra] = String(target || "").split(":");
    if (extra !== undefined || !name) return null;
    if (name === "history") return sub === undefined ? { action: "history" } : null;
    if (name === "settings") return /^[a-z]+$/.test(sub || "x") ? { view: "settings", settingsPage: sub || null } : null;
    return GO_VIEWS.includes(name) && sub === undefined ? { view: name } : null;
  }

  /** Old addresses that moved: #/settings/subscription is the Plans page, #/settings/data is Privacy & data. */
  function resolveLegacyRoute(view, sub) {
    if (view === "settings" && sub === "subscription") return { view: "plans", sub: undefined };
    if (view === "settings" && sub === "data") return { view: "settings", sub: "privacy" };
    return { view, sub };
  }

  const PAGE_LABELS = {
    home: "Home", chat: "Chat", activity: "Activity", capabilities: "Capabilities", plans: "Plans",
    settings: "Settings", developer: "Developer Agent", metrics: "Usage & Metrics", feature: "Capabilities",
  };

  /** The trail above a page: Home › Settings › Voice. Every item but the last is a link (it has `view`). */
  function breadcrumbs({ view, settingsTitle, featureTitle } = {}) {
    if (!view || view === "home") return [];
    const trail = [{ label: PAGE_LABELS.home, view: "home" }];
    if (view === "settings" && settingsTitle) {
      trail.push({ label: PAGE_LABELS.settings, view: "settings", closeSubpage: true }, { label: settingsTitle });
    } else if (view === "feature") {
      trail.push({ label: PAGE_LABELS.capabilities, view: "capabilities" });
      if (featureTitle) trail.push({ label: featureTitle });
    } else {
      trail.push({ label: PAGE_LABELS[view] || view });
    }
    return trail;
  }

  return {
    CHAT_INDEX_MAX,
    NEW_CHAT_TITLE,
    SLASH_COMMANDS,
    GO_SHORTCUTS,
    deriveChatTitle,
    parseChatIndex,
    upsertChat,
    removeChat,
    filterChats,
    dayBucket,
    groupChatsByDay,
    dayKey,
    dayLabel,
    matchSlashCommands,
    refineActions,
    chatToMarkdown,
    chatToText,
    exportFileName,
    goShortcutTarget,
    parseGoTarget,
    resolveLegacyRoute,
    breadcrumbs,
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
    createClientTurnId,
    resolveApiBase,
  };
});
