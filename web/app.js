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
    ttsVoice: "zarvis.ttsVoice",
    userName: "zarvis.userName",
    conversationId: "zarvis.conversationId",
  };

  const API_BASE = resolveApiBase();

  // A display name used to be pre-filled here with a fixed person's name for every visitor.
  // Nothing in the UI ever set it, so it is removed rather than sent with requests.
  try {
    localStorage.removeItem(STORAGE_KEYS.userName);
  } catch {}

  const Logic = window.ZarvisLogic;
  // Declared before init() runs: populateVoiceSelect() uses it during startup, and a `const`
  // declared further down would still be in its temporal dead zone at that point.
  const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir"];
  // Also declared up front for the same reason (used by the session code during init()).
  class SessionEndedError extends Error {}
  let refreshInFlight = null;
  let capabilityCache = null;
  const SESSION_GATE_COPY = {
    signed_out: ["You're signed out", "Sign in with your email, or start a new guest account on this browser."],
    account_deleted: ["Your account was deleted", "Start a new guest account, or sign in to a different account."],
    refresh_token_reused: ["Your session was ended for your security", "A sign-in token was used twice, so ZARVIS ended the session. ZARVIS did not create a new account for you."],
  };

  const SESSION_KEYS = { isGuest: "zarvis.isGuest", email: "zarvis.email", ended: "zarvis.sessionEnded" };

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
    viewHome: document.getElementById("view-home"),
    viewWorkspace: document.getElementById("view-chat"),
    viewCapabilities: document.getElementById("view-capabilities"),
    viewPlans: document.getElementById("view-plans"),
    viewMetrics: document.getElementById("view-metrics"),
    viewActivity: document.getElementById("view-activity"),
    viewDeveloper: document.getElementById("view-developer"),
    viewSettings: document.getElementById("view-settings"),
    viewFeature: document.getElementById("view-feature"),
    featureRoot: document.getElementById("feature-root"),
    capabilityHub: document.getElementById("capability-hub"),
    settingsSubpageTitle: document.getElementById("settings-subpage-title"),
    chatAnnouncer: document.getElementById("chat-announcer"),
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
    settingsGrid: document.getElementById("settings-grid"),
    settingsPanels: document.getElementById("settings-panels"),
    settingsPanelBack: document.querySelector("[data-settings-back]"),
    appearanceAuroraBtn: document.getElementById("appearance-aurora-btn"),
    appearanceDimBtn: document.getElementById("appearance-dim-btn"),
    settingsOpenDeveloper: document.getElementById("settings-open-developer"),
    activityTaskList: document.getElementById("activity-task-list"),
    activityRefreshBtn: document.getElementById("activity-refresh-btn"),
    activityMetricsBtn: document.getElementById("activity-metrics-btn"),
    developerEntryLink: document.getElementById("developer-entry-link"),
    developerBackBtn: document.getElementById("developer-back-btn"),
    chatBackBtn: document.getElementById("chat-back-btn"),
    openChatBtn: document.getElementById("open-chat-btn"),
    homeDeveloperCard: document.getElementById("home-developer-card"),
    developerRepoInput: document.getElementById("developer-repo-input"),
    developerAnalyzeBtn: document.getElementById("developer-analyze-btn"),
    developerRequirementInput: document.getElementById("developer-requirement-input"),
    developerImplementBtn: document.getElementById("developer-implement-btn"),
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
    activeView: "home",
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
    // Server-side durable conversation id. The browser keeps only this pointer; the
    // conversation messages themselves live in the backend/Postgres store.
    conversationId: localStorage.getItem(STORAGE_KEYS.conversationId) || null,
    appearance: localStorage.getItem("zarvis.appearance") || "aurora",
    settingsPage: null,
    featureId: null,
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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitComposerInput(el.input.value);
      }
      if (e.key === "Escape" && isBusy() && el.confirmModal.hidden) cancelCurrentTurn();
    });
    el.input.addEventListener("input", resizeComposer);
    el.fileInput.addEventListener("change", handleFileSelected);
    el.attachmentRemoveBtn.addEventListener("click", () => {
      haptic();
      clearPendingAttachment();
    });

    // Secondary UI initialization is isolated per feature. One optional browser API or
    // non-critical screen must never prevent the other buttons from receiving handlers.
    const optionalInitializers = [
      ["speech synthesis", setupSpeechSynthesis],
      ["language UI", applyLanguage],
      ["voice toggle", applyVoiceToggleState],
      ["speech recognition", setupSpeechRecognition],
      ["service worker", registerServiceWorker],
      ["navigation", setupBottomNav],
      ["home feature links", setupHomeFeatures],
      ["capability pages", setupCapabilityPages],
      ["plans", setupPlans],
      ["settings", setupSettings],
      ["session gate", setupSessionGate],
      ["account", setupAccountPanel],
      ["developer", setupDeveloper],
      ["github", setupGithubConnect],
    ];
    for (const [name, initialize] of optionalInitializers) {
      try {
        initialize();
      } catch (err) {
        console.error("Zarvis optional UI initialization failed (" + name + "):", err);
      }
    }

    try {
      await ensureSession();
      void restoreConversation();
      const results = await Promise.allSettled([loadSkills(), fetchTasks()]);
      if (results.some((result) => result.status === "rejected" && result.reason instanceof SessionEndedError)) return;
      for (const result of results) {
        if (result.status === "rejected") console.error("Zarvis startup data failed:", result.reason);
      }
      if (results.every((result) => result.status === "rejected")) {
        addErrorBubble(COPY[state.lang].bootError, () => location.reload());
        setOrbState("ERROR");
        return;
      }
    } catch (err) {
      if (err instanceof SessionEndedError) return; // the session gate is showing
      console.error("Zarvis session bootstrap failed:", err);
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
    document.documentElement.lang = state.lang === "hi" ? "hi" : "en";
    el.micBtn.setAttribute("aria-label", copy.mic || "Speak");
    if (!el.sendBtn.classList.contains("stop-mode")) el.sendBtn.setAttribute("aria-label", copy.send || "Send");
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

  // ---- Session (guest bootstrap, refresh rotation, explicit sign-in) ---------------------
  // The server rotates refresh tokens on every use and revokes the whole session if an old
  // one is replayed. So: (1) refreshes are de-duplicated within this tab and serialized
  // across tabs with the Web Locks API, and (2) a failed refresh NEVER creates a new account
  // silently — only an explicit session_* code ends the session, and then the user chooses
  // (sign in, or start a new guest account). Network/5xx failures keep the same account.

  async function ensureSession() {
    if (localStorage.getItem(STORAGE_KEYS.accessToken)) return;
    const ended = localStorage.getItem(SESSION_KEYS.ended);
    if (ended) {
      showSessionGate(ended);
      throw new SessionEndedError(ended);
    }
    await createGuestSession();
  }

  async function createGuestSession() {
    const res = await fetch(`${API_BASE}/auth/guest`, { method: "POST" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Guest account creation failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }
    storeTokens(await res.json());
  }

  function storeTokens(tokens) {
    localStorage.setItem(STORAGE_KEYS.accessToken, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
    localStorage.setItem(SESSION_KEYS.isGuest, String(tokens.isGuest !== false));
    if (tokens.email) localStorage.setItem(SESSION_KEYS.email, tokens.email);
    else localStorage.removeItem(SESSION_KEYS.email);
    localStorage.removeItem(SESSION_KEYS.ended);
  }

  function clearSessionTokens() {
    for (const key of [STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken, STORAGE_KEYS.conversationId, SESSION_KEYS.isGuest]) {
      localStorage.removeItem(key);
    }
    state.conversationId = null;
    state.history = [];
  }

  /** Ends the session locally (tokens are useless now) and asks the user what to do next. */
  function endSession(reason) {
    clearSessionTokens();
    localStorage.setItem(SESSION_KEYS.ended, reason);
    showSessionGate(reason);
  }

  async function apiFetch(path, options = {}, retried = false) {
    const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
    if (!accessToken) {
      const ended = localStorage.getItem(SESSION_KEYS.ended);
      if (ended) {
        showSessionGate(ended);
        throw new SessionEndedError(ended);
      }
    }
    // A FormData body (document upload) must NOT get a manual content-type: the browser sets
    // its own multipart boundary.
    const isFormData = options.body instanceof FormData;
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
    if (res.status !== 401 || retried) return res;

    const outcome = await refreshSession(accessToken);
    if (outcome.kind === "refreshed") return apiFetch(path, options, true);
    if (outcome.kind === "session_ended") {
      endSession(outcome.code);
      throw new SessionEndedError(outcome.code);
    }
    return res; // unreachable: surface the failure honestly; the same account is kept.
  }

  /** Refreshes once per tab, serialized across tabs; reuses a token another tab already rotated. */
  function refreshSession(tokenOnFailedRequest) {
    if (!refreshInFlight) {
      const run = async () => {
        const stored = localStorage.getItem(STORAGE_KEYS.accessToken);
        if (stored && stored !== tokenOnFailedRequest) return { kind: "refreshed" };
        return doRefresh();
      };
      const locked = navigator.locks?.request ? navigator.locks.request("zarvis-refresh", run) : run();
      refreshInFlight = Promise.resolve(locked).finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function doRefresh() {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
    if (!refreshToken) return { kind: "session_ended", code: "session_invalid" };
    let res;
    try {
      res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      return { kind: "unreachable" };
    }
    if (res.ok) {
      storeTokens(await res.json());
      return { kind: "refreshed" };
    }
    const body = await res.json().catch(() => ({}));
    return Logic.classifyRefreshFailure(res.status, body.code) === "session_ended"
      ? { kind: "session_ended", code: body.code }
      : { kind: "unreachable" };
  }


  function showSessionGate(reason) {
    const gate = document.getElementById("session-gate");
    if (!gate || !gate.hidden) return;
    const [title, body] = SESSION_GATE_COPY[reason] || [
      "Your session has ended",
      "You were signed out on the server (for example from another device). ZARVIS did not create a new account for you.",
    ];
    document.getElementById("session-gate-title").textContent = title;
    document.getElementById("session-gate-body").textContent = body;
    const email = localStorage.getItem(SESSION_KEYS.email);
    if (email) document.getElementById("session-gate-email").value = email;
    document.getElementById("session-gate-error").hidden = true;
    gate.hidden = false;
    document.getElementById("session-gate-email").focus();
  }

  function setupSessionGate() {
    const gate = document.getElementById("session-gate");
    const errorNode = document.getElementById("session-gate-error");
    const fail = (message) => {
      errorNode.textContent = message;
      errorNode.hidden = false;
    };
    document.getElementById("session-gate-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("session-gate-email").value.trim();
      const password = document.getElementById("session-gate-password").value;
      try {
        await signInWithEmail(email, password);
        location.reload();
      } catch (err) {
        fail(err.message);
      }
    });
    document.getElementById("session-gate-guest").addEventListener("click", async () => {
      try {
        clearSessionTokens();
        await createGuestSession();
        location.reload();
      } catch (err) {
        console.error(err);
        fail("Couldn't reach ZARVIS. Check your connection and try again.");
      }
    });
    gate.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.preventDefault(); // the gate must be answered
    });
  }

  function authErrorMessage(status, code) {
    if (code === "email_taken") return "That email already belongs to another ZARVIS account. Sign in with it instead.";
    if (code === "invalid_credentials") return "Email or password is incorrect.";
    if (code === "not_guest") return "This account already has a sign-in email.";
    if (code === "rate_limited" || status === 429) return "Too many attempts. Wait a few minutes and try again.";
    if (status === 400) return "Check the email address, and use a password of at least 8 characters.";
    return "That didn't work (HTTP " + status + "). Try again.";
  }

  async function signInWithEmail(email, password) {
    let res;
    try {
      res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error("Couldn't reach ZARVIS. Check your connection and try again.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(authErrorMessage(res.status, body.code));
    clearSessionTokens();
    storeTokens(body);
  }

  async function signOut() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (err) {
      console.warn("Server sign-out failed; clearing this browser's session anyway:", err);
    }
    endSession("signed_out");
  }

  // ---- Account settings (link guest → email for cross-device continuity) ----------------

  async function refreshAccountPanel() {
    const status = document.getElementById("account-status");
    const linkForm = document.getElementById("account-link-form");
    const signinNote = document.getElementById("account-signin-note");
    const signinTitle = document.getElementById("account-signin-title");
    if (!status) return;
    try {
      const res = await apiFetch("/auth/me");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const me = await res.json();
      localStorage.setItem(SESSION_KEYS.isGuest, String(me.isGuest));
      if (me.email) localStorage.setItem(SESSION_KEYS.email, me.email);
      status.textContent = me.isGuest
        ? "Guest account on this browser. It has no sign-in email yet, so it only exists here. Link an email to use the same account on your phone or another browser."
        : "Signed in as " + me.email + ". Use this email on your phone or another browser to continue the same conversations and tasks.";
      linkForm.hidden = !me.isGuest;
      signinNote.hidden = !me.isGuest;
      signinTitle.textContent = me.isGuest ? "Or sign in to a different account" : "Sign in to a different account";
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      status.textContent = "Couldn't load account details. Check your connection.";
    }
  }

  function setupAccountPanel() {
    const errorNode = document.getElementById("account-error");
    const infoNode = document.getElementById("account-info");
    const show = (node, text) => {
      errorNode.hidden = true;
      infoNode.hidden = true;
      node.textContent = text;
      node.hidden = false;
    };
    document.getElementById("account-link-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("account-link-email").value.trim();
      const password = document.getElementById("account-link-password").value;
      try {
        const res = await apiFetch("/auth/link", { method: "POST", body: JSON.stringify({ email, password }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(authErrorMessage(res.status, body.code));
        show(infoNode, "Linked. Sign in with " + body.email + " on your phone or another browser to continue with this same account.");
        document.getElementById("account-link-password").value = "";
        await refreshAccountPanel();
      } catch (err) {
        if (!(err instanceof SessionEndedError)) show(errorNode, err.message);
      }
    });
    document.getElementById("account-signin-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("account-signin-email").value.trim();
      const password = document.getElementById("account-signin-password").value;
      try {
        await signInWithEmail(email, password);
        location.reload();
      } catch (err) {
        show(errorNode, err.message);
      }
    });
  }

  // ---- Conversation recovery ---------------------------------------------------------------
  // After a reload (or on another browser signed into the same account) only real,
  // server-persisted messages are shown — nothing is reconstructed or invented.

  async function restoreConversation() {
    if (!state.conversationId || el.conversation.children.length > 0) return;
    try {
      const res = await apiFetch(`/conversations/${encodeURIComponent(state.conversationId)}/messages`);
      if (res.status === 404) {
        state.conversationId = null;
        localStorage.removeItem(STORAGE_KEYS.conversationId);
        return;
      }
      if (!res.ok) return;
      const body = await res.json();
      for (const message of body.messages || []) {
        addBubble(message.role === "user" ? "user" : "assistant", message.content);
        state.history.push({ role: message.role, content: message.content });
      }
      state.history = state.history.slice(-12);
      if ((body.messages || []).length) state.firstTurn = false;
    } catch (err) {
      if (!(err instanceof SessionEndedError)) console.warn("Conversation restore failed:", err);
    }
  }

  // ---- Permissions & Device Access (Phase 1 capability registry) -------------------------

  async function microphonePermissionState() {
    try {
      if (!navigator.permissions?.query) return null;
      const status = await navigator.permissions.query({ name: "microphone" });
      return status.state;
    } catch {
      return null; // e.g. Firefox/Safari don't expose it — reported as "browser decides".
    }
  }

  async function renderPermissionCenter() {
    const list = document.getElementById("permission-center-list");
    if (!list) return;
    list.textContent = "Loading…";
    try {
      if (!capabilityCache) {
        const res = await fetch(`${API_BASE}/capabilities`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        capabilityCache = (await res.json()).capabilities;
      }
    } catch (err) {
      console.error(err);
      list.textContent = "Couldn't load the capability list. Check your connection.";
      return;
    }
    const mic = await microphonePermissionState();
    list.textContent = "";
    for (const capability of capabilityCache) {
      const item = document.createElement("article");
      item.className = "capability-item";
      item.dataset.capability = capability.id;

      const header = document.createElement("header");
      const name = document.createElement("strong");
      name.textContent = capability.name;
      const risk = document.createElement("span");
      risk.className = "z-badge";
      risk.textContent = Logic.riskLabel(capability.risk);
      header.append(name, risk);

      const status = document.createElement("p");
      status.className = "capability-status";
      status.textContent =
        "Web: " + Logic.capabilityStatusLabel(capability.platforms.web.status) +
        " · Android: " + Logic.capabilityStatusLabel(capability.platforms.android.status);

      const access = document.createElement("p");
      access.className = "capability-access";
      access.textContent = Logic.webAccessSummary(capability, mic);

      item.append(header, status, access);
      if (capability.confirmation === "PER_ACTION") {
        const note = document.createElement("small");
        note.textContent = "Every action asks for your confirmation.";
        item.appendChild(note);
      }

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Learn more";
      const dl = document.createElement("dl");
      const rows = [
        ["Why", capability.rationale.why],
        ["What data", capability.rationale.data],
        ["What ZARVIS won't do automatically", capability.rationale.notAutomatic],
        ["How to revoke", capability.rationale.revoke],
        ["On the web", capability.platforms.web.note],
        ["On Android", capability.platforms.android.note],
        ["Supported", capability.supportedActions.join("; ") || "—"],
        ["Not supported", capability.unsupportedActions.join("; ")],
        ["If you say no", capability.denialBehavior + " " + capability.fallback],
      ];
      for (const [label, value] of rows) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        dl.append(dt, dd);
      }
      details.append(summary, dl);
      item.appendChild(details);
      list.appendChild(item);
    }
  }

  // ---- Server-issued confirmations -------------------------------------------------------
  // A higher-risk action returns `confirmation_required` with a one-time id bound to that
  // exact action. Approve/decline resolves *that id*; nothing is ever re-sent with a flag.

  function renderConfirmationCard(confirmation, container = el.conversation) {
    const card = document.createElement("div");
    card.className = "confirm-card";
    card.dataset.confirmationId = confirmation.id;
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "Confirmation needed");

    const title = document.createElement("strong");
    title.textContent = "Confirm this action · " + Logic.riskLabel(confirmation.riskLevel);
    const action = document.createElement("p");
    action.className = "confirm-action";
    action.textContent = confirmation.action;
    const note = document.createElement("small");
    const expires = new Date(confirmation.expiresAt);
    note.textContent = "Nothing has been done yet. This approval works once, for this action only" +
      (Number.isNaN(expires.getTime()) ? "." : ", until " + expires.toLocaleTimeString() + ".");

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "zarvis-btn zarvis-btn-secondary";
    decline.textContent = "Decline";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "zarvis-btn zarvis-btn-primary";
    approve.textContent = "Approve";
    actions.append(decline, approve);

    const resolve = async (verb) => {
      approve.disabled = true;
      decline.disabled = true;
      approve.textContent = verb === "approve" ? "Running…" : "Approve";
      try {
        const res = await apiFetch(`/confirmations/${encodeURIComponent(confirmation.id)}/${verb}`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) {
          note.textContent = "This confirmation expired or was already used. Nothing was run. Ask again if you still want it.";
          return;
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        actions.remove();
        note.textContent = Logic.toolStatusLabel(body.result?.status) + ".";
        if (container === el.conversation) addBubble("assistant", body.message || "Done.");
        else renderDeveloperMessage(body.message || "Done.", body.result?.success ? "success" : "error");
      } catch (err) {
        if (err instanceof SessionEndedError) return;
        console.error(err);
        note.textContent = "Couldn't reach ZARVIS, so nothing was confirmed. Try again.";
        approve.disabled = false;
        decline.disabled = false;
        approve.textContent = "Approve";
      }
    };
    approve.addEventListener("click", () => void resolve("approve"));
    decline.addEventListener("click", () => void resolve("decline"));

    card.append(title, action, note, actions);
    container.appendChild(card);
    if (container === el.conversation) scrollConversationToBottom();
    return card;
  }

  // ---- GitHub connection (Developer Agent runs as the user's own GitHub identity) -------

  async function refreshGithubStatus() {
    const statusNode = document.getElementById("github-status");
    const form = document.getElementById("github-connect-form");
    const disconnect = document.getElementById("github-disconnect-btn");
    if (!statusNode) return;
    try {
      const res = await apiFetch("/integrations/github");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const status = await res.json();
      if (!status.available) {
        statusNode.textContent = "GitHub connection isn't configured on this server. Public repositories can still be analyzed.";
        form.hidden = true;
        disconnect.hidden = true;
      } else if (status.connected) {
        statusNode.textContent = "Connected as " + status.login + ". Analysis and pull requests run as this GitHub account.";
        form.hidden = true;
        disconnect.hidden = false;
      } else {
        statusNode.textContent = "Not connected. Public repositories can be analyzed anonymously; private repositories and pull requests need your own token.";
        form.hidden = false;
        disconnect.hidden = true;
      }
    } catch (err) {
      if (!(err instanceof SessionEndedError)) statusNode.textContent = "Couldn't check the GitHub connection.";
    }
  }

  function setupGithubConnect() {
    const form = document.getElementById("github-connect-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("github-token-input");
      const statusNode = document.getElementById("github-status");
      const token = input.value.trim();
      if (!token) return;
      statusNode.textContent = "Verifying with GitHub…";
      try {
        const res = await apiFetch("/integrations/github", { method: "POST", body: JSON.stringify({ token }) });
        const body = await res.json().catch(() => ({}));
        input.value = "";
        if (!res.ok) {
          statusNode.textContent = body.error || "GitHub connection failed.";
          return;
        }
        await refreshGithubStatus();
      } catch (err) {
        if (!(err instanceof SessionEndedError)) statusNode.textContent = "Couldn't reach ZARVIS.";
      }
    });
    document.getElementById("github-disconnect-btn").addEventListener("click", async () => {
      try {
        await apiFetch("/integrations/github", { method: "DELETE" });
      } finally {
        await refreshGithubStatus();
      }
    });
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
        setActiveView("chat");
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

  // Public navigation surface. Internal developer/diagnostic screens are deliberately
  // excluded from the consumer web app; their implementation remains available for private
  // owner/developer builds without exposing technical details in normal navigation.
  const VIEWS = {
    home: el.viewHome,
    chat: el.viewWorkspace,
    capabilities: el.viewCapabilities,
    plans: el.viewPlans,
    activity: el.viewActivity,
    settings: el.viewSettings,
    feature: el.viewFeature,
    phone: document.getElementById("view-phone"),
    files: document.getElementById("view-files"),
    research: document.getElementById("view-research"),
    creative: document.getElementById("view-creative"),
    business: document.getElementById("view-business"),
    developer: document.getElementById("view-developer"),
    work: document.getElementById("view-work"),
  };
  const WORK_VIEWS = new Set(["capabilities", "phone", "files", "research", "creative", "business", "developer", "plans", "feature"]);

  function setupBottomNav() {
    document.body.dataset.activeView = state.activeView;
    applyAppearance();
    // Home is informational only. The composer belongs exclusively to the Chat workspace.
    el.composer.hidden = state.activeView !== "chat";
    for (const item of el.navItems) {
      item.addEventListener("click", () => {
        haptic();
        setActiveView(item.dataset.view);
      });
    }
    el.settingsBtn?.addEventListener("click", () => {
      haptic();
      setActiveView("settings");
    });
    el.settingsBackBtn?.addEventListener("click", () => setActiveView("home"));
    el.developerBackBtn?.addEventListener("click", () => setActiveView("capabilities"));
    el.chatBackBtn.addEventListener("click", () => setActiveView("home"));
    for (const btn of document.querySelectorAll("[data-home-view]")) {
      btn.addEventListener("click", () => setActiveView(btn.dataset.homeView));
    }
    el.activityRefreshBtn?.addEventListener("click", () => refreshActivity());
    el.activityMetricsBtn?.addEventListener("click", () => setActiveView("metrics"));
    el.openChatBtn?.addEventListener("click", () => setActiveView("chat"));
    el.homeDeveloperCard?.addEventListener("click", () => setActiveView("developer"));
    setupHomeAsk();
    setupWorkspacePrompts();
  }

  // Home feature cards are real entry points into the same Chat pipeline — no fake
  // demo pages and no duplicated feature logic. A tap opens Chat, pre-fills a useful
  // request, and leaves the final wording editable before the user sends it.
  function setupHomeFeatures() {
    for (const card of document.querySelectorAll("[data-feature-page]")) {
      card.addEventListener("click", () => {
        haptic();
        openFeature(card.dataset.featurePage);
      });
    }
  }

  function setupCapabilityPages() {
    if (el.capabilityHub && window.ZarvisFeatures) {
      window.ZarvisFeatures.renderHub(el.capabilityHub);
      el.capabilityHub.addEventListener("click", (event) => {
        const button = event.target.closest("[data-feature-page]");
        if (!button) return;
        haptic();
        openFeature(button.dataset.featurePage);
      });
    }
  }

  function openFeature(id) {
    state.featureId = id;
    if (!el.featureRoot || !window.ZarvisFeatures) return;
    window.ZarvisFeatures.renderDetail(el.featureRoot, id, {
      onBack: () => setActiveView("capabilities"),
      onPrimary: (feature) => runFeatureAction(feature, feature.prompt),
      onPrompt: (feature, prompt) => runFeatureAction(feature, prompt),
    });
    if (state.activeView === "feature") return;
    setActiveView("feature");
  }

  function runFeatureAction(feature, prompt) {
    if (feature.action === "voice") {
      setActiveView("chat");
      startListening();
      return;
    }
    if (feature.action === "attach") {
      setActiveView("chat");
      el.input.value = prompt || feature.prompt || "";
      resizeComposer();
      el.fileInput.click();
      return;
    }
    if (feature.action === "phone" || feature.id === "phone") {
      setActiveView("phone");
      return;
    }
    if (feature.action === "developer" && (!prompt || prompt === feature.prompt)) {
      setActiveView("developer");
      return;
    }
    setActiveView("chat");
    el.input.value = prompt || "";
    resizeComposer();
    el.input.focus();
    const length = el.input.value.length;
    requestAnimationFrame(() => el.input.setSelectionRange(length, length));
  }

  function resizeComposer() {
    if (!el.input) return;
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 96) + "px";
  }

  function announceChat(text) {
    if (!el.chatAnnouncer || !text) return;
    el.chatAnnouncer.textContent = "";
    el.chatAnnouncer.textContent = text;
  }

  function setupHomeAsk() {
    const input = document.getElementById("home-ask-input");
    const send = document.getElementById("home-ask-send");
    if (!input || !send) return;
    const ask = () => {
      const text = input.value.trim();
      if (!text) {
        setActiveView("chat");
        el.input.focus();
        return;
      }
      input.value = "";
      setActiveView("chat");
      submitComposerInput(text);
    };
    send.addEventListener("click", ask);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        ask();
      }
    });
    document.getElementById("home-ask-mic")?.addEventListener("click", () => {
      setActiveView("chat");
      startListening();
    });
    document.getElementById("home-ask-attach")?.addEventListener("click", () => {
      setActiveView("chat");
      el.fileInput.click();
    });
    document.getElementById("files-attach-btn")?.addEventListener("click", () => el.fileInput.click());
  }

  function setupWorkspacePrompts() {
    document.querySelectorAll("[data-workspace-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveView("chat");
        el.input.value = button.dataset.workspacePrompt || "";
        resizeComposer();
        el.input.focus();
      });
    });
  }

  function selectedTtsVoice() {
    return localStorage.getItem(STORAGE_KEYS.ttsVoice) || "Kore";
  }

  function setActiveView(view) {
    if (view === "tasks") view = "activity";
    if (!VIEWS[view] || (state.activeView === view && view !== "feature")) return;
    if (state.activeView === "metrics") stopMetricsPolling();
    if (state.activeView === "settings" && view !== "settings") closeSettingsPage();

    state.activeView = view;
    document.body.dataset.activeView = view;
    for (const [name, section] of Object.entries(VIEWS)) {
      if (section) section.hidden = name !== view;
    }
    const navView = view === "feature" ? "capabilities" : view;
    for (const item of el.navItems) {
      const target = item.dataset.view;
      const inBottom = Boolean(item.closest(".bottom-nav"));
      const active = target === navView || (inBottom && target === "work" && WORK_VIEWS.has(view));
      item.classList.toggle("active", active);
      if (item.getAttribute("role") !== "tab") item.setAttribute("aria-current", active ? "page" : "false");
    }
    el.composer.hidden = view !== "chat";

    if (view === "capabilities") renderCapabilities();
    if (view === "plans") refreshPlans();
    if (view === "metrics") {
      renderLatencyLog();
      refreshMetricsHealth();
      refreshTasks();
      startMetricsPolling();
    }
    if (view === "activity") refreshActivity();
    if (view === "home") renderHomeActivity();
    if (view === "developer") void refreshGithubStatus();
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

  function showConfirmModal({ title, body, confirmLabel = "Confirm", destructive = false, onConfirm }) {
    const opener = document.activeElement;
    el.confirmModalTitle.textContent = title;
    el.confirmModalBody.textContent = body;
    el.confirmModalConfirm.textContent = confirmLabel;
    el.confirmModalConfirm.classList.toggle("zarvis-btn-danger", destructive);
    el.confirmModalConfirm.classList.toggle("zarvis-btn-primary", !destructive);
    el.confirmModal.hidden = false;
    el.confirmModalCancel.focus();

    const close = () => {
      el.confirmModal.hidden = true;
      el.confirmModalConfirm.removeEventListener("click", handleConfirm);
      el.confirmModalCancel.removeEventListener("click", close);
      el.confirmModal.removeEventListener("keydown", onKey);
      el.confirmModal.removeEventListener("click", onScrim);
      if (opener && typeof opener.focus === "function") opener.focus();
    };
    const handleConfirm = () => {
      close();
      onConfirm();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [el.confirmModalCancel, el.confirmModalConfirm];
      const first = nodes[0];
      const last = nodes[1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onScrim = (event) => {
      if (event.target === el.confirmModal) close();
    };
    el.confirmModalConfirm.addEventListener("click", handleConfirm);
    el.confirmModalCancel.addEventListener("click", close);
    el.confirmModal.addEventListener("keydown", onKey);
    el.confirmModal.addEventListener("click", onScrim);
  }

  // ---- Settings ----------------------------------------------------------------------------
  // Language, spoken-reply toggle, and Memory & Data controls — mirrors the Android Settings
  // screen's own sections (feature-settings/SettingsScreen.kt) and, for account deletion,
  // its exact backend call (DELETE /api/v1/account, already wired server-side).

  function setupSettings() {
    for (const btn of document.querySelectorAll("[data-settings-page]")) {
      btn.addEventListener("click", () => openSettingsPage(btn.dataset.settingsPage));
    }
    el.settingsPanelBack?.addEventListener("click", closeSettingsPage);
    el.appearanceAuroraBtn?.addEventListener("click", () => setAppearance("aurora"));
    el.appearanceDimBtn?.addEventListener("click", () => setAppearance("dim"));
    el.settingsOpenDeveloper?.addEventListener("click", () => setActiveView("developer"));
    for (const btn of document.querySelectorAll("[data-settings-open-privacy]")) {
      btn.addEventListener("click", () => openSettingsPage("privacy"));
    }
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
      const isGuest = localStorage.getItem(SESSION_KEYS.isGuest) !== "false";
      showConfirmModal({
        title: "Sign out?",
        body: isGuest
          ? "This is a guest account with no sign-in email. After signing out you can't get back into it. Link an email in Account first if you want to keep it."
          : "This ends the session on this browser. Sign in again with your email to continue.",
        confirmLabel: "Sign out",
        destructive: isGuest,
        onConfirm: () => void signOut(),
      });
    });
    el.settingsDeleteBtn.addEventListener("click", () => {
      haptic();
      el.settingsDeleteError.hidden = true;
      showConfirmModal({
        title: "Delete your account?",
        body: "This permanently deletes your account, tasks, and usage history from the server. This cannot be undone.",
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: deleteAccount,
      });
    });
  }

  function openSettingsPage(page) {
    state.settingsPage = page;
    el.viewSettings.classList.add("is-subpage");
    el.settingsGrid.hidden = true;
    el.settingsPanels.hidden = false;
    const entry = document.querySelector(`[data-settings-page="${page}"] strong`);
    if (el.settingsSubpageTitle) el.settingsSubpageTitle.textContent = entry ? entry.textContent : "Settings";
    for (const panel of document.querySelectorAll("[data-settings-panel]")) {
      panel.hidden = panel.dataset.settingsPanel !== page;
    }
    if (page === "account") void refreshAccountPanel();
    if (page === "permissions") void renderPermissionCenter();
    el.settingsPanelBack?.focus?.();
  }

  function closeSettingsPage() {
    state.settingsPage = null;
    el.viewSettings.classList.remove("is-subpage");
    el.settingsPanels.hidden = true;
    el.settingsGrid.hidden = false;
  }

  function setAppearance(mode) {
    state.appearance = mode;
    localStorage.setItem("zarvis.appearance", mode);
    applyAppearance();
  }

  function applyAppearance() {
    document.documentElement.dataset.appearance = state.appearance;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", state.appearance === "dim" ? "#12110f" : "#f4f1eb");
    for (const btn of document.querySelectorAll("[data-appearance]")) {
      btn.classList.toggle("active", btn.dataset.appearance === state.appearance);
    }
  }

  async function refreshActivity() {
    if (!el.activityTaskList) return;
    const refreshBtn = el.activityRefreshBtn;
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing…";
    }
    el.activityTaskList.setAttribute("aria-busy", "true");
    let tasks = null;
    try {
      tasks = await fetchTasks();
    } catch (err) {
      console.error(err);
      tasks = null;
    }
    el.activityTaskList.innerHTML = "";
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    }
    el.activityTaskList.removeAttribute("aria-busy");
    if (!tasks) {
      el.activityTaskList.appendChild(emptyState("Something went wrong", "Try again from Refresh."));
      return;
    }
    if (!tasks.length) {
      el.activityTaskList.appendChild(emptyState("Nothing here yet", "Create a tracked task from Chat. ZARVIS stores the steps. It does not run them."));
      return;
    }
    for (const task of tasks) el.activityTaskList.appendChild(renderTaskCard(task));
  }

  async function deleteAccount() {
    el.settingsDeleteBtn.disabled = true;
    el.settingsDeleteBtn.textContent = "Deleting…";
    try {
      const res = await apiFetch("/account", { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      localStorage.removeItem(SESSION_KEYS.email);
      endSession("account_deleted"); // the user chooses: new guest or sign in — never automatic
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
    if (!el.developerAnalyzeBtn || !el.developerImplementBtn || !el.developerRepoInput) return;
    el.developerEntryLink?.addEventListener("click", () => {
      haptic();
      setActiveView("developer");
    });
    el.developerAnalyzeBtn.addEventListener("click", () => {
      haptic();
      analyzeRepo();
    });
    el.developerImplementBtn.addEventListener("click", () => {
      haptic();
      implementRepo();
    });
    el.developerRepoInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") analyzeRepo();
    });
  }

  /** Asks the server for a one-time confirmation of this exact change, then shows it. */
  async function implementRepo() {
    const repoUrl = el.developerRepoInput.value.trim();
    const requirement = el.developerRequirementInput.value.trim();
    el.developerResult.innerHTML = "";
    if (!repoUrl || !requirement) {
      renderDeveloperMessage("Repository URL and implementation requirement are both required.", "error");
      return;
    }
    el.developerImplementBtn.disabled = true;
    setDeveloperStage("implement", "Checking", "z-badge-info");
    try {
      const res = await apiFetch("/developer/implement", { method: "POST", body: JSON.stringify({ repoUrl, requirement }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.kind === "confirmation_required") {
        setDeveloperStage("implement", "Waiting for you", "z-badge-info");
        renderConfirmationCard(body.confirmation, el.developerResult);
        return;
      }
      setDeveloperStage("implement", "Couldn't start", "z-badge-off");
      renderDeveloperMessage(
        body.structured?.userSafeMessage || body.error || "This change can't run right now (HTTP " + res.status + ").",
        "error",
      );
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      console.error(err);
      setDeveloperStage("implement", "Couldn't start", "z-badge-off");
      renderDeveloperMessage(COPY[state.lang].bootError.title, "error");
    } finally {
      el.developerImplementBtn.disabled = false;
    }
  }

  async function analyzeRepo() {
    const repoUrl = el.developerRepoInput.value.trim();
    el.developerResult.innerHTML = "";
    if (!repoUrl) return;

    el.developerAnalyzeBtn.disabled = true;
    el.developerAnalyzeBtn.textContent = "Analyzing…";
    setDeveloperStage("analyze", "Running", "z-badge-info");
    try {
      const res = await apiFetch("/developer/analyze", { method: "POST", body: JSON.stringify({ repoUrl }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.kind !== "success") {
        setDeveloperStage("analyze", "Couldn't complete", "z-badge-off");
        renderDeveloperMessage(body.structured?.userSafeMessage || body.error || `Analysis failed (${res.status}).`, "error");
        return;
      }
      setDeveloperStage("analyze", "Completed", "z-badge-ok");
      renderDeveloperMessage(body.result?.summary || "Analyzed.", "success");
    } catch (err) {
      console.error(err);
      setDeveloperStage("analyze", "Couldn't complete", "z-badge-off");
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
    lastDeveloperNote = { status, message };
    renderHomeActivity();
  }

  function setDeveloperStage(name, label, tone) {
    const card = document.querySelector(`#developer-stages [data-stage="${name}"] .z-badge`);
    if (!card) return;
    card.textContent = label;
    card.className = "z-badge" + (tone ? " " + tone : "");
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
    card.className = plan.highlighted ? "z-card z-card-settings plan-card highlighted" : "z-card z-card-settings plan-card";

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
    tile.className = "z-card z-card-stat stat-tile";
    const labelEl = document.createElement("span");
    labelEl.className = "stat-tile-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "stat-tile-value";
    valueEl.textContent = value;
    tile.append(labelEl, valueEl);
    return tile;
  }

  let latestTasks;
  let lastDeveloperNote = null;

  function emptyState(title, body) {
    const box = document.createElement("div");
    box.className = "empty-state";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = body;
    box.append(strong, span);
    return box;
  }

  function renderHomeActivity() {
    const root = document.getElementById("home-activity");
    if (!root) return;
    root.replaceChildren();
    if (latestTasks === undefined) {
      const skeleton = document.createElement("div");
      skeleton.className = "z-skeleton";
      skeleton.setAttribute("aria-hidden", "true");
      root.appendChild(skeleton);
      return;
    }
    const rows = [];
    if (Array.isArray(latestTasks)) {
      for (const task of latestTasks.slice(0, 3)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "z-card z-card-task activity-row";
        const status = document.createElement("span");
        status.className = "task-status-badge";
        status.textContent = task.status;
        const title = document.createElement("strong");
        title.textContent = task.goal;
        const meta = document.createElement("small");
        meta.textContent = formatRelativeTime(task.createdAt) + " · Status only";
        button.append(status, title, meta);
        button.addEventListener("click", () => setActiveView("activity"));
        rows.push(button);
      }
    }
    const recentUser = state.history.filter((message) => message.role === "user").slice(-2).reverse();
    for (const message of recentUser) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "z-card z-card-insight activity-row";
      const status = document.createElement("span");
      status.className = "task-status-badge";
      status.textContent = "Conversation";
      const title = document.createElement("strong");
      const line = String(message.content || "").split("\n")[0].replace(/^📎\s*/, "");
      title.textContent = line.length > 80 ? line.slice(0, 77) + "…" : line;
      button.append(status, title);
      button.addEventListener("click", () => setActiveView("chat"));
      rows.push(button);
    }
    if (state.pendingAttachment) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "z-card z-card-status activity-row";
      const status = document.createElement("span");
      status.className = "z-badge z-badge-ok";
      status.textContent = "Ready";
      const title = document.createElement("strong");
      title.textContent = state.pendingAttachment.filename;
      const meta = document.createElement("small");
      meta.textContent = "Ask about this file in Chat.";
      button.append(status, title, meta);
      button.addEventListener("click", () => setActiveView("files"));
      rows.push(button);
    }
    if (lastDeveloperNote) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "z-card z-card-status activity-row";
      const status = document.createElement("span");
      status.className = "task-status-badge";
      status.textContent = lastDeveloperNote.status === "success" ? "Developer" : "Developer";
      const title = document.createElement("strong");
      const line = String(lastDeveloperNote.message || "").split("\n")[0];
      title.textContent = line.length > 80 ? line.slice(0, 77) + "…" : line;
      button.append(status, title);
      button.addEventListener("click", () => setActiveView("developer"));
      rows.push(button);
    }
    if (!rows.length) {
      if (latestTasks === null) {
        const failed = emptyState("Something went wrong", "Tasks could not be loaded. Try again.");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "zarvis-btn zarvis-btn-secondary";
        retry.textContent = "Try again";
        retry.addEventListener("click", () => { void fetchTasks().catch(() => {}); });
        failed.appendChild(retry);
        root.appendChild(failed);
        return;
      }
      root.appendChild(emptyState("Your workspace is ready", "Start a conversation or create your first task."));
      return;
    }
    for (const row of rows) root.appendChild(row);
  }

  async function fetchTasks() {
    let res;
    try {
      res = await apiFetch("/tasks");
    } catch (err) {
      latestTasks = null;
      renderHomeActivity();
      throw err;
    }
    if (!res.ok) {
      latestTasks = null;
      renderHomeActivity();
      return null;
    }
    const { tasks } = await res.json();
    const activeCount = tasks.filter((t) => t.status === "PENDING" || t.status === "RUNNING" || t.status === "PAUSED").length;
    for (const badge of el.metricsBadges) badge.hidden = activeCount === 0;
    for (const item of el.navItems) {
      if (item.dataset.view !== "activity") continue;
      if (activeCount > 0) item.setAttribute("aria-label", "Activity, activity in progress");
      else item.removeAttribute("aria-label");
    }
    latestTasks = tasks;
    renderHomeActivity();
    return tasks;
  }

  async function refreshTasks() {
    if (el.taskList) el.taskList.innerHTML = "";
    const tasks = await fetchTasks();
    if (!tasks || !el.taskList) {
      if (el.activityTaskList && tasks) {
        el.activityTaskList.innerHTML = "";
        for (const task of tasks) el.activityTaskList.appendChild(renderTaskCard(task));
      }
      return;
    }
    if (tasks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = "No active workflows yet — multi-step tasks Zarvis runs will appear here.";
      el.taskList.appendChild(empty);
      if (el.activityTaskList) el.activityTaskList.replaceChildren(empty.cloneNode(true));
      return;
    }
    for (const task of tasks) el.taskList.appendChild(renderTaskCard(task));
    if (el.activityTaskList) {
      el.activityTaskList.innerHTML = "";
      for (const task of tasks) el.activityTaskList.appendChild(renderTaskCard(task));
    }
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
    card.className = "z-card z-card-task task-card";
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
    refreshActivity();
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
  async function runTurn(utterance, isVoice = false, options = {}) {
    if (currentTurnController) {
      currentTurnController.abort();
      stopSpeaking();
    }
    const controller = new AbortController();
    currentTurnController = controller;
    const thinkingNode = addThinkingBubble();
    setOrbState("UNDERSTANDING");
    const isFirstTurn = state.firstTurn;
    const startedAt = performance.now();
    // Declared outside `try` because `finally` below uses them.
    const ttsQueue = [];
    let ttsStartTimer = null;

    try {
      // Create/resume the AudioContext directly from the user's voice gesture before the
      // network await, so mobile browsers are much less likely to block playback later.
      if (isVoice && state.speak) {
        try {
          activeAudioContext = activeAudioContext || new AudioContext({ sampleRate: 24000 });
          if (activeAudioContext.state === "suspended") await activeAudioContext.resume();
        } catch (audioError) {
          console.warn("Gemini streaming audio context unavailable:", audioError);
        }
      }
      const res = await apiFetch("/orchestrator/turn-stream", {
        method: "POST",
        body: JSON.stringify({
          utterance,
          locale: state.lang,
          isFirstTurn,
          conversationId: state.conversationId,
          history: state.history.slice(-12),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        console.error("Realtime orchestrator failed:", res.status, body.error || body.reason);
        addErrorBubble(COPY[state.lang].bootError, utterance);
        setOrbState("ERROR");
        recordLatency(utterance, Math.round(performance.now() - startedAt), false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullMessage = "";
      let assistantNode = null;
      let sentenceBuffer = "";
      const ttsTasks = new Set();
      let firstTextAt = 0;
      let ttsPrimed = false;

      const drainTts = () => {
        while (
          ttsQueue.length &&
          ttsTasks.size < TTS_MAX_CONCURRENT_STREAMS &&
          !controller.signal.aborted
        ) {
          const next = ttsQueue.shift();
          const task = speakGeminiStream(next.text, controller.signal, next.ticket);
          ttsTasks.add(task);
          task.catch((err) => {
            if (err?.name !== "AbortError") console.warn("Gemini TTS segment failed:", err);
          }).finally(() => {
            ttsTasks.delete(task);
            if (ttsQueue.length) drainTts();
          });
        }
      };

      const enqueueTts = (text, immediate = false) => {
        const clean = text.trim();
        if (!clean || !isVoice || !state.speak) return;
        // The ticket is taken at enqueue time, so playback order == reply order even when a
        // later segment's audio downloads first.
        ttsQueue.push({ text: clean, ticket: ttsSegments.next() });
        if (immediate || ttsPrimed) {
          ttsPrimed = true;
          drainTts();
          return;
        }
        // Keep the initial ~2.3s text accumulation, then prefetch the next segment while
        // the previous Gemini TTS segment is still playing. This removes the request gap
        // between sentences that caused audible pauses.
        if (!firstTextAt) firstTextAt = performance.now();
        if (!ttsStartTimer) {
          ttsStartTimer = setTimeout(() => {
            ttsStartTimer = null;
            ttsPrimed = true;
            drainTts();
          }, 2300);
        }
      };

      const waitForTtsQueue = async () => {
        while (
          !controller.signal.aborted &&
          (ttsQueue.length || ttsTasks.size)
        ) {
          drainTts();
          if (!ttsQueue.length && !ttsTasks.size) break;
          await delay(50);
        }
      };

      const consumeEvent = async (event, data) => {
        if (event === "meta" && data?.conversationId) {
          state.conversationId = String(data.conversationId);
          localStorage.setItem(STORAGE_KEYS.conversationId, state.conversationId);
          return;
        }
        // Real backend stages only (model step / tool started / tool finished) — no simulated steps.
        if (event === "progress" && data) {
          if (data.type === "tool_started") {
            setOrbState("EXECUTING");
            showProgress(thinkingNode, "Using " + data.skillId + "…");
          } else if (data.type === "tool_finished") {
            showProgress(thinkingNode, data.skillId + ": " + Logic.toolStatusLabel(data.status));
          } else if (data.type === "thinking" && data.step > 1) {
            setOrbState("UNDERSTANDING");
            showProgress(thinkingNode, "Reviewing the result…");
          }
          return;
        }
        if (event === "error") {
          throw new Error(data?.error || "The request could not be completed.");
        }
        if (event === "delta" && typeof data?.text === "string") {
          fullMessage += data.text;
          sentenceBuffer += data.text;
          if (!assistantNode) {
            thinkingNode.remove();
            assistantNode = addBubble("assistant", "", utterance);
            // "Speaking" is set by the audio pipeline only when sound actually starts.
          }
          renderFormattedText(assistantNode, fullMessage);
          scrollConversationToBottom();

          // Start Gemini TTS as soon as a sentence is available; don't wait for the full reply.
          // Keep chunks large enough for natural continuous speech. We still split
          // at punctuation/word boundaries, but avoid firing a network request for
          // every short sentence.
          const ready = sentenceBuffer.match(/^([\s\S]*?[.!?।！？]+\s*)/);
          if (ready && sentenceBuffer.length >= 220) {
            enqueueTts(ready[1]);
            sentenceBuffer = sentenceBuffer.slice(ready[1].length);
          } else if (sentenceBuffer.length >= 320) {
            const cut = sentenceBuffer.lastIndexOf(" ", 320);
            if (cut > 160) {
              enqueueTts(sentenceBuffer.slice(0, cut));
              sentenceBuffer = sentenceBuffer.slice(cut + 1);
            }
          }
          return;
        }
        if (event === "done") {
          if (ttsStartTimer) {
            clearTimeout(ttsStartTimer);
            ttsStartTimer = null;
          }
          if (sentenceBuffer.trim()) enqueueTts(sentenceBuffer, true);
          if (typeof data?.message === "string") fullMessage = data.message;
          state.history.push({ role: "user", content: utterance });
          if (fullMessage.trim()) state.history.push({ role: "assistant", content: fullMessage.trim() });
          state.history = state.history.slice(-12);
          renderHomeActivity();
          state.firstTurn = false;
          recordLatency(utterance, Math.round(performance.now() - startedAt), true);
          renderToolActivity(data?.toolCalls);
          setOrbState("SUCCESS");
          if (assistantNode) renderFormattedText(assistantNode, fullMessage);
          await drainTts();
          await waitForTtsPlayback(controller.signal);
          if (!controller.signal.aborted) setOrbState("IDLE");
        }
      };

      const processBuffer = async (flush = false) => {
        const parsed = Logic.parseSseEvents(buffer, flush);
        buffer = parsed.rest;
        for (const { event, data } of parsed.events) await consumeEvent(event, data);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        await processBuffer();
      }
      await processBuffer(true);
      if (!assistantNode && fullMessage.trim()) {
        thinkingNode.remove();
        assistantNode = addBubble("assistant", fullMessage, utterance);
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (err instanceof SessionEndedError) {
        setOrbState("IDLE");
        return;
      }
      console.error(err);
      addErrorBubble(COPY[state.lang].bootError, utterance);
      setOrbState("ERROR");
      recordLatency(utterance, Math.round(performance.now() - startedAt), false);
    } finally {
      if (ttsStartTimer) {
        clearTimeout(ttsStartTimer);
        ttsStartTimer = null;
      }
      // Segments that will never be played must release their turn, or later speech would wait forever.
      for (const item of ttsQueue.splice(0)) item.ticket.done();
      if (!thinkingNode.isConnected) {
        // no-op; the real assistant bubble is already rendered
      } else {
        thinkingNode.remove();
      }
      if (currentTurnController === controller) currentTurnController = null;
      updateComposerMode(); // Send/Stop must reflect that no turn is in flight any more
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

  function syncChatConversationLayout() {
    const active = el.conversation.children.length > 0;
    document.body.classList.toggle("chat-has-messages", active);
    if (el.viewWorkspace) el.viewWorkspace.classList.toggle("has-messages", active);
  }

  function scrollConversationToBottom() {
    if (!el.conversation) return;
    el.conversation.scrollTop = el.conversation.scrollHeight;
    requestAnimationFrame(() => {
      el.conversation.scrollTop = el.conversation.scrollHeight;
    });
  }

  function addBubble(role, text, utterance) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.setAttribute("data-role", role);
    const label = document.createElement("span");
    label.className = "bubble-role";
    label.textContent = role === "user" ? "You" : role === "assistant" ? "ZARVIS" : role === "tool" ? "Action" : "Status";
    bubble.appendChild(label);
    const body = document.createElement("div");
    body.className = "bubble-body";
    if (role === "assistant") renderFormattedText(body, text);
    else body.textContent = text;
    bubble.appendChild(body);
    if (role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "bubble-actions";
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(body.innerText || text);
          copyBtn.textContent = "Copied";
        } catch {
          copyBtn.textContent = "Copy failed";
        }
      });
      actions.appendChild(copyBtn);
      if (utterance) {
        const again = document.createElement("button");
        again.type = "button";
        again.textContent = "Regenerate";
        again.addEventListener("click", () => {
          bubble.remove();
          runTurn(utterance, false);
        });
        actions.appendChild(again);
      }
      const listen = document.createElement("button");
      listen.type = "button";
      listen.textContent = "Listen";
      listen.addEventListener("click", () => {
        void speak(body.innerText || text, null, true);
      });
      actions.appendChild(listen);
      bubble.appendChild(actions);
    }
    el.conversation.appendChild(bubble);
    syncChatConversationLayout();
    scrollConversationToBottom();
    if (role === "assistant") announceChat(text);
    return body;
  }

  const TOOL_TONES = {
    COMPLETED: "success",
    USER_ACTION_REQUIRED: "confirm",
    CONFIRMATION_REQUIRED: "confirm",
    PERMISSION_REQUIRED: "confirm",
    DENIED: "failed",
    UNSUPPORTED: "failed",
    FAILED: "failed",
  };

  /** One row per tool call, from the backend's structured result (blueprint §10). */
  function renderToolActivity(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;
    for (const call of toolCalls) {
      if (call?.outcome?.kind === "confirmation_required" && call.outcome.confirmation) {
        renderConfirmationCard(call.outcome.confirmation);
        continue;
      }
      const statusCode = call?.result?.status || (call?.outcome?.kind === "success" ? "COMPLETED" : "FAILED");
      const row = document.createElement("div");
      row.className = "z-card z-card-tool tool-row";
      row.dataset.status = statusCode;
      row.dataset.tone = TOOL_TONES[statusCode] || "";
      const top = document.createElement("div");
      top.className = "tool-row-top";
      const title = document.createElement("strong");
      title.textContent = call.skillId || "Tool";
      const status = document.createElement("span");
      status.className = "z-badge";
      status.textContent = Logic.toolStatusLabel(statusCode);
      top.append(title, status);
      row.appendChild(top);
      const note = document.createElement("p");
      note.className = "stage-note";
      const message = call?.result?.userSafeMessage || "";
      note.textContent = String(message).replace(/\s+/g, " ").slice(0, 220);
      row.appendChild(note);
      el.conversation.appendChild(row);
    }
    scrollConversationToBottom();
  }

  function showProgress(thinkingNode, text) {
    if (!thinkingNode?.isConnected) return;
    let note = thinkingNode.querySelector(".progress-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "progress-note";
      thinkingNode.appendChild(note);
    }
    note.textContent = text;
  }

  /** Render a safe subset of Markdown (all input escaped first — see web/logic.js, tested). */
  function renderFormattedText(container, text) {
    container.innerHTML = Logic.formatReplyHtml(text);
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
    announceChat(errorCopy.title + ". " + errorCopy.subtitle);
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
    announceChat(copy.title + ". " + copy.subtitle);
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
          addSystemNotice(noticeForExtractError(body.error));
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
        addSystemNotice(noticeForExtractError(body.error));
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

  function noticeForExtractError(code) {
    if (code === "unsupported_file_type") return COPY[state.lang].unsupportedFile;
    if (code === "document_too_long") return COPY[state.lang].oversizedFile;
    if (code === "empty_document") return COPY[state.lang].emptyFile;
    return COPY[state.lang].unreadableFile;
  }

  function setFilesState(text, mode) {
    const node = document.getElementById("files-state");
    if (!node) return;
    node.className = mode === "ready" ? "z-card z-card-status" : "empty-state";
    const title = mode === "ready" ? "Ready" : mode === "loading" ? "Reading" : "Nothing here yet";
    node.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = text;
    node.append(strong, span);
  }

  function setExtractingState(isExtracting) {
    el.uploadBtn.setAttribute("aria-disabled", String(isExtracting));
    el.uploadBtn.classList.toggle("is-disabled", isExtracting);
    el.fileInput.disabled = isExtracting;
    el.uploadBtn.title = isExtracting ? COPY[state.lang].extracting : COPY[state.lang].uploadTitle;
    if (isExtracting) setFilesState("Reading the file…", "loading");
  }

  /** Shows the "📄 filename / Ready to analyze" chip above the composer — the attachment
   * itself (extracted text) lives only in `state.pendingAttachment`, never rendered into
   * the DOM or a chat bubble, so a long document never shows up verbatim in the transcript. */
  function setPendingAttachment(filename, text) {
    state.pendingAttachment = { filename, text };
    el.attachmentName.textContent = filename;
    el.attachmentStatus.textContent = COPY[state.lang].attachmentReady;
    el.attachmentChip.hidden = false;
    setFilesState(`${filename} is ready. Ask about it in Chat.`, "ready");
    renderHomeActivity();
    el.input.focus();
  }

  function clearPendingAttachment() {
    state.pendingAttachment = null;
    el.attachmentChip.hidden = true;
    setFilesState("Attach a file, then ask about it in Chat.");
    renderHomeActivity();
  }

  /** The composer's single entry point for a user-authored turn (typed Send/Enter, or a
   * recognized voice transcript) — folds in a pending attachment if there is one, so
   * "attach a document, then ask a question" and "attach, then just hit Send" both work
   * from the exact same code path `submitUtterance()` itself doesn't need to know about. */
  function submitComposerInput(rawText, isVoice = false) {
    // A spoken command should produce a spoken reply automatically. This keeps typed chat
    // silent by default while making voice interaction feel like a real two-way conversation.
    // The user can still turn spoken replies off from Settings after the voice turn.
    if (isVoice && !state.speak) {
      state.speak = true;
      localStorage.setItem(STORAGE_KEYS.speak, "on");
      applyVoiceToggleState();
    }

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
    scrollConversationToBottom();
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
    el.sendBtn.setAttribute("aria-label", busy ? copy.stop : copy.send);
    el.sendLabel.textContent = busy ? copy.stop : copy.send;
  }

  // A turn is "in flight" for every state between UNDERSTANDING and the SPEAKING reply —
  // used by the composer's Send/Stop toggle (updateComposerMode) and cancelCurrentTurn's
  // Escape-key guard, both via isBusy() below.
  const BUSY_STATES = ["UNDERSTANDING", "EXECUTING", "SUCCESS", "SPEAKING"];
  function isBusy() {
    return currentTurnController !== null || BUSY_STATES.includes(el.orb.dataset.state);
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
      navigator.serviceWorker
        .register("./sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch((err) => console.error("Service worker registration failed:", err));
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
      if (!currentTurnController) setOrbState("ERROR");
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
    if (currentTurnController) cancelCurrentTurn();
    stopSpeaking();
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
    populateVoiceSelect();
    el.voiceSelect?.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEYS.ttsVoice, el.voiceSelect.value);
    });
  }

  function voicesForCurrentLang() {
    const langPrefix = state.lang === "hi" ? "hi" : "en";
    return cachedVoices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }

  function populateVoiceSelect() {
    if (!el.voiceSelect) return;
    el.voiceSelect.innerHTML = "";
    for (const voice of GEMINI_VOICES) {
      const option = document.createElement("option");
      option.value = voice;
      option.textContent = voice;
      el.voiceSelect.appendChild(option);
    }
    const saved = localStorage.getItem(STORAGE_KEYS.ttsVoice);
    el.voiceSelect.value = GEMINI_VOICES.includes(saved) ? saved : "Kore";
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

  // Gemini is the only voice provider. Browser speechSynthesis is NOT a TTS fallback.
  async function speak(text, node, force = false) {
    if ((!state.speak && !force) || !text) return;
    if (node) attachWaveform(node);
    try {
      await speakWithGemini(text);
    } catch (err) {
      if (err?.name !== "AbortError") console.warn("Gemini TTS unavailable:", err);
    } finally {
      if (node) detachWaveform(node);
      if (el.orb.dataset.state === "SPEAKING") setOrbState("IDLE");
    }
  }

  let activeAudio = null;
  let activeTtsController = null;
  let activeAudioContext = null;
  let ttsScheduledUntil = 0;
  const ttsSources = new Set();

  async function speakWithGemini(text) {
    const controller = new AbortController();
    activeTtsController = controller;
    try {
      const res = await apiFetch("/tts/synthesize", {
        method: "POST",
        body: JSON.stringify({ text, voice: selectedTtsVoice() }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Gemini TTS HTTP " + res.status);
      const blob = await res.blob();
      if (!blob.size) throw new Error("Gemini TTS returned empty audio");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudio = audio;
      try {
        await new Promise((resolve, reject) => {
          // "Speaking" only once the browser reports audio is actually playing.
          audio.addEventListener("playing", () => setOrbState("SPEAKING"), { once: true });
          audio.addEventListener("ended", resolve, { once: true });
          audio.addEventListener("pause", resolve, { once: true });
          audio.addEventListener("error", () => reject(new Error("Gemini audio playback failed")), { once: true });
          audio.play().catch(reject);
        });
      } finally {
        URL.revokeObjectURL(url);
        activeAudio = null;
      }
      setOrbState("IDLE");
    } finally {
      activeTtsController = null;
    }
  }

  const TTS_SAMPLE_RATE = 24000;
  const TTS_PREROLL_SECONDS = 1.2;
  const TTS_MIN_START_AHEAD_SECONDS = 0.06;
  const TTS_MAX_CONCURRENT_STREAMS = 2;

  const ttsSegments = Logic.createOrderedSegments();

  /**
   * Streams one reply segment as raw 24 kHz PCM. Up to TTS_MAX_CONCURRENT_STREAMS segments
   * may download at once, but each waits for its [ticket] before scheduling any audio, and
   * schedules strictly after the previous segment's audio — so segments never overlap.
   */
  async function speakGeminiStream(text, signal, ticket = ttsSegments.next()) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    activeTtsController = controller;
    let myTurn = false;
    ticket.ready.then(() => {
      myTurn = true;
    });

    try {
      const res = await apiFetch("/tts/synthesize-stream", {
        method: "POST",
        body: JSON.stringify({ text, voice: selectedTtsVoice() }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        const detail = typeof body?.error === "string" ? body.error : "Gemini TTS request failed";
        throw new Error("Gemini streaming TTS HTTP " + res.status + ": " + detail);
      }

      const audioContext = activeAudioContext || new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
      activeAudioContext = audioContext;
      if (audioContext.state === "suspended") await audioContext.resume();

      const reader = res.body.getReader();
      // Network chunks are arbitrary byte ranges; keep a trailing odd byte for the next read
      // so 16-bit samples never become misaligned.
      let pendingByte = null;
      const pendingPcm = [];
      let pendingBytes = 0;
      let primed = false;
      let scheduledUntil = null;

      const schedulePcm = (bytes) => {
        if (!bytes?.byteLength) return;
        const usableLength = bytes.byteLength - (bytes.byteLength % 2);
        if (usableLength <= 0) return;
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, usableLength / 2);
        const buffer = audioContext.createBuffer(1, pcm.length, TTS_SAMPLE_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        const earliest = audioContext.currentTime + TTS_MIN_START_AHEAD_SECONDS;
        if (scheduledUntil === null) {
          // First audio of this segment: start after everything already scheduled.
          scheduledUntil = Math.max(earliest, ttsScheduledUntil);
          const startsInMs = Math.max(0, (scheduledUntil - audioContext.currentTime) * 1000);
          setTimeout(() => {
            if (!controller.signal.aborted) setOrbState("SPEAKING");
          }, startsInMs);
        }
        scheduledUntil = Math.max(scheduledUntil, earliest);
        source.start(scheduledUntil);
        scheduledUntil += buffer.duration;
        ttsSources.add(source);
        source.onended = () => ttsSources.delete(source);
        ttsScheduledUntil = scheduledUntil;
      };

      const flushPending = () => {
        if (!pendingPcm.length) return;
        const merged = new Uint8Array(pendingBytes);
        let offset = 0;
        for (const chunk of pendingPcm) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        pendingPcm.length = 0;
        pendingBytes = 0;
        schedulePcm(merged);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        let bytes = value;
        if (pendingByte !== null) {
          const merged = new Uint8Array(bytes.byteLength + 1);
          merged[0] = pendingByte;
          merged.set(bytes, 1);
          bytes = merged;
          pendingByte = null;
        }
        if (bytes.byteLength % 2 !== 0) {
          pendingByte = bytes[bytes.byteLength - 1];
          bytes = bytes.subarray(0, bytes.byteLength - 1);
        }
        if (!bytes.byteLength) continue;
        pendingPcm.push(bytes);
        pendingBytes += bytes.byteLength;

        // Buffer ~TTS_PREROLL_SECONDS before the first schedule to absorb network jitter, and
        // never schedule before it is this segment's turn.
        if (!myTurn) continue;
        const bufferedSeconds = pendingBytes / 2 / TTS_SAMPLE_RATE;
        if (!primed && bufferedSeconds >= TTS_PREROLL_SECONDS) {
          flushPending();
          primed = true;
        } else if (primed) {
          flushPending();
        }
      }
      // A lone trailing byte is not a complete sample; it is dropped, not invented.
      pendingByte = null;
      await ticket.ready;
      if (!controller.signal.aborted) flushPending();
    } finally {
      ticket.done();
      signal?.removeEventListener("abort", onAbort);
      if (activeTtsController === controller) activeTtsController = null;
    }
  }

  async function waitForTtsPlayback(signal) {
    while (!signal?.aborted && ttsScheduledUntil > (activeAudioContext?.currentTime || 0) + 0.02) {
      const remaining = Math.max(20, (ttsScheduledUntil - (activeAudioContext?.currentTime || 0)) * 1000);
      await delay(Math.min(remaining, 120));
    }
  }

  function stopSpeaking() {
    if (activeTtsController) activeTtsController.abort();
    if (activeAudio) activeAudio.pause();
    for (const source of ttsSources) {
      try { source.stop(); } catch {}
    }
    ttsSources.clear();
    ttsScheduledUntil = 0;
    setOrbState("IDLE");
  }
  function detectSpeechLanguage(text) {
    if (/[\u0900-\u097f]/.test(text)) return "hi";
    const normalized = text.toLocaleLowerCase();
    const hi =
      /\b(?:aap|aapko|aapke|aapki|tum|tumhe|mujhe|mera|meri|kya|kaise|kaisa|kaisi|hai|hain|ho|tha|thi|the|raha|rahi|rahe|batao|kisne|kaun|kal|aaj|abhi|bahut|accha|achha|acha|haal|chal|karna|karo|kar)\b/.test(normalized);
    return hi ? "hi" : "en";
  }
})();
