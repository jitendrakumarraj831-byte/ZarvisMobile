/* ZARVIS MOBILE — Work, Files, Research, Tasks, Outputs, Agents, Memory, Activity and usage.

   Every list and number on these pages is read back from the ZARVIS server (projects, files, notes, executions,
   tasks, memory, activity). Nothing is invented on the client, and a change is only reported as done once the
   server has answered 2xx for it. app.js hands in the few things this file needs through ZarvisWorkspace.init(host). */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  let host = null;
  const Logic = window.ZarvisLogic;
  const $ = (id) => document.getElementById(id);

  /* ---------- Small DOM helpers (text is always set as text, never as HTML) ---------- */

  function icon(id) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function append(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach((item) => append(node, item));
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }

  /** Like node.append(), but a null or false child is skipped instead of being written as the word "null". */
  function put(node, ...kids) {
    kids.forEach((kid) => append(node, kid));
    return node;
  }

  function h(tag, cls, ...kids) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    kids.forEach((kid) => append(node, kid));
    return node;
  }

  /** A real <button>. `opts.icon` adds a sprite icon; `opts.aria` is the accessible name when the label is short. */
  function button(label, cls, onClick, opts = {}) {
    const b = h("button", cls, opts.icon ? icon(opts.icon) : null, label ? h("span", null, label) : null);
    b.type = "button";
    if (opts.aria) b.setAttribute("aria-label", opts.aria);
    if (opts.title) b.title = opts.title;
    if (onClick) b.addEventListener("click", (event) => { host?.haptic?.(); onClick(event); });
    return b;
  }

  function badge(text, tone) {
    return h("span", "z-badge" + (tone ? " z-badge-" + tone : ""), text);
  }

  /** A link whose text came from a website or a search provider. */
  function userLink(text) {
    const a = h("a", "exec-link", text);
    a.dataset.userText = "";
    return a;
  }

  /** A badge that carries a name the user chose (a project): the translator leaves it alone. */
  function userBadge(text, tone) {
    const node = badge(text, tone);
    node.dataset.userText = "";
    return node;
  }

  /** Server-provided text (names, goals, notes) is the user's own words: the interface translator leaves it alone. */
  function userText(tag, cls, text) {
    const node = h(tag, cls, text);
    node.dataset.userText = "";
    return node;
  }

  function relative(value) {
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) return "";
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return new Date(ms).toLocaleDateString(host?.lang?.() === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function bytes(n) {
    if (!Number.isFinite(n)) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  function toast(text) {
    host?.toast?.(text);
  }

  /** Static interface text for places the page translator does not reach (the options of a drop-down). */
  const T = (text) => (window.ZarvisI18n && host && host.lang ? window.ZarvisI18n.translate(text, host.lang()) : text);

  /* ---------- Talking to the server ---------- */

  /** How long a request may take before the page stops waiting: a step of a task or a file read can take a while, a list should not. */
  const LONG_CALL = /^\/(?:tasks\/[^/]+\/(?:run|retry)|files\/upload)(?:\?|$)/;
  const SHORT_TIMEOUT_MS = 25000;
  const LONG_TIMEOUT_MS = 130000;

  /** Never throws for an HTTP or network failure: the caller gets {ok, status, body, network, timeout, ended}. */
  async function call(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LONG_CALL.test(path) ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS);
    try {
      const res = await host.apiFetch(path, { ...options, signal: controller.signal });
      if (res.ok && options.method && options.method !== "GET") home.at = 0; // Home's copy of the account is now out of date
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body, network: false, timeout: false, ended: false };
    } catch (err) {
      if (err && err.name === "SessionEndedError") return { ok: false, status: 401, body: null, network: false, timeout: false, ended: true };
      if (err && err.constructor && err.constructor.name === "SessionEndedError") return { ok: false, status: 401, body: null, network: false, timeout: false, ended: true };
      // A request that never answers must not leave a page on its loading skeleton for ever.
      if (err && err.name === "AbortError") return { ok: false, status: 0, body: null, network: false, timeout: true, ended: false };
      return { ok: false, status: 0, body: null, network: true, timeout: false, ended: false };
    } finally {
      clearTimeout(timer);
    }
  }

  const json = (value) => ({ method: "POST", body: JSON.stringify(value) });
  const send = (method, value) => ({ method, body: JSON.stringify(value) });

  /** The reason to show for a failed call: the server's own words when it gave any. */
  function reason(r, fallback) {
    if (r.timeout) return "ZARVIS took too long to answer. Try again in a moment.";
    if (r.network) return "Couldn't reach ZARVIS. Check your connection and try again.";
    if (r.body && typeof r.body.error === "string" && r.body.error) return r.body.error;
    if (r.status === 429) return "Too many requests right now. Wait a moment and try again.";
    if (r.status === 404) return "That no longer exists.";
    if (r.status === 503) return "This isn't available on the server right now.";
    if (r.status >= 500) return "The server had a problem (" + r.status + "). Try again.";
    return fallback || "That didn't work (" + r.status + ").";
  }

  /** Only the newest request for a panel may draw: a slow answer to an older one is dropped. */
  const tokens = {};
  const claim = (key) => (tokens[key] = (tokens[key] || 0) + 1);
  const isCurrent = (key, token) => tokens[key] === token;

  /* ---------- Shared states: loading, empty, error ---------- */

  function skeleton(rows = 3) {
    const box = h("div", "ws-skeleton");
    box.setAttribute("aria-hidden", "true");
    for (let i = 0; i < rows; i += 1) box.appendChild(h("div", "skeleton skeleton-row"));
    return box;
  }

  function emptyBox(title, body, action) {
    const box = h("div", "empty-state", h("strong", null, title), body ? h("span", null, body) : null);
    if (action) box.appendChild(button(action.label, "btn btn-secondary", action.onClick, { icon: action.icon }));
    return box;
  }

  function errorBox(title, r, retry) {
    const box = h("div", "empty-state ws-error", h("strong", null, title), h("span", null, reason(r)));
    box.setAttribute("role", "alert");
    if (retry) box.appendChild(button("Try again", "btn btn-secondary", retry, { icon: "i-refresh" }));
    return box;
  }

  function sectionHead(title, ...actions) {
    return h("div", "section-head", h("h2", "section-title", title), actions.length ? h("div", "ws-actions", actions) : null);
  }

  /**
   * Marks a sideways-scrolling row with which edges have more to scroll to (data-fade="start end"), so CSS can fade them:
   * a tab that is cut off by the edge reads as "there is more", not as a clipped word.
   */
  function scrollFade(row) {
    if (!row || row.dataset.fadeReady) return;
    row.dataset.fadeReady = "1";
    row.classList.add("scroll-fade");
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      const edges = [];
      if (row.scrollLeft > 2) edges.push("start");
      if (max > 2 && row.scrollLeft < max - 2) edges.push("end");
      row.dataset.fade = edges.join(" ");
    };
    row.addEventListener("scroll", update, { passive: true });
    // Tied to the element (nothing on window), so a row that is rebuilt and dropped, like the task board on every repaint, leaves
    // nothing behind. The children are watched too: their width changes with the language, while the row's own box does not.
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(update);
      observer.observe(row);
      for (const child of row.children) observer.observe(child);
    }
    update();
    row.__updateFade = update;
  }

  /* ---------- Dialogs ---------- */

  const dialogState = { open: false };

  /**
   * A form in the shared form dialog. fields: [{ name, label, type: text|textarea|select, value, required, maxLength, rows, options, help, placeholder }].
   * onSubmit(values) resolves to undefined when it worked (the dialog closes) or to { error } to stay open with that message.
   */
  function formDialog({ title, description, fields, submitLabel = "Save", onSubmit }) {
    const overlay = $("form-modal");
    const form = $("form-modal-form");
    const holder = $("form-modal-fields");
    const errorNode = $("form-modal-error");
    const submit = $("form-modal-submit");
    if (!overlay || dialogState.open) return Promise.resolve(false);
    dialogState.open = true;
    $("form-modal-title").textContent = title;
    const desc = $("form-modal-desc");
    desc.textContent = description || "";
    desc.hidden = !description;
    holder.replaceChildren();
    errorNode.hidden = true;
    submit.textContent = submitLabel;
    submit.disabled = false;
    const inputs = {};
    fields.forEach((field, index) => {
      const id = "form-field-" + index;
      const wrap = h("div", "field");
      if (field.type === "checks") {
        const set = h("fieldset", "ws-checks");
        set.appendChild(h("legend", null, field.label));
        const boxes = (field.options || []).map((option, i) => {
          const box = h("input");
          box.type = "checkbox";
          box.value = option.value;
          box.checked = option.checked !== false;
          box.id = id + "-" + i;
          set.appendChild(h("label", "ws-check", box, userText("span", null, option.label)));
          return box;
        });
        inputs[field.name] = { focus: (opts) => boxes[0]?.focus(opts), values: () => boxes.filter((b) => b.checked).map((b) => b.value), isChecks: true };
        wrap.appendChild(set);
        holder.appendChild(wrap);
        return;
      }
      wrap.appendChild(h("label", null, field.label + (field.required ? " *" : "")));
      wrap.lastChild.htmlFor = id;
      let input;
      if (field.type === "textarea") {
        input = h("textarea", "input");
        input.rows = field.rows || 4;
      } else if (field.type === "select") {
        input = h("select", "input select");
        for (const option of field.options || []) {
          const o = h("option", null, option.label);
          o.value = option.value;
          input.appendChild(o);
        }
      } else {
        input = h("input", "input");
        input.type = "text";
      }
      input.id = id;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.required) input.required = true;
      if (field.value != null) input.value = field.value;
      inputs[field.name] = input;
      wrap.appendChild(input);
      if (field.help) {
        const help = h("small", "hint", field.help);
        help.id = id + "-help";
        input.setAttribute("aria-describedby", help.id);
        wrap.appendChild(help);
      }
      holder.appendChild(wrap);
    });
    overlay.hidden = false;
    const first = Object.values(inputs)[0];
    first?.focus({ preventScroll: true });

    return new Promise((resolve) => {
      let busy = false;
      const close = (result) => {
        if (busy) return;
        overlay.hidden = true;
        dialogState.open = false;
        form.removeEventListener("submit", onFormSubmit);
        $("form-modal-cancel").removeEventListener("click", onCancel);
        $("form-modal-close").removeEventListener("click", onCancel);
        overlay.removeEventListener("keydown", onKey);
        overlay.removeEventListener("mousedown", onScrim);
        resolve(result);
      };
      const onCancel = () => close(false);
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(false);
        }
      };
      const onScrim = (event) => {
        if (event.target === overlay) close(false);
      };
      const onFormSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const values = {};
        for (const field of fields) {
          if (inputs[field.name].isChecks) {
            values[field.name] = inputs[field.name].values();
            continue;
          }
          const raw = inputs[field.name].value;
          values[field.name] = field.type === "select" ? raw : raw.trim();
          if (field.required && !values[field.name]) {
            errorNode.textContent = field.label + " is required.";
            errorNode.hidden = false;
            inputs[field.name].focus();
            return;
          }
        }
        busy = true;
        submit.disabled = true;
        submit.textContent = "Saving…";
        errorNode.hidden = true;
        let outcome;
        try {
          outcome = await onSubmit(values);
        } catch (err) {
          outcome = { error: "That didn't work. Try again." };
          console.error(err);
        }
        busy = false;
        submit.disabled = false;
        submit.textContent = submitLabel;
        if (outcome && outcome.error) {
          errorNode.textContent = outcome.error;
          errorNode.hidden = false;
          return;
        }
        close(true);
      };
      form.addEventListener("submit", onFormSubmit);
      $("form-modal-cancel").addEventListener("click", onCancel);
      $("form-modal-close").addEventListener("click", onCancel);
      overlay.addEventListener("keydown", onKey);
      overlay.addEventListener("mousedown", onScrim);
    });
  }

  /** The side panel used to read a file or one run's output. build(body) fills it; it is closed with Esc, the button or the backdrop. */
  let closeOpenViewer = null;

  function openViewer({ title, build, userTitle = false }) {
    const overlay = $("viewer-overlay");
    const body = $("viewer-body");
    if (!overlay) return;
    if (closeOpenViewer) closeOpenViewer(); // a second panel never stacks its listeners on the first one's
    claim("viewer"); // every newly opened panel outdates the answers still on their way for an earlier one
    $("viewer-title").textContent = title;
    if (userTitle) $("viewer-title").dataset.userText = "";
    else delete $("viewer-title").dataset.userText;
    body.replaceChildren();
    build(body);
    overlay.hidden = false;
    $("viewer-close").focus({ preventScroll: true });
    const close = () => {
      overlay.hidden = true;
      overlay.removeEventListener("keydown", onKey);
      overlay.removeEventListener("mousedown", onScrim);
      $("viewer-close").removeEventListener("click", close);
      if (closeOpenViewer === close) closeOpenViewer = null;
    };
    closeOpenViewer = close;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const onScrim = (event) => {
      if (event.target === overlay) close();
    };
    overlay.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", onScrim);
    $("viewer-close").addEventListener("click", close);
    return close;
  }

  function closeViewer() {
    $("viewer-close")?.click();
  }

  /** Destructive actions ask first (the shared confirm dialog) and report success only after the server did it. */
  function confirmThen({ title, body, confirmLabel, destructive = true, run }) {
    host.confirm({ title, body, confirmLabel, destructive, onConfirm: () => void run() });
  }

  function download(content, fileName, type) {
    const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFileName(name, ext) {
    const base = String(name || "zarvis").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "zarvis";
    return base + "." + ext;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Copy failed");
    }
  }

  /* ---------- Agents (names used in pickers; the server owns the real list) ---------- */

  const AGENT_NAMES = { personal: "Personal", research: "Research", documents: "Documents", creative: "Creative", business: "Business", developer: "Developer" };
  const AGENT_TONES = { personal: "tone-blue", research: "tone-cyan", documents: "tone-amber", creative: "tone-pink", business: "tone-coral", developer: "tone-violet" };
  const AGENT_ICONS = { personal: "i-user", research: "i-globe", documents: "i-file", creative: "i-pen", business: "i-briefcase", developer: "i-code" };

  const LIFECYCLE_LABEL = {
    QUEUED: "Queued · not started",
    RUNNING: "Running",
    EXECUTING: "Running a tool",
    VERIFYING: "Checking the result",
    WAITING: "Waiting for you",
    CONFIRMATION_REQUIRED: "Needs your confirmation",
    COMPLETED: "Completed",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
    BLOCKED: "Blocked",
  };

  /* ---------- Notes: decisions, memory, research notes ---------- */

  const NOTE_KIND_LABEL = { decision: "Decision", memory: "Memory", note: "Note", research: "Research note" };

  function noteRow(note, { onChanged, showKind = false } = {}) {
    const row = h("article", "ws-row ws-note");
    row.dataset.noteId = note.id;
    if (note.kind === "memory" && !note.enabled) row.classList.add("is-paused");
    const copy = h("div", "ws-row-copy");
    copy.appendChild(userText("p", "ws-note-text", note.content));
    if (Array.isArray(note.sources) && note.sources.length) {
      const list = h("ul", "ws-citations");
      note.sources.forEach((source, index) => {
        const a = userLink(source.title || source.url);
        a.href = source.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        list.appendChild(h("li", null, h("span", "ws-cite-n", "[" + (index + 1) + "]"), a));
      });
      copy.appendChild(list);
    }
    const meta = h("div", "ws-meta");
    if (showKind) meta.appendChild(badge(NOTE_KIND_LABEL[note.kind] || note.kind, "info"));
    if (note.kind === "memory") meta.appendChild(badge(note.enabled ? "Used in replies" : "Paused", note.enabled ? "ok" : "off"));
    meta.appendChild(h("span", null, relative(note.updatedAt || note.createdAt)));
    copy.appendChild(meta);
    const actions = h("div", "ws-row-actions");
    if (note.kind === "memory") {
      actions.appendChild(button(note.enabled ? "Pause" : "Use again", "btn btn-ghost btn-sm", async () => {
        const r = await call("/notes/" + encodeURIComponent(note.id), send("PATCH", { enabled: !note.enabled }));
        if (r.ended) return;
        if (!r.ok) return toast(reason(r));
        toast(note.enabled ? "Paused. ZARVIS won't use it." : "ZARVIS will use it again.");
        onChanged?.();
      }));
    }
    actions.appendChild(button("Edit", "btn btn-ghost btn-sm", () => {
      void formDialog({
        title: "Edit " + (NOTE_KIND_LABEL[note.kind] || "note").toLowerCase(),
        fields: [{ name: "content", label: "Text", type: "textarea", value: note.content, required: true, maxLength: 2000, rows: 5 }],
        onSubmit: async (v) => {
          const r = await call("/notes/" + encodeURIComponent(note.id), send("PATCH", { content: v.content }));
          if (r.ended) return undefined;
          if (!r.ok) return { error: reason(r) };
          toast("Saved");
          onChanged?.();
          return undefined;
        },
      });
    }, { aria: "Edit: " + note.content.slice(0, 40) }));
    actions.appendChild(button("Delete", "btn btn-ghost btn-sm ws-danger", () => {
      confirmThen({
        title: "Delete this " + (NOTE_KIND_LABEL[note.kind] || "note").toLowerCase() + "?",
        body: "“" + note.content.slice(0, 120) + (note.content.length > 120 ? "…" : "") + "” will be removed from the server.",
        confirmLabel: "Delete",
        run: async () => {
          const r = await call("/notes/" + encodeURIComponent(note.id), { method: "DELETE" });
          if (r.ended) return;
          if (!r.ok) return toast(reason(r));
          toast("Deleted");
          onChanged?.();
        },
      });
    }, { aria: "Delete: " + note.content.slice(0, 40) }));
    row.append(copy, actions);
    return row;
  }

  function addNoteDialog({ kind, projectId, onDone, title, label, value }) {
    return formDialog({
      title: title || "Add " + (NOTE_KIND_LABEL[kind] || "note").toLowerCase(),
      description: kind === "memory" ? "ZARVIS only remembers what you save here. You can pause, edit or delete it any time." : undefined,
      fields: [{ name: "content", label: label || "Text", type: "textarea", required: true, maxLength: 2000, rows: 5, value }],
      submitLabel: "Save",
      onSubmit: async (v) => {
        const r = await call("/notes", json({ kind, content: v.content, ...(projectId ? { projectId } : {}) }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        toast("Saved");
        onDone?.();
        return undefined;
      },
    });
  }

  /* ---------- Work shell ---------- */

  const WORK_TABS = ["projects", "files", "research", "tasks", "outputs"];
  const work = { tab: "projects", projectId: null, projectTab: "overview", showArchived: false, projectQuery: "", projectSort: "recent" };
  const cache = { projects: null };

  function workSub() {
    return work.tab === "projects" && work.projectId ? "project-" + work.projectId : work.tab;
  }

  /** What each Work section is, in one line. The Projects list keeps the page's own sentence (it says where everything is stored); a project's page needs none. */
  const WORK_SUBTITLES = {
    files: "Documents and images ZARVIS has read, with the text it kept.",
    research: "Web searches with their sources, and notes with citations.",
    tasks: "Tracked tasks with their real status.",
    outputs: "What ZARVIS wrote for you, saved as files.",
  };
  const WORK_SUBTITLE_DEFAULT = "Projects, files, research and tasks. Everything here is stored on the ZARVIS server with your account.";

  function applyTabs() {
    const sub = $("work-sub");
    if (sub) {
      const text = work.projectId ? "" : WORK_SUBTITLES[work.tab] || WORK_SUBTITLE_DEFAULT;
      if (sub.textContent !== text && sub.dataset.shown !== text) {
        sub.textContent = text;
        sub.dataset.shown = text;
      }
      sub.hidden = !text;
    }
    for (const tab of WORK_TABS) {
      const button = $("work-tab-" + tab);
      const panel = $("work-panel-" + tab);
      const selected = tab === work.tab;
      button?.setAttribute("aria-selected", String(selected));
      if (button) button.tabIndex = selected ? 0 : -1;
      if (panel) panel.hidden = !selected;
      // On a narrow screen the tab row scrolls sideways: keep the chosen tab in view (without moving the page).
      if (selected && button && button.offsetParent) button.parentElement.scrollLeft = Math.max(0, button.offsetLeft - (button.parentElement.clientWidth - button.offsetWidth) / 2);
    }
    $("work-tabs")?.__updateFade?.();
  }

  function renderWorkTab() {
    if (work.tab === "projects") void renderProjects();
    else if (work.tab === "files") void renderFiles();
    else if (work.tab === "research") void renderResearch();
    else if (work.tab === "tasks") void renderTasks();
    else if (work.tab === "outputs") void renderOutputs();
  }

  /** Sets which tab (or project) Work shows, without drawing it. `sub` is a tab name or project-<id>. */
  function setWorkSub(sub) {
    const project = /^project-([\w-]+)$/.exec(sub || "");
    if (project) {
      work.tab = "projects";
      work.projectId = project[1];
    } else {
      work.tab = WORK_TABS.includes(sub) ? sub : "projects";
      work.projectId = null;
    }
    applyTabs();
  }

  /** Shows that tab (or project) and draws it. Used for #/work/<sub>, the tabs and in-page links. */
  function showWork(sub) {
    setWorkSub(sub);
    renderWorkTab();
  }

  function selectTab(tab, { focus = false } = {}) {
    work.tab = tab;
    work.projectId = null;
    applyTabs();
    renderWorkTab();
    host.syncRoute();
    if (focus) $("work-tab-" + tab)?.focus();
  }

  function setupWork() {
    const list = $("work-tabs");
    if (!list) return;
    list.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-work-tab]");
      if (tab) selectTab(tab.dataset.workTab);
    });
    list.addEventListener("keydown", (event) => {
      const index = WORK_TABS.indexOf(work.tab);
      let next = -1;
      if (event.key === "ArrowRight") next = (index + 1) % WORK_TABS.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + WORK_TABS.length) % WORK_TABS.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = WORK_TABS.length - 1;
      if (next < 0) return;
      event.preventDefault();
      selectTab(WORK_TABS[next], { focus: true });
    });
    scrollFade(list);
    setupTaskControls();
    $("tasks-refresh-btn")?.addEventListener("click", () => void renderTasks());
    $("tasks-new-btn")?.addEventListener("click", () => newTaskDialog({}));
    $("tasks-search")?.addEventListener("input", applyTaskFilter);
  }

  async function loadProjectsCache(force = false) {
    if (cache.projects && !force) return cache.projects;
    const r = await call("/projects");
    if (r.ok && r.body && Array.isArray(r.body.projects)) cache.projects = r.body.projects;
    return cache.projects || [];
  }

  const projectNameOf = (id) => ((cache.projects || []).find((p) => p.id === id) || {}).name || (cache.names && cache.names[id]) || "";

  /* ---------- Projects ---------- */

  function agentOptions(includeNone = true) {
    return [...(includeNone ? [{ value: "", label: T("No particular agent") }] : []), ...Object.entries(AGENT_NAMES).map(([value, label]) => ({ value, label: T(label + " agent") }))];
  }

  function newProjectDialog() {
    return formDialog({
      title: "New project",
      description: "A project keeps its chats, files, tasks, decisions and memory together, so you can pick the work up again later.",
      fields: [
        { name: "name", label: "Name", required: true, maxLength: 120, placeholder: "e.g. Website relaunch" },
        { name: "goal", label: "Goal", maxLength: 1000, placeholder: "What should be true when this is done?" },
        { name: "description", label: "Description", type: "textarea", maxLength: 2000, rows: 3 },
        { name: "agentId", label: "Works mainly with", type: "select", options: agentOptions() },
      ],
      submitLabel: "Create project",
      onSubmit: async (v) => {
        const r = await call("/projects", json({ name: v.name, goal: v.goal, description: v.description, ...(v.agentId ? { agentId: v.agentId } : {}) }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        cache.projects = null;
        toast("Project created");
        work.projectId = r.body.id;
        work.projectTab = "overview";
        host.syncRoute();
        void renderProjects();
        return undefined;
      },
    });
  }

  function countsLine(counts) {
    const parts = [plural(counts.conversations, "chat", "chats")];
    parts.push(counts.openTasks ? plural(counts.openTasks, "open task", "open tasks") : plural(counts.tasks, "task", "tasks"));
    parts.push(plural(counts.files, "file", "files"));
    if (counts.decisions) parts.push(plural(counts.decisions, "decision", "decisions"));
    return parts.join(" · ");
  }

  async function renderProjects() {
    const panel = $("work-panel-projects");
    if (!panel) return;
    if (work.projectId) return renderProjectDetail();
    const token = claim("projects");
    panel.replaceChildren(skeleton());
    const r = await call("/projects" + (work.showArchived ? "" : "?status=ACTIVE"));
    if (r.ended || !isCurrent("projects", token)) return;
    panel.replaceChildren();
    const archivedToggle = h("label", "ws-check", (() => {
      const c = h("input");
      c.type = "checkbox";
      c.checked = work.showArchived;
      c.addEventListener("change", () => { work.showArchived = c.checked; void renderProjects(); });
      return c;
    })(), h("span", null, "Show archived"));
    panel.appendChild(sectionHead("Projects", archivedToggle, button("New project", "btn btn-primary", () => void newProjectDialog(), { icon: "i-plus" })));
    if (!r.ok) {
      panel.appendChild(errorBox("Couldn't load your projects", r, () => void renderProjects()));
      return;
    }
    cache.projects = work.showArchived ? cache.projects : r.body.projects;
    const projects = r.body.projects;
    if (!projects.length) {
      panel.appendChild(emptyBox(work.showArchived ? "No projects yet" : "No active projects", "Create a project to keep chats, files, tasks and decisions together. Nothing is created for you.", { label: "New project", icon: "i-plus", onClick: () => void newProjectDialog() }));
      return;
    }
    const grid = h("div", "ws-grid");
    grid.id = "projects-grid";
    const status = h("p", "sr-only");
    status.setAttribute("role", "status");
    const paint = () => {
      const shown = Logic.filterProjects(projects, { query: work.projectQuery, sort: work.projectSort });
      grid.replaceChildren();
      if (!shown.length) {
        grid.appendChild(emptyBox("No projects match", "Try another search."));
        status.textContent = "No projects match";
        return;
      }
      status.textContent = plural(shown.length, "project shown", "projects shown");
      for (const project of shown) grid.appendChild(projectCard(project));
    };
    // Searching and sorting only make sense once there is something to choose between.
    if (projects.length > 1) {
      const search = h("input");
      search.type = "search";
      search.id = "projects-search";
      search.placeholder = "Search projects";
      search.autocomplete = "off";
      search.setAttribute("aria-label", "Search projects");
      search.value = work.projectQuery;
      search.addEventListener("input", () => { work.projectQuery = search.value; paint(); });
      const sort = h("select", "select");
      sort.id = "projects-sort";
      sort.setAttribute("aria-label", "Sort projects");
      for (const [key, label] of Logic.PROJECT_SORTS) {
        const option = h("option", null, label);
        option.value = key;
        sort.appendChild(option);
      }
      sort.value = work.projectSort;
      sort.addEventListener("change", () => { work.projectSort = sort.value; paint(); });
      panel.appendChild(h("div", "toolbar", h("label", "search-field", icon("i-search"), h("span", "sr-only", "Search projects"), search), sort));
    }
    panel.appendChild(status);
    paint();
    panel.appendChild(grid);
    panel.appendChild(h("p", "hint", "Projects are stored on the ZARVIS server with your account, so they are the same on every device."));
  }

  function projectCard(project) {
    const card = h("article", "ws-card ws-project");
    const open = button("", "ws-card-open", () => openProject(project.id));
    open.setAttribute("aria-label", "Open project: " + project.name);
    const head = h("div", "ws-card-head");
    put(head, userText("strong", "ws-card-title", project.name), project.status === "ARCHIVED" ? badge("Archived", "off") : null, project.agentId ? badge(AGENT_NAMES[project.agentId] || project.agentId, "info") : null);
    card.append(head);
    if (project.goal) card.appendChild(userText("p", "ws-card-goal", project.goal));
    card.appendChild(h("p", "ws-card-counts", countsLine(project.counts)));
    card.appendChild(h("p", "ws-card-time", "Updated " + relative(project.updatedAt)));
    card.appendChild(open);
    return card;
  }

  function openProject(id, tab = "overview") {
    work.tab = "projects";
    work.projectId = id;
    work.projectTab = tab;
    applyTabs();
    host.syncRoute();
    void renderProjects();
    window.scrollTo({ top: 0 });
  }

  const PROJECT_TABS = [
    ["overview", "Overview"], ["chats", "Chats"], ["files", "Files"], ["research", "Research"], ["tasks", "Tasks"], ["decisions", "Decisions"], ["memory", "Memory"], ["activity", "Activity"],
  ];

  async function renderProjectDetail() {
    const panel = $("work-panel-projects");
    const id = work.projectId;
    const token = claim("project");
    panel.replaceChildren(skeleton());
    const r = await call("/projects/" + encodeURIComponent(id));
    if (r.ended || !isCurrent("project", token)) return;
    panel.replaceChildren();
    const back = button("Projects", "btn btn-ghost ws-back", () => selectTab("projects"), { icon: "i-left" });
    panel.appendChild(back);
    if (!r.ok) {
      panel.appendChild(r.status === 404
        ? emptyBox("This project no longer exists", "It was deleted, or it belongs to another account.", { label: "Back to projects", onClick: () => selectTab("projects") })
        : errorBox("Couldn't load this project", r, () => void renderProjectDetail()));
      return;
    }
    const detail = r.body;
    const project = detail.project;
    cache.projects = null;
    cache.names = cache.names || {};
    cache.names[project.id] = project.name;
    const head = h("header", "ws-project-head");
    const titleRow = h("div", "ws-project-title");
    put(titleRow, userText("h2", "ws-h2", project.name), project.status === "ARCHIVED" ? badge("Archived", "off") : null, project.agentId ? badge((AGENT_NAMES[project.agentId] || project.agentId) + " agent", "info") : null);
    const actions = h("div", "ws-actions");
    actions.append(
      button("Edit", "btn btn-secondary", () => editProjectDialog(project), { icon: "i-edit" }),
      button(project.status === "ARCHIVED" ? "Restore" : "Archive", "btn btn-ghost", async () => {
        const next = project.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
        const res = await call("/projects/" + encodeURIComponent(project.id), send("PATCH", { status: next }));
        if (res.ended) return;
        if (!res.ok) return toast(reason(res));
        toast(next === "ARCHIVED" ? "Archived" : "Restored");
        void renderProjectDetail();
      }),
      button("Delete", "btn btn-ghost ws-danger", () => confirmThen({
        title: "Delete this project?",
        body: "“" + project.name + "” and its notes, decisions and project memory are removed. Its chats, tasks and files are kept and become unassigned.",
        confirmLabel: "Delete project",
        run: async () => {
          const res = await call("/projects/" + encodeURIComponent(project.id), { method: "DELETE" });
          if (res.ended) return;
          if (!res.ok) return toast(reason(res));
          cache.projects = null;
          toast("Project deleted");
          selectTab("projects");
        },
      })),
    );
    head.append(titleRow, actions);
    panel.appendChild(head);
    if (project.goal) panel.appendChild(h("p", "ws-goal", h("strong", null, "Goal: "), userText("span", null, project.goal)));
    if (project.description) panel.appendChild(userText("p", "ws-desc", project.description));

    panel.appendChild(continueCard(detail));

    const tabs = h("div", "ws-subtabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Project sections");
    scrollFade(tabs);
    const countFor = { chats: detail.counts.conversations, files: detail.counts.files, research: detail.counts.research, tasks: detail.counts.tasks, decisions: detail.counts.decisions, memory: detail.counts.memory };
    const body = h("div", "ws-subpanel");
    body.setAttribute("role", "tabpanel");
    const select = (key, focus) => {
      work.projectTab = key;
      for (const t of tabs.children) {
        const on = t.dataset.key === key;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      }
      body.id = "project-panel-" + key;
      body.setAttribute("aria-labelledby", "project-tab-" + key);
      body.replaceChildren();
      renderProjectTab(body, key, detail);
    };
    for (const [key, label] of PROJECT_TABS) {
      const n = countFor[key];
      const t = h("button", "ws-tab ws-tab-sm", label, n ? h("span", "ws-count", String(n)) : null);
      t.type = "button";
      t.setAttribute("role", "tab");
      t.id = "project-tab-" + key;
      t.setAttribute("aria-controls", "project-panel-" + key);
      t.dataset.key = key;
      t.addEventListener("click", () => select(key));
      tabs.appendChild(t);
    }
    tabs.addEventListener("keydown", (event) => {
      const keys = PROJECT_TABS.map(([key]) => key);
      const index = keys.indexOf(work.projectTab);
      let next = -1;
      if (event.key === "ArrowRight") next = (index + 1) % keys.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + keys.length) % keys.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = keys.length - 1;
      if (next < 0) return;
      event.preventDefault();
      select(keys[next], true);
    });
    panel.append(tabs, body);
    select(PROJECT_TABS.some(([key]) => key === work.projectTab) ? work.projectTab : "overview");
    // The project exists: keep the address and the page title right.
    host.syncRoute();
  }

  function editProjectDialog(project) {
    return formDialog({
      title: "Edit project",
      fields: [
        { name: "name", label: "Name", required: true, maxLength: 120, value: project.name },
        { name: "goal", label: "Goal", maxLength: 1000, value: project.goal },
        { name: "description", label: "Description", type: "textarea", maxLength: 2000, rows: 3, value: project.description },
        { name: "agentId", label: "Works mainly with", type: "select", options: agentOptions(), value: project.agentId || "" },
      ],
      onSubmit: async (v) => {
        const r = await call("/projects/" + encodeURIComponent(project.id), send("PATCH", { name: v.name, goal: v.goal, description: v.description, agentId: v.agentId || null }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        cache.projects = null;
        toast("Saved");
        void renderProjectDetail();
        return undefined;
      },
    });
  }

  /** "Continue work": only what the server has stored. With nothing stored it says so instead of suggesting work. */
  function continueCard(detail) {
    const c = detail.continue;
    const card = h("section", "ws-continue");
    card.setAttribute("aria-labelledby", "continue-title");
    card.appendChild(h("h3", "ws-h3", h("span", null, icon("i-memory")), h("span", null, "Continue work")));
    card.firstChild.id = "continue-title";
    const rows = h("div", "ws-continue-rows");
    const project = detail.project;
    if (c.lastConversation) {
      const chat = c.lastConversation;
      rows.appendChild(h("div", "ws-continue-row", h("div", "ws-row-copy", h("small", null, "Last chat · " + relative(chat.updatedAt)), userText("strong", null, chat.title || "Chat")), button("Continue chat", "btn btn-primary btn-sm", () => void host.openConversation(chat.id))));
    }
    for (const task of c.openTasks.slice(0, 3)) {
      rows.appendChild(h("div", "ws-continue-row", h("div", "ws-row-copy", h("small", null, "Task · " + (LIFECYCLE_LABEL[task.lifecycle] || task.lifecycle)), userText("strong", null, task.goal)), button("Open task", "btn btn-secondary btn-sm", () => { work.projectTab = "tasks"; void renderProjectDetail(); })));
    }
    for (const action of c.pendingActions) {
      const holder = h("div", "ws-continue-pending");
      holder.appendChild(h("small", null, "Waiting for your confirmation · " + action.skillName));
      host.renderConfirmation({ id: action.confirmationId, action: action.action, riskLevel: action.riskLevel, actionClass: action.actionClass, expiresAt: action.expiresAt, skillName: action.skillName }, holder, { onResolved: () => void renderProjectDetail() });
      rows.appendChild(holder);
    }
    if (!rows.children.length) {
      rows.appendChild(h("p", "muted", "Nothing is stored to continue yet. Start a chat in this project and next time it is picked up here, with its real messages."));
    }
    card.appendChild(rows);
    const foot = h("div", "ws-continue-foot");
    foot.appendChild(button("New chat in this project", "btn btn-secondary btn-sm", () => host.openChat({ fresh: true, projectId: project.id, agentId: project.agentId || undefined }), { icon: "i-chat" }));
    foot.appendChild(h("small", "muted", "Based on what is stored on the server. Last activity " + relative(c.lastActivityAt) + "."));
    card.appendChild(foot);
    return card;
  }

  function renderProjectTab(body, key, detail) {
    const project = detail.project;
    const again = () => void renderProjectDetail();
    if (key === "overview") {
      const stats = h("div", "ws-stats");
      for (const [label, value] of [["Chats", detail.counts.conversations], ["Open tasks", detail.counts.openTasks], ["Files", detail.counts.files], ["Decisions", detail.counts.decisions], ["Memory", detail.counts.memory], ["Research notes", detail.counts.research]]) {
        stats.appendChild(h("div", "ws-stat", h("strong", null, String(value)), h("span", null, label)));
      }
      body.appendChild(stats);
      const quick = h("div", "chip-row");
      quick.append(
        button("Add a decision", "chip", () => void addNoteDialog({ kind: "decision", projectId: project.id, onDone: again, title: "Add a decision", label: "What was decided?" }), { icon: "i-check" }),
        button("Plan a task", "chip", () => newTaskDialog({ projectId: project.id, onDone: again }), { icon: "i-task" }),
        button("Research in this project", "chip", () => host.openChat({ fresh: true, projectId: project.id, agentId: "research", prompt: "Search the web and cite the sources you use: " }), { icon: "i-globe" }),
        button("Add project memory", "chip", () => void addNoteDialog({ kind: "memory", projectId: project.id, onDone: again, title: "Add project memory", label: "What should ZARVIS remember for this project?" }), { icon: "i-memory" }),
      );
      body.appendChild(sectionHead("Quick actions"));
      body.appendChild(quick);
      body.appendChild(sectionHead("Recent activity"));
      body.appendChild(activityList(detail.activity.slice(0, 6), "Nothing has happened in this project yet."));
      return;
    }
    if (key === "chats") {
      body.appendChild(sectionHead("Chats in this project",
        button("Add an existing chat", "btn btn-secondary", () => void addExistingChatDialog(project.id, again), { icon: "i-plus" }),
        button("New chat", "btn btn-primary", () => host.openChat({ fresh: true, projectId: project.id, agentId: project.agentId || undefined }), { icon: "i-chat" })));
      if (!detail.conversations.length) return void body.appendChild(emptyBox("No chats in this project", "Start one here, or add an earlier chat."));
      const list = h("div", "list");
      for (const chat of detail.conversations) {
        const row = h("article", "ws-row");
        const open = button("", "ws-row-open", () => void host.openConversation(chat.id));
        open.setAttribute("aria-label", "Open chat: " + (chat.title || "Chat"));
        row.append(h("div", "ws-row-copy", userText("strong", null, chat.title || "Chat"), h("small", null, "Updated " + relative(chat.updatedAt))), open);
        const actions = h("div", "ws-row-actions");
        actions.appendChild(button("Remove", "btn btn-ghost btn-sm", async () => {
          const r = await call("/conversations/" + encodeURIComponent(chat.id) + "/project", json({ projectId: null }));
          if (r.ended) return;
          if (!r.ok) return toast(reason(r));
          toast("Removed from the project. The chat is kept.");
          again();
        }, { aria: "Remove from project: " + (chat.title || "Chat") }));
        row.appendChild(actions);
        list.appendChild(row);
      }
      body.appendChild(list);
      return;
    }
    if (key === "files") {
      body.appendChild(sectionHead("Files in this project", uploadButton(project.id, again)));
      if (!detail.files.length) return void body.appendChild(emptyBox("No files in this project", "Upload a document or an image. ZARVIS keeps the text it reads from it."));
      const list = h("div", "list");
      for (const file of detail.files) list.appendChild(fileRow(file, { onChanged: again, hideProject: true }));
      body.appendChild(list);
      return;
    }
    if (key === "research") {
      const notes = detail.notes.filter((n) => n.kind === "research");
      const searches = detail.executions.filter((e) => e.skillId === "web.search" && e.status === "COMPLETED");
      body.appendChild(sectionHead("Research in this project", button("Research something", "btn btn-primary", () => host.openChat({ fresh: true, projectId: project.id, agentId: "research", prompt: "Search the web and cite the sources you use: " }), { icon: "i-globe" })));
      body.appendChild(h("h3", "ws-h3", "Searches"));
      if (!searches.length) body.appendChild(emptyBox("No searches in this project yet", "Ask the Research agent to search the web from this project."));
      else for (const run of searches) body.appendChild(searchRunCard(run, { onChanged: again, projectId: project.id }));
      body.appendChild(h("h3", "ws-h3", "Research notes"));
      if (!notes.length) body.appendChild(emptyBox("No research notes", "Save a search as a note to keep its sources with it."));
      else notes.forEach((n) => body.appendChild(noteRow(n, { onChanged: again })));
      return;
    }
    if (key === "tasks") {
      body.appendChild(sectionHead("Tasks in this project", button("New task", "btn btn-primary", () => newTaskDialog({ projectId: project.id, onDone: again }), { icon: "i-plus" })));
      if (!detail.tasks.length) return void body.appendChild(emptyBox("No tasks in this project", "A task is a goal with steps. It records its real status; a step runs when you press Run."));
      const list = h("div", "list");
      for (const task of detail.tasks) list.appendChild(taskCard(task, again));
      body.appendChild(list);
      return;
    }
    if (key === "decisions") {
      body.appendChild(sectionHead("Decisions", button("Add a decision", "btn btn-primary", () => void addNoteDialog({ kind: "decision", projectId: project.id, onDone: again, title: "Add a decision", label: "What was decided?" }), { icon: "i-plus" })));
      const notes = detail.notes.filter((n) => n.kind === "decision");
      if (!notes.length) return void body.appendChild(emptyBox("No decisions recorded", "Write down what was decided so it stays with the project. ZARVIS can use it in this project's chats."));
      notes.forEach((n) => body.appendChild(noteRow(n, { onChanged: again })));
      return;
    }
    if (key === "memory") {
      body.appendChild(sectionHead("Project memory", button("Add memory", "btn btn-primary", () => void addNoteDialog({ kind: "memory", projectId: project.id, onDone: again, title: "Add project memory", label: "What should ZARVIS remember for this project?" }), { icon: "i-plus" })));
      body.appendChild(h("p", "hint", "Only what you save here. ZARVIS uses it in this project's chats unless you pause it, or pause memory altogether in Settings → Memory."));
      const notes = detail.notes.filter((n) => n.kind === "memory");
      if (!notes.length) return void body.appendChild(emptyBox("No project memory", "Nothing is remembered for this project unless you add it."));
      notes.forEach((n) => body.appendChild(noteRow(n, { onChanged: again })));
      return;
    }
    if (key === "activity") {
      body.appendChild(sectionHead("Activity in this project"));
      body.appendChild(activityList(detail.activity, "Nothing has happened in this project yet."));
    }
  }

  async function addExistingChatDialog(projectId, onDone) {
    const r = await call("/conversations?limit=50");
    if (r.ended) return;
    if (!r.ok) return toast(reason(r));
    const chats = (r.body.conversations || []).filter((c) => c.projectId !== projectId);
    if (!chats.length) return toast("Every chat you have is already in this project.");
    void formDialog({
      title: "Add an existing chat",
      description: "The chat keeps its messages. It is listed in this project, and the project's goal, decisions and memory are used when you continue it.",
      fields: [{ name: "chat", label: "Chat", type: "select", options: chats.map((c) => ({ value: c.id, label: (c.title || T("Chat")) + (c.projectId ? " " + T("(in another project)") : "") })) }],
      submitLabel: "Add chat",
      onSubmit: async (v) => {
        const res = await call("/conversations/" + encodeURIComponent(v.chat) + "/project", json({ projectId }));
        if (res.ended) return undefined;
        if (!res.ok) return { error: reason(res) };
        toast("Chat added");
        onDone();
        return undefined;
      },
    });
  }

  function activityList(entries, emptyText) {
    if (!entries.length) return emptyBox(emptyText);
    const ol = h("ol", "timeline timeline-compact");
    for (const entry of entries) ol.appendChild(activityItem(entry));
    return ol;
  }

  const ACTIVITY_ICON = { tool: "i-bolt", task: "i-task", file: "i-file", note: "i-pen", chat: "i-chat", project: "i-folder" };
  const ACTIVITY_LABEL = { tool: "Tool", task: "Task", file: "File", note: "Note", chat: "Chat", project: "Project" };

  function activityItem(entry) {
    const li = h("li", "timeline-item");
    li.dataset.tone = entry.tone === "ok" ? "ok" : entry.tone === "error" ? "error" : "";
    const dot = h("span", "timeline-dot", icon(entry.tone === "error" ? "i-x" : entry.tone === "ok" ? "i-check" : ACTIVITY_ICON[entry.type] || "i-activity"));
    const body = h("div", "timeline-body");
    body.appendChild(entry.type === "tool" ? h("strong", null, entry.title) : userText("strong", null, entry.title));
    const label = ACTIVITY_LABEL[entry.type] || "Activity";
    body.appendChild(h("div", "timeline-meta", h("span", null, label), entry.detail && entry.detail !== label ? h("span", null, entry.detail) : null, h("span", null, relative(entry.at))));
    li.append(dot, body);
    if (entry.ref && entry.ref.kind !== "execution") {
      const open = button("", "timeline-more", () => openEntry(entry), { icon: "i-right", aria: "Open: " + entry.title });
      li.appendChild(open);
    }
    return li;
  }

  function openEntry(entry) {
    const { kind, id, projectId } = entry.ref;
    if (kind === "conversation") void host.openConversation(id);
    else if (kind === "project") openProject(id);
    else if (kind === "task") {
      if (projectId) openProject(projectId, "tasks");
      else host.setActiveView("work"), selectTab("tasks");
    } else if (kind === "file") {
      if (projectId) openProject(projectId, "files");
      else host.setActiveView("work"), selectTab("files");
    } else if (kind === "note") {
      if (projectId) openProject(projectId, "decisions");
      else host.setActiveView("work"), selectTab("research");
    }
  }

  /* ---------- Files ---------- */

  const FILE_ICON = { document: "i-file", image: "i-image", text: "i-file" };
  const FILE_KIND = { document: "Document", image: "Image", text: "Text file" };
  const filesState = { filter: "all", query: "", uploads: [], uploadSeq: 0 };

  const MAX_TEXT_BYTES = 60000;
  const MAX_BINARY_BYTES = 4 * 1024 * 1024;
  const TEXT_EXT = [".txt", ".md", ".markdown", ".csv", ".json", ".log"];

  function classifyFile(file) {
    const name = file.name.toLowerCase();
    if (/^image\/(png|jpe?g|webp|heic|heif)$/.test(file.type) || /\.(png|jpe?g|webp|heic|heif)$/.test(name)) return "image";
    if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return "docx";
    if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.some((ext) => name.endsWith(ext))) return "text";
    return null;
  }

  const UPLOAD_ERRORS = {
    unsupported_file_type: "ZARVIS can read images, PDF, DOCX and .txt, .md, .csv, .json and .log files. This type isn't one of them.",
    document_too_long: "That file has more text than one document can hold (60,000 characters).",
    empty_document: "That file looks empty: there was no text to read.",
    image_analysis_unavailable: "Reading images isn't set up on this server. Documents and text files still work.",
    ai_unavailable: "The image reader couldn't be reached, so nothing was saved. Try again in a moment.",
    ai_quota_exceeded: "ZARVIS has reached today's AI limit for reading images. Nothing was saved.",
    extraction_failed: "ZARVIS couldn't read this file. Try another file.",
    file_too_large: "That file is over 4 MB.",
    upload_unavailable: "File upload is temporarily unavailable.",
    upload_failed: "The upload didn't go through. Try again.",
  };

  const uploadReason = (r) => UPLOAD_ERRORS[(r.body && (r.body.error || r.body.code)) || ""] || reason(r, "The upload didn't work (" + r.status + ").");
  const retryable = (r) => r.network || r.timeout || r.status >= 500 || r.status === 429 || (r.body && r.body.error === "ai_unavailable");

  /** Uploads one file and returns { ok, message, retry }. Text is read here; everything else is read by the server. */
  async function uploadOne(file, projectId) {
    const kind = classifyFile(file);
    if (!kind) return { ok: false, message: UPLOAD_ERRORS.unsupported_file_type };
    if (kind === "text") {
      if (file.size > MAX_TEXT_BYTES) return { ok: false, message: UPLOAD_ERRORS.document_too_long };
      let text;
      try {
        text = await file.text();
      } catch {
        return { ok: false, message: "This browser couldn't read the file.", retry: true };
      }
      if (!text.trim()) return { ok: false, message: UPLOAD_ERRORS.empty_document };
      const r = await call("/files/text", json({ name: file.name, text, ...(projectId ? { projectId } : {}), source: "upload" }));
      if (r.ended) return { ok: false, message: "", ended: true };
      return r.ok ? { ok: true } : { ok: false, message: uploadReason(r), retry: retryable(r) };
    }
    if (file.size > MAX_BINARY_BYTES) return { ok: false, message: UPLOAD_ERRORS.file_too_large };
    const form = new FormData();
    form.append("file", file, file.name);
    if (projectId) form.append("projectId", projectId);
    const r = await call("/files/upload", { method: "POST", body: form });
    if (r.ended) return { ok: false, message: "", ended: true };
    return r.ok ? { ok: true } : { ok: false, message: uploadReason(r), retry: retryable(r) };
  }

  /** Runs the uploads one after another. Each shows its real state; a failure says why and, if trying again could help, offers it. */
  async function startUploads(files, projectId, onDone) {
    for (const file of Array.from(files)) {
      const entry = { id: ++filesState.uploadSeq, name: file.name, state: "working", message: "", file, projectId };
      filesState.uploads.push(entry);
      renderUploads();
      const result = await uploadOne(file, projectId);
      if (result.ended) {
        filesState.uploads = filesState.uploads.filter((u) => u !== entry);
        renderUploads();
        return;
      }
      if (result.ok) {
        filesState.uploads = filesState.uploads.filter((u) => u !== entry);
        toast("Saved " + file.name);
      } else {
        entry.state = "failed";
        entry.message = result.message;
        entry.retry = !!result.retry;
        toast(file.name + ": " + result.message);
      }
      renderUploads();
      onDone?.();
    }
  }

  function renderUploads() {
    const box = $("files-uploads");
    if (!box) return;
    box.replaceChildren();
    box.hidden = filesState.uploads.length === 0;
    for (const entry of filesState.uploads) {
      const row = h("div", "ws-upload");
      row.dataset.state = entry.state;
      if (entry.state === "working") {
        row.setAttribute("role", "status");
        row.append(h("span", "ws-spinner"), h("span", "ws-upload-text", h("strong", null, entry.name), h("small", null, "Uploading and reading the file… (no percentage: the server reads it in one step)")));
      } else {
        row.setAttribute("role", "alert");
        const text = h("span", "ws-upload-text", h("strong", null, entry.name), h("small", null, entry.message));
        row.append(icon("i-alert"), text);
        if (entry.retry) {
          row.appendChild(button("Try again", "btn btn-secondary btn-sm", () => {
            filesState.uploads = filesState.uploads.filter((u) => u !== entry);
            void startUploads([entry.file], entry.projectId, () => void renderFilesList());
          }));
        }
        row.appendChild(button("Dismiss", "btn btn-ghost btn-sm", () => {
          filesState.uploads = filesState.uploads.filter((u) => u !== entry);
          renderUploads();
        }, { aria: "Dismiss: " + entry.name }));
      }
      box.appendChild(row);
    }
  }

  /** A "Upload" button with its own hidden picker. */
  function uploadButton(projectId, onDone) {
    const input = h("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    input.accept = "image/*,.txt,.md,.csv,.json,.log,.pdf,.docx";
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.value = "";
      if (files.length) void startUploads(files, projectId, onDone);
    });
    const wrap = h("span", "ws-upload-button");
    wrap.append(input, button("Upload", "btn btn-primary", () => input.click(), { icon: "i-upload" }));
    return wrap;
  }

  function filterFiles(files) {
    const q = filesState.query.trim().toLowerCase();
    let list = files;
    if (filesState.filter === "images") list = list.filter((f) => f.kind === "image");
    else if (filesState.filter === "documents") list = list.filter((f) => f.kind === "document" || f.kind === "text");
    else if (filesState.filter === "project") list = list.filter((f) => f.projectId);
    else if (filesState.filter === "generated") list = list.filter((f) => f.source === "generated");
    else if (filesState.filter === "recent") list = list.slice(0, 10);
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    return list;
  }

  let lastFiles = [];

  async function renderFiles() {
    const panel = $("work-panel-files");
    if (!panel) return;
    panel.replaceChildren();
    panel.appendChild(sectionHead("Files", uploadButton(null, () => void renderFilesList())));
    panel.appendChild(h("p", "hint", "ZARVIS keeps the text it read from a file, not the original. Drop files anywhere on this page to upload them."));
    const uploads = h("div", "ws-uploads");
    uploads.id = "files-uploads";
    uploads.hidden = true;
    panel.appendChild(uploads);
    const toolbar = h("div", "toolbar");
    const search = h("input");
    search.type = "search";
    search.placeholder = "Search files";
    search.autocomplete = "off";
    search.setAttribute("aria-label", "Search files");
    search.value = filesState.query;
    search.addEventListener("input", () => { filesState.query = search.value; paintFiles(); });
    toolbar.appendChild(h("label", "search-field", icon("i-search"), h("span", "sr-only", "Search files"), search));
    const seg = h("div", "segmented");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Filter files");
    for (const [key, label] of [["all", "All Files"], ["recent", "Recent"], ["images", "Images"], ["documents", "Documents"], ["project", "Project Files"], ["generated", "Generated Files"]]) {
      const b = h("button", "seg" + (filesState.filter === key ? " active" : ""), label);
      b.type = "button";
      b.dataset.filter = key;
      b.setAttribute("aria-pressed", String(filesState.filter === key));
      b.addEventListener("click", () => {
        filesState.filter = key;
        for (const other of seg.children) {
          const on = other === b;
          other.classList.toggle("active", on);
          other.setAttribute("aria-pressed", String(on));
        }
        paintFiles();
      });
      seg.appendChild(b);
    }
    toolbar.appendChild(seg);
    panel.appendChild(toolbar);
    const list = h("div", "list");
    list.id = "files-list";
    list.setAttribute("aria-live", "polite");
    panel.appendChild(list);
    renderUploads();
    await renderFilesList();
  }

  async function renderFilesList() {
    const list = $("files-list");
    if (!list) return;
    const token = claim("files");
    if (!list.children.length) list.replaceChildren(skeleton());
    const [r] = await Promise.all([call("/files"), loadProjectsCache(true)]);
    if (r.ended || !isCurrent("files", token) || !$("files-list")) return;
    if (!r.ok) {
      list.replaceChildren(errorBox("Couldn't load your files", r, () => void renderFilesList()));
      return;
    }
    lastFiles = r.body.files;
    paintFiles();
  }

  function paintFiles() {
    const list = $("files-list");
    if (!list) return;
    list.replaceChildren();
    if (!lastFiles.length) {
      list.appendChild(emptyBox("No files yet", "Upload a PDF, Word document, image or text file. ZARVIS reads it and keeps the text so you can summarize it, ask about it or compare it.", { label: "Upload a file", icon: "i-upload", onClick: () => $("work-panel-files")?.querySelector(".ws-upload-button input")?.click() }));
      return;
    }
    const shown = filterFiles(lastFiles);
    if (!shown.length) {
      list.appendChild(emptyBox("No files match", "Try another filter or search."));
      return;
    }
    for (const file of shown) list.appendChild(fileRow(file, { onChanged: () => void renderFilesList() }));
  }

  function fileRow(file, { onChanged, hideProject = false } = {}) {
    const row = h("article", "ws-row file-row");
    row.dataset.fileId = file.id;
    const ico = h("span", "row-ico tone-" + (file.kind === "image" ? "pink" : file.source === "generated" ? "violet" : "amber"), icon(FILE_ICON[file.kind] || "i-file"));
    const meta = h("div", "ws-meta");
    meta.appendChild(h("span", null, FILE_KIND[file.kind] || "File"));
    meta.appendChild(h("span", null, file.source === "generated" ? "Generated" : bytes(file.sizeBytes)));
    if (!hideProject && file.projectId && projectNameOf(file.projectId)) meta.appendChild(userBadge(projectNameOf(file.projectId), "info"));
    meta.appendChild(h("span", null, relative(file.createdAt)));
    const copy = h("div", "ws-row-copy", userText("strong", "ws-file-name", file.name), meta);
    const open = button("", "ws-row-open", () => void openFileViewer(file, onChanged));
    open.setAttribute("aria-label", "Preview: " + file.name);
    const actions = h("div", "ws-row-actions");
    actions.appendChild(button("Ask ZARVIS", "btn btn-ghost btn-sm", () => void askAbout(file, "ask"), { aria: "Ask ZARVIS about: " + file.name }));
    const more = button("", "icon-btn icon-btn-sm", null, { icon: "i-more", aria: "More actions for " + file.name, title: "More" });
    more.addEventListener("click", () => fileMenu(more, file, onChanged));
    actions.appendChild(more);
    row.append(ico, copy, open, actions);
    return row;
  }

  function fileMenu(anchor, file, onChanged) {
    window.ZarvisShell?.menu(anchor, file.name, [
      { label: "Preview", icon: "i-eye", hint: "Read the text ZARVIS kept", run: () => void openFileViewer(file, onChanged) },
      { label: "Summarize", icon: "i-sparkle", hint: "In chat, from this file", run: () => void askAbout(file, "summarize") },
      { label: "Explain", icon: "i-brain", hint: "In simple words", run: () => void askAbout(file, "explain") },
      { label: "Ask ZARVIS", icon: "i-chat", hint: "Ask your own question", run: () => void askAbout(file, "ask") },
      { label: "Extract information", icon: "i-grid", hint: "People, dates, amounts, actions", run: () => void askAbout(file, "extract") },
      { label: "Compare…", icon: "i-columns", hint: "With another file", run: () => void compareDialog(file) },
      { label: "Create output…", icon: "i-pen", hint: "Write something from this file", run: () => void createOutputDialog(file) },
      { label: "Rename…", icon: "i-edit", hint: "", run: () => renameDialog(file, onChanged) },
      { label: "Move to project…", icon: "i-folder", hint: "", run: () => void moveDialog(file, onChanged) },
      { label: "Delete…", icon: "i-trash", hint: "Removes the saved text", run: () => deleteFile(file, onChanged) },
    ]);
  }

  /** Loads the file's stored text, then runs fn. Says plainly if it can't. */
  async function withFileText(file, fn) {
    const r = await call("/files/" + encodeURIComponent(file.id));
    if (r.ended) return;
    if (!r.ok) return toast(reason(r, "Couldn't open that file."));
    return fn(r.body);
  }

  const FILE_PROMPTS = {
    summarize: "",
    explain: "Explain this document in simple words and point out the important parts.",
    extract: "Extract the key information from this document as a clear list: people and organisations, dates, amounts and numbers, decisions, and action items. Write “not mentioned” for anything the document does not say. Do not guess.",
    ask: "",
  };

  async function askAbout(file, kind) {
    await withFileText(file, (full) => {
      host.openChat({
        fresh: true,
        projectId: file.projectId || undefined,
        agentId: "documents",
        attachment: { name: full.name, text: full.text },
        prompt: FILE_PROMPTS[kind],
        submit: kind !== "ask",
      });
      closeViewer();
    });
  }

  async function compareDialog(file) {
    if (!lastFiles.length) {
      const listed = await call("/files");
      if (listed.ended) return;
      if (!listed.ok) return toast(reason(listed));
      lastFiles = listed.body.files;
    }
    const others = lastFiles.filter((f) => f.id !== file.id);
    if (!others.length) return toast("Upload a second file to compare it with this one.");
    void formDialog({
      title: "Compare “" + file.name + "”",
      description: "ZARVIS reads both texts (up to 25,000 characters of each) and answers in chat.",
      fields: [
        { name: "other", label: "Compare with", type: "select", options: others.map((f) => ({ value: f.id, label: f.name })) },
        { name: "focus", label: "What should the comparison focus on?", maxLength: 300, placeholder: "e.g. differences in price and deadlines (optional)" },
      ],
      submitLabel: "Compare in chat",
      onSubmit: async (v) => {
        const [a, b] = await Promise.all([call("/files/" + encodeURIComponent(file.id)), call("/files/" + encodeURIComponent(v.other))]);
        if (a.ended || b.ended) return undefined;
        if (!a.ok || !b.ok) return { error: reason(a.ok ? b : a, "Couldn't open one of the files.") };
        const cap = 25000;
        const clip = (t) => (t.length > cap ? t.slice(0, cap) + "\n[…the rest of this document was left out to fit]" : t);
        const prompt = "Compare these two documents" + (v.focus ? ", focusing on: " + v.focus : "") + ". Say what is the same, what differs, and anything one has that the other lacks. Use only what the texts say.\n\n" +
          "[Document A: " + a.body.name + "]\n" + clip(a.body.text) + "\n\n[Document B: " + b.body.name + "]\n" + clip(b.body.text);
        host.openChat({ fresh: true, projectId: file.projectId || undefined, agentId: "documents", prompt, displayText: "Compare “" + a.body.name + "” and “" + b.body.name + "”", submit: true });
        closeViewer();
        return undefined;
      },
    });
  }

  function createOutputDialog(file) {
    void formDialog({
      title: "Create output from “" + file.name + "”",
      description: "ZARVIS writes it in chat using this file's text. Save the reply to Files when you like it.",
      fields: [{ name: "task", label: "What should ZARVIS create?", type: "textarea", required: true, maxLength: 600, rows: 3, placeholder: "e.g. A one-page brief for the team, or a reply email" }],
      submitLabel: "Create in chat",
      onSubmit: async (v) => {
        const r = await call("/files/" + encodeURIComponent(file.id));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r, "Couldn't open that file.") };
        host.openChat({ fresh: true, projectId: file.projectId || undefined, agentId: "documents", attachment: { name: r.body.name, text: r.body.text }, prompt: v.task, submit: true });
        closeViewer();
        return undefined;
      },
    });
  }

  function renameDialog(file, onChanged) {
    void formDialog({
      title: "Rename file",
      fields: [{ name: "name", label: "Name", required: true, maxLength: 200, value: file.name }],
      onSubmit: async (v) => {
        const r = await call("/files/" + encodeURIComponent(file.id), send("PATCH", { name: v.name }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        toast("Renamed");
        onChanged?.();
        return undefined;
      },
    });
  }

  async function moveDialog(file, onChanged) {
    const projects = await loadProjectsCache(true);
    void formDialog({
      title: "Move “" + file.name + "”",
      fields: [{ name: "projectId", label: "Project", type: "select", value: file.projectId || "", options: [{ value: "", label: T("No project") }, ...projects.map((p) => ({ value: p.id, label: p.name }))] }],
      submitLabel: "Move",
      onSubmit: async (v) => {
        const r = await call("/files/" + encodeURIComponent(file.id), send("PATCH", { projectId: v.projectId || null }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        toast("Moved");
        onChanged?.();
        return undefined;
      },
    });
  }

  function deleteFile(file, onChanged) {
    confirmThen({
      title: "Delete this file?",
      body: "“" + file.name + "” and the text ZARVIS kept from it are removed from the server. This can't be undone.",
      confirmLabel: "Delete",
      run: async () => {
        const r = await call("/files/" + encodeURIComponent(file.id), { method: "DELETE" });
        if (r.ended) return;
        if (!r.ok) return toast(reason(r));
        toast("Deleted");
        closeViewer();
        onChanged?.();
      },
    });
  }

  async function openFileViewer(file, onChanged) {
    const close = openViewer({ title: file.name, userTitle: true, build: (body) => body.appendChild(skeleton(2)) });
    void close;
    const token = tokens.viewer;
    const r = await call("/files/" + encodeURIComponent(file.id));
    if (r.ended) return closeViewer();
    // A slower answer for a file that was opened earlier must not overwrite the file shown now.
    if (!isCurrent("viewer", token)) return;
    const body = $("viewer-body");
    if (!body) return;
    body.replaceChildren();
    if (!r.ok) {
      body.appendChild(errorBox("Couldn't open this file", r, () => void openFileViewer(file, onChanged)));
      return;
    }
    const f = r.body;
    const rows = [["Type", FILE_KIND[f.kind] || "File"], ["Size", f.source === "generated" ? "Generated text" : bytes(f.sizeBytes)], ["Characters kept", String(f.text.length)], ["Saved", new Date(f.createdAt).toLocaleString()]];
    if (f.projectId && projectNameOf(f.projectId)) rows.push(["Project", projectNameOf(f.projectId)]);
    const dl = h("dl", "exec-kv");
    for (const [k, v] of rows) dl.appendChild(h("div", null, h("dt", null, k), h("dd", null, v)));
    body.appendChild(dl);
    body.appendChild(h("p", "notice-line", icon("i-alert"), f.note || (f.source === "generated" ? "This is text ZARVIS wrote for you." : "Only the text ZARVIS read is kept. The original file isn't stored.")));
    const actions = h("div", "ws-actions ws-viewer-actions");
    actions.append(
      button("Summarize", "btn btn-primary btn-sm", () => void askAbout(f, "summarize"), { icon: "i-sparkle" }),
      button("Ask ZARVIS", "btn btn-secondary btn-sm", () => void askAbout(f, "ask"), { icon: "i-chat" }),
      button("Copy text", "btn btn-ghost btn-sm", () => void copyText(f.text), { icon: "i-copy" }),
      button("Download", "btn btn-ghost btn-sm", () => download(f.text, safeFileName(f.name.replace(/\.[^.]+$/, ""), f.source === "generated" ? "md" : "txt"), "text/plain"), { icon: "i-download" }),
      button("Delete", "btn btn-ghost btn-sm ws-danger", () => deleteFile(f, onChanged), { icon: "i-trash" }),
    );
    body.appendChild(actions);
    const pre = h("pre", "file-text");
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", "Text of " + f.name);
    pre.dataset.userText = "";
    pre.textContent = f.text;
    body.appendChild(pre);
  }

  /* ---------- Outputs ---------- */

  const OUTPUT_KEYS = ["report", "comparison", "outline", "summary", "reply", "post", "ideas", "message", "poem"];
  const OUTPUT_SKILLS = ["research.report", "research.compare", "research.outline", "docs.summarize", "creative.write_poem", "creative.write_message", "creative.brainstorm", "business.customer_reply", "business.social_post"];

  function outputTextOf(execution) {
    const o = execution.output;
    if (!o) return "";
    for (const key of OUTPUT_KEYS) if (typeof o[key] === "string" && o[key].trim()) return o[key];
    return "";
  }

  /** Saves text ZARVIS wrote as a file in Files. The server confirms before anything is said to be saved. */
  async function saveOutput({ name, text, projectId }) {
    const r = await call("/files/text", json({ name, text, source: "generated", ...(projectId ? { projectId } : {}) }));
    if (r.ended) return false;
    if (!r.ok) {
      toast(reason(r));
      return false;
    }
    toast("Saved to Files");
    return true;
  }

  async function renderOutputs() {
    const panel = $("work-panel-outputs");
    if (!panel) return;
    const token = claim("outputs");
    panel.replaceChildren(sectionHead("Outputs"), h("p", "hint", "Things ZARVIS wrote for you. Saving one keeps it in Files as a generated file."), skeleton());
    const [files, runs] = await Promise.all([call("/files"), call("/executions?skillIds=" + OUTPUT_SKILLS.join(",") + "&limit=30"), loadProjectsCache()]);
    if (files.ended || runs.ended || !isCurrent("outputs", token)) return;
    panel.replaceChildren(sectionHead("Outputs"), h("p", "hint", "Things ZARVIS wrote for you. Saving one keeps it in Files as a generated file."));
    panel.appendChild(h("h3", "ws-h3", "Saved outputs"));
    if (!files.ok) panel.appendChild(errorBox("Couldn't load your saved outputs", files, () => void renderOutputs()));
    else {
      const generated = files.body.files.filter((f) => f.source === "generated");
      if (!generated.length) panel.appendChild(emptyBox("No saved outputs yet", "Use “Save to Files” under a ZARVIS reply, or save a recent result below."));
      else {
        const list = h("div", "list");
        generated.forEach((f) => list.appendChild(fileRow(f, { onChanged: () => void renderOutputs() })));
        panel.appendChild(list);
      }
    }
    panel.appendChild(h("h3", "ws-h3", "Recent results you can save"));
    if (!runs.ok) {
      panel.appendChild(errorBox("Couldn't load recent results", runs, () => void renderOutputs()));
      return;
    }
    const usable = runs.body.executions.filter((e) => e.status === "COMPLETED" && outputTextOf(e));
    if (!usable.length) {
      panel.appendChild(emptyBox("No recent results", "Ask ZARVIS to write something, summarize a file or research a topic, and the result is listed here."));
      return;
    }
    const list = h("div", "list");
    for (const run of usable) {
      const text = outputTextOf(run);
      const row = h("article", "ws-row");
      const copy = h("div", "ws-row-copy", h("strong", null, run.skillName), userText("p", "ws-snippet", text.replace(/\s+/g, " ").slice(0, 160) + (text.length > 160 ? "…" : "")), h("div", "ws-meta", /^research\./.test(run.skillId) ? badge("AI reasoning · not live", "info") : null, h("span", null, relative(run.createdAt))));
      const actions = h("div", "ws-row-actions");
      actions.append(
        button("View", "btn btn-ghost btn-sm", () => openRunViewer(run), { aria: "View result: " + run.skillName }),
        button("Save to Files", "btn btn-secondary btn-sm", async (event) => {
          const b = event.currentTarget;
          b.disabled = true;
          const ok = await saveOutput({ name: run.skillName + " – " + new Date(run.createdAt).toLocaleDateString() + ".md", text, projectId: run.projectId || undefined });
          b.disabled = false;
          if (ok) void renderOutputs();
        }),
      );
      row.append(copy, actions);
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  function openRunViewer(run) {
    openViewer({
      title: run.skillName,
      build: (body) => {
        body.appendChild(h("div", "exec-kv", ""));
        body.lastChild.replaceWith(h("dl", "exec-kv", h("div", null, h("dt", null, "Status"), h("dd", null, run.status === "COMPLETED" ? "Completed" : run.status)), h("div", null, h("dt", null, "Recorded"), h("dd", null, new Date(run.createdAt).toLocaleString()))));
        if (run.inputPreview) {
          const asked = Object.values(run.inputPreview).find((v) => typeof v === "string" && v);
          if (asked) body.appendChild(userText("p", "exec-input", "“" + asked + "”"));
        }
        const out = h("div", "exec-output");
        window.ZarvisExec?.renderOutput(out, run.skillId, run.output, { inputPreview: run.inputPreview });
        if (out.children.length) body.appendChild(out);
        const text = outputTextOf(run) || (run.output && typeof run.output.answer === "string" ? run.output.answer : "");
        if (text) {
          const pre = h("pre", "file-text");
          pre.tabIndex = 0;
          pre.dataset.userText = "";
          pre.textContent = text;
          body.appendChild(pre);
        } else if (run.summary) body.appendChild(userText("p", null, run.summary));
        body.appendChild(h("p", "hint", "Read from the stored record of this run. " + (run.evidence && run.evidence.check === "non_empty_result" ? "The skill returned a non-empty result." : "")));
      },
    });
  }

  /* ---------- Research ---------- */

  const research = { mode: "concise", topic: "", data: null };

  const RESEARCH_REASONING = ["research.compare", "research.report", "research.outline"];

  function researchPrompt(kind, topic) {
    const lead = {
      search: "Search the web and cite the sources you use: ",
      compare: "Compare these options and say which claims come from live search: ",
      outline: "Give me a research outline of the questions worth investigating about: ",
    }[kind];
    return lead + topic + (research.mode === "concise" ? " Keep the answer concise." : " Give a detailed, structured answer.");
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function sourcesOf(run) {
    return Array.isArray(run.output && run.output.results) ? run.output.results.filter((s) => s && /^https?:\/\//i.test(s.url)) : [];
  }

  function searchRunCard(run, { onChanged, projectId } = {}) {
    const query = (run.inputPreview && run.inputPreview.query) || "Web search";
    const answer = typeof (run.output && run.output.answer) === "string" ? run.output.answer.trim() : "";
    const sources = sourcesOf(run);
    const card = h("article", "ws-card ws-search");
    card.append(h("div", "ws-card-head", badge("Live web", "ok"), userText("strong", "ws-card-title", query), h("span", "ws-card-time", relative(run.createdAt))));
    if (answer) {
      const p = userText("p", "ws-answer is-clamped", answer);
      card.appendChild(p);
      if (answer.length > 260) {
        const more = button("Show more", "btn btn-ghost btn-sm", () => {
          const clamped = p.classList.toggle("is-clamped");
          more.firstChild.textContent = clamped ? "Show more" : "Show less";
        });
        card.appendChild(more);
      }
    } else {
      card.appendChild(h("p", "muted", "The search returned sources but no summary text."));
    }
    const out = h("div", "exec-output");
    window.ZarvisExec?.renderOutput(out, "web.search", run.output);
    if (out.children.length) card.appendChild(out);
    const actions = h("div", "ws-row-actions ws-row-actions-start");
    actions.appendChild(button("Save as research note", "btn btn-secondary btn-sm", () => saveSearchAsNote(run, query, answer, sources, projectId, onChanged), { icon: "i-bookmark" }));
    actions.appendChild(button("Ask a follow-up", "btn btn-ghost btn-sm", () => host.openChat({ fresh: true, projectId: run.projectId || projectId || undefined, agentId: "research", prompt: "Following up on my search for “" + query + "”: " }), { icon: "i-chat" }));
    card.appendChild(actions);
    return card;
  }

  function saveSearchAsNote(run, query, answer, sources, projectId, onChanged) {
    const text = (query + ": " + (answer || "(no summary)")).slice(0, 2000);
    void formDialog({
      title: "Save as a research note",
      description: sources.length ? "The note keeps the links you tick, taken from this search. Only links the search returned can be saved as sources." : "This search returned no sources, so the note will have none.",
      fields: [
        { name: "content", label: "Note", type: "textarea", value: text, required: true, maxLength: 2000, rows: 6 },
        ...(sources.length ? [{ name: "sources", label: "Sources to keep", type: "checks", options: sources.map((s) => ({ value: s.url, label: (s.title || domainOf(s.url)) + " (" + domainOf(s.url) + ")", checked: true })) }] : []),
      ],
      submitLabel: "Save note",
      onSubmit: async (v) => {
        const r = await call("/notes", json({ kind: "research", content: v.content, executionId: run.id, sources: v.sources || [], ...((run.projectId || projectId) ? { projectId: run.projectId || projectId } : {}) }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        toast("Saved");
        onChanged?.();
        if (!onChanged) void renderResearch();
        return undefined;
      },
    });
  }

  async function renderResearch() {
    const panel = $("work-panel-research");
    if (!panel) return;
    const token = claim("research");
    panel.replaceChildren();
    panel.appendChild(sectionHead("Research"));
    panel.appendChild(h("p", "hint", "Live web results and AI reasoning are labelled separately, and ZARVIS never invents a source: a citation can only be a link a search really returned."));

    // Ask
    const form = h("form", "ws-ask");
    const input = h("input", "input");
    input.type = "text";
    input.placeholder = "What do you want to research?";
    input.maxLength = 500;
    input.value = research.topic;
    input.setAttribute("aria-label", "Research topic");
    input.addEventListener("input", () => { research.topic = input.value; });
    const mode = h("div", "segmented");
    mode.setAttribute("role", "group");
    mode.setAttribute("aria-label", "Answer length");
    for (const [key, label] of [["concise", "Concise"], ["detailed", "Detailed"]]) {
      const b = h("button", "seg" + (research.mode === key ? " active" : ""), label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(research.mode === key));
      b.addEventListener("click", () => {
        research.mode = key;
        for (const other of mode.children) {
          const on = other === b;
          other.classList.toggle("active", on);
          other.setAttribute("aria-pressed", String(on));
        }
      });
      mode.appendChild(b);
    }
    const go = (kind) => {
      const topic = input.value.trim();
      if (!topic) return input.focus();
      host.openChat({ fresh: true, agentId: "research", prompt: researchPrompt(kind, topic), submit: true });
    };
    const row = h("div", "ws-ask-row");
    row.append(button("Search the web", "btn btn-primary", () => go("search"), { icon: "i-globe" }), button("Compare options", "btn btn-secondary", () => go("compare"), { icon: "i-columns" }), button("Research outline", "btn btn-secondary", () => go("outline"), { icon: "i-list" }));
    form.append(h("label", "sr-only", "Research topic"), input, mode, row);
    form.addEventListener("submit", (event) => { event.preventDefault(); go("search"); });
    panel.appendChild(form);

    const body = h("div", "ws-research-body");
    body.appendChild(skeleton());
    panel.appendChild(body);

    const [runs, notes, reasoning] = await Promise.all([
      call("/executions?skillIds=web.search&limit=30"),
      call("/notes?kind=research"),
      call("/executions?skillIds=" + RESEARCH_REASONING.join(",") + "&limit=20"),
    ]);
    if (runs.ended || notes.ended || reasoning.ended || !isCurrent("research", token)) return;
    body.replaceChildren();
    research.data = { runs: runs.ok ? runs.body.executions : [], notes: notes.ok ? notes.body.notes : [], reasoning: reasoning.ok ? reasoning.body.executions : [] };
    const again = () => void renderResearch();

    // Searches
    body.appendChild(h("h3", "ws-h3", "Searches ", badge("Live web", "ok")));
    if (!runs.ok) body.appendChild(errorBox("Couldn't load your searches", runs, again));
    else {
      const done = runs.body.executions.filter((e) => e.status === "COMPLETED");
      if (!done.length) body.appendChild(emptyBox("No searches yet", "Search the web above. Each search is kept here with its answer and its sources."));
      else done.slice(0, 8).forEach((run) => body.appendChild(searchRunCard(run, { onChanged: again })));
      const failed = runs.body.executions.length - done.length;
      if (failed > 0) body.appendChild(h("p", "hint", plural(failed, "search", "searches") + " didn't complete and " + (failed === 1 ? "is" : "are") + " not listed. See Activity for why."));
    }

    // Sources
    body.appendChild(h("h3", "ws-h3", "Sources"));
    const seen = new Map();
    for (const run of research.data.runs.filter((e) => e.status === "COMPLETED")) {
      for (const s of sourcesOf(run)) if (!seen.has(s.url)) seen.set(s.url, { ...s, query: (run.inputPreview && run.inputPreview.query) || "", at: run.createdAt });
    }
    if (!seen.size) body.appendChild(emptyBox("No sources yet", "Sources appear here when a search returns them."));
    else {
      body.appendChild(h("p", "hint", "Links the search provider returned. ZARVIS lists them; it does not open and read each page."));
      const list = h("ul", "ws-source-list");
      for (const s of [...seen.values()].slice(0, 40)) {
        const a = userLink(s.title || domainOf(s.url));
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        list.appendChild(h("li", null, a, h("small", null, domainOf(s.url) + " · from “" + String(s.query).slice(0, 60) + "”")));
      }
      body.appendChild(list);
    }

    // Key facts & research notes
    body.appendChild(sectionHead("Key facts and research notes", button("Add a note", "btn btn-secondary btn-sm", () => void addNoteDialog({ kind: "research", onDone: again, title: "Add a research note", label: "Your note" }), { icon: "i-plus" })));
    if (!notes.ok) body.appendChild(errorBox("Couldn't load your research notes", notes, again));
    else if (!notes.body.notes.length) body.appendChild(emptyBox("No research notes", "Save a search as a note to keep its key facts with their sources, or write your own."));
    else notes.body.notes.forEach((n) => body.appendChild(noteRow(n, { onChanged: again })));

    // Comparisons, reports, outlines
    body.appendChild(h("h3", "ws-h3", "Comparisons, reports and outlines ", badge("AI reasoning · not live", "info")));
    body.appendChild(h("p", "hint", "Written from general knowledge, not from a live search. Verify anything time-sensitive."));
    if (!reasoning.ok) body.appendChild(errorBox("Couldn't load these", reasoning, again));
    else {
      const done = reasoning.body.executions.filter((e) => e.status === "COMPLETED" && outputTextOf(e));
      if (!done.length) body.appendChild(emptyBox("Nothing here yet", "Ask for a comparison, a report or an outline above."));
      else {
        const list = h("div", "list");
        for (const run of done.slice(0, 8)) {
          const text = outputTextOf(run);
          const rowEl = h("article", "ws-row");
          rowEl.append(h("div", "ws-row-copy", h("strong", null, run.skillName), userText("p", "ws-snippet", text.replace(/\s+/g, " ").slice(0, 160) + (text.length > 160 ? "…" : "")), h("div", "ws-meta", h("span", null, relative(run.createdAt)))),
            h("div", "ws-row-actions", button("View", "btn btn-ghost btn-sm", () => openRunViewer(run), { aria: "View: " + run.skillName }), button("Save to Files", "btn btn-secondary btn-sm", async (event) => {
              const saveButton = event.currentTarget; // currentTarget is cleared once the handler has awaited
              saveButton.disabled = true;
              await saveOutput({ name: run.skillName + " – " + new Date(run.createdAt).toLocaleDateString() + ".md", text, projectId: run.projectId || undefined });
              saveButton.disabled = false;
            })));
          list.appendChild(rowEl);
        }
        body.appendChild(list);
      }
    }

    // Citations
    body.appendChild(h("h3", "ws-h3", "Citations"));
    const cites = citationsOf(research.data.notes);
    if (!cites.length) body.appendChild(emptyBox("No citations yet", "A citation is a source you saved with a research note. Only links from a real search can be saved."));
    else {
      const ol = h("ol", "ws-citation-list");
      for (const c of cites) {
        const a = userLink(c.title || domainOf(c.url));
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        ol.appendChild(h("li", null, a, h("small", null, domainOf(c.url))));
      }
      body.appendChild(ol);
    }

    // Export
    body.appendChild(h("h3", "ws-h3", "Export"));
    const exportRow = h("div", "ws-actions");
    exportRow.append(
      button("Download Markdown", "btn btn-secondary", () => {
        const md = researchMarkdown(research.data);
        if (!md) return toast("There's nothing to export yet.");
        download(md, "zarvis-research-" + new Date().toISOString().slice(0, 10) + ".md", "text/markdown");
      }, { icon: "i-download" }),
      button("Copy", "btn btn-ghost", () => {
        const md = researchMarkdown(research.data);
        if (!md) return toast("There's nothing to export yet.");
        void copyText(md);
      }, { icon: "i-copy" }),
    );
    body.appendChild(exportRow);
    body.appendChild(h("p", "hint", "The export contains only what is stored in your account: your notes with their citations, your searches with their sources, and reasoning clearly marked as not live."));
  }

  function citationsOf(notes) {
    const out = [];
    const seen = new Set();
    for (const note of notes) for (const s of note.sources || []) if (!seen.has(s.url)) { seen.add(s.url); out.push(s); }
    return out;
  }

  function researchMarkdown(data) {
    const searches = data.runs.filter((e) => e.status === "COMPLETED");
    const reasoning = data.reasoning.filter((e) => e.status === "COMPLETED" && outputTextOf(e));
    if (!data.notes.length && !searches.length && !reasoning.length) return "";
    const numbers = new Map();
    const cite = (url) => {
      if (!numbers.has(url)) numbers.set(url, numbers.size + 1);
      return numbers.get(url);
    };
    const titles = new Map();
    const lines = ["# Research export", "", "_Exported " + new Date().toLocaleString() + ". Built only from what is stored in your ZARVIS account._", ""];
    if (data.notes.length) {
      lines.push("## Notes", "");
      for (const note of data.notes) {
        for (const s of note.sources || []) titles.set(s.url, s.title);
        lines.push("- " + note.content.replace(/\n+/g, " ") + (note.sources && note.sources.length ? " " + note.sources.map((s) => "[" + cite(s.url) + "]").join("") : ""));
      }
      lines.push("");
    }
    if (searches.length) {
      lines.push("## Live web searches", "");
      for (const run of searches) {
        const q = (run.inputPreview && run.inputPreview.query) || "Web search";
        const sources = sourcesOf(run);
        for (const s of sources) titles.set(s.url, s.title);
        lines.push("### " + q + " — " + new Date(run.createdAt).toLocaleDateString(), "");
        if (run.output && run.output.answer) lines.push(String(run.output.answer).trim(), "");
        if (sources.length) lines.push("Sources: " + sources.map((s) => "[" + cite(s.url) + "]").join(" "), "");
      }
    }
    if (reasoning.length) {
      lines.push("## AI reasoning (not live-sourced)", "");
      for (const run of reasoning) lines.push("### " + run.skillName + " — " + new Date(run.createdAt).toLocaleDateString(), "", outputTextOf(run).trim(), "");
    }
    if (numbers.size) {
      lines.push("## Sources", "");
      for (const [url, n] of numbers) lines.push("[" + n + "] " + (titles.get(url) || domainOf(url)) + " — " + url);
      lines.push("");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  /* ---------- Tasks ---------- */

  const TASKS_VIEW_KEY = "zarvis.tasksView";
  const readTasksView = () => { try { return localStorage.getItem(TASKS_VIEW_KEY) === "board" ? "board" : "list"; } catch { return "list"; } };
  const taskState = { tasks: [], poll: 0, running: new Set(), view: readTasksView(), filter: "all", sort: "updated" };
  const MID_RUN = ["RUNNING", "EXECUTING", "VERIFYING"];

  const STEP_WORD = { DONE: "Done", FAILED: "Failed", RUNNING: "In progress", SKIPPED: "Skipped", PENDING: "Not started" };

  function evidenceLine(step) {
    const e = step.evidence;
    if (!e) return "";
    if (e.check === "model_reply_only") return "Answered in the conversation. No tool ran, so nothing outside the conversation was done or checked.";
    if (e.check === "approved_action") return "An action you approved ran and returned a result.";
    if (e.check === "tool_results" && Array.isArray(e.tools)) {
      return e.tools.map((t) => t.skillId + ": " + String(t.status || "").toLowerCase().replace(/_/g, " ") + (t.evidence && t.evidence.check === "non_empty_result" ? " (non-empty result)" : "")).join("; ");
    }
    return "";
  }

  function taskCard(task, onChanged, { compact = false } = {}) {
    const card = h("article", "task-card");
    card.dataset.status = task.status;
    card.dataset.lifecycle = task.lifecycle;
    card.dataset.taskId = task.id;
    if (MID_RUN.includes(task.lifecycle) && !task.stale) card.classList.add("glow-active");
    const top = h("div", "task-card-top");
    const chip = h("span", "task-status-badge", LIFECYCLE_LABEL[task.lifecycle] || task.lifecycle);
    chip.dataset.status = task.status;
    chip.dataset.lifecycle = task.lifecycle;
    put(top, chip, task.projectId && projectNameOf(task.projectId) ? userBadge(projectNameOf(task.projectId), "info") : null, h("span", "task-time", relative(task.updatedAt || task.createdAt)));
    card.appendChild(top);
    card.appendChild(userText("p", "task-goal", task.goal));

    if (task.steps.length) {
      const done = task.progress.done;
      const progress = h("div", "task-progress");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Steps finished");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(task.progress.total));
      progress.setAttribute("aria-valuenow", String(done));
      progress.setAttribute("aria-valuetext", done + " of " + task.progress.total + " steps finished");
      const bar = h("div", "task-progress-bar");
      bar.style.width = Math.round((done / task.progress.total) * 100) + "%";
      progress.appendChild(bar);
      card.append(progress, h("p", "task-progress-text", done + " of " + task.progress.total + " steps finished"));
      const steps = h("ol", "task-steps ws-steps");
      for (const step of task.steps) {
        const li = h("li", "task-step");
        li.dataset.status = step.status;
        const dot = h("span", "task-step-dot");
        dot.setAttribute("aria-hidden", "true");
        const text = h("div", "ws-step-text");
        text.appendChild(h("span", null, userText("span", null, step.description), h("small", "ws-step-state", " · " + (STEP_WORD[step.status] || step.status) + (step.retryCount ? " · attempt " + (step.retryCount + 1) : ""))));
        if (step.error) text.appendChild(h("small", "ws-step-error", step.error));
        if (step.resultSummary && step.status === "DONE") {
          const d = h("details", "ws-step-result");
          d.appendChild(h("summary", null, "Result"));
          d.appendChild(userText("p", "ws-snippet", step.resultSummary));
          const ev = evidenceLine(step);
          if (ev) d.appendChild(h("small", "muted", "What was checked: " + ev));
          text.appendChild(d);
        }
        li.append(dot, text);
        steps.appendChild(li);
      }
      // On the board a card is a summary: the steps are one tap away, not a wall of text in a narrow column.
      if (compact) {
        const details = h("details", "ws-task-steps");
        details.appendChild(h("summary", null, "Steps (" + task.steps.length + ")"));
        details.appendChild(steps);
        card.appendChild(details);
      } else {
        card.appendChild(steps);
      }
    } else if (task.lifecycle === "QUEUED") {
      card.appendChild(h("p", "muted", "No steps yet. Running it carries out the goal as a single step."));
    }

    if (task.error && (task.lifecycle === "FAILED" || task.lifecycle === "BLOCKED")) {
      card.appendChild(h("p", "alert alert-error ws-task-error", h("strong", null, "Why it stopped: "), task.error.message + (task.error.retryable ? " You can retry it." : "")));
    }
    if (task.blockedReason) card.appendChild(h("p", "alert alert-error ws-task-error", task.blockedReason));
    if (task.stale) card.appendChild(h("p", "notice-line", icon("i-alert"), "This run stopped responding, so it can be retried."));
    if (task.result && task.lifecycle === "COMPLETED") {
      const r = h("div", "ws-task-result");
      r.append(h("strong", null, "Result"), userText("p", null, task.result.summary));
      card.appendChild(r);
    }

    if (task.lifecycle === "CONFIRMATION_REQUIRED" && task.pendingConfirmationId) {
      const holder = h("div", "ws-task-confirm");
      holder.appendChild(h("p", "muted", "Checking the approval…"));
      card.appendChild(holder);
      void pendingConfirmationFor(task, holder, onChanged);
    }

    const actions = h("div", "task-actions");
    const busy = taskState.running.has(task.id);
    for (const action of task.actions) {
      const label = action === "run" ? (task.lifecycle === "QUEUED" ? "Run first step" : "Run next step") : action === "retry" ? "Retry the step" : "Cancel";
      const b = button(busy && action !== "cancel" ? "Running…" : label, "task-action-btn" + (action === "cancel" ? " danger" : ""), () => void doTaskAction(task, action, onChanged));
      b.disabled = busy && action !== "cancel";
      actions.appendChild(b);
    }
    if (task.conversationId) actions.appendChild(button("Open chat", "task-action-btn", () => void host.openConversation(task.conversationId), { aria: "Open the chat for: " + task.goal.slice(0, 40) }));
    if (actions.children.length) card.appendChild(actions);

    if (task.events && task.events.length) {
      const d = h("details", "ws-task-history");
      d.appendChild(h("summary", null, "History (" + task.events.length + ")"));
      const ol = h("ol", "ws-history");
      for (const ev of [...task.events].reverse().slice(0, 20)) ol.appendChild(h("li", null, h("time", null, new Date(ev.at).toLocaleString()), h("span", null, ev.message)));
      d.appendChild(ol);
      card.appendChild(d);
    }
    return card;
  }

  async function pendingConfirmationFor(task, holder, onChanged) {
    const r = await call("/confirmations/" + encodeURIComponent(task.pendingConfirmationId));
    if (r.ended) return;
    holder.replaceChildren();
    if (!r.ok || r.body.status !== "PENDING") {
      holder.appendChild(h("p", "muted", "This confirmation is no longer pending (it expired or was already used). Cancel the task, or retry the step to be asked again."));
      return;
    }
    host.renderConfirmation(r.body, holder, { onResolved: () => onChanged?.() });
  }

  async function doTaskAction(task, action, onChanged) {
    if (action === "cancel") {
      confirmThen({
        title: "Cancel this task?",
        body: "“" + task.goal.slice(0, 120) + "” will stop. Steps that already finished stay finished.",
        confirmLabel: "Cancel task",
        run: async () => {
          const r = await call("/tasks/" + encodeURIComponent(task.id) + "/cancel", { method: "POST" });
          if (r.ended) return;
          if (!r.ok) toast(reason(r));
          else toast("Task cancelled");
          onChanged?.();
        },
      });
      return;
    }
    taskState.running.add(task.id);
    onChanged?.(true);
    const r = await call("/tasks/" + encodeURIComponent(task.id) + "/" + (action === "retry" ? "retry" : "run"), { method: "POST" });
    taskState.running.delete(task.id);
    if (r.ended) return;
    if (!r.ok) toast(reason(r, "Couldn't run the step."));
    else toast(r.body.lifecycle === "FAILED" ? "The step failed. See why on the task." : r.body.lifecycle === "COMPLETED" ? "Task completed" : r.body.lifecycle === "CONFIRMATION_REQUIRED" ? "The step needs your confirmation" : "Step finished");
    onChanged?.();
  }

  function newTaskDialog({ projectId, onDone }) {
    void (async () => {
      const projects = projectId ? [] : await loadProjectsCache();
      void formDialog({
        title: "New task",
        description: "A task is a goal with steps. It is recorded as QUEUED and nothing starts until you press Run. Each step then runs as an ordinary ZARVIS turn.",
        fields: [
          { name: "goal", label: "Goal", required: true, maxLength: 500, placeholder: "e.g. Prepare the weekly report" },
          { name: "steps", label: "Steps (one per line, optional)", type: "textarea", rows: 5, help: "Up to 20 steps. With none, the goal itself is the one step." },
          ...(projectId ? [] : [{ name: "projectId", label: "Project", type: "select", options: [{ value: "", label: T("No project") }, ...projects.map((p) => ({ value: p.id, label: p.name }))] }]),
        ],
        submitLabel: "Create task",
        onSubmit: async (v) => {
          const steps = v.steps.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (steps.length > 20) return { error: "Use at most 20 steps." };
          const r = await call("/tasks", json({ goal: v.goal, ...(steps.length ? { steps } : {}), ...((projectId || v.projectId) ? { projectId: projectId || v.projectId } : {}) }));
          if (r.ended) return undefined;
          if (!r.ok) return { error: reason(r) };
          toast("Task created. Nothing has started.");
          if (onDone) onDone();
          else void renderTasks();
          return undefined;
        },
      });
    })();
  }

  /** Re-draws the task list or board from what was last read, with the current search, filter and sort. */
  function applyTaskFilter() {
    paintTasks();
  }

  async function renderTasks(keepScroll) {
    const list = $("task-list");
    if (!list) return;
    clearTimeout(taskState.poll);
    const token = claim("tasks");
    $("tasks-refresh-btn")?.setAttribute("disabled", "");
    list.setAttribute("aria-busy", "true");
    if (!list.children.length) list.replaceChildren(skeleton(2));
    const [r] = await Promise.all([call("/tasks"), loadProjectsCache()]);
    $("tasks-refresh-btn")?.removeAttribute("disabled");
    list.removeAttribute("aria-busy");
    if (r.ended || !isCurrent("tasks", token)) return;
    if (!r.ok) {
      list.replaceChildren(errorBox("Couldn't load your tasks", r, () => void renderTasks()));
      $("tasks-controls").hidden = true;
      host.onTasks?.(null);
      return;
    }
    const tasks = [...r.body.tasks].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    taskState.tasks = tasks;
    host.onTasks?.(tasks);
    paintTasks();
    // A run that is still going on the server (started here or elsewhere) is re-read until it settles.
    if (tasks.some((t) => MID_RUN.includes(t.lifecycle) && !t.stale) && work.tab === "tasks") {
      taskState.poll = setTimeout(() => { if (!document.hidden && host.activeView() === "work" && work.tab === "tasks") void renderTasks(); }, 4000);
    }
    void keepScroll;
  }

  /** The columns of the board. Cards are the same task cards as the list (one implementation of Run, Retry, Cancel and confirmations). */
  function taskBoardView(tasks, again) {
    const board = h("div", "task-board");
    for (const column of Logic.taskBoard(tasks)) {
      const title = h("h3", "task-col-title", h("span", null, column.label), h("span", "ws-count", String(column.tasks.length)));
      title.id = "task-col-" + column.key;
      const body = h("div", "task-col-body");
      if (column.tasks.length) for (const task of column.tasks) body.appendChild(taskCard(task, again, { compact: true }));
      else body.appendChild(h("p", "task-col-empty", "None"));
      const section = h("section", "task-col", title, body);
      section.dataset.group = column.key;
      section.setAttribute("aria-labelledby", title.id);
      board.appendChild(section);
    }
    scrollFade(board);
    return board;
  }

  function paintTasks() {
    const list = $("task-list");
    if (!list) return;
    const controls = $("tasks-controls");
    const none = $("tasks-no-match");
    const status = $("tasks-status");
    list.replaceChildren();
    if (none) none.hidden = true;
    const tasks = taskState.tasks;
    if (!tasks.length) {
      if (controls) controls.hidden = true;
      list.appendChild(emptyBox("No tasks yet", "Ask ZARVIS to plan a goal in chat, or create one here. A task shows its real status and never starts by itself.", { label: "New task", icon: "i-plus", onClick: () => newTaskDialog({}) }));
      if (status) status.textContent = "";
      return;
    }
    if (controls) controls.hidden = false;
    const board = taskState.view === "board";
    // On the board the columns are the statuses, so the status filter would only contradict them.
    $("tasks-filters").hidden = board;
    const counts = Logic.taskCounts(tasks);
    for (const b of $("tasks-filters").querySelectorAll("[data-filter]")) {
      b.querySelector(".ws-count").textContent = String(counts[b.dataset.filter]);
      const on = b.dataset.filter === taskState.filter;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const b of $("tasks-view").querySelectorAll("[data-view]")) {
      const on = b.dataset.view === taskState.view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    const shown = Logic.filterTasks(tasks, { query: $("tasks-search")?.value || "", filter: board ? "all" : taskState.filter, sort: taskState.sort, projectName: projectNameOf, label: (lifecycle) => T(LIFECYCLE_LABEL[lifecycle] || lifecycle) });
    if (status) status.textContent = shown.length ? plural(shown.length, "task shown", "tasks shown") : "No tasks match";
    if (!shown.length) {
      if (none) none.hidden = false;
      return;
    }
    const again = (quiet) => { if (quiet === true) paintTasks(); else void renderTasks(); };
    if (board) list.appendChild(taskBoardView(shown, again));
    else for (const task of shown) list.appendChild(taskCard(task, again));
  }

  /** Search, sort, filter and List/Board controls of the Tasks page; built from the shared definitions in logic.js. */
  function setupTaskControls() {
    const filters = $("tasks-filters");
    const sort = $("tasks-sort");
    const view = $("tasks-view");
    if (!filters || !sort || !view || filters.children.length) return;
    for (const [key, label] of Logic.TASK_FILTERS) {
      const b = h("button", "seg", h("span", null, label), h("span", "ws-count", "0"));
      b.type = "button";
      b.dataset.filter = key;
      b.addEventListener("click", () => { taskState.filter = key; paintTasks(); });
      filters.appendChild(b);
    }
    for (const [key, label] of Logic.TASK_SORTS) {
      const option = h("option", null, label);
      option.value = key;
      sort.appendChild(option);
    }
    sort.addEventListener("change", () => { taskState.sort = sort.value; paintTasks(); });
    for (const [key, label, ico] of [["list", "List", "i-list"], ["board", "Board", "i-columns"]]) {
      const b = h("button", "seg", icon(ico), h("span", null, label));
      b.type = "button";
      b.dataset.view = key;
      b.addEventListener("click", () => {
        taskState.view = key;
        try { localStorage.setItem(TASKS_VIEW_KEY, key); } catch { /* the choice just is not remembered */ }
        paintTasks();
      });
      view.appendChild(b);
    }
  }

  /* ---------- Agents ---------- */

  const agents = { current: "" };

  function agentsSub() {
    return agents.current;
  }

  function setAgentsSub(sub) {
    agents.current = sub && AGENT_NAMES[sub] ? sub : "";
  }

  function showAgents(sub) {
    setAgentsSub(sub);
    void renderAgents();
  }

  function openAgent(id) {
    agents.current = id || "";
    host.syncRoute();
    void renderAgents();
    window.scrollTo({ top: 0 });
  }

  async function renderAgents() {
    const root = $("agents-root");
    if (!root) return;
    const token = claim("agents");
    root.replaceChildren(skeleton());
    if (agents.current) return renderAgentDetail(root, token);
    const r = await call("/agents");
    if (r.ended || !isCurrent("agents", token)) return;
    root.replaceChildren();
    root.appendChild(h("header", "page-head", h("div", null, h("h1", "page-title", "Agents"), h("p", "page-sub", "Specialists built on ZARVIS's real skills. An agent only uses its own skills, and anything that acts outside ZARVIS still asks you first."))));
    if (!r.ok) {
      root.appendChild(errorBox("Couldn't load the agents", r, () => void renderAgents()));
      return;
    }
    const grid = h("div", "ws-grid");
    for (const a of r.body.agents) {
      const card = h("article", "ws-card ws-agent");
      const ico = h("span", "row-ico " + (AGENT_TONES[a.id] || "tone-blue"), icon(AGENT_ICONS[a.id] || "i-bot"));
      const open = button("", "ws-card-open", () => openAgent(a.id));
      open.setAttribute("aria-label", "Open the " + a.name + " agent");
      card.append(h("div", "ws-card-head", ico, h("strong", "ws-card-title", a.name + " agent")), h("p", "ws-card-goal", a.tagline), h("p", "ws-card-counts", a.available + " of " + a.skillCount + " skill" + (a.skillCount === 1 ? "" : "s") + " available on your plan"), open);
      grid.appendChild(card);
    }
    root.appendChild(grid);
    const extra = h("div", "ws-grid ws-grid-links");
    for (const [title, text, target, ico] of [
      ["Capability status", "Every capability, and whether it is WORKING, PARTIAL, PLANNED or UNSUPPORTED on the web.", "capabilities", "i-grid"],
      ["Phone actions", "Calls, contacts and notifications are Android-only. The web can't do them and says so.", "settings:permissions", "i-phone"],
    ]) {
      const card = h("article", "ws-card");
      card.append(h("div", "ws-card-head", h("span", "row-ico tone-blue", icon(ico)), h("strong", "ws-card-title", title)), h("p", "ws-card-goal", text));
      const open = button("", "ws-card-open", null);
      open.dataset.go = target;
      open.setAttribute("aria-label", title);
      card.appendChild(open);
      extra.appendChild(card);
    }
    root.appendChild(extra);
  }

  async function renderAgentDetail(root, token) {
    const id = agents.current;
    const r = await call("/agents/" + encodeURIComponent(id));
    if (r.ended || !isCurrent("agents", token)) return;
    root.replaceChildren();
    // No second "‹ Agents" button here: the breadcrumb above the page is the way back (and the 44px one on a phone).
    if (!r.ok) {
      root.appendChild(r.status === 404 ? emptyBox("That agent doesn't exist", "", { label: "Back to agents", onClick: () => openAgent("") }) : errorBox("Couldn't load this agent", r, () => void renderAgents()));
      return;
    }
    const a = r.body;
    const head = h("header", "ws-agent-head");
    head.append(h("span", "row-ico row-ico-lg " + (AGENT_TONES[a.id] || "tone-blue"), icon(AGENT_ICONS[a.id] || "i-bot")),
      h("div", null, h("h1", "page-title", a.name + " agent"), h("p", "page-sub", a.tagline), badge(a.available + " of " + a.skillCount + " skills available", a.available === a.skillCount ? "ok" : "info")));
    root.appendChild(head);
    root.appendChild(userText("p", "ws-desc", a.description));

    // Ask
    const ask = h("section", "ws-section");
    ask.appendChild(h("h2", "section-title", "Ask the " + a.name + " agent"));
    const form = h("form", "ws-ask");
    const input = h("textarea", "input");
    input.rows = 2;
    input.maxLength = 2000;
    input.placeholder = "What should the " + a.name + " agent do?";
    input.setAttribute("aria-label", "Ask the " + a.name + " agent");
    form.append(input, h("div", "ws-ask-row", button("Ask", "btn btn-primary", () => form.requestSubmit(), { icon: "i-plane" }), button("Open an empty chat", "btn btn-ghost", () => host.openChat({ fresh: true, agentId: a.id }), { icon: "i-chat" })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return input.focus();
      host.openChat({ fresh: true, agentId: a.id, prompt: text, submit: true });
    });
    ask.appendChild(form);
    const chips = h("div", "chip-row");
    for (const q of a.quickActions) chips.appendChild(button(q.label, "chip", () => host.openChat({ fresh: true, agentId: a.id, prompt: q.prompt }), { icon: "i-sparkle" }));
    ask.append(h("h3", "ws-h3", "Quick actions"), chips);
    root.appendChild(ask);

    // Skills
    const skills = h("section", "ws-section");
    skills.appendChild(h("h2", "section-title", "What it can do"));
    const list = h("div", "list");
    for (const s of a.skills) {
      const row = h("article", "ws-row");
      const meta = h("div", "ws-meta");
      put(meta, badge({ LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk", VERY_HIGH: "Very high risk" }[s.riskLevel] || s.riskLevel, s.riskLevel === "LOW" ? "ok" : "err"),
        s.asksConfirmation ? badge("Asks you first", "info") : badge("Doesn't act outside ZARVIS", "off"),
        s.usageCost.value ? h("span", null, s.usageCost.value + " credit" + (s.usageCost.value === 1 ? "" : "s")) : h("span", null, "Free"),
        s.upgradeRequired ? badge("Needs the " + s.requiredEntitlement + " plan", "err") : null, s.outOfCredits ? badge("Out of credits", "err") : null);
      row.appendChild(h("div", "ws-row-copy", h("strong", null, s.name), userText("p", "ws-snippet", s.description), meta));
      list.appendChild(row);
    }
    skills.appendChild(list);
    root.appendChild(skills);

    // Integrations, permissions
    const needs = h("section", "ws-section");
    needs.appendChild(h("h2", "section-title", "Required integrations and permissions"));
    const kvs = h("dl", "exec-kv");
    const integ = a.integrations.length
      ? a.integrations.map((i) => {
        const st = i.status;
        const state = !st ? "" : !st.available ? "Not available on this server" : st.connected ? "Connected as " + st.login : "Not connected";
        return "GitHub — " + (i.required ? "required" : "optional") + ". " + state + ". " + i.why;
      }).join(" ")
      : "None.";
    kvs.appendChild(h("div", null, h("dt", null, "Integrations"), h("dd", null, integ)));
    kvs.appendChild(h("div", null, h("dt", null, "Device permissions"), h("dd", null, a.permissions.device.length ? a.permissions.device.join(", ") : "None. On the web this agent needs no device permission.")));
    kvs.appendChild(h("div", null, h("dt", null, "Always asks first"), h("dd", null, a.permissions.alwaysAsksFirst.length ? a.permissions.alwaysAsksFirst.join(", ") : "Nothing it does reaches outside ZARVIS, so it doesn't need to.")));
    needs.appendChild(kvs);
    if (a.integrations.some((i) => i.id === "github")) needs.appendChild(button("Open the Developer workspace", "btn btn-secondary", () => host.setActiveView("developer"), { icon: "i-code" }));
    root.appendChild(needs);

    // Current work
    const current = h("section", "ws-section");
    current.appendChild(h("h2", "section-title", "Current work"));
    if (!a.currentWork.projects.length) current.appendChild(emptyBox("No project is set to work with this agent", "Choose this agent when you create or edit a project."));
    else {
      const l = h("div", "list");
      for (const p of a.currentWork.projects) {
        const row = h("article", "ws-row");
        row.append(h("div", "ws-row-copy", userText("strong", null, p.name), p.goal ? userText("small", null, p.goal) : null), h("div", "ws-row-actions", button("Open", "btn btn-secondary btn-sm", () => { host.setActiveView("work"); openProject(p.id); }, { aria: "Open project: " + p.name })));
        l.appendChild(row);
      }
      current.appendChild(l);
    }
    root.appendChild(current);

    // Recent results and activity
    const results = a.recentResults.filter((e) => e.status === "COMPLETED");
    const rr = h("section", "ws-section");
    rr.appendChild(h("h2", "section-title", "Recent results"));
    if (!results.length) rr.appendChild(emptyBox("No results yet", "Results appear here after this agent's skills run."));
    else {
      const l = h("div", "list");
      for (const run of results) {
        const row = h("article", "ws-row");
        row.append(h("div", "ws-row-copy", h("strong", null, run.skillName), userText("p", "ws-snippet", (outputTextOf(run) || (run.output && run.output.answer) || run.summary || "").toString().replace(/\s+/g, " ").slice(0, 160)), h("div", "ws-meta", h("span", null, relative(run.createdAt)))),
          h("div", "ws-row-actions", button("View", "btn btn-ghost btn-sm", () => openRunViewer(run), { aria: "View result: " + run.skillName })));
        l.appendChild(row);
      }
      rr.appendChild(l);
    }
    root.appendChild(rr);

    const act = h("section", "ws-section");
    act.appendChild(h("h2", "section-title", "Activity"));
    const entries = a.recentResults.map((e) => ({ id: e.id, type: "tool", title: e.skillName, detail: ({ COMPLETED: "Completed", FAILED: "Couldn't complete", DENIED: "Not done", CONFIRMATION_REQUIRED: "Waiting for your confirmation", PERMISSION_REQUIRED: "Needs permission", USER_ACTION_REQUIRED: "Needs your input", UNSUPPORTED: "Not available" })[e.status] || e.status, tone: e.status === "COMPLETED" ? "ok" : e.status === "FAILED" || e.status === "DENIED" ? "error" : "neutral", at: e.createdAt, ref: { kind: "execution", id: e.id } }));
    act.appendChild(activityList(entries, "Nothing has run yet."));
    root.appendChild(act);

    const lim = h("section", "ws-section");
    lim.appendChild(h("h2", "section-title", "Limitations"));
    const ul = h("ul", "feature-list");
    for (const text of a.limitations) ul.appendChild(userText("li", null, text));
    lim.appendChild(ul);
    root.appendChild(lim);
  }

  /* ---------- Memory (Settings → Memory) ---------- */

  async function renderMemory() {
    const root = $("memory-root");
    if (!root) return;
    const token = claim("memory");
    if (!root.children.length || root.querySelector("p.muted")) root.replaceChildren(skeleton(2));
    const r = await call("/memory");
    if (r.ended || !isCurrent("memory", token)) return;
    root.replaceChildren();
    if (!r.ok) {
      root.appendChild(errorBox("Couldn't load your memory", r, () => void renderMemory()));
      return;
    }
    const m = r.body;
    const again = () => void renderMemory();

    const master = h("div", "panel");
    const sw = h("button", "switch");
    sw.type = "button";
    sw.setAttribute("aria-pressed", String(m.enabled));
    sw.setAttribute("aria-label", "Use saved memory in replies");
    sw.append(h("span", "switch-thumb"), h("span", "sr-only switch-text", m.enabled ? "On" : "Off"));
    sw.addEventListener("click", async () => {
      sw.disabled = true;
      const res = await call("/memory/settings", send("PUT", { enabled: !m.enabled }));
      if (res.ended) return;
      if (!res.ok) {
        sw.disabled = false;
        return toast(reason(res));
      }
      toast(res.body.enabled ? "ZARVIS will use your saved memory." : "Memory is paused. ZARVIS won't use it.");
      again();
    });
    master.appendChild(h("div", "control-row", h("div", "row-copy", h("strong", null, "Use saved memory in replies"), h("small", null, "ZARVIS only remembers what you save on this page or in a project. It never saves memories by itself. Turn this off to keep everything stored but unused.")), sw));
    root.appendChild(master);

    // Personal memory
    const personal = h("section", "panel");
    personal.appendChild(sectionHead("Personal memory",
      button("Add memory", "btn btn-secondary btn-sm", () => void addNoteDialog({ kind: "memory", onDone: again, title: "Add personal memory", label: "What should ZARVIS remember about you?" }), { icon: "i-plus" })));
    personal.appendChild(h("p", "hint", "Facts and preferences you chose to save, such as the language you like or where you live. At most the newest " + m.limits.memoryItemsUsed + " active items are given to ZARVIS."));
    if (!m.personal.length) personal.appendChild(emptyBox("Nothing saved", "ZARVIS has no personal memory of you. Add something, or use “Remember” under one of your messages in chat."));
    else {
      m.personal.forEach((n) => personal.appendChild(noteRow(n, { onChanged: again })));
      personal.appendChild(button("Forget all personal memory", "btn btn-danger-ghost btn-sm", () => confirmThen({
        title: "Forget all personal memory?",
        body: "All " + plural(m.personal.length, "personal memory item", "personal memory items") + " will be deleted from the server. Project memory is not touched.",
        confirmLabel: "Forget everything",
        run: async () => {
          const res = await call("/memory/personal", { method: "DELETE" });
          if (res.ended) return;
          if (!res.ok) return toast(reason(res));
          toast("Forgot " + plural(res.body.removed, "item", "items"));
          again();
        },
      }), { icon: "i-trash" }));
    }
    root.appendChild(personal);

    // Project memory
    const projects = h("section", "panel");
    projects.appendChild(sectionHead("Project memory"));
    projects.appendChild(h("p", "hint", "Kept inside each project and used only in that project's chats."));
    if (!m.projects.length) projects.appendChild(emptyBox("No project memory", "Open a project and use its Memory tab to add some."));
    else {
      for (const p of m.projects) {
        projects.appendChild(h("div", "ws-memory-project", userText("strong", null, p.name), button("Open project", "btn btn-ghost btn-sm", () => { host.setActiveView("work"); openProject(p.id, "memory"); }, { aria: "Open project: " + p.name })));
        p.items.forEach((n) => projects.appendChild(noteRow(n, { onChanged: again })));
      }
    }
    root.appendChild(projects);

    // Conversation context
    const ctx = h("section", "panel");
    ctx.appendChild(sectionHead("Conversation context"));
    ctx.appendChild(h("p", null, "In a chat, ZARVIS reads the last " + m.limits.conversationMessages + " messages of that chat. Chats are stored on the server with your account and come back on any device you sign in on. A new chat starts without any of them."));
    ctx.appendChild(h("div", "ws-actions",
      button("Start a new chat", "btn btn-secondary", () => host.newConversation(), { icon: "i-plus" }),
      button("Open chat history", "btn btn-ghost", () => host.openHistory(), { icon: "i-memory" })));
    root.appendChild(ctx);
  }

  /** The value on the Settings → Memory row: what the server holds, or Paused. */
  async function refreshMemoryValue() {
    const node = document.querySelector('[data-setting-value="memory"]');
    if (!node) return;
    const r = await call("/memory");
    if (r.ended || !r.ok) return;
    const count = r.body.personal.length + r.body.projects.reduce((n, p) => n + p.items.length, 0);
    node.textContent = !r.body.enabled ? "Paused" : count ? count + " saved" : "None saved";
  }

  /** "Remember" under a message: opens the memory dialog with that text ready to edit. */
  function rememberDialog(text) {
    return formDialog({
      title: "Remember this",
      description: "Saved to your personal memory. Edit it first if you like; you can pause or delete it later in Settings → Memory.",
      fields: [{ name: "content", label: "What should ZARVIS remember?", type: "textarea", value: String(text || "").slice(0, 2000), required: true, maxLength: 2000, rows: 5 }],
      submitLabel: "Remember",
      onSubmit: async (v) => {
        const r = await call("/notes", json({ kind: "memory", content: v.content }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        toast("Saved to memory");
        return undefined;
      },
    });
  }

  /** "Save to Files" under a reply. */
  async function saveReplyDialog(text, { projectId } = {}) {
    const projects = await loadProjectsCache();
    const stamp = new Date().toLocaleDateString();
    return formDialog({
      title: "Save to Files",
      description: "Keeps this reply as a generated file you can find under Work → Outputs.",
      fields: [
        { name: "name", label: "File name", required: true, maxLength: 200, value: "ZARVIS reply – " + stamp + ".md" },
        { name: "projectId", label: "Project", type: "select", value: projectId || "", options: [{ value: "", label: T("No project") }, ...projects.map((p) => ({ value: p.id, label: p.name }))] },
      ],
      submitLabel: "Save",
      onSubmit: async (v) => {
        const r = await call("/files/text", json({ name: v.name, text, source: "generated", ...(v.projectId ? { projectId: v.projectId } : {}) }));
        if (r.ended) return undefined;
        if (!r.ok) return { error: reason(r) };
        toast("Saved to Files");
        return undefined;
      },
    });
  }

  /* ---------- Activity (account feed) ---------- */

  const activity = { type: "all", query: "", items: null };

  async function renderActivity() {
    const list = $("activity-feed");
    if (!list) return;
    const token = claim("activity");
    list.setAttribute("aria-busy", "true");
    if (!activity.items) list.replaceChildren(skeleton(3));
    const r = await call("/activity?limit=100");
    list.removeAttribute("aria-busy");
    if (r.ended || !isCurrent("activity", token)) return;
    if (!r.ok) {
      activity.items = null;
      list.replaceChildren();
      const empty = $("activity-feed-empty");
      empty.replaceChildren(errorBox("Couldn't load your activity", r, () => void renderActivity()));
      empty.hidden = false;
      return;
    }
    activity.items = r.body.activity;
    paintActivity();
  }

  function paintActivity() {
    const list = $("activity-feed");
    const empty = $("activity-feed-empty");
    if (!list || !empty || !activity.items) return;
    list.replaceChildren();
    empty.hidden = true;
    const q = activity.query.trim().toLowerCase();
    const shown = activity.items.filter((e) => (activity.type === "all" || e.type === activity.type) && (!q || (e.title + " " + e.detail).toLowerCase().includes(q)));
    if (!shown.length) {
      empty.replaceChildren(activity.items.length ? emptyBox("Nothing matches", "Try another filter or search.") : emptyBox("No activity yet", "Chat with ZARVIS, run a skill, save a file or start a project, and it is recorded here.", { label: "Start a chat", icon: "i-chat", onClick: () => host.setActiveView("chat") }));
      empty.hidden = false;
      return;
    }
    shown.slice(0, 80).forEach((entry) => list.appendChild(activityItem(entry)));
  }

  function setActivityFilter(type, query) {
    activity.type = type || "all";
    activity.query = query || "";
    paintActivity();
  }

  /* ---------- Plans & Usage: what credits were spent on ---------- */

  async function renderUsage() {
    const stats = $("usage-stats");
    const bySkill = $("usage-by-skill");
    if (!stats || !bySkill) return;
    const token = claim("usage");
    const r = await call("/usage/summary");
    if (r.ended || !isCurrent("usage", token)) return;
    stats.replaceChildren();
    bySkill.replaceChildren();
    const note = $("usage-note");
    if (!r.ok) {
      if (note) note.textContent = "";
      bySkill.appendChild(errorBox("Couldn't load your usage", r, () => void renderUsage()));
      return;
    }
    const u = r.body;
    if (note) note.textContent = "From your account's credit ledger";
    for (const [label, value] of [["Credits left", u.balance], ["Spent in 30 days", u.spentLast30Days], ["Skill runs charged", u.runs]]) {
      stats.appendChild(h("div", "stat-tile", h("span", "stat-tile-label", label), h("strong", "stat-tile-value", Number(value).toLocaleString("en-IN"))));
    }
    if (!u.bySkill.length) {
      bySkill.appendChild(emptyBox("No credits spent yet", "Skills that cost credits show up here after they run. Chatting is free."));
      return;
    }
    for (const s of u.bySkill) {
      bySkill.appendChild(h("div", "ws-row", h("div", "ws-row-copy", h("strong", null, s.name), h("small", null, plural(s.runs, "run", "runs"))), h("strong", "ws-credit", s.credits + " credit" + (s.credits === 1 ? "" : "s"))));
    }
  }

  /* ---------- Home: continue a project, and "Your workspace" below the first screen ---------- */

  // Home reads the account once per visit (not per card), keeps that read for a few seconds so entering Home twice in a row
  // does not ask again, and forgets it the moment this page writes anything (see call()).
  const HOME_TTL_MS = 8000;
  const HOME_INTRO_KEY = "zarvis.homeIntroDismissed";
  const home = { at: 0, data: null };
  const homeIntroDismissed = () => { try { return localStorage.getItem(HOME_INTRO_KEY) === "1"; } catch { return false; } };

  async function refreshHome(force = false) {
    const dash = $("home-dash");
    // Home is only read when Home is the page being shown (it is also asked for once at start-up, whatever page that opens on).
    if (!$("home-project") || host.activeView() !== "home") return;
    if (force || !home.data || Date.now() - home.at >= HOME_TTL_MS) {
      const token = claim("home");
      if (dash && !home.data) paintHomeLoading();
      const reads = await Promise.all([call("/projects?status=ACTIVE"), call("/files"), call("/tasks"), call("/activity?limit=40"), call("/entitlements/me")]);
      if (reads.some((r) => r.ended) || !isCurrent("home", token)) return;
      home.data = { projects: reads[0], files: reads[1], tasks: reads[2], activity: reads[3], plan: reads[4] };
      home.at = Date.now();
    }
    paintHome();
  }

  /** The sentence for a read that failed: what is true, not a guess. */
  const homeReadFailure = (r) => (r.timeout ? "took too long to answer" : r.network ? "could not be reached" : "could not be loaded");

  function paintHomeLoading() {
    const dash = $("home-dash");
    dash.hidden = false;
    dash.setAttribute("aria-busy", "true");
    $("home-dash-body").replaceChildren(skeleton(3));
  }

  function paintHome() {
    const data = home.data;
    if (!data) return;
    $("home-dash")?.setAttribute("data-loaded", "1"); // set in the same tick the cards are drawn; tests wait for it
    const row = $("home-project");
    const projectList = data.projects.ok && data.projects.body && Array.isArray(data.projects.body.projects) ? data.projects.body.projects : null;
    // "Continue a project" above the fold: the newest active project.
    if (row) {
      const newest = projectList && Logic.homeDashboard({ projects: projectList }).projects[0];
      if (newest) {
        $("home-project-title").textContent = newest.name;
        $("home-project-title").dataset.userText = ""; // the project's own name
        $("home-project-label").textContent = "Continue a project · " + relative(newest.updatedAt);
        row.hidden = false;
        row.onclick = () => {
          host.setActiveView("work");
          openProject(newest.id);
        };
      } else {
        row.hidden = true;
      }
    }
    const dash = $("home-dash");
    const body = $("home-dash-body");
    if (!dash || !body) return;
    dash.removeAttribute("aria-busy");
    const field = (r, key) => (r.ok && r.body && Array.isArray(r.body[key]) ? r.body[key] : null);
    const kit = window.ZarvisChatKit;
    const model = Logic.homeDashboard({ chats: kit ? kit.list() : [], projects: projectList, files: field(data.files, "files"), tasks: field(data.tasks, "tasks"), tools: field(data.activity, "activity") });
    body.replaceChildren();
    const failed = [["projects", data.projects], ["files", data.files], ["tasks", data.tasks], ["recent activity", data.activity]].filter(([, r]) => !r.ok);

    // A brand-new account: say where to start, with real actions. It can be dismissed for good. Never shown when a read failed.
    if (model.empty) {
      dash.hidden = homeIntroDismissed();
      if (!dash.hidden) body.appendChild(homeIntro());
      syncHomeMore();
      return;
    }
    const grid = h("div", "dash-grid");
    if (model.chats.length) {
      grid.appendChild(dashCard("Recent chats", { label: "See all", go: "history" }, model.chats.map((chat) => dashRow("i-chat", "blue", chat.title, relative(chat.updatedAt), () => void host.openConversation(chat.id)))));
    }
    if (model.projects && model.projects.length) {
      grid.appendChild(dashCard("Projects", { label: "See all", go: "work:projects" }, model.projects.map((p) => dashRow("i-folder", "violet", p.name, countsLine(p.counts) + " · " + relative(p.updatedAt), () => { host.setActiveView("work"); openProject(p.id); }))));
    }
    if (model.tasks && model.tasks.total) {
      const c = model.tasks.counts;
      const summary = [plural(c.open, "open", "open"), c.stopped ? plural(c.stopped, "stopped", "stopped") : null, plural(c.finished, "finished", "finished")].filter(Boolean).join(" · ");
      const rows = model.tasks.open.length
        ? model.tasks.open.map((t) => dashRow("i-task", "green", t.goal, T(LIFECYCLE_LABEL[t.lifecycle] || t.lifecycle) + " · " + relative(t.updatedAt || t.createdAt), () => { host.setActiveView("work"); selectTab("tasks"); }))
        : [h("p", "dash-note", "No open tasks.")];
      grid.appendChild(dashCard("Tasks", { label: "See all", go: "work:tasks" }, [h("p", "dash-summary", summary), ...rows]));
    }
    if (model.files && model.files.length) {
      grid.appendChild(dashCard("Recent files", { label: "See all", go: "work:files" }, model.files.map((f) => dashRow(FILE_ICON[f.kind] || "i-file", f.kind === "image" ? "pink" : f.source === "generated" ? "violet" : "amber", f.name, (FILE_KIND[f.kind] || "File") + " · " + relative(f.createdAt), () => void openFileViewer(f, () => { home.at = 0; void refreshHome(); })))));
    }
    if (model.tools && model.tools.length) {
      grid.appendChild(dashCard("What ZARVIS did lately", { label: "Open Activity", go: "activity" }, model.tools.map((e) => dashRow(e.tone === "error" ? "i-x" : e.tone === "ok" ? "i-check" : "i-activity", e.tone === "error" ? "coral" : e.tone === "ok" ? "green" : "blue", e.title, (e.detail ? e.detail + " · " : "") + relative(e.at), () => host.setActiveView("activity"), { userTitle: false }))));
    }
    const plan = data.plan.ok && data.plan.body;
    if (plan && plan.plan) grid.appendChild(planCard(plan));
    if (grid.children.length) body.appendChild(grid);
    if (failed.length) {
      const note = h("div", "dash-failed");
      note.setAttribute("role", "status");
      note.append(icon("i-alert"), h("span", null, "Some of this is missing: " + failed.map(([name, r]) => name + " " + homeReadFailure(r)).join(", ") + "."), button("Try again", "btn btn-ghost btn-sm", () => void refreshHome(true)));
      body.appendChild(note);
    }
    dash.hidden = !body.children.length;
    syncHomeMore();
  }

  /** The cue under the prompts that scrolls to the dashboard; it exists only while the dashboard does. */
  function syncHomeMore() {
    const more = $("home-more");
    if (more) more.hidden = !!$("home-dash")?.hidden;
  }

  function dashRow(ico, tone, title, meta, onClick, { userTitle = true } = {}) {
    const row = h("button", "dash-row", h("span", "row-ico tone-" + tone, icon(ico)), h("span", "dash-row-copy", userTitle ? userText("strong", null, title) : h("strong", null, title), meta ? h("small", null, meta) : null), icon("i-right"));
    row.type = "button";
    row.addEventListener("click", () => { host?.haptic?.(); onClick(); });
    return row;
  }

  function dashCard(title, more, rows) {
    const head = h("div", "dash-card-head", h("h3", "dash-card-title", title));
    if (more) {
      const link = h("button", "link-btn", more.label);
      link.type = "button";
      link.dataset.go = more.go; // the app's own link handler goes there
      link.setAttribute("aria-label", more.label + ": " + title);
      head.appendChild(link);
    }
    return h("section", "dash-card", head, h("div", "dash-card-rows", rows));
  }

  /** Plan and credits exactly as the server reports them; a guest is told, once, that a kept account is what keeps them. */
  function planCard(plan) {
    const name = { TRIAL: "Trial", FREE: "Free", PRO: "Pro" }[plan.plan] || plan.plan;
    const credits = Number(plan.creditBalance);
    const when = plan.plan === "PRO" && plan.planExpiresAt ? "Active until " + new Date(plan.planExpiresAt).toLocaleDateString(host?.lang?.() === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" })
      : plan.plan === "TRIAL" && plan.trialExpiresAt ? "Ends " + new Date(plan.trialExpiresAt).toLocaleDateString(host?.lang?.() === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" }) : "";
    const rows = [dashRow("i-plan", "violet", name + " plan", [Number.isFinite(credits) ? plural(credits, "credit", "credits") : null, when].filter(Boolean).join(" · "), () => host.setActiveView("plans"), { userTitle: false })];
    if (localStorage.getItem("zarvis.isGuest") !== "false") {
      const link = h("button", "inline-link", "Link an email");
      link.type = "button";
      link.dataset.go = "settings:account";
      rows.push(h("p", "dash-note", "This is a guest account, so its work stays only while this browser keeps it. ", link));
    }
    return dashCard("Plan and credits", { label: "Plans & Usage", go: "plans" }, rows);
  }

  /** First-visit guidance: three real starting points, not a tour. */
  function homeIntro() {
    const card = h("section", "dash-card dash-intro");
    card.append(h("h3", "dash-card-title", "Start here"), h("p", "dash-note", "Nothing is saved yet. Pick one way to begin; ZARVIS only keeps what you make."));
    const steps = h("div", "dash-intro-steps");
    steps.append(
      dashRow("i-chat", "blue", "Ask a question", "Type or speak; chats are saved to your account.", () => $("home-prompt-input")?.focus(), { userTitle: false }),
      dashRow("i-upload", "amber", "Add a file", "ZARVIS reads it and keeps the text, so you can summarize it.", () => document.querySelector('#home-prompt-form [data-home-action="upload"]')?.click(), { userTitle: false }),
      dashRow("i-folder", "violet", "Start a project", "Keep a goal's chats, files and tasks together.", () => { host.setActiveView("work"); selectTab("projects"); void newProjectDialog(); }, { userTitle: false }),
    );
    const dismiss = button("Hide this", "btn btn-ghost btn-sm", () => {
      try { localStorage.setItem(HOME_INTRO_KEY, "1"); } catch { /* it just comes back next time */ }
      $("home-dash").hidden = true;
      syncHomeMore();
    });
    card.append(steps, dismiss);
    return card;
  }

  /* ---------- Files dropped on the Files page ---------- */

  /** Called by the chat kit for a drop anywhere. On the Files page (or a project's Files tab) the files are uploaded to Files, not attached to chat. */
  function handleDrop(files) {
    if (host.activeView() !== "work" || !files.length) return false;
    if (work.tab === "files") {
      void startUploads(files, null, () => void renderFilesList());
      return true;
    }
    if (work.tab === "projects" && work.projectId && work.projectTab === "files") {
      void startUploads(files, work.projectId, () => void renderProjectDetail());
      return true;
    }
    return false;
  }

  function init(hostApi) {
    host = hostApi;
    setupWork();
    $("home-more")?.addEventListener("click", () => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      $("home-dash")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && host.activeView() === "work" && work.tab === "tasks") void renderTasks();
    });
  }

  window.ZarvisWorkspace = {
    init,
    showWork,
    setWorkSub,
    workSub,
    showAgents,
    setAgentsSub,
    agentsSub,
    renderWork: renderWorkTab,
    renderMemory,
    refreshMemoryValue,
    renderActivity,
    openRun: openRunViewer,
    setActivityFilter,
    renderUsage,
    refreshHome,
    invalidateHome: () => { home.at = 0; },
    handleDrop,
    rememberDialog,
    saveReplyDialog,
    renderTasks,
    applyTaskFilter,
    formDialog,
    openProject,
    currentProjectId: () => work.projectId,
    projectName: (id) => projectNameOf(id),
    loadProjects: loadProjectsCache,
    scrollFade,
  };
})();
