/* ZARVIS MOBILE — app shell: global search (command palette), notifications and profile menu.
   Every entry maps onto something the app really does (pages, capabilities, settings pages,
   session activity, appearance, install). app.js hands in the few hooks it needs through
   ZarvisShell.init(api); nothing here talks to the backend. */
(() => {
  "use strict";

  let api = null;
  let installPrompt = null;
  let paletteEl = null;
  let popoverEl = null;
  let popoverAnchor = null;
  let lastFocus = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; });

  function icon(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
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

  function relative(date) {
    const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    return hrs < 24 ? hrs + "h ago" : new Date(date).toLocaleDateString();
  }

  /* ---------- Search / command palette ---------- */

  const PAGES = [
    ["home", "Home", "i-home"], ["chat", "Chat", "i-chat"], ["capabilities", "Capabilities", "i-grid"],
    ["tasks", "Tasks", "i-task"], ["activity", "Activity", "i-activity"], ["developer", "Developer Agent", "i-code"],
    ["metrics", "Usage & Metrics", "i-chart"], ["plans", "Plans", "i-plan"], ["settings", "Settings", "i-settings"],
  ];

  function buildItems() {
    const items = [];
    for (const [view, label, ico] of PAGES) {
      if ((view === "developer" || view === "metrics") && !api.devAccess()) continue;
      items.push({ group: "Pages", label, hint: "Go to " + label, icon: ico, run: () => api.setActiveView(view) });
    }
    items.push({ group: "Actions", label: "New chat", hint: "Start a fresh conversation", icon: "i-plus", run: () => { api.setActiveView("chat"); api.newConversation(); } });
    items.push({ group: "Actions", label: "Speak to ZARVIS", hint: "Start voice input", icon: "i-mic", run: () => { api.setActiveView("chat"); api.startListening(); } });
    items.push({ group: "Actions", label: "Attach a file", hint: "Summarize a document or ask about an image", icon: "i-attach", run: () => { api.setActiveView("chat"); api.pickFile(); } });
    items.push({ group: "Actions", label: api.getAppearance() === "dim" ? "Switch to Light appearance" : "Switch to Dark appearance", hint: "Appearance", icon: "i-palette", run: () => api.setAppearance(api.getAppearance() === "dim" ? "aurora" : "dim") });
    if (installPrompt) items.push({ group: "Actions", label: "Install ZARVIS", hint: "Add to your home screen", icon: "i-download", run: installApp });

    const features = window.ZarvisFeatures;
    for (const group of features?.groups || []) {
      if (group.title === "Developer" && !api.devAccess()) continue;
      for (const item of group.items) {
        items.push({
          group: "Capabilities", label: item.name, hint: item.short || item.desc, icon: item.icon, keywords: item.desc,
          run: () => openCapability(item.name),
        });
      }
    }
    for (const row of document.querySelectorAll("[data-settings-page]")) {
      const label = row.dataset.settingsLabel || row.querySelector("strong")?.textContent || row.dataset.settingsPage;
      items.push({
        group: "Settings", label, hint: row.querySelector("small")?.textContent || "", icon: "i-settings",
        run: () => { api.setActiveView("settings"); api.openSettingsPage(row.dataset.settingsPage); },
      });
    }
    items.push(...(api.extraItems?.() || []));
    for (const entry of (api.getActivity() || []).slice(0, 12)) {
      items.push({ group: "Recent activity", label: entry.title || "Activity", hint: relative(entry.at), icon: "i-activity", run: () => api.setActiveView("activity") });
    }
    return items;
  }

  function openCapability(name) {
    api.setActiveView("capabilities");
    const card = [...document.querySelectorAll("#capability-hub .cap-item")].find((c) => c.querySelector(".cap-name span")?.textContent === name);
    const target = card?.querySelector(".cap-copy[data-cap-action]") || card?.querySelector(".cap-action");
    target?.click();
  }

  async function installApp() {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    await prompt.userChoice.catch(() => {});
  }

  function score(item, q) {
    if (!q) return item.group === "Pages" ? 2 : item.group === "Actions" ? 1 : 0;
    const label = item.label.toLowerCase();
    if (label === q) return 100;
    if (label.startsWith(q)) return 80;
    if (label.includes(q)) return 60;
    if ((item.hint || "").toLowerCase().includes(q)) return 30;
    if ((item.keywords || "").toLowerCase().includes(q)) return 20;
    return -1;
  }

  function openPalette() {
    closePopover();
    if (!paletteEl) {
      paletteEl = node("div", "palette-overlay");
      paletteEl.hidden = true;
      paletteEl.innerHTML =
        '<div class="palette" role="dialog" aria-modal="true" aria-label="Search ZARVIS">' +
        '<div class="palette-input"><svg class="ico" aria-hidden="true"><use href="#i-search"/></svg>' +
        '<input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search pages, features, settings and activity…" />' +
        '<button type="button" class="palette-close" aria-label="Close search">Esc</button></div>' +
        '<ul id="palette-list" role="listbox" aria-label="Results"></ul>' +
        '<p class="palette-hint"><span>↑↓ to move</span><span>Enter to open</span><span>Ctrl/⌘ K anywhere</span></p></div>';
      document.body.appendChild(paletteEl);
      paletteEl.addEventListener("mousedown", (e) => { if (e.target === paletteEl) closePalette(); });
      paletteEl.querySelector(".palette-close").addEventListener("click", closePalette);
      paletteEl.querySelector("input").addEventListener("input", renderResults);
      paletteEl.querySelector("input").addEventListener("keydown", onPaletteKey);
    }
    lastFocus = document.activeElement;
    paletteEl.hidden = false;
    document.body.classList.add("palette-open");
    const input = paletteEl.querySelector("input");
    input.value = "";
    renderResults();
    input.focus();
  }

  function closePalette() {
    if (!paletteEl || paletteEl.hidden) return;
    paletteEl.hidden = true;
    document.body.classList.remove("palette-open");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.();
  }

  let results = [];
  let active = 0;

  function renderResults() {
    const q = paletteEl.querySelector("input").value.trim().toLowerCase();
    const list = paletteEl.querySelector("#palette-list");
    const scored = buildItems().map((item) => ({ item, s: score(item, q) })).filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s).slice(0, q ? 30 : 14);
    // Keep each group together, ordered by its best match.
    const groups = new Map();
    for (const r of scored) {
      if (!groups.has(r.item.group)) groups.set(r.item.group, []);
      groups.get(r.item.group).push(r.item);
    }
    results = [...groups.values()].flat();
    active = 0;
    list.replaceChildren();
    if (!results.length) {
      list.appendChild(node("li", "palette-empty", "No matches. Try a feature, page or setting name."));
      return;
    }
    let group = "";
    results.forEach((item, index) => {
      if (item.group !== group) {
        group = item.group;
        const head = node("li", "palette-group", group);
        head.setAttribute("role", "presentation");
        list.appendChild(head);
      }
      const li = node("li", "palette-item");
      li.id = "palette-opt-" + index;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === 0));
      const ico = node("span", "palette-ico");
      ico.appendChild(icon(item.icon || "i-sparkle"));
      const copy = node("span", "palette-copy");
      copy.append(node("strong", null, item.label), node("small", null, item.hint || ""));
      li.append(ico, copy);
      li.addEventListener("mousemove", () => setActive(index));
      li.addEventListener("click", () => choose(index));
      list.appendChild(li);
    });
    paletteEl.querySelector("input").setAttribute("aria-activedescendant", "palette-opt-0");
  }

  function setActive(index) {
    if (index === active || !results.length) return;
    active = (index + results.length) % results.length;
    const items = paletteEl.querySelectorAll(".palette-item");
    items.forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    items[active]?.scrollIntoView({ block: "nearest" });
    paletteEl.querySelector("input").setAttribute("aria-activedescendant", "palette-opt-" + active);
  }

  function choose(index) {
    const item = results[index];
    if (!item) return;
    closePalette();
    item.run();
  }

  function onPaletteKey(event) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(active + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(active - 1); }
    else if (event.key === "Enter") { event.preventDefault(); choose(active); }
    else if (event.key === "Escape") { event.preventDefault(); closePalette(); }
    else if (event.key === "Tab") { event.preventDefault(); }
  }

  /* ---------- Popovers: notifications and profile ---------- */

  function closePopover() {
    if (!popoverEl || popoverEl.hidden) return;
    popoverEl.hidden = true;
    popoverAnchor?.setAttribute("aria-expanded", "false");
    popoverAnchor?.focus?.();
    popoverAnchor = null;
  }

  function showPopover(anchor, title, build) {
    if (popoverEl && !popoverEl.hidden && popoverAnchor === anchor) { closePopover(); return; }
    closePalette();
    if (!popoverEl) {
      popoverEl = node("div", "shell-popover");
      popoverEl.hidden = true;
      popoverEl.setAttribute("role", "dialog");
      document.body.appendChild(popoverEl);
      document.addEventListener("mousedown", (e) => {
        if (popoverEl.hidden || popoverEl.contains(e.target) || popoverAnchor?.contains(e.target)) return;
        popoverEl.hidden = true;
        popoverAnchor?.setAttribute("aria-expanded", "false");
        popoverAnchor = null;
      });
      popoverEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.stopPropagation(); closePopover(); }
      });
    }
    popoverEl.replaceChildren();
    popoverEl.setAttribute("aria-label", title);
    popoverEl.appendChild(node("p", "popover-title", title));
    build(popoverEl);
    popoverEl.hidden = false;
    popoverAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    popoverEl.style.width = width + "px";
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    popoverEl.style.left = left + "px";
    popoverEl.style.top = Math.round(rect.bottom + 8) + "px";
    popoverEl.querySelector("button")?.focus();
  }

  function menuButton(label, ico, hint, onClick) {
    const b = node("button", "popover-item");
    b.type = "button";
    const i = node("span", "popover-ico");
    i.appendChild(icon(ico));
    const copy = node("span", "popover-copy");
    copy.appendChild(node("strong", null, label));
    if (hint) copy.appendChild(node("small", null, hint));
    b.append(i, copy);
    b.addEventListener("click", () => { closePopover(); onClick(); });
    return b;
  }

  function openNotifications(anchor) {
    showPopover(anchor, "Notifications", (root) => {
      const entries = (api.getActivity() || []).slice(0, 6);
      if (!entries.length) {
        root.appendChild(node("p", "popover-empty", "You're all caught up. New conversations, files and tasks show up here."));
      } else {
        for (const entry of entries) {
          root.appendChild(menuButton(entry.title || "Activity", "i-activity", relative(entry.at), () => api.setActiveView("activity")));
        }
      }
      root.appendChild(menuButton("Open Activity", "i-right", "All conversations and tasks", () => api.setActiveView("activity")));
    });
  }

  function openProfile(anchor) {
    showPopover(anchor, "Account", (root) => {
      const who = api.account();
      const head = node("div", "popover-account");
      head.appendChild(node("strong", null, who.name || (who.guest ? "Guest account" : "Signed in")));
      head.appendChild(node("small", null, who.email || (who.guest ? "Link an email in Profile to keep this account on other devices." : "")));
      root.appendChild(head);
      root.appendChild(menuButton("Profile & account", "i-user", "Email link and sign in", () => { api.setActiveView("settings"); api.openSettingsPage("account"); }));
      root.appendChild(menuButton("Plans & credits", "i-plan", "Your plan and usage", () => api.setActiveView("plans")));
      if (api.devAccess()) root.appendChild(menuButton("Developer Agent", "i-code", "Analyze a repository", () => api.setActiveView("developer")));
      root.appendChild(menuButton("Settings", "i-settings", "Voice, language, privacy", () => api.setActiveView("settings")));
      const dark = api.getAppearance() === "dim";
      root.appendChild(menuButton(dark ? "Switch to Light" : "Switch to Dark", "i-palette", "Appearance", () => api.setAppearance(dark ? "aurora" : "dim")));
      if (installPrompt) root.appendChild(menuButton("Install ZARVIS", "i-download", "Add to your home screen", installApp));
    });
  }

  /* ---------- Wiring ---------- */

  function init(hooks) {
    api = hooks;
    // The shortcut hint matches the platform (⌘ K on Apple devices, Ctrl K elsewhere).
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "")) {
      for (const hint of document.querySelectorAll(".kbd-hint")) hint.textContent = "⌘ K";
    }
    for (const btn of document.querySelectorAll("[data-shell=search]")) btn.addEventListener("click", openPalette);
    for (const btn of document.querySelectorAll("[data-shell=notifications]")) {
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", () => openNotifications(btn));
    }
    for (const btn of document.querySelectorAll("[data-shell=profile]")) {
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.addEventListener("click", () => openProfile(btn));
    }
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteEl && !paletteEl.hidden) closePalette(); else openPalette();
      } else if (event.key === "Escape") {
        closePalette();
        closePopover();
      }
    });
    window.addEventListener("resize", () => { if (popoverEl && !popoverEl.hidden) closePopover(); });
  }

  /** Small action menu for any button (used by Activity rows). items: [{label, icon, hint, run}] */
  function menu(anchor, title, items) {
    showPopover(anchor, title, (root) => {
      for (const item of items) root.appendChild(menuButton(item.label, item.icon, item.hint, item.run));
    });
  }

  window.ZarvisShell = { init, menu };
})();
