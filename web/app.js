/**
 * ZARVIS MOBILE web client — a thin browser client over the same backend API the Android
 * app calls (MASTER_SPEC.md §25 "API Boundaries"). No framework/build step: this is
 * deliberately plain HTML/CSS/JS so the whole product can be demoed by opening a URL,
 * mirroring the zero-credential/zero-setup spirit of the backend's MockAIProvider default
 * (AI_ARCHITECTURE.md). See MASTER_SPEC.md §12a "Web Client Architecture".
 *
 * Session model mirrors the Android app's guest bootstrap (MASTER_SPEC.md §32, "No login
 * screen yet"): on first load this creates a device-scoped backend account automatically
 * (POST /api/v1/auth/signup with a generated, unguessable email) rather than showing a
 * signup form, so a first-time visitor can start talking to ZARVIS immediately.
 */
(() => {
  "use strict";

  const STORAGE_KEYS = {
    accessToken: "zarvis.accessToken",
    refreshToken: "zarvis.refreshToken",
    lang: "zarvis.lang",
    speak: "zarvis.speak",
    voiceURI: "zarvis.voiceURI",
    userName: "zarvis.userName",
  };

  const API_BASE = resolveApiBase();

  // Sent with every orchestrator turn so replies can address the user by name (see
  // backend/src/agents/orchestrator.ts's TurnRequest.userName) — just a display label the
  // model uses, never an identity/auth claim; the account itself is authenticated by the
  // bearer token regardless of what this says. Defaults to the product owner's own name
  // for this single-account deployment; editable later by writing localStorage directly
  // (no settings screen yet — see MASTER_SPEC.md §32 "No login screen yet").
  if (!localStorage.getItem(STORAGE_KEYS.userName)) {
    localStorage.setItem(STORAGE_KEYS.userName, "Jitendra Kumar");
  }

  const COPY = {
    en: {
      greeting: "Hey, I'm Zarvis. 👋",
      hero: "Think it. Ask it. Get it done.",
      subtitle: "Your intelligent AI assistant for conversations, ideas, research, writing, and everyday tasks.",
      quickActionsLead: "Ask anything. Start anywhere.",
      placeholder: "Ask Zarvis…",
      send: "Send",
      stop: "Stop",
      mic: "Speak",
      uploadTitle: "Attach a document",
      thinking: "Thinking…",
      retry: "Retry",
      // Deliberately generic and non-technical — shown for every connection/server failure
      // regardless of the underlying cause (network down, backend cold start, a platform
      // error page), so a raw status code or platform failure text is never what the user
      // sees. The real error is only ever logged via console.error, never rendered here.
      bootError: { title: "Zarvis can't connect right now.", subtitle: "Please try again in a moment." },
      unsupportedFile: {
        title: "Can't read this file type yet.",
        subtitle: "Zarvis can analyze images, .txt, .md, .csv, .json, .pdf, and .docx files. Try one of those, or paste the text directly.",
      },
      unreadableFile: { title: "Zarvis couldn't read this document.", subtitle: "Please try another file." },
      emptyFile: { title: "That file looks empty.", subtitle: "Try a different file or paste the text directly." },
      oversizedFile: {
        title: "That file is too long to send in one go.",
        subtitle: "Try a shorter excerpt or paste the most relevant part directly.",
      },
      extracting: "Reading document…",
      attachmentReady: "Ready to analyze",
      attachmentRemove: "Remove attachment",
      stateLabels: {
        IDLE: "Ready",
        LISTENING: "Listening",
        UNDERSTANDING: "Understanding",
        PLANNING: "Understanding",
        EXECUTING: "Working",
        SUCCESS: "Done",
        SPEAKING: "Speaking",
        ERROR: "Something went wrong",
      },
      quickActions: {
        ask: "Ask anything",
        write: "Write",
        research: "Research",
        code: "Code",
        analyze: "Analyze",
        plan: "Plan",
        create: "Create",
      },
    },
    hi: {
      greeting: "नमस्ते, मैं Zarvis हूँ। 👋",
      hero: "सोचें। पूछें। हो जाए।",
      subtitle: "बातचीत, विचार, रिसर्च, लेखन और रोज़मर्रा के कामों के लिए आपका बुद्धिमान AI असिस्टेंट।",
      quickActionsLead: "कुछ भी पूछें। कहीं से भी शुरू करें।",
      placeholder: "Zarvis से पूछें…",
      send: "भेजें",
      stop: "रोकें",
      mic: "बोलें",
      uploadTitle: "डॉक्यूमेंट अटैच करें",
      thinking: "सोच रहा हूँ…",
      retry: "फिर कोशिश करें",
      bootError: { title: "Zarvis से अभी कनेक्शन नहीं हो पा रहा है।", subtitle: "कृपया थोड़ी देर बाद फिर कोशिश करें।" },
      unsupportedFile: {
        title: "यह फ़ाइल प्रकार अभी पढ़ा नहीं जा सकता।",
        subtitle: "Zarvis इमेज, .txt, .md, .csv, .json, .pdf और .docx फ़ाइलें analyze कर सकता है। इनमें से कोई आज़माएं, या टेक्स्ट सीधे पेस्ट करें।",
      },
      unreadableFile: { title: "Zarvis इस डॉक्यूमेंट को पढ़ नहीं सका।", subtitle: "कृपया कोई दूसरी फ़ाइल आज़माएं।" },
      emptyFile: { title: "यह फ़ाइल खाली लग रही है।", subtitle: "कोई दूसरी फ़ाइल आज़माएं या टेक्स्ट सीधे पेस्ट करें।" },
      oversizedFile: {
        title: "यह फ़ाइल एक बार में भेजने के लिए बहुत बड़ी है।",
        subtitle: "छोटा हिस्सा आज़माएं या सबसे ज़रूरी टेक्स्ट सीधे पेस्ट करें।",
      },
      extracting: "डॉक्यूमेंट पढ़ा जा रहा है…",
      attachmentReady: "विश्लेषण के लिए तैयार",
      attachmentRemove: "अटैचमेंट हटाएं",
      stateLabels: {
        IDLE: "तैयार",
        LISTENING: "सुन रहा हूँ",
        UNDERSTANDING: "समझ रहा हूँ",
        PLANNING: "समझ रहा हूँ",
        EXECUTING: "काम कर रहा हूँ",
        SUCCESS: "पूरा हुआ",
        SPEAKING: "बोल रहा हूँ",
        ERROR: "समस्या हुई",
      },
      quickActions: {
        ask: "कुछ भी पूछें",
        write: "लिखें",
        research: "रिसर्च",
        code: "कोड",
        analyze: "एनालाइज़",
        plan: "प्लान",
        create: "बनाएं",
      },
    },
  };

  // Best-effort tactile feedback on Android (Chrome/WebView expose `navigator.vibrate`;
  // desktop browsers and iOS Safari don't — silently a no-op there, never worth surfacing
  // an error for).
  function haptic(ms = 10) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch {
      /* unsupported — ignore */
    }
  }

  const el = {
    orb: document.getElementById("orb"),
    heroGreeting: document.getElementById("hero-greeting"),
    heroTitle: document.getElementById("hero-title"),
    heroSubtitle: document.getElementById("hero-subtitle"),
    quickActionsLead: document.getElementById("quick-actions-lead"),
    heroStatus: document.getElementById("hero-status"),
    heroStatusLabel: document.getElementById("hero-status-label"),
    conversation: document.getElementById("conversation"),
    categories: document.getElementById("categories"),
    input: document.getElementById("text-input"),
    sendBtn: document.getElementById("send-btn"),
    sendLabel: document.querySelector("#send-btn .send-label"),
    micBtn: document.getElementById("mic-btn"),
    uploadBtn: document.getElementById("upload-btn"),
    fileInput: document.getElementById("file-input"),
    attachmentChip: document.getElementById("attachment-chip"),
    attachmentName: document.getElementById("attachment-name"),
    attachmentStatus: document.getElementById("attachment-status"),
    attachmentRemoveBtn: document.getElementById("attachment-remove"),
    voiceSelect: document.getElementById("voice-select"),
    composer: document.getElementById("composer"),
    navItems: Array.from(document.querySelectorAll(".nav-item")),
    // Two badges (bottom-nav + desktop sidebar) share one dot of state — see fetchTasks().
    metricsBadges: Array.from(document.querySelectorAll(".nav-badge")),
    viewWorkspace: document.getElementById("view-workspace"),
    viewCapabilities: document.getElementById("view-capabilities"),
    viewPlans: document.getElementById("view-plans"),
    viewMetrics: document.getElementById("view-metrics"),
    viewDeveloper: document.getElementById("view-developer"),
    viewSettings: document.getElementById("view-settings"),
    capabilitiesList: document.getElementById("capabilities-list"),
    plansCurrent: document.getElementById("plans-current"),
    billingToggle: document.getElementById("billing-toggle"),
    planCards: document.getElementById("plan-cards"),
    metricsHealthGrid: document.getElementById("metrics-health-grid"),
    latencyStats: document.getElementById("latency-stats"),
    latencyLog: document.getElementById("latency-log"),
    taskList: document.getElementById("task-list"),
    settingsBtn: document.getElementById("settings-btn"),
    settingsBackBtn: document.getElementById("settings-back-btn"),
    settingsLangOptions: document.getElementById("settings-lang-options"),
    settingsVoiceToggle: document.getElementById("settings-voice-toggle"),
    settingsDeleteBtn: document.getElementById("settings-delete-btn"),
    settingsDeleteError: document.getElementById("settings-delete-error"),
    settingsClearSessionBtn: document.getElementById("settings-clear-session-btn"),
    developerEntryLink: document.getElementById("developer-entry-link"),
    developerBackBtn: document.getElementById("developer-back-btn"),
    developerRepoInput: document.getElementById("developer-repo-input"),
    developerAnalyzeBtn: document.getElementById("developer-analyze-btn"),
    developerResult: document.getElementById("developer-result"),
    confirmModal: document.getElementById("confirm-modal"),
    confirmModalTitle: document.getElementById("confirm-modal-title"),
    confirmModalBody: document.getElementById("confirm-modal-body"),
    confirmModalCancel: document.getElementById("confirm-modal-cancel"),
    confirmModalConfirm: document.getElementById("confirm-modal-confirm"),
  };

  const state = {
    lang: localStorage.getItem(STORAGE_KEYS.lang) || "en",
    // Off by default in the browser — spoken replies (and the mic, below) only ever turn on
    // from an explicit tap (the orb, the composer mic button, or this Settings toggle), never
    // automatically on load.
    speak: localStorage.getItem(STORAGE_KEYS.speak) === "on",
    // Which of the 4 bottom-nav views is currently showing — see setActiveView().
    activeView: "workspace",
    // The live skill catalogue, fetched once and reused by both the Workspace category
    // chips and the full Capabilities Hub cards, instead of fetching /skills twice.
    skills: [],
    billing: "monthly",
    // True only for the very first turn of a session — lets the system prompt ask Gemini
    // for a warmer, more "attractive" welcome-style reply once, without every later message
    // paying that same introductory tax.
    firstTurn: true,
    // A successfully-read/extracted document waiting to be asked about — { filename, text }
    // or null. Set by handleFileSelected() once text is available (immediately for a local
    // text file, after a server round trip for PDF/DOCX — see documents/extractText.ts),
    // shown as the "📄 filename / Ready to analyze" chip, and consumed (cleared) the moment
    // it rides along with the next submitted turn (submitComposerInput()).
    pendingAttachment: null,
    // Bounded client-side conversation context for natural follow-up questions.
    history: [],
  };

  // Declared here (not near their setup functions below) because init() runs synchronously
  // up to its first `await` and calls those setup functions immediately — a `let` declared
  // later in this same scope would still be in its temporal dead zone at that point,
  // throwing "Cannot access '...' before initialization".
  let recognition = null;
  let cachedVoices = [];
  // Real, client-measured latency of every orchestrator turn this session (recordLatency(),
  // called from submitUtterance() around the actual /orchestrator/turn fetch) — feeds the
  // System Metrics tab. In-memory only, capped, never persisted or fabricated.
  let latencyEntries = [];

  init().catch((err) => {
    // The technical detail (network failure, a platform error page, whatever) is only ever
    // logged here — never rendered into the UI. addErrorBubble always shows the same
    // friendly, translated connection message regardless of cause.
    console.error(err);
    addErrorBubble(COPY[state.lang].bootError, () => location.reload());
    setOrbState("ERROR");
  });

  async function init() {
    // Wire the core composer controls first. These must remain usable even if an optional
    // startup subsystem (voice, settings, plans, or service-worker registration) fails.
    el.sendBtn.addEventListener("click", () => {
      haptic();
      if (isBusy() && !el.input.value.trim() && !state.pendingAttachment) cancelCurrentTurn();
      else submitComposerInput(el.input.value);
    });
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitComposerInput(el.input.value);
      if (e.key === "Escape" && isBusy()) cancelCurrentTurn();
    });
    el.fileInput.addEventListener("change", handleFileSelected);
    el.attachmentRemoveBtn.addEventListener("click", () => {
      haptic();
      clearPendingAttachment();
    });

    // Secondary UI initialization follows the core controls so one non-critical setup error
    // cannot make the Send/attachment controls appear dead.
    try {
      setupSpeechSynthesis();
      applyLanguage();
      applyVoiceToggleState();
      setupSpeechRecognition();
      registerServiceWorker();
      setupBottomNav();
      setupPlans();
      setupSettings();
      setupDeveloper();
    } catch (err) {
      console.error("Optional UI initialization failed:", err);
    }

    try {
      await ensureSession();
      await Promise.all([loadSkills(), fetchTasks()]);
    } catch (err) {
      console.error("Zarvis startup data failed:", err);
      addErrorBubble(COPY[state.lang].bootError, () => location.reload());
      setOrbState("ERROR");
      return;
    }

    setOrbState("IDLE");
    // No auto-arm: voice input only ever starts from an explicit mic/orb press.
  }

  function resolveApiBase() {
    const params = new URLSearchParams(location.search);
    const override = params.get("api");
    if (override) return override.replace(/\/$/, "");
    return `${location.origin}/api/v1`;
  }

  function applyLanguage() {
    const copy = COPY[state.lang];
    el.heroGreeting.textContent = copy.greeting;
    el.heroTitle.textContent = copy.hero;
    el.heroSubtitle.textContent = copy.subtitle;
    el.quickActionsLead.textContent = copy.quickActionsLead;
    el.input.placeholder = copy.placeholder;
    // Set only the label span's text, not the whole button — sendBtn also contains an SVG
    // icon that el.sendBtn.textContent = ... would silently wipe out.
    el.sendLabel.textContent = copy.send;
    el.micBtn.title = copy.mic;
    if (el.uploadBtn.getAttribute("aria-disabled") !== "true") el.uploadBtn.title = copy.uploadTitle; // don't clobber "Reading document…"
    if (state.pendingAttachment) el.attachmentStatus.textContent = copy.attachmentReady;
    el.attachmentRemoveBtn.title = copy.attachmentRemove;
    // Re-render the status pill and quick-action tiles in the new language — both build
    // their own text at render time (setOrbState, renderQuickActions) rather than reading it
    // lazily, so switching languages mid-session needs both refreshed explicitly here. Not
    // updateComposerMode() itself: it (via isBusy()) reads BUSY_STATES, a `const` declared
    // later in this file — applyLanguage() runs synchronously from init(), before that
    // declaration executes, so calling it here throws "Cannot access before initialization"
    // and takes down the entire init() sequence with it. el.sendLabel is already set above.
    el.heroStatusLabel.textContent = copy.stateLabels[el.orb.dataset.state] || copy.stateLabels.IDLE;
    if (state.skills.length) renderQuickActions(state.skills);
    populateVoiceSelect(); // available voices differ between "en" and "hi"
    for (const btn of el.settingsLangOptions.querySelectorAll(".option-btn")) {
      btn.classList.toggle("active", btn.dataset.lang === state.lang);
    }
  }

  /** Settings screen's language pills read/write the same `state.lang`/localStorage key. */
  function setLanguage(lang) {
    state.lang = lang;
    localStorage.setItem(STORAGE_KEYS.lang, state.lang);
    applyLanguage();
  }

  /** Settings screen's "Spoken replies" button — off by default (see `state.speak`'s init). */
  function toggleSpeak() {
    state.speak = !state.speak;
    localStorage.setItem(STORAGE_KEYS.speak, state.speak ? "on" : "off");
    applyVoiceToggleState();
  }

  function applyVoiceToggleState() {
    el.settingsVoiceToggle.setAttribute("aria-pressed", String(state.speak));
    el.settingsVoiceToggle.textContent = state.speak ? "Spoken replies: On" : "Spoken replies: Off";
  }

  // ---- Session (guest account bootstrap + refresh) -------------------------------------

  async function ensureSession() {
    if (localStorage.getItem(STORAGE_KEYS.accessToken)) return;
    await createGuestSession();
  }

  async function createGuestSession() {
    const deviceId = crypto.randomUUID();
    const email = `guest-${deviceId}@device.zarvismobile.com`;
    const password = crypto.randomUUID() + crypto.randomUUID();
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Guest signup failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }
    const tokens = await res.json();
    localStorage.setItem(STORAGE_KEYS.accessToken, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
  }

  // `attempt` walks three stages: 0 = the original call; 1 = retried once after a
  // successful token refresh; 2 = retried once more after bootstrapping a brand-new guest
  // account. That last stage matters on its own, not just as a refresh fallback: if the
  // account this browser's stored tokens point to no longer exists server-side (e.g. the
  // backend's user data was reset, migrated to a different store, or this is a stale token
  // from before that migration), /auth/refresh 401s for the exact same "unknown user"
  // reason the original call did — refreshing can never recover from that. Without this,
  // a browser that bootstrapped a guest account before such a reset is stuck on 401 for
  // every request forever, since ensureSession() only ever signs up when *no* token is
  // stored at all, not when the stored one has gone stale.
  async function apiFetch(path, options = {}, attempt = 0) {
    const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
    // A FormData body (the document-upload flow) must NOT get a manual content-type — the
    // browser sets its own multipart boundary automatically, and overriding it here would
    // break the upload. Every other caller still sends plain JSON, unchanged.
    const isFormData = options.body instanceof FormData;
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
    if (res.status !== 401 || attempt >= 2) return res;

    if (attempt === 0 && (await tryRefresh())) {
      return apiFetch(path, options, 1);
    }
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    await createGuestSession();
    return apiFetch(path, options, 2);
  }

  async function tryRefresh() {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
    if (!refreshToken) return false;
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const tokens = await res.json();
    localStorage.setItem(STORAGE_KEYS.accessToken, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
    return true;
  }

  // ---- Skill catalogue -------------------------------------------------------------------
  // AI provider status lives only in the Metrics tab now (refreshMetricsHealth, below) — no
  // duplicate header badge making the same live/mock call on every load.

  const CATEGORY_LABELS = { SEO: "SEO", GITHUB: "GitHub" };

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category.charAt(0) + category.slice(1).toLowerCase();
  }

  // Feather-style icon paths, one per category — see CategoryIconAvatar's Android
  // equivalent (feature-home/CapabilitiesScreen.kt) for why this exists: a recognizable
  // glyph standing in for a per-skill "visual mockup", not a bespoke illustration per skill.
  const CATEGORY_ICON_PATHS = {
    WEB: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
    DOCUMENTS:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>',
    DEVELOPER: '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>',
    BUSINESS: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>',
    CREATIVE: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"></path>',
    AUTOMATION:
      '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    RESEARCH: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    PHONE:
      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path>',
  };
  const DEFAULT_CATEGORY_ICON_PATH = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>';

  function categoryIconSvg(category) {
    const path = CATEGORY_ICON_PATHS[category.toUpperCase()] || DEFAULT_CATEGORY_ICON_PATH;
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  async function loadSkills() {
    const res = await apiFetch("/skills");
    if (!res.ok) return;
    const { skills } = await res.json();
    state.skills = skills;
    renderQuickActions(skills);
  }

  function groupByCategory(skills) {
    const byCategory = new Map();
    for (const skill of skills) {
      if (!byCategory.has(skill.category)) byCategory.set(skill.category, []);
      byCategory.get(skill.category).push(skill);
    }
    return byCategory;
  }

  // Five curated, plain-language entry points instead of one raw chip per backend skill
  // category (Web, Documents, Developer, Business, Creative, Automation, Research — a wall
  // of technical category names that meant little to a first-time user). Each one (besides
  // "ask", which is just a composer shortcut — always available, no backend dependency) maps
  // to real, currently-registered skill categories; a group whose categories are entirely
  // absent from this build's /skills response renders nothing rather than promising an
  // action the backend can't actually do. Order matches the product's own priority: talk to
  // Zarvis first, then the concrete task shapes it already supports.
  const QUICK_ACTION_GROUPS = [
    { key: "ask", categories: [] },
    { key: "write", categories: ["CREATIVE", "BUSINESS"] },
    { key: "research", categories: ["WEB", "RESEARCH"] },
    { key: "code", categories: ["DEVELOPER"] },
    { key: "analyze", categories: ["DOCUMENTS", "DEVELOPER"] },
    { key: "plan", categories: ["AUTOMATION"] },
    { key: "create", categories: ["CREATIVE", "BUSINESS"] },
  ];
  const QUICK_ACTION_ICON_PATHS = {
    ask: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
    write: CATEGORY_ICON_PATHS.CREATIVE,
    research: CATEGORY_ICON_PATHS.RESEARCH,
    code: CATEGORY_ICON_PATHS.DEVELOPER,
    analyze: CATEGORY_ICON_PATHS.DOCUMENTS,
    plan: CATEGORY_ICON_PATHS.AUTOMATION,
    create: CATEGORY_ICON_PATHS.CREATIVE,
  };

  function quickActionIconSvg(key) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${QUICK_ACTION_ICON_PATHS[key]}</svg>`;
  }

  function renderQuickActions(skills) {
    el.categories.innerHTML = "";
    const byCategory = groupByCategory(skills);
    const labels = COPY[state.lang].quickActions;
    for (const group of QUICK_ACTION_GROUPS) {
      const matched = group.categories.flatMap((c) => byCategory.get(c) || []);
      if (group.categories.length && !matched.length) continue; // not supported by this backend build
      const example = matched.length ? exampleFor(matched[0].description) : "";

      const card = document.createElement("button");
      card.type = "button";
      card.className = "quick-action";
      card.innerHTML = `${quickActionIconSvg(group.key)}<span>${labels[group.key]}</span>`;
      card.addEventListener("click", () => {
        haptic();
        el.input.value = example;
        el.input.focus();
      });
      el.categories.appendChild(card);
    }
  }

  function exampleFor(description) {
    const match = description.match(/"([^"]+)"/);
    return match ? match[1] : description;
  }

  // ---- Capabilities Hub -------------------------------------------------------------------
  // Every skill from the same catalogue the Workspace chips summarize, shown in full as a
  // showcase card grouped by category with a direct "Run Agent" trigger — MASTER_SPEC.md §22
  // "Feature Showcase Hub by Category" — mirroring the Android Capabilities screen. Unlike
  // the Workspace chips (which only fill the composer so the user can review/edit first, a
  // deliberate existing choice), "Run Agent" here executes immediately, matching what "direct
  // triggers" means on Android's equivalent screen.

  function renderCapabilities() {
    el.capabilitiesList.innerHTML = "";
    if (state.skills.length === 0) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = "Couldn't load capabilities right now.";
      el.capabilitiesList.appendChild(empty);
      return;
    }
    const byCategory = groupByCategory(state.skills);
    for (const [category, categorySkills] of byCategory) {
      const label = document.createElement("h3");
      label.className = "capability-group-label";
      label.textContent = categoryLabel(category);
      el.capabilitiesList.appendChild(label);
      for (const skill of categorySkills) el.capabilitiesList.appendChild(renderCapabilityCard(skill));
    }
  }

  function renderCapabilityCard(skill) {
    const card = document.createElement("div");
    card.className = "capability-card";

    const top = document.createElement("div");
    top.className = "capability-card-top";

    const icon = document.createElement("span");
    icon.className = "capability-icon";
    icon.innerHTML = categoryIconSvg(skill.category);
    top.appendChild(icon);

    const heading = document.createElement("div");
    heading.className = "capability-card-heading";
    const name = document.createElement("h4");
    name.className = "capability-card-name";
    name.textContent = skill.name;
    heading.appendChild(name);
    const risk = document.createElement("span");
    risk.className = "risk-badge";
    risk.dataset.level = skill.riskLevel;
    risk.textContent = skill.riskLevel;
    heading.appendChild(risk);
    top.appendChild(heading);

    card.appendChild(top);

    const desc = document.createElement("p");
    desc.className = "capability-card-desc";
    desc.textContent = skill.description;
    card.appendChild(desc);

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "capability-run-btn";
    if (skill.upgradeRequired) {
      runBtn.textContent = "Upgrade required";
      runBtn.disabled = true;
    } else {
      runBtn.textContent = "Run Agent";
      runBtn.addEventListener("click", () => {
        haptic();
        setActiveView("workspace");
        submitUtterance(exampleFor(skill.description));
      });
    }
    card.appendChild(runBtn);

    return card;
  }

  // ---- Bottom nav / view switching ---------------------------------------------------------
  // 4 top-level views (MASTER_SPEC.md §22/§23), mirroring the Android app's floating glass
  // bottom nav: Workspace / Capabilities / Plans & Quotas / System Metrics. Only Workspace
  // keeps the composer visible — the other three are read-only/showcase surfaces reached one
  // tap away, replacing the old single "Status & Workflows" drawer.

  const VIEWS = {
    workspace: el.viewWorkspace,
    capabilities: el.viewCapabilities,
    plans: el.viewPlans,
    metrics: el.viewMetrics,
    developer: el.viewDeveloper,
    settings: el.viewSettings,
  };

  function setupBottomNav() {
    for (const item of el.navItems) {
      item.addEventListener("click", () => {
        haptic();
        setActiveView(item.dataset.view);
      });
    }
    el.settingsBtn.addEventListener("click", () => {
      haptic();
      setActiveView("settings");
    });
    el.settingsBackBtn.addEventListener("click", () => setActiveView("workspace"));
    el.developerBackBtn.addEventListener("click", () => setActiveView("capabilities"));
  }

  function setActiveView(view) {
    if (!VIEWS[view] || state.activeView === view) return;
    if (state.activeView === "metrics") stopMetricsPolling();

    state.activeView = view;
    for (const [name, section] of Object.entries(VIEWS)) section.hidden = name !== view;
    for (const item of el.navItems) item.classList.toggle("active", item.dataset.view === view);
    el.composer.hidden = view !== "workspace";

    if (view === "capabilities") renderCapabilities();
    if (view === "plans") refreshPlans();
    if (view === "metrics") {
      renderLatencyLog();
      refreshMetricsHealth();
      refreshTasks();
      startMetricsPolling();
    }
  }

  // ---- Plans & Quotas -----------------------------------------------------------------------
  // Free vs Pro comparison — MASTER_SPEC.md §19-21. Never a fabricated price: Web/Play
  // billing isn't wired up yet (§32), so real pricing is marked "coming soon" instead of
  // invented — same honesty as the Android Plans screen. The monthly/yearly toggle is a real,
  // working control; it only ever changes the billing-period label, never a dollar amount
  // that doesn't exist yet.

  const PLAN_TIERS = [
    {
      name: "FREE",
      tag: null,
      tagline: "Get started with zero commitment.",
      features: ["LOW-risk, low-cost skills only", "Voice + text, English/Hindi/Hinglish", "Standard response speed"],
      highlighted: false,
    },
    {
      name: "PRO",
      tag: "Recommended",
      tagline: "Full access across every shipped skill.",
      features: [
        "Every skill Zarvis ships, at every risk tier",
        "Higher usage/credit ceiling",
        "Priority orchestrator queueing",
      ],
      highlighted: true,
    },
  ];

  let currentPlanName = null;

  function setupPlans() {
    const options = el.billingToggle.querySelectorAll(".billing-option");
    for (const btn of options) {
      btn.addEventListener("click", () => {
        haptic();
        state.billing = btn.dataset.billing;
        for (const b of options) b.classList.toggle("active", b === btn);
        renderPlanCards(currentPlanName);
      });
    }
  }

  // ---- Confirmation modal ----------------------------------------------------------------
  // One generic instance (mirrors Android's RiskConfirmationDialog/AlertDialog pattern)
  // rather than a one-off dialog per caller — currently used only by Settings' "Delete
  // account", but written to take any title/body/confirm label.

  function showConfirmModal({ title, body, confirmLabel = "Confirm", onConfirm }) {
    el.confirmModalTitle.textContent = title;
    el.confirmModalBody.textContent = body;
    el.confirmModalConfirm.textContent = confirmLabel;
    el.confirmModal.hidden = false;

    const close = () => {
      el.confirmModal.hidden = true;
      el.confirmModalConfirm.removeEventListener("click", handleConfirm);
      el.confirmModalCancel.removeEventListener("click", close);
    };
    const handleConfirm = () => {
      close();
      onConfirm();
    };
    el.confirmModalConfirm.addEventListener("click", handleConfirm);
    el.confirmModalCancel.addEventListener("click", close);
  }

  // ---- Settings ----------------------------------------------------------------------------
  // Language, spoken-reply toggle, and Memory & Data controls — mirrors the Android Settings
  // screen's own sections (feature-settings/SettingsScreen.kt) and, for account deletion,
  // its exact backend call (DELETE /api/v1/account, already wired server-side).

  function setupSettings() {
    for (const btn of el.settingsLangOptions.querySelectorAll(".option-btn")) {
      btn.addEventListener("click", () => {
        haptic();
        setLanguage(btn.dataset.lang);
      });
    }
    el.settingsVoiceToggle.addEventListener("click", () => {
      haptic();
      toggleSpeak();
    });
    el.settingsClearSessionBtn.addEventListener("click", () => {
      haptic();
      clearLocalSession();
    });
    el.settingsDeleteBtn.addEventListener("click", () => {
      haptic();
      el.settingsDeleteError.hidden = true;
      showConfirmModal({
        title: "Delete your account?",
        body: "This permanently deletes your account, tasks, and usage history from the server. This cannot be undone.",
        confirmLabel: "Delete",
        onConfirm: deleteAccount,
      });
    });
  }

  /** Clears only the session tokens (keeps language/voice preferences) so the next reload
   * bootstraps a fresh guest account — the web equivalent of Android's "Clear local
   * session," which does the same thing to its own token storage. */
  function clearLocalSession() {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    location.reload();
  }

  async function deleteAccount() {
    el.settingsDeleteBtn.disabled = true;
    el.settingsDeleteBtn.textContent = "Deleting…";
    try {
      const res = await apiFetch("/account", { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      clearLocalSession(); // reloads — a fresh guest session bootstraps on the next load
    } catch (err) {
      console.error(err);
      el.settingsDeleteBtn.disabled = false;
      el.settingsDeleteBtn.textContent = "Delete account";
      el.settingsDeleteError.hidden = false;
    }
  }

  // ---- Developer ---------------------------------------------------------------------------
  // Repository Agent's read-only structural analysis — calls the same direct endpoint
  // (POST /api/v1/developer/analyze) the Android Developer screen calls, distinct from
  // routing the same request through the orchestrator's natural-language turn.

  function setupDeveloper() {
    el.developerEntryLink.addEventListener("click", () => {
      haptic();
      setActiveView("developer");
    });
    el.developerAnalyzeBtn.addEventListener("click", () => {
      haptic();
      analyzeRepo();
    });
    el.developerRepoInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") analyzeRepo();
    });
  }

  async function analyzeRepo() {
    const repoUrl = el.developerRepoInput.value.trim();
    el.developerResult.innerHTML = "";
    if (!repoUrl) return;

    el.developerAnalyzeBtn.disabled = true;
    el.developerAnalyzeBtn.textContent = "Analyzing…";
    try {
      const res = await apiFetch("/developer/analyze", { method: "POST", body: JSON.stringify({ repoUrl }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.kind !== "success") {
        renderDeveloperMessage(body.error || body.userMessage || `Analysis failed (${res.status}).`, "error");
        return;
      }
      renderDeveloperMessage(body.result?.summary || "Analyzed.", "success");
    } catch (err) {
      console.error(err);
      renderDeveloperMessage(COPY[state.lang].bootError.title, "error");
    } finally {
      el.developerAnalyzeBtn.disabled = false;
      el.developerAnalyzeBtn.textContent = "Analyze";
    }
  }

  function renderDeveloperMessage(message, status) {
    const widget = document.createElement("div");
    widget.className = "result-widget";
    widget.dataset.kind = "code";
    widget.dataset.status = status;

    const header = document.createElement("div");
    header.className = "widget-header";
    header.innerHTML = `<span class="widget-title"><span class="widget-status-dot"></span>Developer</span>`;
    widget.appendChild(header);

    const body = document.createElement("div");
    body.className = "widget-body";
    renderFormattedText(body, message);
    widget.appendChild(body);

    el.developerResult.appendChild(widget);
  }

  async function refreshPlans() {
    el.plansCurrent.innerHTML = "";
    try {
      const res = await apiFetch("/entitlements/me");
      if (res.ok) {
        const snapshot = await res.json();
        currentPlanName = snapshot.plan;
        el.plansCurrent.appendChild(renderStatTile({ label: "Current plan", value: snapshot.plan }));
        el.plansCurrent.appendChild(renderStatTile({ label: "Credits", value: String(snapshot.creditBalance) }));
        if (snapshot.trialExpiresAt) {
          el.plansCurrent.appendChild(renderStatTile({ label: "Trial ends", value: new Date(snapshot.trialExpiresAt).toLocaleDateString() }));
        }
      }
    } catch {
      // The Free/Pro comparison below still renders regardless — this tile row is a
      // nice-to-have, not a hard dependency.
    }
    renderPlanCards(currentPlanName);
  }

  function renderPlanCards(currentPlan) {
    el.planCards.innerHTML = "";
    for (const plan of PLAN_TIERS) el.planCards.appendChild(renderPlanCard(plan, currentPlan));
  }

  function renderPlanCard(plan, currentPlan) {
    const card = document.createElement("div");
    card.className = plan.highlighted ? "plan-card highlighted" : "plan-card";

    const top = document.createElement("div");
    top.className = "plan-card-top";
    const name = document.createElement("h3");
    name.className = "plan-card-name";
    name.textContent = plan.name;
    top.appendChild(name);
    const tag = document.createElement("span");
    tag.className = "plan-card-tag";
    tag.textContent = currentPlan === plan.name ? "Current plan" : plan.tag || "";
    top.appendChild(tag);
    card.appendChild(top);

    const tagline = document.createElement("p");
    tagline.className = "plan-card-tagline";
    tagline.textContent = plan.tagline;
    card.appendChild(tagline);

    if (plan.highlighted) {
      const note = document.createElement("p");
      note.className = "plan-card-note";
      note.textContent = `Billed ${state.billing} · pricing coming soon`;
      card.appendChild(note);
    }

    const list = document.createElement("ul");
    list.className = "plan-card-features";
    for (const feature of plan.features) {
      const li = document.createElement("li");
      li.textContent = feature;
      list.appendChild(li);
    }
    card.appendChild(list);

    return card;
  }

  // ---- System Metrics -----------------------------------------------------------------------
  // Real, client-measured per-turn latency (recordLatency(), called from submitUtterance()
  // around the actual /orchestrator/turn fetch — pure on-device timing, no new backend
  // endpoint) plus the task log, reusing the same render*Task* functions as before — replaces
  // the old "Status & Workflows" drawer with a full tab, matching the Android System Metrics
  // screen. Never a fabricated number.

  const MAX_LATENCY_ENTRIES = 50;

  function recordLatency(label, durationMs, success) {
    latencyEntries = [{ id: `${Date.now()}-${Math.random()}`, label, durationMs, success }, ...latencyEntries].slice(0, MAX_LATENCY_ENTRIES);
    if (state.activeView === "metrics") renderLatencyLog();
  }

  async function refreshMetricsHealth() {
    el.metricsHealthGrid.innerHTML = "";
    try {
      const res = await fetch(`${API_BASE.replace(/\/api\/v1$/, "")}/health`);
      const body = await res.json();
      el.metricsHealthGrid.appendChild(renderStatTile({ label: "AI Provider", value: body.provider === "google" ? "Gemini (live)" : "Mock" }));
      el.metricsHealthGrid.appendChild(renderStatTile({ label: "Backend", value: "Online" }));
    } catch {
      el.metricsHealthGrid.appendChild(renderStatTile({ label: "Backend", value: "Offline" }));
    }
  }

  function renderLatencyLog() {
    el.latencyStats.innerHTML = "";
    const avgMs =
      latencyEntries.length === 0
        ? "—"
        : `${Math.round(latencyEntries.reduce((sum, entry) => sum + entry.durationMs, 0) / latencyEntries.length)}ms`;
    const successRate =
      latencyEntries.length === 0 ? "—" : `${Math.round((latencyEntries.filter((entry) => entry.success).length / latencyEntries.length) * 100)}%`;
    el.latencyStats.appendChild(renderStatTile({ label: "Avg Latency", value: avgMs }));
    el.latencyStats.appendChild(renderStatTile({ label: "Turns Logged", value: String(latencyEntries.length) }));
    el.latencyStats.appendChild(renderStatTile({ label: "Success Rate", value: successRate }));

    el.latencyLog.innerHTML = "";
    if (latencyEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "latency-empty";
      empty.textContent = "No turns yet this session — ask Zarvis something on Workspace and it shows up here instantly.";
      el.latencyLog.appendChild(empty);
      return;
    }
    for (const entry of latencyEntries) el.latencyLog.appendChild(renderLatencyRow(entry));
  }

  function renderLatencyRow(entry) {
    const row = document.createElement("div");
    row.className = "latency-row";
    row.dataset.success = String(entry.success);
    const label = document.createElement("span");
    label.className = "latency-row-label";
    label.textContent = entry.label;
    const ms = document.createElement("span");
    ms.className = "latency-row-ms";
    ms.textContent = `${entry.durationMs}ms`;
    row.append(label, ms);
    return row;
  }

  let metricsPollTimer = null;

  function startMetricsPolling() {
    if (metricsPollTimer) return;
    metricsPollTimer = setInterval(() => {
      refreshMetricsHealth();
      refreshTasks();
    }, 6000);
  }

  function stopMetricsPolling() {
    if (metricsPollTimer) {
      clearInterval(metricsPollTimer);
      metricsPollTimer = null;
    }
  }

  function renderStatTile({ label, value }) {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const labelEl = document.createElement("span");
    labelEl.className = "stat-tile-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "stat-tile-value";
    valueEl.textContent = value;
    tile.append(labelEl, valueEl);
    return tile;
  }

  async function fetchTasks() {
    const res = await apiFetch("/tasks");
    if (!res.ok) return [];
    const { tasks } = await res.json();
    const activeCount = tasks.filter((t) => t.status === "PENDING" || t.status === "RUNNING" || t.status === "PAUSED").length;
    // Surfaced on the Metrics nav item (bottom-nav on mobile, sidebar on desktop) — the same
    // "something's running" signal the old topbar tasks-toggle badge showed, just relocated
    // with the drawer it replaced.
    for (const badge of el.metricsBadges) badge.hidden = activeCount === 0;
    return tasks;
  }

  async function refreshTasks() {
    el.taskList.innerHTML = "";
    const tasks = await fetchTasks();
    if (tasks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = "No active workflows yet — multi-step tasks Zarvis runs will appear here.";
      el.taskList.appendChild(empty);
      return;
    }
    for (const task of tasks) el.taskList.appendChild(renderTaskCard(task));
  }

  // User-triggerable transitions per status — mirrors backend/src/tasks/taskService.ts's
  // VALID_TRANSITIONS, minus the automatic RUNNING->DONE/FAILED transitions no button here
  // should ever trigger directly.
  const TASK_ACTIONS = {
    PENDING: [{ action: "cancel", label: "Cancel", cls: "danger" }],
    RUNNING: [
      { action: "pause", label: "Pause", cls: "" },
      { action: "cancel", label: "Cancel", cls: "danger" },
    ],
    PAUSED: [
      { action: "resume", label: "Resume", cls: "primary" },
      { action: "cancel", label: "Cancel", cls: "danger" },
    ],
    FAILED: [{ action: "retry", label: "Retry", cls: "primary" }],
    DONE: [],
    CANCELLED: [],
  };

  function renderTaskCard(task) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.dataset.status = task.status;
    if (task.status === "RUNNING") card.classList.add("glow-active");

    const top = document.createElement("div");
    top.className = "task-card-top";
    const badge = document.createElement("span");
    badge.className = "task-status-badge";
    badge.dataset.status = task.status;
    badge.textContent = task.status;
    const time = document.createElement("span");
    time.className = "task-time";
    time.textContent = formatRelativeTime(task.createdAt);
    top.append(badge, time);
    card.appendChild(top);

    const goal = document.createElement("p");
    goal.className = "task-goal";
    goal.textContent = task.goal;
    card.appendChild(goal);

    if (task.steps && task.steps.length > 0) {
      const doneCount = task.steps.filter((s) => s.status === "DONE").length;
      const progress = document.createElement("div");
      progress.className = "task-progress";
      const bar = document.createElement("div");
      bar.className = "task-progress-bar";
      bar.style.width = `${Math.round((doneCount / task.steps.length) * 100)}%`;
      progress.appendChild(bar);
      card.appendChild(progress);

      const stepsWrap = document.createElement("div");
      stepsWrap.className = "task-steps";
      for (const step of task.steps) {
        const row = document.createElement("div");
        row.className = "task-step";
        row.dataset.status = step.status;
        const dot = document.createElement("span");
        dot.className = "task-step-dot";
        const label = document.createElement("span");
        label.textContent = step.description;
        row.append(dot, label);
        stepsWrap.appendChild(row);
      }
      card.appendChild(stepsWrap);
    }

    const actions = TASK_ACTIONS[task.status] || [];
    if (actions.length > 0) {
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "task-actions";
      for (const { action, label, cls } of actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = cls ? `task-action-btn ${cls}` : "task-action-btn";
        btn.textContent = label;
        btn.addEventListener("click", () => performTaskAction(task.id, action));
        actionsWrap.appendChild(btn);
      }
      card.appendChild(actionsWrap);
    }

    return card;
  }

  async function performTaskAction(taskId, action) {
    const res = await apiFetch(`/tasks/${taskId}/${action}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`Task ${action} failed:`, body.error || res.status);
      return;
    }
    refreshTasks();
  }

  function formatRelativeTime(dateInput) {
    const diffMin = Math.round((Date.now() - new Date(dateInput).getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(dateInput).toLocaleDateString();
  }

  // ---- Conversation turn -----------------------------------------------------------------

  // The in-flight turn's controller, if any — lets a new turn (text or voice) interrupt
  // whatever ZARVIS is still doing, the same way Android's ConversationViewModel cancels its
  // tracked `turnJob` when a new one starts, rather than blocking the new one until the old
  // one finishes. `null` when idle.
  let currentTurnController = null;

  /** `isVoice` is true only for the speech-recognition result handler (a mic/orb press) —
   * every other caller (Send, Enter, a quick-action/capability card, a file upload) is a
   * typed/text submission. Threaded through to runTurn() so a typed message's reply always
   * stays text-only, even with Spoken replies on: only a voice-originated turn is ever a
   * candidate to speak back. `displayText`, when given, is what the user's own chat bubble
   * shows instead of the raw `rawText` sent to the backend — used by the upload flow so the
   * bubble reads "📎 filename.txt" rather than the file's entire contents. */
  async function submitUtterance(rawText, isVoice = false, displayText) {
    const utterance = rawText.trim();
    if (!utterance) return;
    el.input.value = "";
    addBubble("user", displayText ?? utterance);
    await runTurn(utterance, isVoice);
  }

  /** The actual orchestrator round trip, shared by a fresh submission (submitUtterance,
   * which first echoes the utterance as a user bubble) and Retry (addErrorBubble, which
   * deliberately does not — the failed attempt's own user bubble is still on screen, so
   * retrying the exact same text would otherwise show it twice; a retry is always treated as
   * typed/text-only, regardless of how the original turn started). */
  async function runTurn(utterance, isVoice = false) {
    // A turn already running gets interrupted, not queued behind — cancels its network
    // request (the AbortError branch below exits quietly, exactly like Android's
    // `catch (t: CancellationException) { throw t }`: not a failure to report) and stops
    // whatever it was speaking, so the new turn starts from a clean IDLE-equivalent state.
    if (currentTurnController) {
      currentTurnController.abort();
      stopSpeaking();
    }
    const controller = new AbortController();
    currentTurnController = controller;

    const thinkingNode = addThinkingBubble();

    setOrbState("UNDERSTANDING");

    const isFirstTurn = state.firstTurn;
    state.firstTurn = false; // set before the request, not after — a failed first turn
    // shouldn't get a second "warm welcome" pass on retry.

    // Real, client-measured round-trip time for this specific call — feeds the System
    // Metrics tab's "Live API Latency" log (recordLatency()). Not a fabricated number: it's
    // performance.now() wrapped around the exact fetch already being made for this turn.
    const startedAt = performance.now();
    try {
      await delay(250);
      if (controller.signal.aborted) return;
      setOrbState("EXECUTING");
      const res = await apiFetch(
        "/orchestrator/turn",
        {
          method: "POST",
          body: JSON.stringify({
            utterance,
            locale: state.lang,
            userName: localStorage.getItem(STORAGE_KEYS.userName),
            isFirstTurn,
            history: state.history.slice(-12),
          }),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The backend's own `error` string is logged for debugging but never shown — a
        // caller-facing message here is always the same friendly, translated copy,
        // regardless of what actually failed server-side.
        console.error(`Orchestrator turn failed (${res.status}):`, body.error || body.reason);
        addErrorBubble(COPY[state.lang].bootError, utterance);
        setOrbState("ERROR");
        recordLatency(utterance, Math.round(performance.now() - startedAt), false);
        return;
      }
      const result = await res.json();
      state.history.push({ role: "user", content: utterance });
      if (typeof result.message === "string" && result.message.trim()) {
        state.history.push({ role: "assistant", content: result.message.trim() });
      }
      state.history = state.history.slice(-12);
      recordLatency(utterance, Math.round(performance.now() - startedAt), true);
      // A brief emerald "done" flash before speaking — MASTER_SPEC.md §22 "Success = Emerald
      // Green Glow", mirroring the Android orb's SUCCESS state exactly (same 450ms flash).
      setOrbState("SUCCESS");
      await delay(450);
      if (controller.signal.aborted) return;
      const node = renderAssistantResult(result);
      // Awaited so the orb actually stays SPEAKING for the duration of playback — without
      // this, the fire-and-forget call returns almost immediately (it only runs
      // synchronously up to its first internal await) and the setOrbState("IDLE") below
      // would fire right after, overwriting SPEAKING a fraction of a second in.
      // Typed messages stay text-only — only a voice-originated turn ever speaks back (and
      // even then, only with Spoken replies on; see speak()'s own state.speak check).
      if (isVoice) await speak(result.message, node);
      if (controller.signal.aborted) return;
      setOrbState("IDLE");
    } catch (err) {
      if (err.name === "AbortError") return; // interrupted by a newer turn — not a failure
      console.error(err);
      addErrorBubble(COPY[state.lang].bootError, utterance);
      setOrbState("ERROR");
      recordLatency(utterance, Math.round(performance.now() - startedAt), false);
    } finally {
      // Runs on every exit path (success, HTTP failure, thrown error, or an early return
      // from the abort checks above) — removing it here, once, is what guarantees it can
      // never linger, rather than repeating `thinkingNode.remove()` at each return site
      // above and risking a path that forgets to.
      thinkingNode.remove();
      // Only the still-current call clears the tracked controller — an older,
      // since-interrupted call's `finally` must not race the newer turn that superseded it.
      if (currentTurnController === controller) {
        currentTurnController = null;
      }
    }
  }

  /** Cancels whatever ZARVIS is currently doing (thinking or speaking) without starting a
   * new turn — the composer's Stop action (see updateComposerMode()) and the sole way to
   * interrupt a turn from the keyboard/mouse without also submitting new text. */
  function cancelCurrentTurn() {
    if (currentTurnController) currentTurnController.abort();
    stopSpeaking();
    setOrbState("IDLE");
  }

  function addBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    if (role === "assistant") renderFormattedText(bubble, text);
    else bubble.textContent = text;
    el.conversation.appendChild(bubble);
    el.conversation.scrollTop = el.conversation.scrollHeight;
    return bubble;
  }

  /** Render a safe subset of Markdown used by ZARVIS replies without exposing arbitrary HTML. */
  function renderFormattedText(container, text) {
    const escaped = String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\x27/g, "&#39;");
    const lines = escaped.split(/\r?\n/);
    const html = [];
    let inList = false;
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        if (!inList) { html.push("<ul class=\"reply-list\">"); inList = true; }
        html.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
        continue;
      }
      if (inList) { html.push("</ul>"); inList = false; }
      if (!line.trim()) html.push('<div class="reply-spacer" aria-hidden="true"></div>');
      else html.push(`<div class="reply-line">${formatInlineMarkdown(line)}</div>`);
    }
    if (inList) html.push("</ul>");
    container.innerHTML = html.join("");
  }

  function formatInlineMarkdown(line) {
    return line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  /** A transient "thinking" placeholder shown for the UNDERSTANDING/EXECUTING span of a
   * turn — removed the moment the real reply (or an error) is ready, in every exit path of
   * submitUtterance (success, HTTP failure, thrown error, and abort-by-interruption alike),
   * so it can never linger as a fake "still working" state. */
  function addThinkingBubble() {
    const bubble = document.createElement("div");
    bubble.className = "bubble assistant thinking";
    bubble.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>';
    el.conversation.appendChild(bubble);
    el.conversation.scrollTop = el.conversation.scrollHeight;
    return bubble;
  }

  /** A failed turn's reply — always the generic, translated connection-error copy (a short
   * title plus a softer supporting line, e.g. `COPY[lang].bootError`) plus a Retry action,
   * per the product rule that a failure must never be a dead end and never a raw technical
   * message. `retryAction` is either the utterance to resubmit (calls `runTurn` directly, not
   * `submitUtterance`, so retrying doesn't echo the user's message a second time — the failed
   * attempt's own user bubble is already on screen) or a plain function, for failures with no
   * utterance to retry (e.g. the initial session bootstrap). */
  function addErrorBubble(errorCopy, retryAction) {
    const bubble = document.createElement("div");
    bubble.className = "bubble system";

    const title = document.createElement("p");
    title.className = "bubble-error-text";
    title.textContent = errorCopy.title;
    bubble.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "bubble-error-subtitle";
    subtitle.textContent = errorCopy.subtitle;
    bubble.appendChild(subtitle);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "bubble-retry-btn";
    retryBtn.textContent = COPY[state.lang].retry;
    retryBtn.addEventListener("click", () => {
      haptic();
      bubble.remove(); // the retry attempt gets its own thinking/success/error bubble
      if (typeof retryAction === "function") retryAction();
      else runTurn(retryAction);
    });
    bubble.appendChild(retryBtn);

    el.conversation.appendChild(bubble);
    el.conversation.scrollTop = el.conversation.scrollHeight;
    return bubble;
  }

  /** A plain informational/error notice with no retry action (unlike addErrorBubble, above)
   * — used for client-side upload validation failures that happen before any turn is
   * submitted, so there's nothing to retry. */
  function addSystemNotice(copy) {
    const bubble = document.createElement("div");
    bubble.className = "bubble system";

    const title = document.createElement("p");
    title.className = "bubble-error-text";
    title.textContent = copy.title;
    bubble.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "bubble-error-subtitle";
    subtitle.textContent = copy.subtitle;
    bubble.appendChild(subtitle);

    el.conversation.appendChild(bubble);
    el.conversation.scrollTop = el.conversation.scrollHeight;
    return bubble;
  }

  // ---- File upload (document summarization via the existing docs.summarize skill) --------
  // Plain-text formats (.txt/.md/.csv/.json/.log) are read directly in the browser
  // (File.text(), zero network round trip) — unchanged from before. PDF/DOCX need a real
  // parser neither a browser nor this backend previously had: POST
  // /api/v1/documents/extract (backend/src/api/routes/documents.ts, new) runs actual
  // extraction (unpdf/mammoth — never a byte-for-byte passthrough pretending a binary file
  // is plain text, Product Principle #4) and returns plain text. Either path ends the same
  // way: a "ready to analyze" attachment chip, not an immediate auto-submit — the user then
  // asks a question (or just hits Send) and the extracted text rides along with that turn
  // (submitComposerInput(), below), matching a normal attach-then-ask flow.

  const MAX_TEXT_UPLOAD_BYTES = 60_000; // matches the backend's own extracted-text cap
  const MAX_BINARY_UPLOAD_BYTES = 4 * 1024 * 1024; // matches documents.ts's multer limit
  const READABLE_TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".log"];
  const PDF_EXTENSIONS = [".pdf"];
  const DOCX_EXTENSIONS = [".docx"];
  const PDF_MIME = "application/pdf";
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
  const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

  /** `null` means genuinely unsupported (for example a ZIP or executable). */
  function classifyLocalFile(file) {
    const name = file.name.toLowerCase();
    if (IMAGE_MIME_TYPES.has(file.type) || /\.(png|jpe?g|webp|heic|heif)$/.test(name)) return "image";
    if (file.type === PDF_MIME || PDF_EXTENSIONS.some((ext) => name.endsWith(ext))) return "pdf";
    if (file.type === DOCX_MIME || DOCX_EXTENSIONS.some((ext) => name.endsWith(ext))) return "docx";
    if ((file.type && (file.type.startsWith("text/") || file.type === "application/json")) || READABLE_TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      return "text";
    }
    return null;
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets picking the exact same file again still fire "change"
    if (!file) return;
    haptic();

    const kind = classifyLocalFile(file);
    if (!kind) {
      addSystemNotice(COPY[state.lang].unsupportedFile);
      return;
    }

    if (kind === "image") {
      if (file.size > MAX_BINARY_UPLOAD_BYTES) {
        addSystemNotice(COPY[state.lang].oversizedFile);
        return;
      }
      setExtractingState(true);
      try {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const res = await apiFetch("/documents/extract", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(`Image analysis failed (${res.status}):`, body.error);
          addSystemNotice(COPY[state.lang].unreadableFile);
          return;
        }
        const { text } = await res.json();
        setPendingAttachment(file.name, text);
      } catch (err) {
        console.error(err);
        addSystemNotice(COPY[state.lang].unreadableFile);
      } finally {
        setExtractingState(false);
      }
      return;
    }

    if (kind === "text") {
      if (file.size > MAX_TEXT_UPLOAD_BYTES) {
        addSystemNotice(COPY[state.lang].oversizedFile);
        return;
      }
      let text;
      try {
        text = await file.text();
      } catch (err) {
        console.error(err);
        addSystemNotice(COPY[state.lang].unreadableFile);
        return;
      }
      if (!text.trim()) {
        addSystemNotice(COPY[state.lang].emptyFile);
        return;
      }
      if (new TextEncoder().encode(text).length > MAX_TEXT_UPLOAD_BYTES) {
        addSystemNotice(COPY[state.lang].oversizedFile);
        return;
      }
      setPendingAttachment(file.name, text);
      return;
    }

    // pdf / docx — real extraction happens server-side (see the section doc comment above).
    if (file.size > MAX_BINARY_UPLOAD_BYTES) {
      addSystemNotice(COPY[state.lang].oversizedFile);
      return;
    }
    setExtractingState(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const res = await apiFetch("/documents/extract", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`Document extraction failed (${res.status}):`, body.error);
        if (body.error === "unsupported_file_type") addSystemNotice(COPY[state.lang].unsupportedFile);
        else if (body.error === "document_too_long") addSystemNotice(COPY[state.lang].oversizedFile);
        else addSystemNotice(COPY[state.lang].unreadableFile);
        return;
      }
      const { text } = await res.json();
      setPendingAttachment(file.name, text);
    } catch (err) {
      console.error(err);
      addSystemNotice(COPY[state.lang].unreadableFile);
    } finally {
      setExtractingState(false);
    }
  }

  function setExtractingState(isExtracting) {
    el.uploadBtn.setAttribute("aria-disabled", String(isExtracting));
    el.uploadBtn.classList.toggle("is-disabled", isExtracting);
    el.fileInput.disabled = isExtracting;
    el.uploadBtn.title = isExtracting ? COPY[state.lang].extracting : COPY[state.lang].uploadTitle;
  }

  /** Shows the "📄 filename / Ready to analyze" chip above the composer — the attachment
   * itself (extracted text) lives only in `state.pendingAttachment`, never rendered into
   * the DOM or a chat bubble, so a long document never shows up verbatim in the transcript. */
  function setPendingAttachment(filename, text) {
    state.pendingAttachment = { filename, text };
    el.attachmentName.textContent = filename;
    el.attachmentStatus.textContent = COPY[state.lang].attachmentReady;
    el.attachmentChip.hidden = false;
    el.input.focus();
  }

  function clearPendingAttachment() {
    state.pendingAttachment = null;
    el.attachmentChip.hidden = true;
  }

  /** The composer's single entry point for a user-authored turn (typed Send/Enter, or a
   * recognized voice transcript) — folds in a pending attachment if there is one, so
   * "attach a document, then ask a question" and "attach, then just hit Send" both work
   * from the exact same code path `submitUtterance()` itself doesn't need to know about. */
  function submitComposerInput(rawText, isVoice = false) {
    const attachment = state.pendingAttachment;
    if (!attachment) return submitUtterance(rawText, isVoice);

    const instruction = rawText.trim();
    const task = instruction || `Please summarize this document (${attachment.filename}).`;
    const utterance = `${task}\n\n[Attached document: ${attachment.filename}]\n${attachment.text}`;
    const displayText = instruction ? `📎 ${attachment.filename}\n${instruction}` : `📎 ${attachment.filename}`;
    clearPendingAttachment();
    return submitUtterance(utterance, isVoice, displayText);
  }

  // ---- Dynamic result widgets ------------------------------------------------------------
  // A skill's category (the `category` prefix of its dotted id, e.g. "research.report" ->
  // "research") decides the shape of the card its result renders as, instead of every skill
  // producing an identical text bubble. Categories not listed here (web, personal, ...) fall
  // through to the plain bubble — deliberately conservative, since a made-up shape for a
  // category no one asked to distinguish would just be decoration.
  const CATEGORY_WIDGET_KIND = {
    developer: "code",
    automation: "pill",
    research: "panel",
    business: "panel",
    creative: "panel",
    docs: "panel",
  };

  function widgetKindFor(skillId) {
    return CATEGORY_WIDGET_KIND[skillId.split(".")[0]] || null;
  }

  // Renders one turn's reply: a shaped widget when a backend skill actually ran and its
  // category has a distinct shape, a plain bubble otherwise (direct AI chat, or a category
  // with no special-cased widget). Returns the created DOM node so the caller can attach a
  // live waveform to it while the reply is being spoken.
  function renderAssistantResult(result) {
    const call = result.toolCalls && result.toolCalls[0];
    const kind = call && widgetKindFor(call.skillId);
    if (!call || !kind) return addBubble("assistant", result.message || "…");
    return addResultWidget(kind, call.skillId, call.outcome, result.message || "…");
  }

  function addResultWidget(kind, skillId, outcome, message) {
    const status = outcome.kind === "success" ? "success" : "error";

    const widget = document.createElement("div");
    widget.className = "result-widget";
    widget.dataset.kind = kind;
    widget.dataset.status = status;

    const header = document.createElement("div");
    header.className = "widget-header";
    const title = document.createElement("span");
    title.className = "widget-title";
    title.innerHTML = `<span class="widget-status-dot"></span>${categoryLabel(skillId.split(".")[0])}`;
    header.appendChild(title);

    if (kind === "code") {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "widget-copy-btn";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        haptic();
        try {
          await navigator.clipboard.writeText(message);
          copyBtn.textContent = "Copied";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.classList.remove("copied");
          }, 1500);
        } catch {
          /* Clipboard API unavailable (permissions/http) — the text is still fully visible
             and selectable in the card, so there's nothing to fall back to here. */
        }
      });
      header.appendChild(copyBtn);
    }
    widget.appendChild(header);

    const body = document.createElement("div");
    body.className = "widget-body";
    body.textContent = message;
    widget.appendChild(body);

    el.conversation.appendChild(widget);
    el.conversation.scrollTop = el.conversation.scrollHeight;
    return widget;
  }

  // A waveform + stop control attached to whichever message node is actively being spoken
  // right now — real playback state, not a decoration, so it exists only between speak()
  // actually starting audio and that audio actually ending.
  function attachWaveform(node) {
    if (!node || node.querySelector(".waveform-row")) return;
    const row = document.createElement("div");
    row.className = "waveform-row";
    row.innerHTML =
      '<div class="waveform" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>' +
      '<button type="button" class="waveform-stop" title="Stop speaking">' +
      '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>' +
      "</button>";
    row.querySelector(".waveform-stop").addEventListener("click", () => {
      haptic();
      stopSpeaking();
    });
    node.appendChild(row);
    el.conversation.scrollTop = el.conversation.scrollHeight;
  }

  function detachWaveform(node) {
    const row = node && node.querySelector(".waveform-row");
    if (row) row.remove();
  }

  // Drives both the orb's animation and the hero-status pill's pulsing dot from the same
  // state — the optimistic-UI "instant feedback" for a submitted turn (MASTER_SPEC.md §22
  // sub-second rule): this runs synchronously the moment a turn starts, well before the
  // network call resolves, so the pulse appears the same frame as the tap/Enter.
  function setOrbState(newState) {
    el.orb.dataset.state = newState;
    el.heroStatus.dataset.state = newState;
    // A natural-language status ("Working…", "काम कर रहा हूँ…"), never the raw internal
    // state name — showing enum values like "EXECUTING" or "UNDERSTANDING" verbatim would be
    // exactly the kind of developer/debug leak the product content rules rule out. The
    // `dataset.state` above (unchanged) is what CSS/animations key off of.
    const labels = COPY[state.lang].stateLabels;
    el.heroStatusLabel.textContent = labels[newState] || labels.IDLE;
    updateComposerMode();
  }

  /** Swaps the Send button into a Stop button for the whole busy span (UNDERSTANDING through
   * SPEAKING) — the composer's always-visible way to cancel a turn, alongside the
   * per-message waveform's own stop control (attachWaveform) and the Escape key. Mirrors the
   * common "Send becomes Stop while generating" pattern rather than inventing a second
   * button that would crowd the already-tight command bar. */
  function updateComposerMode() {
    const busy = isBusy();
    const copy = COPY[state.lang];
    el.sendBtn.classList.toggle("stop-mode", busy);
    el.sendBtn.title = busy ? copy.stop : copy.send;
    el.sendLabel.textContent = busy ? copy.stop : copy.send;
  }

  // A turn is "in flight" for every state between UNDERSTANDING and the SPEAKING reply —
  // used by the composer's Send/Stop toggle (updateComposerMode) and cancelCurrentTurn's
  // Escape-key guard, both via isBusy() below.
  const BUSY_STATES = ["UNDERSTANDING", "EXECUTING", "SUCCESS", "SPEAKING"];
  function isBusy() {
    return BUSY_STATES.includes(el.orb.dataset.state);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- Service worker (PWA) ---------------------------------------------------------------
  // Registered unconditionally for offline/installability support (manifest.webmanifest +
  // sw.js) — no visible Install button in the header (kept deliberately out of the topbar per
  // the product's "clean and minimal" header goal); a visitor who wants to install still can
  // via their browser's own menu (e.g. Chrome's address-bar install icon, iOS Safari's Share
  // -> Add to Home Screen).
  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.error("Service worker registration failed:", err));
    }
  }

  // ---- Voice in (STT) and out (TTS) — MASTER_SPEC.md §11 Voice Architecture, browser-native
  // Web Speech API standing in for Android's SpeechRecognizer/TextToSpeech behind the same
  // state machine, since no cloud STT/TTS credential is wired in this pass. ---------------

  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      el.micBtn.disabled = true;
      el.micBtn.title = "Voice input isn't supported in this browser — use text instead.";
      return;
    }
    recognition = new SpeechRecognition();
    recognition.interimResults = false;
    // Always a single bounded utterance — never a continuous/auto-restarting session. No
    // wake-word loop: voice input only ever runs for the span between an explicit press
    // (mic button or orb) and either a result, an explicit Stop, or the browser's own
    // silence timeout.
    recognition.continuous = false;

    recognition.addEventListener("result", (event) => {
      // A manual mic tap during UNDERSTANDING/EXECUTING is a deliberate voice interruption
      // (submitUtterance() cancels the running turn, same as tapping Send with new text
      // would) — but during SPEAKING the mic could pick up Zarvis's own audio output as if
      // it were a new command, so that phase alone is guarded.
      if (el.orb.dataset.state === "SPEAKING") return;
      const transcript = event.results[event.results.length - 1][0].transcript;
      submitComposerInput(transcript, true);
    });

    recognition.addEventListener("end", () => {
      el.micBtn.setAttribute("aria-pressed", "false");
      el.orb.setAttribute("aria-pressed", "false");
      if (el.orb.dataset.state === "LISTENING") setOrbState("IDLE");
    });

    recognition.addEventListener("error", () => {
      el.micBtn.setAttribute("aria-pressed", "false");
      el.orb.setAttribute("aria-pressed", "false");
      setOrbState("IDLE");
    });

    el.micBtn.addEventListener("click", toggleListening);
    el.orb.addEventListener("click", toggleListening);
    el.orb.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleListening();
      }
    });
  }

  /** Shared by the mic button and the orb (just a second, larger microphone target — not a
   * separate mode): a press starts one bounded voice turn, a press while already listening
   * stops it early. This is the only way voice input ever starts — never automatically, and
   * never a repeating/continuous loop. */
  function toggleListening() {
    haptic();
    if (el.orb.dataset.state === "LISTENING") stopListening();
    else startListening();
  }

  function startListening() {
    if (!recognition) return;
    recognition.lang = state.lang === "hi" ? "hi-IN" : "en-US";
    el.micBtn.setAttribute("aria-pressed", "true");
    el.orb.setAttribute("aria-pressed", "true");
    setOrbState("LISTENING");
    try {
      recognition.start();
    } catch {
      // Already running — recognition.start() throws InvalidStateError in that case.
    }
  }

  function stopListening() {
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // Not running — nothing to stop.
    }
    el.micBtn.setAttribute("aria-pressed", "false");
    el.orb.setAttribute("aria-pressed", "false");
  }

  // The browser's voice list loads asynchronously (often empty until `voiceschanged`
  // fires, especially on Android Chrome) — cache it once available rather than calling
  // getVoices() fresh inside speak(), which can return [] on the very first reply and
  // silently fall back to whatever default voice the engine picks (usually English,
  // reading Hindi text with English phonetics — the "not real Hindi" sound).
  //
  // Real caveat, stated honestly rather than oversold: the Web Speech API only ever plays
  // back whichever text-to-speech voices the OS/browser ships — on Android that's Google's
  // on-device "Google Text-to-Speech" engine. Its network-served voices are noticeably
  // better than its offline ones, but none of them are the dedicated neural voice model
  // behind the ChatGPT/Gemini apps' voice mode — that is a different, separate product
  // (e.g. Google Cloud Text-to-Speech's Neural2/Studio voices, or a Gemini "native audio"
  // model) requiring its own API credential and a real backend call, not a browser API.
  // See DEVELOPMENT.md "Voice quality" for that upgrade path.

  function setupSpeechSynthesis() {
    if (!window.speechSynthesis) return;
    const loadVoices = () => {
      cachedVoices = window.speechSynthesis.getVoices();
      populateVoiceSelect();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    el.voiceSelect.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEYS.voiceURI, el.voiceSelect.value);
    });
  }

  function voicesForCurrentLang() {
    const langPrefix = state.lang === "hi" ? "hi" : "en";
    return cachedVoices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }

  function populateVoiceSelect() {
    const candidates = voicesForCurrentLang();
    el.voiceSelect.innerHTML = "";
    if (candidates.length <= 1) {
      el.voiceSelect.hidden = true;
      return;
    }
    for (const voice of candidates) {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name}${voice.localService ? "" : " ☁"}`;
      el.voiceSelect.appendChild(option);
    }
    const saved = localStorage.getItem(STORAGE_KEYS.voiceURI);
    const defaultVoice = saved && candidates.some((v) => v.voiceURI === saved) ? saved : pickVoice(state.lang === "hi" ? "hi" : "en").voiceURI;
    el.voiceSelect.value = defaultVoice;
    el.voiceSelect.hidden = false;
  }

  function pickVoice(langPrefix) {
    const saved = localStorage.getItem(STORAGE_KEYS.voiceURI);
    if (saved) {
      const found = cachedVoices.find((v) => v.voiceURI === saved && v.lang.toLowerCase().startsWith(langPrefix));
      if (found) return found;
    }
    const candidates = cachedVoices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
    // Prefer a network voice: on Android's Google TTS engine these are the higher-quality
    // ones, while the offline/local voice is usually the more robotic-sounding fallback.
    return candidates.find((v) => !v.localService) || candidates[0];
  }

  // Tries Gemini's native audio voice first (POST /api/v1/tts/synthesize — the same voice
  // technology behind the Gemini app's voice mode, see AI_ARCHITECTURE.md "Native audio
  // voice"), falling back to the browser's built-in speechSynthesis if that backend call
  // fails for any reason (not configured, offline, rate-limited, ...) — never a silent dead
  // end, per Product Principle #4.
  async function speak(text, node) {
    if (!state.speak || !text) return;
    setOrbState("SPEAKING");
    if (node) attachWaveform(node);
    let playedLive = false;
    try {
      playedLive = await speakWithGemini(text);
    } catch (err) {
      // An explicit Stop (waveform button, composer Stop, or a new turn interrupting this
      // one) must not then fall back to the browser's own voice reading the same reply —
      // that would ignore the very "stop talking" the user just asked for. A real Gemini
      // failure (network, no credential, rate limit, ...) still falls back below.
      if (err.name === "AbortError") {
        if (node) detachWaveform(node);
        return;
      }
      console.warn("Gemini voice unavailable, falling back to the browser's voice:", err);
    }
    if (!playedLive) await speakWithBrowser(text);
    if (node) detachWaveform(node);
  }

  // Tracks whatever is currently producing audio/network activity so stopSpeaking() can
  // actually interrupt it, however far it's gotten: `activeTtsController` cancels the
  // /tts/synthesize request itself if Stop is hit before any audio exists yet, `activeAudio`
  // pauses the Gemini path's playback once it does, and speechSynthesis.cancel() below
  // covers the browser-fallback path — only one of these is ever relevant at a time,
  // matching speak()'s own try-Gemini-then-fall-back sequencing.
  let activeAudio = null;
  let activeTtsController = null;

  async function speakWithGemini(text) {
    const controller = new AbortController();
    activeTtsController = controller;
    let res;
    try {
      res = await apiFetch("/tts/synthesize", { method: "POST", body: JSON.stringify({ text }), signal: controller.signal });
    } finally {
      activeTtsController = null;
    }
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    activeAudio = audio;
    try {
      await new Promise((resolve, reject) => {
        audio.addEventListener("ended", resolve, { once: true });
        // Fires when stopSpeaking() calls audio.pause() for a manual stop, so the awaited
        // promise settles instead of hanging until the tab is closed.
        audio.addEventListener("pause", resolve, { once: true });
        audio.addEventListener("error", () => reject(new Error("Audio playback failed")), { once: true });
        audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
      activeAudio = null;
    }
    setOrbState("IDLE");
    return true;
  }

  // Interrupts whichever voice is currently speaking (tapped from the waveform's stop
  // control, the composer's Stop button, or a new turn superseding this one) — mirrors the
  // mic/orb's existing "never leave the user stuck mid-interaction" behavior for playback.
  function stopSpeaking() {
    if (activeTtsController) activeTtsController.abort();
    if (activeAudio) activeAudio.pause();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setOrbState("IDLE");
  }

  // Returns a Promise that settles once playback actually finishes (naturally, on error, or
  // via stopSpeaking()'s cancel()) — previously fire-and-forget, which silently broke the
  // "await speak() so the orb/waveform reflect the real playback duration" contract for
  // this fallback path specifically (the Gemini path above already awaited correctly).
  function speakWithBrowser(text) {
    if (!window.speechSynthesis) {
      setOrbState("IDLE");
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const langPrefix = state.lang === "hi" ? "hi" : "en";
      utterance.lang = state.lang === "hi" ? "hi-IN" : "en-US";
      const voice = pickVoice(langPrefix);
      if (voice) utterance.voice = voice;
      const finish = () => {
        setOrbState("IDLE");
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });
  }
})();
