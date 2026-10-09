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
      .replace(/~~([^\s~](?:[^~]*[^\s~])?)~~/g, "<del>$1</del>")
      // *italic*: the asterisks must hug the text, so "2 * 3 * 4" and bullets stay literal.
      .replace(/(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])/g, "$1<em>$2</em>")
      // [label](https://…) — only http(s); the text is already escaped, so no quote can
      // close the attribute.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // Bare links not already inside an href.
      .replace(/(^|[\s(])(https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<)])+?)(?=[.,;:!?]*(?:\s|$|\)|&quot;|&#39;|&lt;|&gt;))/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return line.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  // ---- Syntax highlighting for fenced code --------------------------------------------------------
  // Small and dependency-free. It tokenizes the RAW code and escapes every token it emits, so the only
  // markup it can produce is <span class="tok-…"> with a class from the fixed list below. A language it
  // does not know, or code longer than HIGHLIGHT_MAX_CHARS (a streaming reply is re-rendered on every
  // chunk), is shown as plain escaped text.

  const HIGHLIGHT_MAX_CHARS = 30000;
  const words = (list) => new Set(list.split(" "));
  const LANGS = {
    js: {
      keywords: words("as async await break case catch class const continue default delete do else enum export extends finally for from function if implements import in instanceof interface let new of private protected public readonly return static super switch this throw try type typeof var void while with yield"),
      literals: words("true false null undefined NaN Infinity"),
      rules: [
        ["com", /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
        ["str", /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\[\s\S])*`?/y],
        ["num", /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)n?/y],
      ],
    },
    python: {
      keywords: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"),
      literals: words("True False None"),
      rules: [
        ["com", /#[^\n]*/y],
        ["str", /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y],
        ["num", /\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
      ],
    },
    shell: {
      keywords: words("if then else elif fi for while do done case esac in function select until return exit export local set unset cd echo source"),
      literals: words(""),
      rules: [
        ["com", /#[^\n]*/y],
        ["str", /"(?:[^"\\]|\\[\s\S])*"?|'[^']*'?/y],
        ["lit", /\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9@#?*!$-]/y],
        ["num", /\d+(?:\.\d+)?/y],
      ],
    },
    sql: {
      keywords: words("select from where insert into values update set delete create table alter drop join left right inner outer on group by order limit having as and or not primary key foreign references index distinct union all case when then else end"),
      literals: words("true false null"),
      ignoreCase: true,
      rules: [
        ["com", /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
        ["str", /'(?:[^'\\]|\\.|'')*'?/y],
        ["num", /\d+(?:\.\d+)?/y],
      ],
    },
    json: {
      keywords: words(""),
      literals: words("true false null"),
      rules: [
        ["attr", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y],
        ["str", /"(?:[^"\\\n]|\\.)*"?/y],
        ["num", /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
      ],
    },
    css: {
      keywords: words(""),
      literals: words(""),
      rules: [
        ["com", /\/\*[\s\S]*?(?:\*\/|$)/y],
        ["str", /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y],
        ["kw", /@[\w-]+/y],
        ["num", /#[\da-fA-F]{3,8}\b|-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|ch|s|ms|deg|fr)?/y],
        ["attr", /[\w-]+(?=\s*:(?!:))/y],
      ],
    },
  };
  const LANG_ALIASES = {
    js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js", node: "js", ts: "js", typescript: "js", tsx: "js",
    py: "python", python: "python",
    sh: "shell", bash: "shell", shell: "shell", zsh: "shell", console: "shell",
    sql: "sql", json: "json", jsonc: "json", css: "css", scss: "css",
    html: "html", xml: "html", svg: "html", htm: "html",
  };

  function highlightLanguage(lang) {
    return LANG_ALIASES[String(lang || "").toLowerCase()] || null;
  }

  /** Joins [class|null, text] tokens into escaped HTML, merging neighbouring plain text. */
  function tokensToHtml(tokens) {
    let out = "";
    let plain = "";
    for (const [cls, text] of tokens) {
      if (!cls) {
        plain += text;
        continue;
      }
      if (plain) out += escapeHtml(plain);
      plain = "";
      out += `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
    }
    return out + (plain ? escapeHtml(plain) : "");
  }

  function tokenizeWith(def, code) {
    const tokens = [];
    const isWord = /[A-Za-z_$]/;
    let i = 0;
    while (i < code.length) {
      let matched = false;
      for (const [cls, re] of def.rules) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (m && m[0]) {
          tokens.push([cls, m[0]]);
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      if (isWord.test(code[i])) {
        const m = /[A-Za-z_$][\w$]*/y;
        m.lastIndex = i;
        const word = m.exec(code)[0];
        const key = def.ignoreCase ? word.toLowerCase() : word;
        tokens.push([def.keywords.has(key) ? "kw" : def.literals.has(key) ? "lit" : null, word]);
        i += word.length;
      } else {
        tokens.push([null, code[i]]);
        i += 1;
      }
    }
    return tokens;
  }

  function tokenizeHtml(code) {
    const tokens = [];
    const comment = /<!--[\s\S]*?(?:-->|$)/y;
    const open = /<\/?[A-Za-z][\w:-]*/y;
    const attrName = /[\w:@.-]+/y;
    const value = /"[^"]*"?|'[^']*'?/y;
    const close = /\/?>/y;
    const at = (re, i) => { re.lastIndex = i; return re.exec(code); };
    let i = 0;
    let inTag = false;
    while (i < code.length) {
      let m;
      if (!inTag && (m = at(comment, i))) tokens.push(["com", m[0]]);
      else if (!inTag && (m = at(open, i))) { tokens.push(["tag", m[0]]); inTag = true; }
      else if (inTag && (m = at(close, i))) { tokens.push(["tag", m[0]]); inTag = false; }
      else if (inTag && (m = at(value, i))) tokens.push(["str", m[0]]);
      else if (inTag && (m = at(attrName, i))) tokens.push(["attr", m[0]]);
      else { tokens.push([null, code[i]]); i += 1; continue; }
      i += m[0].length;
    }
    return tokens;
  }

  /** Escaped HTML for a block of raw code, with <span class="tok-…"> around comments, strings, numbers, keywords and so on. */
  function highlightCode(code, lang) {
    const raw = String(code ?? "");
    const name = highlightLanguage(lang);
    if (!name || raw.length > HIGHLIGHT_MAX_CHARS) return escapeHtml(raw);
    return tokensToHtml(name === "html" ? tokenizeHtml(raw) : tokenizeWith(LANGS[name], raw));
  }

  // ---- Markdown tables ---------------------------------------------------------------------------------

  const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

  /** Splits one (already escaped) table line into trimmed cells; `\|` is a literal pipe. */
  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = [];
    let cell = "";
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === "\\" && s[i + 1] === "|") {
        cell += "|";
        i += 1;
      } else if (s[i] === "|") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += s[i];
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  /** A table starts at `index` when that line and the next have the same number of cells and the next is a delimiter row (---|:--:). */
  function tableStartsAt(lines, index) {
    const head = lines[index];
    const sep = lines[index + 1];
    if (head === undefined || sep === undefined || !head.includes("|") || !sep.includes("|") || !TABLE_DELIMITER.test(sep)) return false;
    return splitTableRow(head).length === splitTableRow(sep).length;
  }

  function tableHtml(headLine, sepLine, bodyLines) {
    const align = splitTableRow(sepLine).map((c) => (c.startsWith(":") && c.endsWith(":") ? " class=\"al-c\"" : c.endsWith(":") ? " class=\"al-r\"" : ""));
    const cell = (tag, text, i) => `<${tag}${tag === "th" ? ' scope="col"' : ""}${align[i] || ""}>${formatInlineMarkdown(text)}</${tag}>`;
    const head = splitTableRow(headLine).map((t, i) => cell("th", t, i)).join("");
    const rows = bodyLines
      .map((line) => {
        const cells = splitTableRow(line);
        return "<tr>" + align.map((_, i) => cell("td", cells[i] ?? "", i)).join("") + "</tr>";
      })
      .join("");
    // A scrollable region must be reachable by keyboard, and needs a name.
    return `<div class="reply-table-wrap" role="region" tabindex="0" aria-label="Table"><table class="reply-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  /**
   * A safe subset of Markdown: headings, horizontal rules, bullet and numbered lists, tables, block quotes,
   * fenced code blocks (with syntax colours for common languages), bold, italic, strikethrough, inline code
   * and http(s) links. All input is escaped first; nothing else is interpreted as HTML. An unclosed fence
   * (e.g. mid-stream) renders the rest as code, and a table appears once its delimiter row has arrived.
   */
  function formatReplyHtml(text) {
    const rawLines = String(text ?? "").split(/\r?\n/);
    const lines = rawLines.map(escapeHtml);
    const html = [];
    let list = null; // "ul" | "ol" | null
    let code = null; // { lang, lines, raw } while inside a fence
    let quote = false;
    const closeList = () => {
      if (list) html.push(`</${list}>`);
      list = null;
    };
    const closeQuote = () => {
      if (quote) html.push("</blockquote>");
      quote = false;
    };
    const codeBlock = (block) => `<pre class="reply-code"${block.lang ? ` data-lang="${block.lang}"` : ""}><code>${highlightCode(block.raw.join("\n"), block.lang)}</code></pre>`;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
      if (code) {
        if (fence) {
          html.push(codeBlock(code));
          code = null;
        } else {
          code.lines.push(line);
          code.raw.push(rawLines[index]);
        }
        continue;
      }
      if (fence) {
        closeList();
        closeQuote();
        code = { lang: fence[1], lines: [], raw: [] };
        continue;
      }
      const quoted = line.match(/^\s*&gt;\s?(.*)$/);
      if (quoted) {
        closeList();
        if (!quote) html.push('<blockquote class="reply-quote">');
        quote = true;
        html.push(quoted[1].trim() ? `<div class="reply-line">${formatInlineMarkdown(quoted[1])}</div>` : '<div class="reply-spacer" aria-hidden="true"></div>');
        continue;
      }
      closeQuote();
      if (tableStartsAt(lines, index)) {
        closeList();
        let end = index + 2;
        while (end < lines.length && lines[end].trim() && lines[end].includes("|")) end += 1;
        html.push(tableHtml(line, lines[index + 1], lines.slice(index + 2, end)));
        index = end - 1;
        continue;
      }
      // A line of only ---, *** or ___ (spaces allowed between) is a horizontal rule.
      if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        closeList();
        html.push('<hr class="reply-rule">');
        continue;
      }
      // #### and deeper are real headings in Gemini's output too; they share the smallest heading size.
      const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        html.push(`<div class="reply-heading reply-h${Math.min(heading[1].length, 3)}">${formatInlineMarkdown(heading[2])}</div>`);
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
    closeQuote();
    if (code) html.push(codeBlock(code));
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

  /**
   * What a refused or unreachable /billing/verify means for the person who just paid, from the server's own
   * status. The Checkout callback only says the gateway took the payment; this decides what the page may claim:
   *  - rejected: the server checked and it did not verify (400/404). The plan did not change.
   *  - pending: the bank has not captured it yet (402). The plan turns on when it does.
   *  - unreachable: the server could not be asked or the gateway did not answer (network, 5xx). Unknown; the
   *    server also hears from Razorpay directly, so the plan may still switch on.
   * `polls` is how many times the page re-reads the plan before it gives up and says it is not active yet.
   */
  function paymentVerifyOutcome(status, code) {
    if (status === 402 || code === "payment_not_captured") {
      return { kind: "pending", tone: "warn", polls: 6, message: "Your bank hasn't confirmed this payment yet. Your plan switches on as soon as it does. This page keeps checking." };
    }
    if (status === 400 || status === 404 || code === "invalid_signature" || code === "payment_mismatch" || code === "order_not_found") {
      return { kind: "rejected", tone: "err", polls: 1, message: "We couldn't verify this payment, so your plan was not changed." };
    }
    return { kind: "unreachable", tone: "warn", polls: 6, message: "We couldn't reach the payment service to confirm your payment. If you were charged, your plan switches on automatically once it is confirmed. This page keeps checking." };
  }

  // ---- Tasks: groups, filters, sorting and the board ------------------------------------------------------
  // The server's lifecycle (backend TaskLifecycle) is the only truth about a task. These helpers only decide where a
  // task is listed; the card always shows its exact lifecycle, so grouping never flattens or renames a state.

  /** The board's columns, left to right: [key, label]. */
  const TASK_GROUPS = [["queued", "Not started"], ["running", "In progress"], ["waiting", "Waiting for you"], ["stopped", "Stopped"], ["finished", "Finished"]];
  const LIFECYCLE_GROUP = {
    QUEUED: "queued",
    RUNNING: "running", EXECUTING: "running", VERIFYING: "running",
    WAITING: "waiting", CONFIRMATION_REQUIRED: "waiting",
    FAILED: "stopped", BLOCKED: "stopped",
    COMPLETED: "finished", CANCELLED: "finished",
  };
  /** The filter buttons of the list: [key, label]. "open" is every group that still needs something to happen. */
  const TASK_FILTERS = [["all", "All"], ["open", "Open tasks"], ["stopped", "Stopped"], ["finished", "Finished"]];
  const TASK_SORTS = [["updated", "Recently updated"], ["newest", "Newest first"], ["oldest", "Oldest first"]];
  const OPEN_TASK_GROUPS = ["queued", "running", "waiting"];

  /** Which group a task belongs to. A run that stopped answering is shown as stopped; a lifecycle this client does not know is "unknown", never guessed. */
  function taskGroup(task) {
    const group = LIFECYCLE_GROUP[task && task.lifecycle];
    if (!group) return "unknown";
    return group === "running" && task.stale ? "stopped" : group;
  }

  function taskSearchText(task, projectName, lifecycleLabel) {
    const steps = (task.steps || []).flatMap((step) => [step.description, step.resultSummary]);
    return [task.goal, lifecycleLabel, projectName, task.result && task.result.summary, task.error && task.error.message, task.blockedReason, ...steps].filter(Boolean).join("\n").toLowerCase();
  }

  /** The tasks that match a search and a filter, in the chosen order. `projectName(id)` and `label(lifecycle)` let the page's own words be searched too. */
  function filterTasks(tasks, { query = "", filter = "all", sort = "updated", projectName = () => "", label = (lifecycle) => lifecycle } = {}) {
    const q = String(query).trim().toLowerCase();
    const time = (value) => Date.parse(value) || 0;
    const list = (Array.isArray(tasks) ? tasks : []).filter((task) => {
      const group = taskGroup(task);
      if (filter === "open" && !OPEN_TASK_GROUPS.includes(group)) return false;
      if ((filter === "stopped" || filter === "finished") && group !== filter) return false;
      return !q || taskSearchText(task, task.projectId ? projectName(task.projectId) : "", label(task.lifecycle)).includes(q);
    });
    const order = {
      updated: (a, b) => time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt),
      newest: (a, b) => time(b.createdAt) - time(a.createdAt),
      oldest: (a, b) => time(a.createdAt) - time(b.createdAt),
    };
    return list.sort(order[sort] || order.updated);
  }

  /** How many tasks each filter button would show (ignoring the search). */
  function taskCounts(tasks) {
    const counts = { all: 0, open: 0, stopped: 0, finished: 0 };
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const group = taskGroup(task);
      counts.all += 1;
      if (OPEN_TASK_GROUPS.includes(group)) counts.open += 1;
      else if (group === "stopped" || group === "finished") counts[group] += 1;
    }
    return counts;
  }

  /** The board: one column per group in order (empty ones included, so a column never disappears), plus "Other" only when a task has a lifecycle this client does not know. */
  function taskBoard(tasks) {
    const columns = TASK_GROUPS.map(([key, label]) => ({ key, label, tasks: [] }));
    const other = { key: "unknown", label: "Other", tasks: [] };
    for (const task of Array.isArray(tasks) ? tasks : []) (columns.find((c) => c.key === taskGroup(task)) || other).tasks.push(task);
    return other.tasks.length ? [...columns, other] : columns;
  }

  // ---- Home dashboard -----------------------------------------------------------------------------------

  /**
   * What Home's "Your workspace" shows, chosen from what the server and this browser really hold. Every list is a
   * slice of a real list (nothing is padded), and `empty` is only true when every source is known and has nothing;
   * a source that failed to load is passed as null, which can never make the account look new.
   *   chats: this browser's chat index (newest first); projects/files/tasks/tools: the server's lists, or null if unread.
   */
  function homeDashboard({ chats = [], projects = null, files = null, tasks = null, tools = null, limit = 3 } = {}) {
    const time = (value) => Date.parse(value) || 0;
    const known = (list) => Array.isArray(list);
    const activeProjects = known(projects) ? projects.filter((p) => p.status !== "ARCHIVED").sort((a, b) => time(b.updatedAt) - time(a.updatedAt)) : null;
    const recentFiles = known(files) ? [...files].sort((a, b) => time(b.createdAt) - time(a.createdAt)) : null;
    const toolRuns = known(tools) ? tools.filter((entry) => entry.type === "tool").sort((a, b) => time(b.at) - time(a.at)) : null;
    const open = known(tasks) ? filterTasks(tasks, { filter: "open" }) : null;
    const sources = [activeProjects, recentFiles, tasks, toolRuns];
    return {
      chats: (Array.isArray(chats) ? chats : []).slice(0, limit),
      projects: activeProjects ? activeProjects.slice(0, limit) : null,
      files: recentFiles ? recentFiles.slice(0, limit) : null,
      tasks: known(tasks) ? { counts: taskCounts(tasks), open: open.slice(0, limit), total: tasks.length } : null,
      tools: toolRuns ? toolRuns.slice(0, limit) : null,
      allKnown: sources.every(known),
      empty: sources.every(known) && !(Array.isArray(chats) && chats.length) && !activeProjects.length && !recentFiles.length && !tasks.length && !toolRuns.length,
    };
  }

  /**
   * Whether an entry point may be offered: some skill of one of its categories exists in this build's /skills answer.
   * An entry with no categories (a page link, or "ask") is always offered. A skill that needs a plan upgrade still counts:
   * it is listed, and the server says so when it is used. `null` skills (not read yet) offers everything, never hides on a guess.
   */
  function entryAvailable(categories, skills) {
    if (!Array.isArray(categories) || !categories.length || !Array.isArray(skills)) return true;
    return skills.some((skill) => categories.includes(skill.category));
  }

  /** The sorts the Projects list offers, in the order they are shown: [key, label]. */
  const PROJECT_SORTS = [["recent", "Most recent"], ["name", "Name"], ["tasks", "Open tasks"]];

  /**
   * The projects that match a search (name, goal and description, case-insensitive) in the chosen order. Pure: the list
   * itself is whatever the server returned, so nothing here can show a project that does not exist.
   */
  function filterProjects(projects, { query = "", sort = "recent" } = {}) {
    const q = String(query).trim().toLowerCase();
    const list = (Array.isArray(projects) ? projects : []).filter((p) => !q || [p.name, p.goal, p.description].join("\n").toLowerCase().includes(q));
    const time = (p) => Date.parse(p.updatedAt) || 0;
    const byRecent = (a, b) => time(b) - time(a);
    const order = {
      name: (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base", numeric: true }) || byRecent(a, b),
      tasks: (a, b) => ((b.counts && b.counts.openTasks) || 0) - ((a.counts && a.counts.openTasks) || 0) || byRecent(a, b),
    };
    return list.sort(order[sort] || byRecent);
  }

  function riskLabel(risk) {
    return { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk", VERY_HIGH: "Very high risk" }[risk] || risk;
  }

  // ---- Chat page: chat list, day labels, slash commands, refine prompts, export, navigation ----
  // The chat list is an index of the account's conversations as this browser knows them (id, title, last
  // activity), topped up from GET /conversations. Opening one loads its real messages from the server;
  // nothing about a conversation is kept here beyond that index.

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

  /** Ids of chats the user removed from the list on this browser, capped so the store cannot grow without bound. */
  function parseHiddenChats(raw) {
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter((id) => typeof id === "string" && /^[\w-]{1,80}$/.test(id)).slice(-200) : [];
    } catch {
      return [];
    }
  }

  function hideChat(hidden, id) {
    return [...hidden.filter((other) => other !== id), id].slice(-200);
  }

  /**
   * Folds the server's list of this account's conversations into the list this browser already has.
   * - a chat only the server knows about is added (this is how a second device or a cleared browser gets its history back),
   * - a chat both know keeps the title already shown, unless that is still the placeholder, and takes the newer time,
   * - a chat only this browser knows (just started, not saved yet) is kept,
   * - a chat the user removed from the list stays out.
   * Entries with bad ids or times are skipped; the result is capped like any other chat list.
   */
  function mergeServerChats(local, server, hidden = []) {
    const skip = new Set(hidden);
    const byId = new Map(local.map((chat) => [chat.id, chat]));
    for (const item of Array.isArray(server) ? server : []) {
      if (!item || typeof item.id !== "string" || !/^[\w-]{1,80}$/.test(item.id) || skip.has(item.id)) continue;
      const updatedAt = Date.parse(item.updatedAt);
      if (!Number.isFinite(updatedAt)) continue;
      const known = byId.get(item.id);
      if (!known) {
        byId.set(item.id, { id: item.id, title: deriveChatTitle(item.title), updatedAt });
      } else {
        const title = known.title === NEW_CHAT_TITLE && item.title ? deriveChatTitle(item.title) : known.title;
        byId.set(item.id, { id: item.id, title, updatedAt: Math.max(known.updatedAt, updatedAt) });
      }
    }
    return sortChats([...byId.values()].filter((chat) => !skip.has(chat.id))).slice(0, CHAT_INDEX_MAX);
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
  const GO_SHORTCUTS = { h: "home", c: "chat", w: "work", e: "agents", t: "tasks", a: "activity", k: "capabilities", p: "plans", s: "settings" };

  function goShortcutTarget(key) {
    const target = GO_SHORTCUTS[String(key || "").toLowerCase()];
    return target || null;
  }

  /** Where an in-text link points: "plans", "activity", "settings:voice", "history". null for anything unknown,
   * so a typo in copy can never become a link that does nothing. */
  const GO_VIEWS = ["home", "chat", "work", "agents", "activity", "capabilities", "plans", "settings", "developer", "metrics"];
  const WORK_TABS = ["projects", "files", "research", "tasks", "outputs"];

  function parseGoTarget(target) {
    const [name, sub, extra] = String(target || "").split(":");
    if (extra !== undefined || !name) return null;
    if (name === "history") return sub === undefined ? { action: "history" } : null;
    if (name === "settings") return /^[a-z]+$/.test(sub || "x") ? { view: "settings", settingsPage: sub || null } : null;
    // Tasks live inside Work now; the old name still works.
    if (name === "tasks") return sub === undefined ? { view: "work", workTab: "tasks" } : null;
    if (name === "work") return sub === undefined ? { view: "work" } : WORK_TABS.includes(sub) ? { view: "work", workTab: sub } : null;
    if (name === "agents") return sub === undefined ? { view: "agents" } : /^[a-z]+$/.test(sub) ? { view: "agents", agentId: sub } : null;
    return GO_VIEWS.includes(name) && sub === undefined ? { view: name } : null;
  }

  /** Old addresses that moved: #/settings/subscription is the Plans page, #/settings/data is Privacy & data, #/tasks is Work › Tasks. */
  function resolveLegacyRoute(view, sub) {
    if (view === "settings" && sub === "subscription") return { view: "plans", sub: undefined };
    if (view === "settings" && sub === "data") return { view: "settings", sub: "privacy" };
    if (view === "tasks") return { view: "work", sub: "tasks" };
    return { view, sub };
  }

  const PAGE_LABELS = {
    home: "Home", chat: "Chat", work: "Work", agents: "Agents", tasks: "Tasks", activity: "Activity", capabilities: "Capabilities", plans: "Plans & Usage",
    settings: "Settings", developer: "Developer Agent", metrics: "Usage & Metrics", feature: "Capabilities",
  };

  /** The trail above a page: Home › Settings › Voice. Every item but the last is a link (it has `view`). */
  function breadcrumbs({ view, settingsTitle, featureTitle, workTitle, workTitleIsName, agentTitle } = {}) {
    if (!view || view === "home") return [];
    const trail = [{ label: PAGE_LABELS.home, view: "home" }];
    if (view === "settings" && settingsTitle) {
      trail.push({ label: PAGE_LABELS.settings, view: "settings", closeSubpage: true }, { label: settingsTitle });
    } else if (view === "feature") {
      trail.push({ label: PAGE_LABELS.capabilities, view: "capabilities" });
      if (featureTitle) trail.push({ label: featureTitle });
    } else if (view === "work" && workTitle) {
      trail.push({ label: PAGE_LABELS.work, view: "work" }, { label: workTitle, ...(workTitleIsName ? { name: true } : {}) });
    } else if (view === "agents" && agentTitle) {
      trail.push({ label: PAGE_LABELS.agents, view: "agents" }, { label: agentTitle });
    } else {
      trail.push({ label: PAGE_LABELS[view] || view });
    }
    return trail;
  }

  /** A task that has not ended. FAILED counts as ended (it needs a retry, not attention in a count). */
  const OPEN_LIFECYCLES = ["QUEUED", "RUNNING", "EXECUTING", "VERIFYING", "WAITING", "CONFIRMATION_REQUIRED", "BLOCKED"];
  function openTaskCount(tasks) {
    return (Array.isArray(tasks) ? tasks : []).filter((task) => OPEN_LIFECYCLES.includes(task && task.lifecycle)).length;
  }

  /**
   * The honest status words of the product, for a capability that is not a device permission.
   * WORKING: connected and verified end to end. PARTIAL: part of it is real. PLANNED: designed, not active.
   * UNSUPPORTED: no route on this platform. A feature never shows as active unless it is WORKING or PARTIAL.
   */
  const FEATURE_STATUSES = ["WORKING", "PARTIAL", "PLANNED", "UNSUPPORTED"];
  function isFeatureStatus(status) {
    return FEATURE_STATUSES.includes(status);
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
    parseHiddenChats,
    hideChat,
    mergeServerChats,
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
    openTaskCount,
    FEATURE_STATUSES,
    isFeatureStatus,
    WORK_TABS,
    SESSION_ENDED_CODES,
    classifyRefreshFailure,
    parseSseEvents,
    escapeHtml,
    formatReplyHtml,
    highlightCode,
    highlightLanguage,
    createOrderedSegments,
    capabilityStatusLabel,
    toolStatusLabel,
    webAccessSummary,
    riskLabel,
    paymentVerifyOutcome,
    homeDashboard,
    entryAvailable,
    TASK_GROUPS,
    TASK_FILTERS,
    TASK_SORTS,
    taskGroup,
    filterTasks,
    taskCounts,
    taskBoard,
    PROJECT_SORTS,
    filterProjects,
    turnFailureKind,
    createClientTurnId,
    resolveApiBase,
  };
});
