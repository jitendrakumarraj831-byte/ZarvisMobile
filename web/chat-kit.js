/* ZARVIS MOBILE — Chat and navigation kit.

   Everything here is a real, client-side behaviour; nothing is simulated:
   - the chat list (this browser's index of conversations, topped up from the account's list on the server;
     opening one loads its real messages from the server) with search, the side panel, the sidebar "Recent chats", the Home
     "Continue" row and the Activity "Recent chats" block,
   - the "/" command menu, one-tap refine follow-ups, edit-and-resend, day dividers,
   - export / copy of a conversation, drafts, drag-and-drop and paste of files,
   - breadcrumbs, keyboard shortcuts, scroll-to-top, a collapsible sidebar, chat text size.

   app.js owns the conversation state and hands in the few hooks needed through ZarvisChatKit.init(api).
   Pure rules (titles, grouping, slash matching, export text) live in logic.js and are unit tested. */
(() => {
  "use strict";

  const L = window.ZarvisLogic;
  const KEYS = { chats: "zarvis.chats", hidden: "zarvis.chatsHidden", draft: "zarvis.draft", textSize: "zarvis.chatText", rail: "zarvis.sidebarRail" };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  let api = null;
  let chats = [];
  let lastDay = null; // calendar day of the newest message in the open thread
  let lastUserText = ""; // what the user's newest message said, for naming a new chat
  let busy = false;
  let historyOpener = null;
  let hidden = []; // chats the user removed from the list here; the server list must not bring them back
  let syncing = false;
  let lastSyncAt = 0;
  let generation = 0; // bumped on sign-out so a list still in flight cannot reach the next person

  const $ = (id) => document.getElementById(id);

  // ---------- small helpers ----------

  function store(op, key, value) {
    try {
      if (op === "get") return localStorage.getItem(key);
      if (op === "set") localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* private mode / blocked storage: everything still works, just not remembered */
    }
    return null;
  }

  function icon(id) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function node(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function relative(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return L.dayLabel(ms, Date.now(), api?.lang() === "hi" ? "hi-IN" : "en-IN");
  }

  const isTyping = (target) => !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  const overlayOpen = () => !!document.querySelector(".modal-overlay:not([hidden]), .palette-overlay:not([hidden])");

  // ---------- chat list (this browser's index, topped up from the account's list on the server) ----------

  function loadChats() {
    chats = L.parseChatIndex(store("get", KEYS.chats) || "[]");
    hidden = L.parseHiddenChats(store("get", KEYS.hidden) || "[]");
  }

  function saveChats() {
    store("set", KEYS.chats, JSON.stringify(chats));
  }

  function record(id, { title, at } = {}) {
    if (!id) return;
    if (hidden.includes(id)) {
      // A chat the user is writing in again belongs back in the list.
      hidden = hidden.filter((other) => other !== id);
      store("set", KEYS.hidden, JSON.stringify(hidden));
    }
    chats = L.upsertChat(chats, { id, title, updatedAt: Number.isFinite(at) ? at : Date.now() });
    saveChats();
    renderAll();
  }

  function removeFromList(id) {
    chats = L.removeChat(chats, id);
    hidden = L.hideChat(hidden, id);
    store("set", KEYS.hidden, JSON.stringify(hidden));
    saveChats();
    renderAll();
  }

  /**
   * Pulls this account's conversations from the server and folds them into the list, so history follows the
   * account to a new device or a cleared browser. Best effort: offline or failing leaves the list as it is.
   * Throttled, because opening the history panel and finishing sign-in both ask for it.
   */
  async function sync({ force = false } = {}) {
    if (!api?.fetchConversations || syncing) return;
    if (!force && Date.now() - lastSyncAt < 20000) return;
    syncing = true;
    const started = generation;
    try {
      const server = await api.fetchConversations();
      if (started !== generation || !Array.isArray(server)) return;
      lastSyncAt = Date.now();
      const merged = L.mergeServerChats(chats, server, hidden);
      if (JSON.stringify(merged) === JSON.stringify(chats)) return;
      chats = merged;
      saveChats();
      renderAll();
    } catch {
      /* the list already on screen is still right */
    } finally {
      syncing = false;
    }
  }

  /** Signing out, switching account or deleting the account: the next person on this browser sees none of it. */
  function forgetAll() {
    chats = [];
    hidden = [];
    generation += 1;
    lastSyncAt = 0;
    for (const key of [KEYS.chats, KEYS.hidden, KEYS.draft]) store("remove", key);
    if (api?.input) api.input.value = "";
    renderAll();
  }

  const currentChat = () => chats.find((chat) => chat.id === api?.conversationId());

  /** One tappable chat row (title + when), used by the empty Chat page, Activity and the history panel. */
  function chatRow(chat, { onOpen, removable } = {}) {
    const row = node("div", "chat-row");
    const open = node("button", "chat-row-open");
    open.type = "button";
    if (chat.id === api.conversationId()) open.setAttribute("aria-current", "true");
    const ico = node("span", "chat-row-ico");
    ico.appendChild(icon("i-chat"));
    const copy = node("span", "chat-row-copy");
    const title = node("strong", null, chat.title);
    title.dataset.userText = "";
    copy.append(title, node("small", null, relative(chat.updatedAt)));
    open.append(ico, copy, icon("i-right"));
    open.addEventListener("click", () => (onOpen || openChat)(chat.id));
    row.appendChild(open);
    if (removable) {
      const del = node("button", "icon-btn icon-btn-sm chat-row-del");
      del.type = "button";
      del.setAttribute("aria-label", "Remove from list: " + chat.title);
      del.title = "Remove from list";
      del.appendChild(icon("i-trash"));
      del.addEventListener("click", () => confirmRemove(chat));
      row.appendChild(del);
    }
    return row;
  }

  function confirmRemove(chat) {
    api.confirm({
      title: "Remove from list?",
      body: "“" + chat.title + "” stays on the ZARVIS server. It just won't be listed on this browser any more.",
      confirmLabel: "Remove",
      onConfirm: () => removeFromList(chat.id),
    });
  }

  function openChat(id) {
    closeHistory(false);
    void api.openConversation(id);
  }

  // ---------- rendering the chat list in each place it appears ----------

  function renderAll() {
    if (!api) return;
    renderHeaderTitle();
    renderSidebarRecents();
    renderHomeContinue();
    renderEmptyRecents();
    renderActivityChats();
    if (!$("history-overlay")?.hidden) renderHistory();
  }

  function renderHeaderTitle() {
    const title = $("chat-title-text");
    if (title) title.textContent = currentChat()?.title || "ZARVIS AI";
  }

  function renderSidebarRecents() {
    const box = $("nav-recent");
    const label = $("nav-recent-label");
    if (!box || !label) return;
    box.replaceChildren();
    const top = chats.slice(0, 4);
    box.hidden = label.hidden = top.length === 0;
    for (const chat of top) {
      const button = node("button", "nav-item nav-chat");
      button.type = "button";
      button.title = chat.title;
      if (chat.id === api.conversationId() && api.activeView() === "chat") {
        button.classList.add("is-current");
        button.setAttribute("aria-current", "page");
      }
      const text = node("span", null, chat.title);
      text.dataset.userText = "";
      button.append(icon("i-chat"), text);
      button.addEventListener("click", () => openChat(chat.id));
      box.appendChild(button);
    }
  }

  function renderHomeContinue() {
    const button = $("home-continue");
    if (!button) return;
    const latest = chats[0];
    button.hidden = !latest;
    if (!latest) return;
    $("home-continue-title").textContent = latest.title;
    $("home-continue-label").textContent = "Continue where you left off · " + relative(latest.updatedAt);
  }

  function renderEmptyRecents() {
    const box = $("chat-recent");
    const list = $("chat-recent-list");
    if (!box || !list) return;
    list.replaceChildren();
    const others = chats.filter((chat) => chat.id !== api.conversationId()).slice(0, 3);
    box.hidden = others.length === 0;
    for (const chat of others) list.appendChild(chatRow(chat));
  }

  function renderActivityChats() {
    const block = $("activity-chats-block");
    const list = $("activity-chat-list");
    if (!block || !list) return;
    list.replaceChildren();
    for (const chat of chats.slice(0, 5)) list.appendChild(chatRow(chat));
    block.dataset.hasChats = chats.length ? "1" : "";
    syncActivityChats();
  }

  let activityType = "all";
  let activityQuery = "";
  /** Shown with the "All" and "Chats" filters, and narrowed by the search box like the rest of Activity. */
  function syncActivityChats(type = activityType, query = activityQuery) {
    activityType = type;
    activityQuery = query;
    const block = $("activity-chats-block");
    if (!block) return;
    const visible = block.dataset.hasChats === "1" && (type === "all" || type === "conversation");
    block.hidden = !visible;
    if (!visible) return;
    const q = String(query || "").toLowerCase();
    for (const row of block.querySelectorAll(".chat-row")) {
      row.hidden = !!q && !row.textContent.toLowerCase().includes(q);
    }
  }

  // ---------- history panel ----------

  function openHistory(opener) {
    historyOpener = opener || document.activeElement;
    const overlay = $("history-overlay");
    $("history-search").value = "";
    renderHistory();
    overlay.hidden = false;
    $("history-search").focus({ preventScroll: true });
    void sync();
  }

  function closeHistory(restoreFocus = true) {
    const overlay = $("history-overlay");
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (restoreFocus && historyOpener && document.contains(historyOpener)) historyOpener.focus?.({ preventScroll: true });
  }

  function renderHistory() {
    const list = $("history-list");
    list.replaceChildren();
    const found = L.filterChats(chats, $("history-search").value);
    if (!found.length) {
      const empty = node("div", "empty-state");
      empty.append(
        node("strong", null, chats.length ? "No chats match" : "No chats yet"),
        node("span", null, chats.length ? "Try a different word." : "Your conversations show up here as soon as you send a message."),
      );
      list.appendChild(empty);
      return;
    }
    for (const group of L.groupChatsByDay(found)) {
      list.appendChild(node("p", "history-group", group.label));
      for (const chat of group.items) list.appendChild(chatRow(chat, { removable: true }));
    }
  }

  function setupHistory() {
    $("history-close").addEventListener("click", () => closeHistory());
    $("history-overlay").addEventListener("mousedown", (event) => {
      if (event.target === $("history-overlay")) closeHistory();
    });
    $("history-search").addEventListener("input", renderHistory);
    $("history-new").addEventListener("click", () => {
      closeHistory(false);
      api.newConversation();
    });
    $("chat-history-btn").addEventListener("click", (event) => openHistory(event.currentTarget));
    $("chat-recent-all").addEventListener("click", (event) => openHistory(event.currentTarget));
    $("activity-chats-all")?.addEventListener("click", (event) => openHistory(event.currentTarget));
    $("home-continue").addEventListener("click", () => {
      if (chats[0]) openChat(chats[0].id);
    });
  }

  // ---------- thread: day dividers, message tools, refine follow-ups ----------

  /** A divider element to insert before a message sent at `at`, when that starts a new day; otherwise null. */
  function daySeparator(at) {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
    const key = L.dayKey(at.getTime());
    if (key === lastDay) return null;
    lastDay = key;
    const sep = node("div", "day-sep");
    sep.setAttribute("role", "separator");
    sep.appendChild(node("span", null, L.dayLabel(at.getTime(), Date.now(), api.lang() === "hi" ? "hi-IN" : "en-IN")));
    return sep;
  }

  function threadReset() {
    lastDay = null;
    clearRefine();
    setThreadLoading(false);
    renderAll();
  }

  function setThreadLoading(on) {
    document.body.classList.toggle("chat-loading", on);
    let box = $("thread-loading");
    if (on && !box) {
      box = node("div", "thread-loading");
      box.id = "thread-loading";
      box.setAttribute("aria-hidden", "true");
      for (const side of ["user", "ai", "ai"]) box.appendChild(node("div", "skeleton-bubble is-" + side));
      $("conversation").after(box);
    }
    if (box) box.hidden = !on;
  }

  function toolButton(label, iconId, onClick) {
    const button = node("button", "bubble-tool");
    button.type = "button";
    button.append(icon(iconId), node("span", null, label));
    button.addEventListener("click", onClick);
    return button;
  }

  /** Copy and Edit under the user's own messages. Edit puts the text back in the box; sending it adds a new message. */
  function decorateBubble(bubble, role, text) {
    if (role !== "user" || !text) return;
    const tools = node("div", "bubble-tools");
    const copy = toolButton("Copy", "i-copy", async () => {
      try {
        await navigator.clipboard.writeText(text);
        api.toast("Copied");
      } catch {
        api.toast("Copy failed");
      }
    });
    const edit = toolButton("Edit", "i-edit", () => {
      api.fill(text);
      api.toast("Edit it, then send. This adds a new message.");
    });
    const remember = toolButton("Remember", "i-memory", () => void window.ZarvisWorkspace?.rememberDialog(text));
    tools.append(copy, edit, remember);
    // The user bubble lays out bottom-up (column-reverse): first in the DOM is lowest on screen.
    bubble.prepend(tools);
  }

  let refineRow = null;
  function clearRefine() {
    refineRow?.remove();
    refineRow = null;
  }

  /** One-tap follow-ups under the newest reply. They are ordinary messages about "your last answer". */
  function showRefine() {
    clearRefine();
    const thread = $("conversation");
    if (!thread || !thread.querySelector('.bubble.assistant:not(.thinking)')) return;
    refineRow = node("div", "refine-row");
    refineRow.setAttribute("role", "group");
    refineRow.setAttribute("aria-label", "Refine the answer");
    for (const action of L.refineActions(api.lang())) {
      const chip = node("button", "refine-chip", action.label);
      chip.type = "button";
      chip.addEventListener("click", () => {
        if (api.isBusy()) return;
        clearRefine();
        api.submit(action.prompt);
      });
      refineRow.appendChild(chip);
    }
    thread.appendChild(refineRow);
    api.scrollToNewest();
  }

  /** Called when a turn completes: the chat now exists on the server, so list it. */
  function afterTurn({ isFirstTurn }) {
    const id = api.conversationId();
    if (id) record(id, { title: isFirstTurn ? lastUserText : undefined });
    showRefine();
  }

  function noteUserMessage(text) {
    lastUserText = String(text || "");
    clearRefine();
  }

  // ---------- reading the open thread (export, copy) ----------

  function threadMessages() {
    const out = [];
    for (const bubble of $("conversation").querySelectorAll(".bubble.user, .bubble.assistant:not(.thinking)")) {
      const role = bubble.dataset.role;
      const body = bubble.querySelector(".bubble-body");
      const text = (role === "assistant" ? api.bubbleText(body) : body?.textContent || "").trim();
      if (!text) continue;
      const stamp = bubble.querySelector("time")?.dateTime;
      out.push({ role, text, time: stamp ? new Date(stamp).toLocaleString() : "" });
    }
    return out;
  }

  function downloadText(content, fileName, type) {
    const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportChat(format = "md") {
    const messages = threadMessages();
    if (!messages.length) {
      api.toast("Nothing to export yet");
      return;
    }
    const title = currentChat()?.title || L.deriveChatTitle(messages[0].text);
    const meta = { title, exportedAt: new Date().toLocaleString() };
    if (format === "txt") downloadText(L.chatToText(messages, meta), L.exportFileName(title, "txt"), "text/plain");
    else downloadText(L.chatToMarkdown(messages, meta), L.exportFileName(title, "md"), "text/markdown");
    api.toast("Chat saved");
  }

  async function copyChat() {
    const messages = threadMessages();
    if (!messages.length) {
      api.toast("Nothing to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(L.chatToText(messages, { title: currentChat()?.title }));
      api.toast("Chat copied");
    } catch {
      api.toast("Copy failed");
    }
  }

  async function copyChatLink() {
    const id = api.conversationId();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(location.origin + "/#/chat/" + id);
      api.toast("Link copied");
    } catch {
      api.toast("Copy failed");
    }
  }

  function openMoreMenu(anchor) {
    const items = [
      { label: "New chat", icon: "i-plus", hint: "Start a fresh conversation", run: () => api.newConversation() },
      { label: "Chat history", icon: "i-memory", hint: "Open an earlier chat", run: () => openHistory(anchor) },
    ];
    if (threadMessages().length) {
      items.push(
        { label: "Export as Markdown", icon: "i-download", hint: "Save this chat as a .md file", run: () => exportChat("md") },
        { label: "Export as text", icon: "i-file", hint: "Save this chat as a .txt file", run: () => exportChat("txt") },
        { label: "Copy conversation", icon: "i-copy", hint: "Copy every message", run: copyChat },
      );
    }
    if (api.conversationId()) {
      items.push({ label: "Copy link to this chat", icon: "i-link", hint: "Opens it when signed in to this account", run: copyChatLink });
    }
    items.push({ label: "Keyboard shortcuts", icon: "i-keyboard", hint: "Press ? anywhere", run: openShortcuts });
    window.ZarvisShell?.menu(anchor, "Chat", items);
  }

  // ---------- "/" command menu ----------

  let slashItems = [];
  let slashActive = 0;

  function slashOpen() {
    return !$("slash-menu").hidden;
  }

  function closeSlash() {
    const menu = $("slash-menu");
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
    slashItems = [];
  }

  function renderSlash() {
    const input = api.input;
    slashItems = L.matchSlashCommands(input.value);
    const menu = $("slash-menu");
    if (!slashItems.length) {
      closeSlash();
      return;
    }
    slashActive = 0;
    menu.replaceChildren();
    slashItems.forEach((command, index) => {
      const option = node("div", "slash-item");
      option.id = "slash-opt-" + index;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === 0));
      const ico = node("span", "slash-ico");
      ico.appendChild(icon(command.icon));
      const copy = node("span", "slash-copy");
      const name = node("strong", null, "/" + command.name);
      copy.append(name, node("small", null, command.label + " · " + command.hint));
      option.append(ico, copy);
      option.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus in the box
      option.addEventListener("click", () => runSlash(command));
      option.addEventListener("mousemove", () => setSlashActive(index));
      menu.appendChild(option);
    });
    menu.hidden = false;
  }

  function setSlashActive(index) {
    if (!slashItems.length || index === slashActive) return;
    slashActive = (index + slashItems.length) % slashItems.length;
    const options = $("slash-menu").children;
    for (let i = 0; i < options.length; i++) options[i].setAttribute("aria-selected", String(i === slashActive));
    options[slashActive]?.scrollIntoView({ block: "nearest" });
  }

  function runSlash(command) {
    closeSlash();
    if (command.kind === "prompt") {
      api.fill(command.prompt);
      return;
    }
    api.input.value = "";
    api.resizeInput();
    saveDraft();
    if (command.action === "attach") api.pickFile();
    else if (command.action === "voice") api.startListening();
    else if (command.action === "new") api.newConversation();
    else if (command.action === "history") openHistory(api.input);
    else if (command.action === "export") exportChat("md");
    else if (command.action === "shortcuts") openShortcuts();
  }

  function setupSlash() {
    const input = api.input;
    input.addEventListener("input", () => {
      renderSlash();
      scheduleDraft();
    });
    input.addEventListener("blur", () => setTimeout(closeSlash, 120));
    // Capture on the document so the menu sees Enter/Tab/arrows before the box's own "Enter sends".
    document.addEventListener("keydown", (event) => {
      if (event.target !== input || !slashOpen() || event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setSlashActive(slashActive + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        runSlash(slashItems[slashActive]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSlash();
      }
    }, true);
  }

  // ---------- drafts ----------

  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    const text = api.input.value;
    if (text.trim()) store("set", KEYS.draft, text);
    else store("remove", KEYS.draft);
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 300);
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    store("remove", KEYS.draft);
    closeSlash();
  }

  function restoreDraft() {
    const draft = store("get", KEYS.draft);
    if (draft && !api.input.value) {
      api.input.value = draft;
      api.resizeInput();
    }
  }

  // ---------- files: drag-and-drop anywhere, paste into the box ----------

  function setupFiles() {
    const overlay = $("drop-overlay");
    let depth = 0;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    document.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      depth += 1;
      overlay.hidden = false;
    });
    document.addEventListener("dragover", (event) => {
      if (hasFiles(event)) event.preventDefault(); // without this the browser would open the file instead
    });
    document.addEventListener("dragleave", (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    document.addEventListener("drop", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const files = Array.from(event.dataTransfer.files || []);
      // On the Files page a dropped file goes to Files; everywhere else it is attached to the chat.
      if (files.length && window.ZarvisWorkspace?.handleDrop?.(files)) return;
      if (files[0]) api.attachFile(files[0]);
    });
    api.input.addEventListener("paste", (event) => {
      const file = Array.from(event.clipboardData?.files || [])[0];
      // Text copied from Word or a spreadsheet also carries a picture of itself: when there is text, paste the text.
      if (!file || event.clipboardData.getData("text/plain")) return;
      event.preventDefault();
      api.attachFile(file);
    });
  }

  // ---------- keyboard shortcuts ----------

  function openShortcuts() {
    $("shortcuts-modal").hidden = false;
    $("shortcuts-close").focus({ preventScroll: true });
  }

  function closeShortcuts() {
    const modal = $("shortcuts-modal");
    if (modal.hidden) return;
    modal.hidden = true;
  }

  function setupShortcuts() {
    const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
    for (const key of document.querySelectorAll(".kbd-mod")) key.textContent = apple ? "⌘" : "Ctrl";
    $("shortcuts-close").addEventListener("click", closeShortcuts);
    $("shortcuts-modal").addEventListener("mousedown", (event) => {
      if (event.target === $("shortcuts-modal")) closeShortcuts();
    });
    for (const button of document.querySelectorAll("[data-open-shortcuts]")) button.addEventListener("click", openShortcuts);

    let goPending = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        // Something above (a confirmation opened from the history panel, the slash menu) already used this Escape.
        if (event.defaultPrevented) return;
        if (!$("shortcuts-modal").hidden) closeShortcuts();
        else if (!$("history-overlay").hidden) closeHistory();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (isTyping(event.target) || overlayOpen()) return;
      const key = event.key;
      if (goPending && Date.now() < goPending) {
        goPending = 0;
        const target = L.goShortcutTarget(key);
        if (target) {
          event.preventDefault();
          api.setActiveView(target);
        }
        return;
      }
      if (key === "/") {
        event.preventDefault();
        api.setActiveView("chat");
        api.input.focus();
      } else if (key === "?") {
        event.preventDefault();
        openShortcuts();
      } else if (key === "g" || key === "G") {
        goPending = Date.now() + 1200;
      } else if (key === "n" || key === "N") {
        event.preventDefault();
        api.newConversation();
      } else if (key === "h" || key === "H") {
        event.preventDefault();
        openHistory(document.activeElement);
      }
    });
  }

  // ---------- breadcrumbs ----------

  function updateCrumbs(context) {
    const nav = $("crumbs");
    const list = $("crumbs-list");
    if (!nav || !list) return;
    const trail = context.view === "chat" ? [] : L.breadcrumbs(context);
    nav.hidden = trail.length < 2;
    nav.toggleAttribute("data-own-back", !!context.settingsTitle || context.view === "feature");
    list.replaceChildren();
    trail.forEach((crumb, index) => {
      const item = node("li");
      if (crumb.view) {
        const button = node("button", "crumb", crumb.label);
        button.type = "button";
        button.addEventListener("click", () => {
          if (crumb.closeSubpage) api.closeSubpage();
          else api.setActiveView(crumb.view);
        });
        item.appendChild(button);
      } else {
        const current = node("span", "crumb crumb-current", crumb.label);
        current.setAttribute("aria-current", "page");
        item.appendChild(current);
      }
      if (index < trail.length - 1) {
        const sep = icon("i-right");
        sep.classList.add("crumb-sep");
        item.appendChild(sep);
      }
      list.appendChild(item);
    });
  }

  // ---------- scroll: to top, and each page keeps its place ----------

  const scrollMemory = new Map();
  function rememberScroll(view) {
    if (view) scrollMemory.set(view, window.scrollY);
  }

  /** Where a page should start: where it was left when reached by Back/Forward, otherwise the top. */
  function scrollTargetFor(view, viaHistory) {
    return viaHistory && view !== "chat" && scrollMemory.has(view) ? scrollMemory.get(view) : 0;
  }

  function setupScrollTop() {
    const button = $("scroll-top");
    const update = () => {
      button.hidden = !(window.scrollY > 700 && !["chat", "home"].includes(api.activeView()));
    };
    window.addEventListener("scroll", update, { passive: true });
    button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" }));
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ["data-active-view"] });
  }

  // ---------- sidebar rail, chat text size, skip link ----------

  function applyRail(on) {
    document.body.classList.toggle("sidebar-rail", on);
    const button = $("sidebar-collapse");
    button.setAttribute("aria-pressed", String(on));
    const label = on ? "Expand sidebar" : "Collapse sidebar";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.querySelector("span").textContent = on ? "Expand" : "Collapse";
  }

  function setupSidebar() {
    applyRail(store("get", KEYS.rail) === "on");
    $("sidebar-collapse").addEventListener("click", () => {
      const on = !document.body.classList.contains("sidebar-rail");
      applyRail(on);
      store("set", KEYS.rail, on ? "on" : "off");
    });
    $("skip-link").addEventListener("click", () => {
      const main = $("main-views");
      main.focus({ preventScroll: true });
      main.scrollIntoView({ block: "start" });
    });
  }

  function applyTextSize(size) {
    const value = ["sm", "md", "lg"].includes(size) ? size : "md";
    document.documentElement.dataset.chatText = value;
    for (const seg of document.querySelectorAll("#chat-text-size [data-size]")) {
      const active = seg.dataset.size === value;
      seg.classList.toggle("active", active);
      seg.setAttribute("aria-pressed", String(active));
    }
  }

  function setupTextSize() {
    applyTextSize(store("get", KEYS.textSize));
    $("chat-text-size").addEventListener("click", (event) => {
      const seg = event.target.closest("[data-size]");
      if (!seg) return;
      applyTextSize(seg.dataset.size);
      store("set", KEYS.textSize, seg.dataset.size);
    });
  }

  // ---------- tab title while ZARVIS is working ----------

  const BUSY_MARK = "● ";
  function decorateTitle(title) {
    return busy ? BUSY_MARK + title : title;
  }

  function setBusy(on) {
    if (on === busy) return;
    busy = on;
    document.title = decorateTitle(document.title.replace(BUSY_MARK, ""));
  }

  // ---------- command palette extras ----------

  function paletteItems() {
    const items = chats.slice(0, 8).map((chat) => ({
      group: "Chats", label: chat.title, hint: relative(chat.updatedAt), icon: "i-chat", run: () => openChat(chat.id),
    }));
    items.push(
      { group: "Actions", label: "Chat history", hint: "Open an earlier chat", icon: "i-memory", run: () => openHistory(null) },
      { group: "Actions", label: "Keyboard shortcuts", hint: "Every shortcut in one list", icon: "i-keyboard", run: openShortcuts },
    );
    if (threadMessages().length) items.push({ group: "Actions", label: "Export this chat", hint: "Save it as a Markdown file", icon: "i-download", run: () => exportChat("md") });
    return items;
  }

  // ---------- start-up ----------

  function init(hooks) {
    api = hooks;
    loadChats();
    const parts = [
      ["history", setupHistory],
      ["slash menu", setupSlash],
      ["files", setupFiles],
      ["shortcuts", setupShortcuts],
      ["scroll", setupScrollTop],
      ["sidebar", setupSidebar],
      ["text size", setupTextSize],
    ];
    // One part failing must never take the others (or the rest of the app) down with it.
    for (const [name, setup] of parts) {
      try {
        setup();
      } catch (err) {
        console.error("Zarvis chat kit failed to start (" + name + "):", err);
      }
    }
    $("chat-more-btn")?.addEventListener("click", (event) => openMoreMenu(event.currentTarget));
    restoreDraft();
    renderAll();
  }

  window.ZarvisChatKit = {
    init,
    record,
    remove: removeFromList,
    sync,
    forgetAll,
    renderAll,
    daySeparator,
    threadReset,
    setThreadLoading,
    decorateBubble,
    afterTurn,
    noteUserMessage,
    pendingTitle: () => lastUserText,
    clearRefine,
    clearDraft,
    updateCrumbs,
    rememberScroll,
    scrollTargetFor,
    decorateTitle,
    setBusy,
    paletteItems,
    syncActivityChats,
    openHistory,
    list: () => chats.slice(),
  };
})();
