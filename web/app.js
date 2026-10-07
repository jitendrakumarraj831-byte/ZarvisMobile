/**
 * ZARVIS MOBILE web client — a thin browser client over the same backend API the Android
 * app calls (MASTER_SPEC.md §25 "API Boundaries"). No framework/build step: this is
 * deliberately plain HTML/CSS/JS so the whole product can be demoed by opening a URL,
 * mirroring the zero-credential/zero-setup spirit of the backend's MockAIProvider default
 * (AI_ARCHITECTURE.md). See MASTER_SPEC.md §12a "Web Client Architecture".
 *
 * Session model mirrors the Android app's guest bootstrap: on first load this creates a
 * device-scoped guest account (POST /api/v1/auth/guest) rather than showing a signup form, so
 * a first-time visitor can start talking to ZARVIS immediately. Signing in (email or Google)
 * is always optional and never blocks chatting.
 */
(() => {
  "use strict";

  const STORAGE_KEYS = {
    accessToken: "zarvis.accessToken",
    refreshToken: "zarvis.refreshToken",
    lang: "zarvis.lang",
    speak: "zarvis.speak",
    ttsVoice: "zarvis.ttsVoice",
    userName: "zarvis.userName",
    conversationId: "zarvis.conversationId",
    devAccess: "zarvis.devAccess",
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
  /** The server's structured `error` event for a turn (see routes/orchestrator.ts). */
  class TurnFailedError extends Error {
    constructor(payload) {
      super(payload?.error || "The request could not be completed.");
      this.name = "TurnFailedError";
      this.payload = payload || {};
    }
  }
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
      greeting: "ZARVIS",
      hero: "What should we work on?",
      subtitle: "Type, speak, or attach a file.",
      quickActionsLead: "Suggestions",
      placeholder: "Message ZARVIS…",
      homeGreetings: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
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
      aiQuota: { title: "ZARVIS has reached today's AI usage limit.", subtitle: "Nothing was charged. Please try again later." },
      aiBusy: { title: "ZARVIS is getting too many requests right now.", subtitle: "Nothing was charged. Please wait a moment and try again." },
      turnBusy: { title: "ZARVIS is still working on this message.", subtitle: "It was not sent twice. Wait a moment, then try again to see the reply." },
      tooLarge: { title: "This message is too long to send.", subtitle: "Shorten it or attach a smaller document. Nothing was sent." },
      unsupportedFile: {
        title: "Can't read this file type yet.",
        subtitle: "Zarvis can analyze images, .txt, .md, .csv, .json, .pdf, and .docx files. Try one of those, or paste the text directly.",
      },
      unreadableFile: { title: "Zarvis couldn't read this document.", subtitle: "Please try another file." },
      imageUnavailable: { title: "Image analysis isn't available right now.", subtitle: "The server has no image model configured. Documents and text files still work." },
      imageAiDown: { title: "Image analysis couldn't reach the AI service.", subtitle: "Your file is fine and nothing was charged. Please try again in a moment." },
      emptyFile: { title: "That file looks empty.", subtitle: "Try a different file or paste the text directly." },
      voiceUnsupported: { title: "Voice input isn't available in this browser.", subtitle: "Type your request instead, or open ZARVIS in Chrome." },
      micDenied: { title: "Microphone access is off.", subtitle: "Allow the microphone for this site in your browser settings, then tap the mic again." },
      noSpeech: { title: "I didn't hear anything.", subtitle: "Tap the mic and speak again." },
      voiceNetwork: { title: "Voice recognition couldn't connect.", subtitle: "Check your connection and try again, or type instead." },
      voiceFailed: { title: "Voice input stopped unexpectedly.", subtitle: "Tap the mic to try again, or type instead." },
      ttsUnavailable: "Spoken reply isn't available right now",
      oversizedFile: {
        title: "That file is too long to send in one go.",
        subtitle: "Try a shorter excerpt or paste the most relevant part directly.",
      },
      extracting: "Reading document…",
      attachmentReady: "Ready to analyze",
      attachmentRemove: "Remove attachment",
      offlineLabel: "Offline",
      offlineBanner: "You're offline. ZARVIS works again as soon as you reconnect.",
      backOnline: "Back online",
      stateLabels: {
        IDLE: "Online",
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
      },
    },
    hi: {
      greeting: "ZARVIS",
      hero: "आज किस पर काम करें?",
      subtitle: "लिखें, बोलें या फ़ाइल अटैच करें।",
      quickActionsLead: "सुझाव",
      placeholder: "ZARVIS को संदेश भेजें…",
      homeGreetings: { morning: "सुप्रभात", afternoon: "नमस्ते", evening: "शुभ संध्या" },
      send: "भेजें",
      stop: "रोकें",
      mic: "बोलें",
      uploadTitle: "डॉक्यूमेंट अटैच करें",
      thinking: "सोच रहा हूँ…",
      retry: "फिर कोशिश करें",
      bootError: { title: "Zarvis से अभी कनेक्शन नहीं हो पा रहा है।", subtitle: "कृपया थोड़ी देर बाद फिर कोशिश करें।" },
      aiQuota: { title: "ZARVIS की आज की AI उपयोग सीमा पूरी हो गई है।", subtitle: "कोई शुल्क नहीं लगा। कृपया बाद में फिर कोशिश करें।" },
      aiBusy: { title: "ZARVIS पर अभी बहुत ज़्यादा अनुरोध आ रहे हैं।", subtitle: "कोई शुल्क नहीं लगा। थोड़ा रुककर फिर कोशिश करें।" },
      turnBusy: { title: "ZARVIS अभी इसी संदेश पर काम कर रहा है।", subtitle: "यह दोबारा नहीं भेजा गया। थोड़ा रुककर जवाब देखने के लिए फिर कोशिश करें।" },
      tooLarge: { title: "यह संदेश भेजने के लिए बहुत लंबा है।", subtitle: "इसे छोटा करें या छोटा डॉक्यूमेंट अटैच करें। कुछ नहीं भेजा गया।" },
      unsupportedFile: {
        title: "यह फ़ाइल प्रकार अभी पढ़ा नहीं जा सकता।",
        subtitle: "Zarvis इमेज, .txt, .md, .csv, .json, .pdf और .docx फ़ाइलें analyze कर सकता है। इनमें से कोई आज़माएं, या टेक्स्ट सीधे पेस्ट करें।",
      },
      unreadableFile: { title: "Zarvis इस डॉक्यूमेंट को पढ़ नहीं सका।", subtitle: "कृपया कोई दूसरी फ़ाइल आज़माएं।" },
      imageUnavailable: { title: "अभी इमेज एनालिसिस उपलब्ध नहीं है।", subtitle: "सर्वर पर इमेज मॉडल सेट नहीं है। डॉक्यूमेंट और टेक्स्ट फ़ाइलें काम करती हैं।" },
      imageAiDown: { title: "इमेज एनालिसिस AI सेवा तक नहीं पहुँच सका।", subtitle: "आपकी फ़ाइल ठीक है और कोई शुल्क नहीं लगा। थोड़ी देर में फिर कोशिश करें।" },
      emptyFile: { title: "यह फ़ाइल खाली लग रही है।", subtitle: "कोई दूसरी फ़ाइल आज़माएं या टेक्स्ट सीधे पेस्ट करें।" },
      voiceUnsupported: { title: "इस ब्राउज़र में वॉइस इनपुट उपलब्ध नहीं है।", subtitle: "टाइप करके पूछें, या ZARVIS को Chrome में खोलें।" },
      micDenied: { title: "माइक्रोफ़ोन की अनुमति बंद है।", subtitle: "ब्राउज़र सेटिंग्स में इस साइट के लिए माइक्रोफ़ोन चालू करें, फिर माइक दोबारा दबाएं।" },
      noSpeech: { title: "मुझे कुछ सुनाई नहीं दिया।", subtitle: "माइक दबाकर फिर से बोलें।" },
      voiceNetwork: { title: "वॉइस पहचान कनेक्ट नहीं हो सकी।", subtitle: "कनेक्शन जांचें और दोबारा कोशिश करें, या टाइप करें।" },
      voiceFailed: { title: "वॉइस इनपुट अचानक रुक गया।", subtitle: "माइक दबाकर दोबारा कोशिश करें, या टाइप करें।" },
      ttsUnavailable: "अभी बोलकर जवाब उपलब्ध नहीं है",
      oversizedFile: {
        title: "यह फ़ाइल एक बार में भेजने के लिए बहुत बड़ी है।",
        subtitle: "छोटा हिस्सा आज़माएं या सबसे ज़रूरी टेक्स्ट सीधे पेस्ट करें।",
      },
      extracting: "डॉक्यूमेंट पढ़ा जा रहा है…",
      attachmentReady: "विश्लेषण के लिए तैयार",
      attachmentRemove: "अटैचमेंट हटाएं",
      offlineLabel: "ऑफ़लाइन",
      offlineBanner: "आप ऑफ़लाइन हैं। इंटरनेट लौटते ही ZARVIS फिर काम करेगा।",
      backOnline: "फिर से ऑनलाइन",
      stateLabels: {
        IDLE: "ऑनलाइन",
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
    settingsOpenMetrics: document.getElementById("settings-open-metrics"),
    settingsDevToggle: document.getElementById("settings-dev-toggle"),
    activityTaskList: document.getElementById("activity-task-list"),
    activityRefreshBtn: document.getElementById("activity-refresh-btn"),
    chatBackBtn: document.getElementById("chat-back-btn"),
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
    homeGreeting: document.getElementById("home-greeting"),
    homeOrb: document.getElementById("home-orb"),
    chatNewBtn: document.getElementById("chat-new-btn"),
    activityTimeline: document.getElementById("activity-timeline"),
    activitySearch: document.getElementById("activity-search"),
    activityFilters: document.getElementById("activity-filters"),
    metricsUsage: document.getElementById("metrics-usage"),
    metricsTrend: document.getElementById("metrics-trend"),
    developerRunStatus: document.getElementById("developer-run-status"),
    developerLog: document.getElementById("developer-log"),
    settingsAiProvider: document.getElementById("settings-ai-provider"),
    settingsNewConversation: document.getElementById("settings-new-conversation"),
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
    // theme-init.js (in <head>) already applied the saved or device theme before first paint.
    appearance: document.documentElement.dataset.appearance === "aurora" ? "aurora" : "dim",
    // "Developer access" is off by default: Developer Agent and Metrics stay out of the way until
    // the user switches them on in Settings → Developer. It only changes what is shown.
    devAccess: readDevAccess(),
    settingsPage: null,
    featureId: null,
  };

  // Declared early out of habit: init() is now started at the very end of this file, so the
  // order of declarations below no longer matters to it.
  let recognition = null;
  // Presentation state read by Settings, Metrics and Activity (declared early for init()).
  let currentPlanName = null;
  let healthCache = null;
  // In-memory log of what happened in this session (requests, files, developer runs) — the
  // Activity timeline and Metrics counts. Never persisted, never fabricated.
  const activityLog = [];
  // Real, client-measured latency of every orchestrator turn this session (recordLatency(),
  // called from submitUtterance() around the actual /orchestrator/turn fetch) — feeds the
  // System Metrics tab. In-memory only, capped, never persisted or fabricated.
  let latencyEntries = [];

  async function init() {
    // Wire the core composer controls first. These must remain usable even if an optional
    // startup subsystem (voice, settings, plans, or service-worker registration) fails.
    el.sendBtn.addEventListener("click", () => {
      haptic();
      if (isBusy() && !el.input.value.trim() && !state.pendingAttachment) {
        // Send turns into Stop under the pointer the moment a turn starts: the second click of
        // a double-click (or a bounced tap) must not cancel the message just sent.
        if (Date.now() - stopModeSince < STOP_GRACE_MS) return;
        cancelCurrentTurn();
      } else submitComposerInput(el.input.value);
    });
    el.input.addEventListener("keydown", (e) => {
      // Enter that confirms an IME composition (Hindi/Devanagari keyboards) is not a send.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitComposerInput(el.input.value);
      }
      if (e.key === "Escape" && isBusy() && el.confirmModal.hidden) cancelCurrentTurn();
    });
    el.input.addEventListener("input", resizeComposer);
    el.fileInput.addEventListener("change", handleFileSelected);
    // The attach control is a focusable <label>; a label opens the picker on click only, so
    // Enter/Space would otherwise do nothing for keyboard users.
    el.uploadBtn.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (el.uploadBtn.getAttribute("aria-disabled") !== "true") openFilePicker();
    });
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
      ["welcome gate", setupWelcomeGate],
      ["account", setupAccountPanel],
      ["developer", setupDeveloper],
      ["github", setupGithubConnect],
      ["modals", setupModalManager],
      ["connection", setupConnectionState],
      ["history", setupHistory],
      ["menu drawer", setupNavDrawer],
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
    // Runs while `const Logic` (below) is still uninitialised: read the global directly.
    return window.ZarvisLogic.resolveApiBase(location.search, location.origin);
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
    renderHomeGreeting();
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
    renderHeroStatus();
    if (state.skills.length) renderQuickActions(state.skills);
    populateVoiceSelect(); // available voices differ between "en" and "hi"
    for (const btn of el.settingsLangOptions.querySelectorAll(".option-btn")) {
      btn.classList.toggle("active", btn.dataset.lang === state.lang);
    }
    // Everything the page says in English that has a Hindi entry (see i18n.js); user content is left alone.
    window.ZarvisI18n?.apply(state.lang);
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

  function readDevAccess() {
    try {
      return localStorage.getItem(STORAGE_KEYS.devAccess) === "on";
    } catch {
      return false;
    }
  }

  /** Shows or hides every Developer-access entry point (nav, Home chip, Activity filter, hub, skills). */
  function applyDevAccess() {
    const on = state.devAccess;
    document.body.dataset.devAccess = on ? "on" : "off";
    for (const node of document.querySelectorAll("[data-dev-only]")) node.hidden = !on;
    el.settingsDevToggle?.setAttribute("aria-pressed", String(on));
    const text = el.settingsDevToggle?.querySelector(".switch-text");
    if (text) text.textContent = on ? "On" : "Off";
    // Leaving Developer access while its Activity filter is selected falls back to "All"
    // (through the filter's own handler, so the list and the pressed state stay in step).
    if (!on) el.activityFilters?.querySelector('[data-filter="developer"].active') && el.activityFilters.querySelector('[data-filter="all"]')?.click();
    if (el.capabilityHub && window.ZarvisFeatures) window.ZarvisFeatures.renderHub(el.capabilityHub, { developer: on });
    if (state.skills.length) renderCapabilities();
    updateSettingsValues();
  }

  function setDevAccess(on) {
    state.devAccess = on;
    try {
      localStorage.setItem(STORAGE_KEYS.devAccess, on ? "on" : "off");
    } catch {}
    applyDevAccess();
  }

  /** Developer-only pages send everyone else to the switch that turns them on. */
  function requireDevAccess(label) {
    if (state.devAccess) return true;
    showToast(label + " is part of Developer access. Turn it on in Settings.");
    setActiveView("settings");
    openSettingsPage("developer");
    return false;
  }

  // ---- Browser history: pages and Settings sub-pages are real history entries ---------------
  // Back / Forward (and the Android system Back button) move between pages instead of leaving
  // the app, a reload keeps the page, and #/settings/voice style links open that page.
  let applyingRoute = false;
  let subpageOwnsEntry = false; // the open Settings sub-page was pushed by this session
  let featureOwnsEntry = false; // same for a capability detail page

  const PAGE_TITLES = { home: "Home", chat: "Chat", activity: "Activity", capabilities: "Capabilities", plans: "Plans", settings: "Settings", developer: "Developer Agent", metrics: "Usage & Metrics", feature: "Capabilities" };

  function currentRoute() {
    if (state.activeView === "settings" && state.settingsPage) return "#/settings/" + state.settingsPage;
    if (state.activeView === "feature" && state.featureId) return "#/capabilities/" + state.featureId;
    return "#/" + state.activeView;
  }

  /** "Activity · ZARVIS MOBILE": what the tab, the history list and a screen reader announce. */
  function pageTitle() {
    const brand = "ZARVIS MOBILE";
    if (state.activeView === "home") return brand;
    let name = "";
    if (state.activeView === "settings" && state.settingsPage) name = el.settingsSubpageTitle?.textContent || "";
    else if (state.activeView === "feature") name = document.querySelector("#view-feature h1")?.textContent || "";
    else name = document.querySelector(".view:not([hidden]) h1:not(.sr-only)")?.textContent || "";
    name = window.ZarvisI18n?.translate((name || PAGE_TITLES[state.activeView] || "").trim(), state.lang) || "";
    return name ? name + " · " + brand : brand;
  }

  function syncRoute() {
    const title = pageTitle();
    document.title = title;
    const announcer = document.getElementById("route-announcer");
    if (announcer) announcer.textContent = state.activeView === "home" ? "Home" : title.split(" · ")[0];
    if (applyingRoute) return;
    const route = currentRoute();
    if (location.hash === route || (state.activeView === "home" && !location.hash)) return;
    history.pushState({ zarvis: true }, "", route);
    subpageOwnsEntry = state.activeView === "settings" && !!state.settingsPage;
    featureOwnsEntry = state.activeView === "feature";
  }

  function applyRoute(hash) {
    const match = /^#\/([a-z]+)(?:\/([\w-]+))?$/.exec(hash || "");
    const view = match && VIEWS[match[1]] && match[1] !== "feature" ? match[1] : "home";
    const sub = match ? match[2] : undefined;
    applyingRoute = true;
    subpageOwnsEntry = false;
    featureOwnsEntry = false;
    try {
      if (view === "settings") {
        if (state.activeView !== "settings") setActiveView("settings");
        if (sub && document.querySelector(`[data-settings-page="${sub}"]`)) {
          if (state.settingsPage !== sub) openSettingsPage(sub);
        } else if (state.settingsPage) closeSettingsPage();
      } else if (view === "capabilities" && sub && document.querySelector(`[data-feature-page="${sub}"]`)) {
        openFeature(sub);
      } else {
        setActiveView(view);
      }
    } finally {
      applyingRoute = false;
    }
    // A guard may have sent us elsewhere (e.g. Developer access is off): keep the address bar truthful.
    const route = currentRoute();
    if (location.hash !== route && !(state.activeView === "home" && !location.hash)) history.replaceState({ zarvis: true }, "", route);
    syncRoute();
  }

  function onRouteChange() {
    if (location.hash === currentRoute() || (!location.hash && state.activeView === "home" && !state.settingsPage)) return;
    applyRoute(location.hash);
  }

  function setupHistory() {
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("hashchange", onRouteChange);
    if (location.hash) applyRoute(location.hash);
    else syncRoute();
  }

  /** The in-app "back" on a Settings sub-page behaves exactly like the browser's Back button. */
  function leaveSettingsSubpage() {
    if (subpageOwnsEntry) {
      history.back();
      return;
    }
    closeSettingsPage();
    history.replaceState({ zarvis: true }, "", "#/settings");
    syncRoute();
  }

  function leaveFeaturePage() {
    if (featureOwnsEntry) {
      history.back();
      return;
    }
    setActiveView("capabilities");
  }

  // ---- Dialogs: focus goes in, stays in, and comes back; the page behind cannot scroll ------
  function setupModalManager() {
    const overlays = Array.from(document.querySelectorAll(".modal-overlay"));
    const app = document.querySelector(".app");
    let lastOutside = null;
    document.addEventListener("focusin", (event) => {
      if (!event.target.closest?.(".modal-overlay, .palette-overlay, .shell-popover")) lastOutside = event.target;
    });
    const focusable = (root) => Array.from(root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).filter((node) => !node.disabled && node.getClientRects().length);
    const openOverlay = () => overlays.find((overlay) => !overlay.hidden);
    let wasOpen = false;
    const sync = () => {
      const open = openOverlay();
      if (open && !wasOpen) {
        wasOpen = true;
        app?.setAttribute("inert", "");
        document.body.classList.add("modal-open");
        if (!open.contains(document.activeElement)) (focusable(open)[0] || open).focus?.({ preventScroll: true });
      } else if (!open && wasOpen) {
        wasOpen = false;
        app?.removeAttribute("inert");
        document.body.classList.remove("modal-open");
        const visible = (node) => !!node && document.contains(node) && node.getClientRects().length > 0;
        const back = visible(lastOutside) ? lastOutside : Array.from(document.querySelectorAll(".nav-item.active")).find(visible);
        back?.focus?.({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(sync);
    for (const overlay of overlays) observer.observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
    // Browsers without `inert` still get a Tab trap.
    document.addEventListener("keydown", (event) => {
      const open = openOverlay();
      if (!open || event.key !== "Tab") return;
      const items = focusable(open);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!open.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    sync();
  }

  // ---- Phone menu: under 700px the sidebar is a drawer behind the menu button ----------------
  // Same navigation as the desktop sidebar (including Plans and, with Developer access, the developer
  // pages). While it is open the page behind is inert and cannot scroll; Esc, the backdrop, the close
  // button or choosing a page closes it and focus returns to the menu button.
  function setupNavDrawer() {
    const drawer = document.getElementById("sidebar-nav");
    const scrim = document.getElementById("drawer-scrim");
    const menuBtn = document.getElementById("menu-btn");
    const closeBtn = document.getElementById("drawer-close");
    const app = document.querySelector(".app");
    if (!drawer || !scrim || !menuBtn || !app) return;
    const phone = window.matchMedia("(max-width: 699px)");
    const isOpen = () => drawer.classList.contains("is-open");
    const behind = () => Array.from(app.children).filter((node) => node !== drawer && node !== scrim);
    const focusable = () => Array.from(drawer.querySelectorAll("button")).filter((node) => !node.disabled && node.getClientRects().length);

    function setOpen(open, restoreFocus = true) {
      if (open === isOpen() || (open && !phone.matches)) return;
      drawer.classList.toggle("is-open", open);
      scrim.hidden = !open;
      document.body.classList.toggle("drawer-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      for (const node of behind()) node.toggleAttribute("inert", open);
      if (open) (drawer.querySelector(".nav-item.active") || closeBtn)?.focus({ preventScroll: true });
      else if (restoreFocus) menuBtn.focus({ preventScroll: true });
    }

    menuBtn.addEventListener("click", () => {
      haptic();
      setOpen(!isOpen());
    });
    closeBtn?.addEventListener("click", () => setOpen(false));
    scrim.addEventListener("click", () => setOpen(false));
    // Runs after the item's own handler has switched the page (tapping the current page still closes it).
    drawer.addEventListener("click", (event) => {
      if (event.target.closest(".nav-item")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (!isOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (!drawer.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    // Back/Forward or a rotation to a wide screen (where the sidebar is always there) leaves nothing half open.
    phone.addEventListener("change", () => { if (!phone.matches) setOpen(false, false); });
    window.addEventListener("popstate", () => setOpen(false, false));
    window.addEventListener("hashchange", () => setOpen(false, false));
  }

  // ---- Connection: say so when the device is offline (the header used to claim "Online") ----
  function renderHeroStatus() {
    if (!el.heroStatusLabel) return;
    const copy = COPY[state.lang];
    const key = el.orb?.dataset.state;
    el.heroStatusLabel.textContent = navigator.onLine === false && (!key || key === "IDLE") ? copy.offlineLabel : copy.stateLabels[key] || copy.stateLabels.IDLE;
  }

  function setupConnectionState() {
    const banner = document.getElementById("offline-banner");
    const apply = (announce) => {
      const offline = navigator.onLine === false;
      document.body.dataset.offline = offline ? "1" : "0";
      if (banner) {
        banner.hidden = !offline;
        banner.textContent = COPY[state.lang].offlineBanner;
      }
      renderHeroStatus();
      if (announce) showToast(offline ? COPY[state.lang].offlineLabel : COPY[state.lang].backOnline);
    };
    window.addEventListener("offline", () => apply(true));
    window.addEventListener("online", () => apply(true));
    apply(false);
  }

  function applyVoiceToggleState() {
    el.settingsVoiceToggle.setAttribute("aria-pressed", String(state.speak));
    const switchText = el.settingsVoiceToggle.querySelector(".switch-text");
    if (switchText) switchText.textContent = state.speak ? "On" : "Off";
    updateSettingsValues();
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

  // ---- Welcome gate: Google / email sign-in card shown when a guest opens Chat ------------
  // Always skippable: "Continue as guest" and the close button are never hidden, so a Google
  // or network failure can never leave the user stuck on this card.

  const WELCOME_DISMISSED_KEY = "zarvis.welcomeDismissed";
  let authConfig = null;
  let gsiPromise = null;

  async function loadAuthConfig() {
    if (authConfig) return authConfig;
    try {
      const res = await fetch(`${API_BASE}/auth/config`);
      if (res.ok) authConfig = await res.json();
    } catch {
      // Offline or a cold start: email sign-in and guest still work, and the next open retries.
    }
    return authConfig || { googleClientId: null };
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (!gsiPromise) {
      gsiPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = resolve;
        script.onerror = () => {
          gsiPromise = null;
          script.remove();
          reject(new Error("Google sign-in could not load"));
        };
        document.head.appendChild(script);
      });
    }
    return gsiPromise;
  }

  function isGuestSession() {
    return localStorage.getItem(SESSION_KEYS.isGuest) !== "false";
  }

  // Also kept in memory so the card stays closed for this visit even when browser storage is blocked.
  let welcomeSkipped = false;

  function welcomeDismissed() {
    if (welcomeSkipped) return true;
    try {
      return localStorage.getItem(WELCOME_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  }

  async function maybeShowWelcomeGate() {
    const gate = document.getElementById("welcome-gate");
    if (!gate || !gate.hidden || !isGuestSession() || welcomeDismissed()) return;
    const config = await loadAuthConfig();
    // The config request is async: the user may have left Chat, dismissed the card or signed in meanwhile.
    if (state.activeView !== "chat" || !gate.hidden || !isGuestSession() || welcomeDismissed()) return;
    document.getElementById("welcome-error").hidden = true;
    gate.hidden = false;
    // On touch screens, focusing the field would pop the keyboard over the card before the user has read it.
    if (window.matchMedia?.("(pointer: fine)").matches) document.getElementById("welcome-email").focus();
    if (!config.googleClientId) return;
    try {
      await loadGoogleIdentity();
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (response) => completeGoogleSignIn(response.credential),
        ux_mode: "popup",
      });
      const holder = document.getElementById("welcome-google-btn");
      holder.textContent = "";
      window.google.accounts.id.renderButton(holder, {
        theme: "filled_black", size: "large", shape: "pill", text: "continue_with",
        width: Math.min(280, Math.max(200, holder.clientWidth || 280)),
      });
      document.getElementById("welcome-google").hidden = false;
    } catch (err) {
      console.warn(err); // email sign-in and "Continue as guest" stay available
    }
  }

  function closeWelcomeGate(remember) {
    document.getElementById("welcome-gate").hidden = true;
    if (!remember) return;
    welcomeSkipped = true;
    try {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
    } catch {}
  }

  async function completeGoogleSignIn(idToken) {
    const errorNode = document.getElementById("welcome-error");
    try {
      const previousAccount = localStorage.getItem(STORAGE_KEYS.accessToken) ? await currentAccountId() : null;
      const res = await apiFetch("/auth/google", { method: "POST", body: JSON.stringify({ idToken }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.code === "google_unavailable" ? "Google sign-in is not set up on this server yet." : body.error || "Google sign-in failed. Try again.");
      }
      if (body.accountId !== previousAccount) clearSessionTokens();
      storeTokens(body);
      location.reload();
    } catch (err) {
      errorNode.textContent = err.message || "Google sign-in failed. Try again.";
      errorNode.hidden = false;
    }
  }

  async function currentAccountId() {
    try {
      const res = await apiFetch("/auth/me");
      return res.ok ? (await res.json()).accountId : null;
    } catch {
      return null;
    }
  }

  function setupWelcomeGate() {
    const errorNode = document.getElementById("welcome-error");
    if (!errorNode) return;
    const fail = (message) => {
      errorNode.textContent = message;
      errorNode.hidden = false;
    };
    const credentials = () => ({
      email: document.getElementById("welcome-email").value.trim(),
      password: document.getElementById("welcome-password").value,
    });
    document.getElementById("welcome-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const { email, password } = credentials();
      try {
        await signInWithEmail(email, password);
        location.reload();
      } catch (err) {
        fail(err.message);
      }
    });
    // Creating an account upgrades this browser's guest in place, so its chats are kept.
    document.getElementById("welcome-create").addEventListener("click", async () => {
      const { email, password } = credentials();
      if (!email || password.length < 8) return fail("Enter your email and a password of at least 8 characters.");
      try {
        const res = await apiFetch("/auth/link", { method: "POST", body: JSON.stringify({ email, password }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(authErrorMessage(res.status, body.code));
        localStorage.setItem(SESSION_KEYS.isGuest, "false");
        localStorage.setItem(SESSION_KEYS.email, body.email || email);
        location.reload();
      } catch (err) {
        fail(err.message);
      }
    });
    document.getElementById("welcome-guest").addEventListener("click", () => closeWelcomeGate(true));
    document.getElementById("welcome-close").addEventListener("click", () => closeWelcomeGate(true));
    document.addEventListener("keydown", (event) => {
      const gate = document.getElementById("welcome-gate");
      if (event.key === "Escape" && !gate.hidden) closeWelcomeGate(true);
    });
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
      renderHomeGreeting();
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
        addBubble(message.role === "user" ? "user" : "assistant", message.content, undefined, message.createdAt ? new Date(message.createdAt) : null);
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
        if (res.status === 409 && body.code === "confirmation_already_used") {
          actions.remove();
          note.textContent = "Already approved: the action ran once and will not run again. Its result is in the conversation.";
          return;
        }
        if (res.status === 404) {
          note.textContent = "This confirmation expired or was already used. Nothing was run. Ask again if you still want it.";
          return;
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        actions.remove();
        if (body.outcome?.kind === "confirmation_required" && body.outcome.confirmation) {
          // What would run changed after approval (e.g. another GitHub account was connected).
          note.textContent = "The action changed before it ran, so nothing was done. Please review it again.";
          renderConfirmationCard(body.outcome.confirmation, container);
          return;
        }
        note.textContent = Logic.toolStatusLabel(body.result?.status) + ".";
        if (container === el.conversation) addBubble("assistant", body.message || "Done.");
        else renderDeveloperMessage(body.message || "Done.", body.result?.success ? "success" : "error");
      } catch (err) {
        if (err instanceof SessionEndedError) return;
        console.error(err);
        note.textContent = "Couldn't reach ZARVIS. If the request got through, its result will appear in the conversation; trying again can never run it twice.";
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
      const rowValue = document.querySelector('[data-setting-value="developer"]');
      if (rowValue) rowValue.textContent = !state.devAccess ? "Off" : !status.available ? "Public repos" : status.connected ? "GitHub connected" : "Not connected";
      renderSettingsSubpageValue();
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
  ];
  const QUICK_ACTION_ICON_PATHS = {
    ask: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>',
    write: CATEGORY_ICON_PATHS.CREATIVE,
    research: CATEGORY_ICON_PATHS.RESEARCH,
    code: CATEGORY_ICON_PATHS.DEVELOPER,
    analyze: CATEGORY_ICON_PATHS.DOCUMENTS,
    plan: CATEGORY_ICON_PATHS.AUTOMATION,
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
      card.className = "chip";
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
    const skills = state.devAccess ? state.skills : state.skills.filter((skill) => skill.category !== "DEVELOPER");
    if (skills.length === 0) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = "Couldn't load capabilities right now.";
      el.capabilitiesList.appendChild(empty);
      return;
    }
    const byCategory = groupByCategory(skills);
    for (const [category, categorySkills] of byCategory) {
      const label = document.createElement("p");
      label.className = "group-label";
      label.textContent = categoryLabel(category);
      el.capabilitiesList.appendChild(label);
      for (const skill of categorySkills) el.capabilitiesList.appendChild(renderCapabilityCard(skill));
    }
  }

  function renderCapabilityCard(skill) {
    const row = document.createElement("div");
    row.className = "skill-row";
    const icon = document.createElement("span");
    icon.className = "row-ico tone-blue";
    icon.innerHTML = categoryIconSvg(skill.category);
    const copy = document.createElement("div");
    copy.className = "cap-copy";
    const name = document.createElement("div");
    name.className = "cap-name";
    const title = document.createElement("strong");
    title.textContent = skill.name;
    const risk = document.createElement("span");
    risk.className = "risk-badge";
    risk.dataset.level = skill.riskLevel;
    risk.textContent = Logic.riskLabel(skill.riskLevel);
    name.append(title, risk);
    const desc = document.createElement("p");
    desc.className = "cap-desc";
    desc.textContent = skill.description;
    copy.append(name, desc);
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "cap-action";
    if (skill.upgradeRequired) {
      runBtn.textContent = "Needs upgrade";
      runBtn.disabled = true;
    } else {
      runBtn.textContent = "Run";
      runBtn.setAttribute("aria-label", "Run " + skill.name);
      runBtn.addEventListener("click", () => {
        haptic();
        setActiveView("chat");
        submitUtterance(exampleFor(skill.description));
      });
    }
    row.append(icon, copy, runBtn);
    return row;
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
    metrics: el.viewMetrics,
    activity: el.viewActivity,
    settings: el.viewSettings,
    feature: el.viewFeature,
    developer: el.viewDeveloper,
  };
  const MOBILE_KEYBOARD = window.matchMedia("(max-width: 699px), (pointer: coarse)");

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
    el.chatBackBtn.addEventListener("click", () => setActiveView("home"));
    el.activityRefreshBtn?.addEventListener("click", () => refreshActivity());
    for (const btn of document.querySelectorAll("[data-nav]")) {
      btn.addEventListener("click", () => {
        haptic();
        setActiveView(btn.dataset.nav);
      });
    }
    for (const btn of document.querySelectorAll('[data-home-action="voice"]')) {
      btn.addEventListener("click", () => {
        haptic();
        setActiveView("chat");
        startListening();
      });
    }
    for (const btn of document.querySelectorAll('[data-home-action="upload"]')) {
      btn.addEventListener("click", () => {
        haptic();
        setActiveView("chat");
        openFilePicker();
      });
    }
    for (const btn of document.querySelectorAll('[data-home-action="image"]')) {
      btn.addEventListener("click", () => {
        haptic();
        setActiveView("chat");
        openFilePicker(true);
      });
    }
    el.homeOrb?.addEventListener("click", () => {
      haptic();
      setActiveView("chat");
      startListening();
    });
    el.chatNewBtn?.addEventListener("click", () => {
      haptic();
      startNewConversation();
    });
    // On phones the on-screen keyboard shrinks the viewport; hide the tab bar while typing so
    // the composer sits directly above the keyboard and nothing is covered.
    el.input.addEventListener("focus", () => {
      // With visualViewport the keyboard is detected from the real viewport change (so a
      // hardware keyboard or a dismissed keyboard never hides the tab bar); focus is only
      // the fallback for browsers without it.
      if (MOBILE_KEYBOARD.matches && !window.visualViewport) document.body.classList.add("keyboard-open");
    });
    el.input.addEventListener("blur", () => {
      // Keep the keyboard layout while focus stays inside the composer (e.g. Send).
      setTimeout(() => {
        if (!el.composer.contains(document.activeElement)) document.body.classList.remove("keyboard-open");
      }, 0);
    });
    // Tapping Send/mic must not pull focus out of the textarea: the keyboard stays up and the
    // composer doesn't shift under the finger mid-tap.
    for (const control of [el.sendBtn, el.micBtn]) {
      control.addEventListener("pointerdown", (event) => {
        if (document.activeElement === el.input) event.preventDefault();
      });
    }
    setupKeyboardInset();
    setupHomeQuickActions();
    setupDesignShortcuts();
    applyDevAccess();
    window.ZarvisShell?.init({
      setActiveView,
      getActivity: () => activityLog,
      openSettingsPage,
      getAppearance: () => state.appearance,
      setAppearance,
      newConversation: startNewConversation,
      startListening,
      pickFile: () => openFilePicker(),
      devAccess: () => state.devAccess,
      account: () => {
        const guest = localStorage.getItem(SESSION_KEYS.isGuest) !== "false";
        return { guest, name: accountDisplayName(), email: guest ? "" : localStorage.getItem(SESSION_KEYS.email) || "" };
      },
    });
    setupActivityControls();
    setupWorkspacePrompts();
    renderHomeGreeting();
  }

  /**
   * Keeps the composer above the on-screen keyboard on every browser. Chrome 108+ honours
   * interactive-widget=resizes-content (the layout viewport shrinks, so the inset is 0);
   * older Chrome, WebViews and Safari only shrink the visual viewport, so the composer is
   * lifted by the keyboard's height (--kb). The keyboard is treated as open only while it
   * actually covers the screen, so dismissing it with Back restores the tab bar even if the
   * textarea keeps focus.
   */
  function setupKeyboardInset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let baseline = { width: window.innerWidth, height: Math.max(window.innerHeight, vv.height) };
    const update = () => {
      if (window.innerWidth !== baseline.width) {
        baseline = { width: window.innerWidth, height: Math.max(window.innerHeight, vv.height) };
      } else if (document.activeElement !== el.input) {
        baseline.height = Math.max(baseline.height, window.innerHeight, vv.height);
      }
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty("--kb", inset + "px");
      if (!MOBILE_KEYBOARD.matches || document.activeElement !== el.input) return;
      const keyboardShown = baseline.height - vv.height > 120;
      document.body.classList.toggle("keyboard-open", keyboardShown);
      if (keyboardShown) scrollConversationToBottom();
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("visibilitychange", () => {
      document.body.classList.toggle("page-hidden", document.hidden);
    });
  }

  /** Home "Quick actions" chip: expands / collapses the suggestion chips under the mic. */
  function setupHomeQuickActions() {
    const toggle = document.getElementById("home-quick-toggle");
    const panel = document.getElementById("home-quick");
    if (!toggle || !panel) return;
    toggle.addEventListener("click", () => {
      haptic();
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.classList.toggle("active", open);
    });
  }

  /** The analyze button keeps its icon; only the label span changes. */
  function setAnalyzeLabel(text) {
    const label = el.developerAnalyzeBtn?.querySelector("span");
    if (label) label.textContent = text;
    else if (el.developerAnalyzeBtn) el.developerAnalyzeBtn.textContent = text;
  }

  /** Display name from a signed-in email ("jitendra.kumar@x" → "Jitendra"); guests have none. */
  function accountDisplayName() {
    try {
      if (localStorage.getItem(SESSION_KEYS.isGuest) !== "false") return "";
      const email = localStorage.getItem(SESSION_KEYS.email) || "";
      const first = email.split("@")[0].split(/[._\-+\d]+/).filter(Boolean)[0] || "";
      return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
    } catch {
      return "";
    }
  }

  function renderAvatar() {
    const name = accountDisplayName();
    for (const node of document.querySelectorAll(".avatar-text")) node.textContent = name ? name.slice(0, 2).toUpperCase() : "Z";
  }

  function renderHomeGreeting() {
    if (!el.homeGreeting) return;
    const copy = COPY[state.lang];
    const hour = new Date().getHours();
    const key = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    el.homeGreeting.textContent = copy.homeGreetings[key];
    const name = accountDisplayName();
    const nameNode = document.getElementById("home-name");
    if (nameNode) nameNode.textContent = name ? ", " + name : "";
    renderAvatar();
  }

  /** Home prompt box, scroll-to-latest and Developer tabs (visual shortcuts onto existing flows). */
  function setupDesignShortcuts() {
    document.getElementById("home-prompt-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("home-prompt-input");
      const text = input?.value.trim();
      if (!text) {
        setActiveView("chat");
        el.input.focus();
        return;
      }
      input.value = "";
      setActiveView("chat");
      submitComposerInput(text);
    });

    const latestBtn = document.getElementById("scroll-latest");
    if (latestBtn) {
      const update = () => {
        const away = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
        latestBtn.hidden = state.activeView !== "chat" || away < 360;
      };
      window.addEventListener("scroll", update, { passive: true });
      latestBtn.addEventListener("click", () => { scrollConversationToBottom(); latestBtn.hidden = true; });
    }

    // The attach label opens the picker natively on click; make sure it lists every supported type.
    el.uploadBtn.addEventListener("click", () => setFilePickerAccept(false));
    document.getElementById("image-btn")?.addEventListener("click", () => {
      haptic();
      openFilePicker(true);
    });

    const tabs = document.querySelectorAll("[data-dev-tab]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((other) => {
          other.classList.toggle("active", other === tab);
          other.setAttribute("aria-selected", String(other === tab));
        });
        const target = document.getElementById(tab.dataset.devTab);
        const panel = target?.closest(".panel") || target;
        panel?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (target && target.matches("textarea, input")) target.focus({ preventScroll: true });
      });
    });
  }

  /** Starts a fresh conversation: only the client's pointer and on-screen thread are reset.
   * The previous conversation stays on the server. */
  function startNewConversation() {
    if (currentTurnController) cancelCurrentTurn();
    localStorage.removeItem(STORAGE_KEYS.conversationId);
    state.conversationId = null;
    state.history = [];
    state.firstTurn = true;
    el.conversation.replaceChildren();
    syncChatConversationLayout();
    recordActivity("conversation", "Started a new conversation", "Previous conversation kept on the server", "ok");
    updateSettingsValues();
    if (state.activeView !== "chat") setActiveView("chat");
    el.input.focus();
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
      window.ZarvisFeatures.renderHub(el.capabilityHub, { developer: state.devAccess });
      el.capabilityHub.addEventListener("click", (event) => {
        const button = event.target.closest("[data-cap-action]");
        if (!button) return;
        haptic();
        const action = button.dataset.capAction;
        if (action === "voice") {
          setActiveView("chat");
          startListening();
        } else if (action === "attach") {
          setActiveView("chat");
          openFilePicker();
        } else if (action === "developer") {
          setActiveView("developer");
        } else if (action === "settings") {
          setActiveView("settings");
          openSettingsPage(button.dataset.capSettings || "voice");
        } else if (action === "feature") {
          openFeature(button.dataset.featurePage);
        } else {
          setActiveView("chat");
          el.input.value = button.dataset.capPrompt || "";
          resizeComposer();
          el.input.focus();
        }
      });
    }
  }

  function openFeature(id) {
    if (id === "developer" && !requireDevAccess("Developer Agent")) return;
    state.featureId = id;
    if (!el.featureRoot || !window.ZarvisFeatures) return;
    window.ZarvisFeatures.renderDetail(el.featureRoot, id, {
      onBack: leaveFeaturePage,
      onPrimary: (feature) => runFeatureAction(feature, feature.prompt),
      onPrompt: (feature, prompt) => runFeatureAction(feature, prompt),
    });
    if (state.activeView === "feature") {
      syncRoute();
      return;
    }
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
      openFilePicker();
      return;
    }
    if (feature.action === "phone" || feature.id === "phone") {
      setActiveView("settings");
      openSettingsPage("permissions");
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

  /** The Image shortcuts narrow the picker to pictures; every other entry point lists all supported files.
   * Setting `accept` on every open means cancelling an Image pick can't leave the next "Files" pick image-only. */
  function setFilePickerAccept(imagesOnly) {
    if (!el.fileInput.dataset.allAccept) el.fileInput.dataset.allAccept = el.fileInput.getAttribute("accept") || "";
    el.fileInput.setAttribute("accept", imagesOnly ? "image/*" : el.fileInput.dataset.allAccept);
  }

  function openFilePicker(imagesOnly = false) {
    setFilePickerAccept(imagesOnly);
    el.fileInput.click();
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
    if (view === "developer" && !requireDevAccess("Developer Agent")) return;
    if (view === "metrics" && !requireDevAccess("Usage & Metrics")) return;
    if (state.activeView === "metrics") stopMetricsPolling();
    if (state.activeView === "settings" && view !== "settings") closeSettingsPage();

    state.activeView = view;
    document.body.dataset.activeView = view;
    for (const [name, section] of Object.entries(VIEWS)) {
      if (section) section.hidden = name !== view;
    }
    const navView = view === "feature" ? "capabilities" : view;
    for (const item of el.navItems) {
      const active = item.dataset.view === navView;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
    el.composer.hidden = view !== "chat";
    document.body.classList.remove("keyboard-open");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    if (view === "chat") maybeShowWelcomeGate();
    if (view === "capabilities") renderCapabilities();
    if (view === "plans") refreshPlans();
    if (view === "metrics") {
      renderLatencyLog();
      renderMetricsUsage();
      refreshMetricsHealth();
      refreshTasks();
      startMetricsPolling();
    }
    if (view === "activity") refreshActivity();
    if (view === "home") {
      renderHomeGreeting();
      renderHomeActivity();
    }
    if (view === "developer") void refreshGithubStatus();
    if (view === "settings") {
      updateSettingsValues();
      void refreshGithubStatus();
      void loadSettingsSummary();
    }
    if (view === "chat") scrollConversationToBottom();
    syncRoute();
  }

  // ---- Plans & Quotas -----------------------------------------------------------------------
  // Free vs Pro. Prices come from the server (GET /billing/plans, INR) — the client only ever
  // sends a plan key when buying, never an amount. Payment runs through Razorpay Checkout
  // (UPI, cards, netbanking, wallets); the server verifies it before granting anything. When
  // the server has no Razorpay keys the page says so instead of showing a dead button.

  const PLAN_TIERS = [
    {
      name: "FREE",
      title: "Free",
      tag: null,
      tagline: "Everything you need to get started.",
      features: ["Conversation and voice in English, Hindi and Hinglish", "Documents, research, writing and business drafts", "Tracked tasks and Developer Agent analysis"],
      highlighted: false,
    },
    {
      name: "PRO",
      title: "Pro",
      tag: "Most popular",
      tagline: "Every skill ZARVIS ships.",
      features: [
        "Everything in Free",
        "Developer Agent pull requests, after your approval",
        "Access to every current skill",
      ],
      highlighted: true,
    },
  ];

  let planCatalogue = null;
  let checkoutBusy = false;
  const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const dateLocale = () => (state.lang === "hi" ? "hi-IN" : "en-IN");
  const formatDate = (value) => new Date(value).toLocaleDateString(dateLocale(), { day: "numeric", month: "short", year: "numeric" });

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
    el.confirmModalConfirm.classList.toggle("btn-danger", destructive);
    el.confirmModalConfirm.classList.toggle("btn-primary", !destructive);
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
    el.settingsPanelBack?.addEventListener("click", leaveSettingsSubpage);
    el.appearanceAuroraBtn?.addEventListener("click", () => setAppearance("aurora"));
    el.appearanceDimBtn?.addEventListener("click", () => setAppearance("dim"));
    el.settingsOpenDeveloper?.addEventListener("click", () => setActiveView("developer"));
    el.settingsOpenMetrics?.addEventListener("click", () => setActiveView("metrics"));
    el.settingsDevToggle?.addEventListener("click", () => {
      haptic();
      setDevAccess(!state.devAccess);
      showToast(state.devAccess ? "Developer access on" : "Developer access off");
    });
    el.settingsNewConversation?.addEventListener("click", () => {
      haptic();
      startNewConversation();
    });
    for (const btn of document.querySelectorAll("[data-settings-open-privacy]")) {
      btn.addEventListener("click", () => openSettingsPage("privacy"));
    }
    for (const btn of el.settingsLangOptions.querySelectorAll(".option-btn")) {
      btn.addEventListener("click", () => {
        haptic();
        setLanguage(btn.dataset.lang);
        showToast(btn.dataset.lang === "hi" ? "भाषा: हिंदी" : "Language: English");
      });
    }
    el.settingsVoiceToggle.addEventListener("click", () => {
      haptic();
      toggleSpeak();
      showToast(state.speak ? "Spoken replies on" : "Spoken replies off");
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
    const row = document.querySelector(`[data-settings-page="${page}"]`);
    const title = row?.dataset.settingsLabel || row?.querySelector("strong")?.textContent;
    if (el.settingsSubpageTitle) el.settingsSubpageTitle.textContent = title || "Settings";
    const desc = document.getElementById("settings-subpage-desc");
    if (desc) desc.textContent = row?.dataset.settingsDesc || row?.querySelector("small")?.textContent || "";
    renderSettingsSubpageValue();
    for (const panel of document.querySelectorAll("[data-settings-panel]")) {
      panel.hidden = panel.dataset.settingsPanel !== page;
    }
    if (page === "account") void refreshAccountPanel();
    if (page === "permissions") void renderPermissionCenter();
    if (page === "ai") void renderAiProvider();
    el.settingsPanelBack?.focus?.();
    syncRoute();
  }

  function closeSettingsPage() {
    state.settingsPage = null;
    el.viewSettings.classList.remove("is-subpage");
    el.settingsPanels.hidden = true;
    el.settingsGrid.hidden = false;
    document.title = pageTitle();
  }

  function setAppearance(mode) {
    state.appearance = mode;
    localStorage.setItem("zarvis.appearance", mode);
    applyAppearance();
    updateSettingsValues();
    showToast(mode === "dim" ? "Dark appearance" : "Light appearance");
  }

  let toastTimer = null;
  /** A short confirmation that a setting was saved (also announced to screen readers). */
  function showToast(text) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove("is-leaving");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add("is-leaving");
      toastTimer = setTimeout(() => { toast.hidden = true; }, 220);
    }, 1800);
  }

  /** Current value shown on each Settings row. */
  function updateSettingsValues() {
    const set = (key, value) => {
      const node = document.querySelector(`[data-setting-value="${key}"]`);
      if (node) node.textContent = value;
    };
    const email = localStorage.getItem(SESSION_KEYS.email);
    const isGuest = localStorage.getItem(SESSION_KEYS.isGuest) !== "false";
    set("account", isGuest ? "Guest" : email || "Signed in");
    set("subscription", currentPlanName ? formatPlanName(currentPlanName) : "");
    set("voice", state.speak ? "On" : "Off");
    set("language", state.lang === "hi" ? "हिंदी" : "English");
    set("appearance", state.appearance === "dim" ? "Dark" : "Light");
    set("memory", state.conversationId ? "Saved" : "New");
    if (!state.devAccess) set("developer", "Off");
    const heroName = document.getElementById("profile-hero-name");
    if (heroName) {
      heroName.textContent = accountDisplayName() || (isGuest ? "Guest" : "Signed in");
      document.getElementById("profile-hero-sub").textContent = isGuest ? "Guest account. Link an email to keep it." : email || "";
      const heroPlan = document.getElementById("profile-hero-plan");
      heroPlan.hidden = !currentPlanName;
      heroPlan.textContent = currentPlanName ? formatPlanName(currentPlanName) : "";
    }
    if (healthCache) set("ai", healthCache.provider === "google" ? "Gemini" : "Not configured");
    set("security", isGuest ? "Guest session" : "Signed in");
    renderSettingsSubpageValue();
  }

  /** The open Settings page repeats its current value next to the title. */
  function renderSettingsSubpageValue() {
    const badge = document.getElementById("settings-subpage-value");
    if (!badge) return;
    const value = state.settingsPage
      ? document.querySelector(`[data-setting-value="${state.settingsPage}"]`)?.textContent.trim() || ""
      : "";
    badge.textContent = value;
    badge.hidden = !value;
  }

  /** Fills the Subscription and AI rows from the real APIs when Settings is opened first
   * (before Plans or Metrics loaded them). Failures leave the value blank, never invented. */
  async function loadSettingsSummary() {
    try {
      if (!healthCache) await fetchHealth();
    } catch {
      // Row stays blank; the AI page itself shows the error state.
    }
    if (currentPlanName) return;
    try {
      const res = await apiFetch("/entitlements/me");
      if (!res.ok) return;
      const snapshot = await res.json();
      if (snapshot?.plan) currentPlanName = snapshot.plan;
      updateSettingsValues();
    } catch {
      // Same: no value rather than a guessed one.
    }
  }

  async function fetchHealth() {
    const res = await fetch(`${API_BASE.replace(/\/api\/v1$/, "")}/health`);
    healthCache = await res.json();
    updateSettingsValues();
    return healthCache;
  }

  async function renderAiProvider() {
    if (!el.settingsAiProvider) return;
    el.settingsAiProvider.textContent = "Checking…";
    try {
      const health = healthCache || (await fetchHealth());
      el.settingsAiProvider.textContent = health.provider === "google"
        ? "Google Gemini is answering your requests."
        : "No AI provider is configured on this server, so answers are limited.";
    } catch {
      el.settingsAiProvider.textContent = "Couldn't reach the server to check.";
    }
  }

  function applyAppearance() {
    document.documentElement.dataset.appearance = state.appearance;
    for (const themeMeta of document.querySelectorAll('meta[name="theme-color"]')) {
      themeMeta.removeAttribute("media");
      themeMeta.setAttribute("content", state.appearance === "dim" ? "#0a0d24" : "#f4f3ff");
    }
    for (const btn of document.querySelectorAll("[data-appearance]")) {
      btn.classList.toggle("active", btn.dataset.appearance === state.appearance);
    }
  }

  async function refreshActivity() {
    if (!el.activityTaskList) return;
    const refreshBtn = el.activityRefreshBtn;
    if (refreshBtn) refreshBtn.disabled = true;
    el.activityTaskList.setAttribute("aria-busy", "true");
    renderActivityTimeline();
    if (!el.activityTaskList.children.length) {
      const skeleton = document.createElement("div");
      skeleton.className = "skeleton skeleton-row";
      skeleton.setAttribute("aria-hidden", "true");
      el.activityTaskList.appendChild(skeleton);
    }
    let tasks = null;
    try {
      tasks = await fetchTasks();
    } catch (err) {
      console.error(err);
      tasks = null;
    }
    el.activityTaskList.innerHTML = "";
    if (refreshBtn) refreshBtn.disabled = false;
    el.activityTaskList.removeAttribute("aria-busy");
    if (!tasks) {
      el.activityTaskList.appendChild(emptyState("Couldn't load tasks", "Check your connection, then refresh."));
      return;
    }
    if (!tasks.length) {
      el.activityTaskList.appendChild(emptyState("No tracked tasks", "Ask ZARVIS to plan a goal and it will appear here.", {
        icon: "i-task",
        action: { label: "Plan a task", onClick: () => document.querySelector('[data-workspace-prompt^="Create a workflow"]')?.click() },
      }));
      return;
    }
    for (const task of tasks) el.activityTaskList.appendChild(renderTaskCard(task));
    applyActivityFilter();
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
  let lastDeveloperAction = null;

  async function implementRepo() {
    lastDeveloperAction = implementRepo;
    const repoUrl = el.developerRepoInput.value.trim();
    const requirement = el.developerRequirementInput.value.trim();
    el.developerResult.innerHTML = "";
    if (!repoUrl || !requirement) {
      renderDeveloperMessage("Add a repository URL and describe the change to implement.", "error", false);
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
        revealDeveloperResult();
        return;
      }
      setDeveloperStage("implement", "Couldn't start", "z-badge-err");
      renderDeveloperMessage(
        body.structured?.userSafeMessage || body.error || "This change can't run right now (HTTP " + res.status + ").",
        "error",
      );
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      console.error(err);
      setDeveloperStage("implement", "Couldn't start", "z-badge-err");
      renderDeveloperMessage(COPY[state.lang].bootError.title, "error");
    } finally {
      el.developerImplementBtn.disabled = false;
    }
  }

  async function analyzeRepo() {
    lastDeveloperAction = analyzeRepo;
    const repoUrl = el.developerRepoInput.value.trim();
    el.developerResult.innerHTML = "";
    if (!repoUrl) {
      renderDeveloperMessage("Add a repository URL, then run Analyze.", "error", false);
      el.developerRepoInput.focus();
      return;
    }

    el.developerAnalyzeBtn.disabled = true;
    setAnalyzeLabel("Analyzing…");
    setDeveloperStage("analyze", "Running", "z-badge-info");
    try {
      const res = await apiFetch("/developer/analyze", { method: "POST", body: JSON.stringify({ repoUrl }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.kind !== "success") {
        setDeveloperStage("analyze", "Couldn't complete", "z-badge-err");
        renderDeveloperMessage(body.structured?.userSafeMessage || body.error || `Analysis failed (${res.status}).`, "error");
        return;
      }
      setDeveloperStage("analyze", "Completed", "z-badge-ok");
      renderDeveloperMessage(body.result?.summary || "Analyzed.", "success");
    } catch (err) {
      console.error(err);
      setDeveloperStage("analyze", "Couldn't complete", "z-badge-err");
      renderDeveloperMessage(COPY[state.lang].bootError.title, "error");
    } finally {
      el.developerAnalyzeBtn.disabled = false;
      setAnalyzeLabel("Analyze Repository");
    }
  }

  function renderDeveloperMessage(message, status, retryable = true) {
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

    if (status === "error" && retryable && lastDeveloperAction) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-secondary widget-retry";
      retry.textContent = "Try again";
      const action = lastDeveloperAction;
      retry.addEventListener("click", () => {
        haptic();
        void action();
      });
      widget.appendChild(retry);
    }
    el.developerResult.appendChild(widget);
    revealDeveloperResult();
    // A validation hint (retryable === false) is not a run: no status change, no history entry.
    if (!retryable && status === "error") return;
    setRunStatus(status === "success" ? "completed" : "failed");
    const line = String(message || "").split("\n").find((text) => text.trim()) || "";
    const title = line.replace(/[#*`_>]/g, "").trim().slice(0, 90) || (status === "success" ? "Completed" : "Failed");
    recordActivity("developer", title, status === "success" ? "Completed" : "Failed", status === "success" ? "ok" : "error");
    appendDeveloperLog(title, status === "success" ? "Completed" : "Failed", status === "success" ? "ok" : "error");
    renderHomeActivity();
  }

  function revealDeveloperResult() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => el.developerResult.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }));
  }

  const RUN_STATUS_LABELS = { idle: "Idle", thinking: "Thinking", working: "Working", waiting: "Waiting for approval", completed: "Completed", failed: "Failed" };

  function setRunStatus(tone) {
    if (!el.developerRunStatus) return;
    el.developerRunStatus.dataset.tone = tone;
    const label = el.developerRunStatus.querySelector("span:last-child");
    if (label) label.textContent = RUN_STATUS_LABELS[tone] || tone;
  }

  function appendDeveloperLog(title, meta, tone) {
    if (!el.developerLog) return;
    const item = document.createElement("li");
    item.className = "timeline-item";
    item.dataset.tone = tone;
    const dot = document.createElement("span");
    dot.className = "timeline-dot";
    dot.appendChild(svgIcon(tone === "ok" ? "i-check" : "i-x"));
    const body = document.createElement("div");
    body.className = "timeline-body";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("div");
    small.className = "timeline-meta";
    small.textContent = meta + " · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    body.append(strong, small);
    item.append(dot, body);
    el.developerLog.querySelector(".timeline-empty")?.remove();
    el.developerLog.prepend(item);
  }

  function setDeveloperStage(name, label, tone) {
    const runTone = label === "Checking" ? "thinking" : label === "Running" ? "working" : label === "Waiting for you" ? "waiting"
      : label === "Completed" ? "completed" : /^Couldn't/.test(label) ? "failed" : null;
    if (runTone) setRunStatus(runTone);
    const card = document.querySelector(`#developer-stages [data-stage="${name}"] .z-badge`);
    if (!card) return;
    card.textContent = label;
    card.className = "z-badge" + (tone ? " " + tone : "");
  }

  async function refreshPlans() {
    el.plansCurrent.replaceChildren();
    let snapshot = null;
    try {
      const res = await apiFetch("/entitlements/me");
      if (res.ok) snapshot = await res.json();
    } catch (err) {
      if (err instanceof SessionEndedError) return;
    }
    try {
      const res = await apiFetch("/billing/plans");
      planCatalogue = res.ok ? await res.json() : null;
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      planCatalogue = null;
    }
    if (snapshot) {
      currentPlanName = snapshot.plan;
      const paid = snapshot.plan === "PRO" && snapshot.planExpiresAt;
      const trial = snapshot.trialExpiresAt && snapshot.plan === "TRIAL";
      el.plansCurrent.append(
        renderStatTile({ label: "Current plan", value: formatPlanName(snapshot.plan), icon: "i-plan", tone: "tone-violet" }),
        renderStatTile({ label: "Credits", value: Number(snapshot.creditBalance).toLocaleString("en-IN"), icon: "i-bolt", tone: "tone-pink" }),
        renderStatTile({ label: paid ? "Active until" : "Trial", value: paid ? formatDate(snapshot.planExpiresAt) : trial ? "Ends " + new Date(snapshot.trialExpiresAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }) : "None", icon: "i-task", tone: "tone-cyan" }),
        renderStatTile({ label: "Payments", value: planCatalogue?.paymentsEnabled ? "UPI & cards" : "Not enabled", icon: "i-card", tone: "tone-blue" }),
      );
      updateSettingsValues();
    }
    renderPlansNotice();
    renderPlanCards(currentPlanName);
  }

  function renderPlansNotice() {
    const notice = document.getElementById("plans-notice");
    const text = document.getElementById("plans-notice-text");
    const box = document.getElementById("pay-box");
    const save = document.getElementById("yearly-save");
    if (!notice || !text) return;
    let message = "";
    if (!planCatalogue) message = "Couldn't load plans and prices. Check your connection and open this page again.";
    else if (!planCatalogue.paymentsEnabled) message = "Online payments aren't enabled on this server yet, so plans can't be bought here. Prices below are what Pro will cost.";
    else if (planCatalogue.testMode) message = "Test mode: payments use Razorpay's test environment and no real money moves.";
    notice.hidden = !message;
    text.textContent = message;
    if (box) box.hidden = !planCatalogue;
    const yearly = planCatalogue?.plans?.find((p) => p.period === "yearly");
    if (save) {
      save.hidden = !yearly || !yearly.savingsPercent;
      if (yearly?.savingsPercent) save.textContent = "Save " + yearly.savingsPercent + "%";
    }
  }

  function renderPlanCards(currentPlan) {
    el.planCards.replaceChildren();
    for (const plan of PLAN_TIERS) el.planCards.appendChild(renderPlanCard(plan, currentPlan));
  }

  function renderPlanCard(plan, currentPlan) {
    const card = document.createElement("div");
    card.className = plan.highlighted ? "plan-card highlighted" : "plan-card";
    const priced = plan.name === "PRO" ? planCatalogue?.plans?.find((p) => p.period === state.billing) : null;
    const isCurrent = currentPlan === plan.name || (plan.name === "FREE" && currentPlan === "TRIAL");

    const top = document.createElement("div");
    top.className = "plan-card-top";
    const name = document.createElement("h3");
    name.className = "plan-card-name";
    name.textContent = plan.title;
    const tag = document.createElement("span");
    tag.className = "plan-card-tag";
    tag.textContent = isCurrent ? "Current plan" : plan.tag || "";
    top.append(name, tag);
    card.appendChild(top);

    const price = document.createElement("p");
    price.className = "plan-price";
    if (plan.name === "FREE") {
      price.append(textSpan("plan-price-amount", inr.format(0)), textSpan("plan-price-unit", " forever"));
    } else if (priced) {
      price.append(textSpan("plan-price-amount", inr.format(priced.amountInr)), textSpan("plan-price-unit", priced.period === "yearly" ? " / year" : " / month"));
    } else {
      price.append(textSpan("plan-price-unit", "Price unavailable"));
    }
    card.appendChild(price);
    if (priced && priced.period === "yearly") {
      card.appendChild(textP("plan-card-note", `≈ ${inr.format(priced.perMonthInr)} / month${priced.savingsPercent ? " · save " + priced.savingsPercent + "%" : ""}`));
    }

    card.appendChild(textP("plan-card-tagline", plan.tagline));

    const list = document.createElement("ul");
    list.className = "plan-card-features";
    const features = priced ? [`${priced.credits.toLocaleString("en-IN")} credits per ${priced.period === "yearly" ? "year" : "month"}`, ...plan.features] : plan.features;
    for (const feature of features) {
      const li = document.createElement("li");
      li.textContent = feature;
      list.appendChild(li);
    }
    card.appendChild(list);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn plan-cta " + (plan.highlighted ? "btn-primary" : "btn-secondary");
    if (plan.name === "FREE") {
      action.textContent = isCurrent ? "Current plan" : "Included";
      action.disabled = true;
    } else if (!priced) {
      action.textContent = "Unavailable";
      action.disabled = true;
    } else if (!planCatalogue.paymentsEnabled) {
      action.textContent = "Payments not enabled yet";
      action.disabled = true;
    } else {
      const active = currentPlan === "PRO" && planCatalogue.current?.planExpiresAt;
      action.textContent = active ? `Renew · add ${priced.period === "yearly" ? "1 year" : "30 days"}` : "Upgrade Now";
      action.addEventListener("click", () => startCheckout(priced.key, action));
    }
    card.appendChild(action);
    return card;
  }

  function textSpan(className, text) {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  }

  function textP(className, text) {
    const node = document.createElement("p");
    node.className = className;
    node.textContent = text;
    return node;
  }

  /** Razorpay Checkout is loaded only when the user taps Upgrade, never on page load. */
  function loadRazorpayCheckout() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => (window.Razorpay ? resolve() : reject(new Error("checkout_unavailable")));
      script.onerror = () => reject(new Error("checkout_blocked"));
      document.head.appendChild(script);
    });
  }

  async function startCheckout(planKey, button) {
    if (checkoutBusy) return;
    checkoutBusy = true;
    const label = button.textContent;
    const reset = () => {
      checkoutBusy = false;
      button.disabled = false;
      button.textContent = label;
    };
    button.disabled = true;
    button.textContent = "Opening secure checkout…";
    try {
      const res = await apiFetch("/billing/orders", { method: "POST", body: JSON.stringify({ planKey }) });
      const order = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(order.error || "Couldn't start the payment.");
      await loadRazorpayCheckout();
      const email = localStorage.getItem(SESSION_KEYS.isGuest) === "false" ? localStorage.getItem(SESSION_KEYS.email) || "" : "";
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "ZARVIS MOBILE",
        description: order.description,
        prefill: email ? { email } : {},
        theme: { color: "#6d4ee8" },
        retry: { enabled: true },
        handler: (response) => {
          reset();
          void confirmPayment(order.orderId, response);
        },
        modal: { ondismiss: reset },
      });
      checkout.on("payment.failed", (event) => {
        showToast(event?.error?.description ? "Payment failed: " + event.error.description : "Payment failed. You were not charged.");
      });
      checkout.open();
    } catch (err) {
      reset();
      if (err instanceof SessionEndedError) return;
      showToast(err?.message === "checkout_blocked" || err?.message === "checkout_unavailable" ? "Couldn't load secure checkout. Check your connection and try again." : err?.message || "Couldn't start the payment.");
    }
  }

  /** After Checkout succeeds: the server checks the signature and the payment before granting Pro. */
  async function confirmPayment(orderId, response) {
    showToast("Confirming your payment…");
    try {
      const res = await apiFetch("/billing/verify", {
        method: "POST",
        body: JSON.stringify({ orderId, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "verification_failed");
      recordActivity("conversation", "Upgraded to Pro", body.planExpiresAt ? "Active until " + formatDate(body.planExpiresAt) : "", "ok");
      showToast("Pro is active" + (body.planExpiresAt ? " until " + formatDate(body.planExpiresAt) : ""));
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      // The payment may still have gone through (the server also hears from Razorpay directly).
      showToast("Payment received. Activating your plan — this can take a minute.");
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await delay(5000);
        try {
          const check = await apiFetch("/entitlements/me");
          if (check.ok && (await check.json()).plan === "PRO") break;
        } catch {
          break;
        }
      }
    }
    await refreshPlans();
  }

  // ---- System Metrics -----------------------------------------------------------------------
  // Real, client-measured per-turn latency (recordLatency(), called from submitUtterance()
  // around the actual /orchestrator/turn fetch — pure on-device timing, no new backend
  // endpoint) plus the task log, reusing the same render*Task* functions as before — replaces
  // the old "Status & Workflows" drawer with a full tab, matching the Android System Metrics
  // screen. Never a fabricated number.

  const MAX_LATENCY_ENTRIES = 50;

  function recordLatency(label, durationMs, success, isVoice = false) {
    const title = summarizeUtterance(label);
    latencyEntries = [{ id: `${Date.now()}-${Math.random()}`, label: title, durationMs, success, isVoice }, ...latencyEntries].slice(0, MAX_LATENCY_ENTRIES);
    recordActivity(isVoice ? "voice" : "conversation", title, success ? (isVoice ? "Voice request" : "Answered") + " · " + durationMs + " ms" : "Didn't complete", success ? "ok" : "error");
    if (state.activeView === "metrics") {
      renderLatencyLog();
      renderMetricsUsage();
    }
  }

  /** First line of what the user asked, without an attached document's text. */
  function summarizeUtterance(text) {
    const withoutDoc = String(text || "").split("\n\n[Attached document:")[0];
    const line = withoutDoc.split("\n")[0].trim();
    return line.length > 90 ? line.slice(0, 87) + "…" : line || "Request";
  }

  async function refreshMetricsHealth() {
    let body = null;
    try {
      body = await fetchHealth();
    } catch {
      body = null;
    }
    el.metricsHealthGrid.replaceChildren();
    if (body) {
      el.metricsHealthGrid.appendChild(renderStatTile({ label: "AI provider", value: body.provider === "google" ? "Gemini" : "Not configured" }));
      // /health reports "degraded" when the database is configured but unusable, "error" when
      // the server could not start; only "ok" is shown as Online.
      const server = body.status === "ok" ? "Online" : body.status === "degraded" ? "Database issue" : "Not started";
      el.metricsHealthGrid.appendChild(renderStatTile({ label: "Server", value: server }));
    } else {
      el.metricsHealthGrid.appendChild(renderStatTile({ label: "Server", value: "Offline" }));
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
    el.latencyStats.appendChild(renderStatTile({ label: "Average", value: avgMs }));
    el.latencyStats.appendChild(renderStatTile({ label: "Requests", value: String(latencyEntries.length) }));
    el.latencyStats.appendChild(renderStatTile({ label: "Success", value: successRate }));
    renderTrend();

    el.latencyLog.innerHTML = "";
    if (latencyEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "latency-empty";
      empty.textContent = "No requests yet this session. Ask ZARVIS something in Chat.";
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

  function renderTrend() {
    if (!el.metricsTrend) return;
    el.metricsTrend.replaceChildren();
    const entries = latencyEntries.slice(0, 20).reverse();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "trend-empty";
      empty.textContent = "Response times appear here after your first request.";
      el.metricsTrend.appendChild(empty);
      return;
    }
    const max = Math.max(...entries.map((entry) => entry.durationMs), 1);
    entries.forEach((entry, index) => {
      const bar = document.createElement("span");
      bar.className = "trend-bar" + (entry.success ? "" : " is-failed");
      bar.style.height = Math.max(4, Math.round((entry.durationMs / max) * 100)) + "%";
      bar.style.animationDelay = index * 20 + "ms";
      bar.title = `${entry.label} — ${entry.durationMs} ms`;
      el.metricsTrend.appendChild(bar);
    });
    el.metricsTrend.setAttribute("aria-label", `Response time for the last ${entries.length} requests, longest ${max} ms`);
  }

  /** Usage for this session (measured here) plus the account's live credit balance. */
  async function renderMetricsUsage() {
    if (!el.metricsUsage) return;
    const count = (type) => activityLog.filter((entry) => entry.type === type).length;
    const conversations = state.history.filter((message) => message.role === "user").length;
    const tiles = [
      { label: "Conversation turns", value: String(conversations), icon: "i-chat", tone: "tone-blue" },
      { label: "AI requests", value: String(latencyEntries.length), icon: "i-sparkle", tone: "tone-violet" },
      { label: "Voice requests", value: String(latencyEntries.filter((entry) => entry.isVoice).length), icon: "i-mic", tone: "tone-pink" },
      { label: "Files read", value: String(count("file") + count("image")), icon: "i-file", tone: "tone-cyan" },
      { label: "Developer runs", value: String(count("developer")), icon: "i-code", tone: "tone-violet" },
      { label: "Tracked tasks", value: Array.isArray(latestTasks) ? String(latestTasks.length) : "—", icon: "i-task", tone: "tone-blue" },
      { label: "Credits", value: "…", id: "metrics-credits", icon: "i-bolt", tone: "tone-pink" },
      { label: "Plan", value: currentPlanName ? formatPlanName(currentPlanName) : "…", id: "metrics-plan", icon: "i-plan", tone: "tone-cyan" },
    ];
    el.metricsUsage.replaceChildren(...tiles.map((tile) => {
      const node = renderStatTile(tile);
      if (tile.id) node.id = tile.id;
      return node;
    }));
    try {
      const res = await apiFetch("/entitlements/me");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const snapshot = await res.json();
      currentPlanName = snapshot.plan;
      const credits = document.querySelector("#metrics-credits .stat-tile-value");
      const plan = document.querySelector("#metrics-plan .stat-tile-value");
      if (credits) credits.textContent = String(snapshot.creditBalance);
      if (plan) plan.textContent = formatPlanName(snapshot.plan);
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      const credits = document.querySelector("#metrics-credits .stat-tile-value");
      if (credits) credits.textContent = "—";
    }
  }

  /** "TRIAL" → "Trial": the same spelling everywhere (Settings, Plans, Metrics). */
  function formatPlanName(plan) {
    const name = String(plan || "");
    return name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : name;
  }

  function renderStatTile({ label, value, icon, tone }) {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    if (icon) {
      tile.classList.add("has-icon", tone || "tone-blue");
      const ico = document.createElement("span");
      ico.className = "stat-tile-ico";
      ico.appendChild(svgIcon(icon));
      tile.appendChild(ico);
    }
    const copyEl = document.createElement("span");
    copyEl.className = "stat-tile-copy";
    const labelEl = document.createElement("span");
    labelEl.className = "stat-tile-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "stat-tile-value";
    valueEl.textContent = value;
    copyEl.append(labelEl, valueEl);
    tile.appendChild(copyEl);
    return tile;
  }

  let latestTasks;

  /** opts.icon: a sprite id shown in a soft halo; opts.action: { label, onClick } for a primary next step. */
  function emptyState(title, body, opts) {
    const box = document.createElement("div");
    box.className = "empty-state";
    if (opts && opts.icon) {
      const halo = document.createElement("span");
      halo.className = "empty-ico";
      halo.setAttribute("aria-hidden", "true");
      halo.appendChild(svgIcon(opts.icon));
      box.appendChild(halo);
    }
    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = body;
    box.append(strong, span);
    if (opts && opts.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary";
      button.textContent = opts.action.label;
      button.addEventListener("click", () => { haptic(); opts.action.onClick(); });
      box.appendChild(button);
    }
    return box;
  }

  const ACTIVITY_ICONS = {
    conversation: "i-chat",
    voice: "i-mic",
    ai: "i-sparkle",
    file: "i-file",
    image: "i-image",
    developer: "i-code",
    task: "i-task",
  };
  const ACTIVITY_LABELS = {
    conversation: "Chat",
    voice: "Voice",
    ai: "AI action",
    file: "File",
    image: "Image",
    developer: "Developer",
    task: "Task",
  };
  const activityFilter = { type: "all", query: "" };

  function svgIcon(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  /** Adds one entry to this session's activity (newest first) and refreshes what shows it. */
  function recordActivity(type, title, meta, tone, thumb) {
    activityLog.unshift({ id: `${Date.now()}-${Math.random()}`, type, title: String(title || ""), meta: meta || "", tone: tone || "", at: new Date(), thumb: thumb || "" });
    if (activityLog.length > 200) activityLog.length = 200;
    if (state.activeView === "activity") renderActivityTimeline();
    if (state.activeView === "home") renderHomeActivity();
  }

  function listRow({ icon, tone, title, meta, onClick }) {
    const row = document.createElement(onClick ? "button" : "div");
    if (onClick) {
      row.type = "button";
      row.addEventListener("click", onClick);
    }
    row.className = "list-row";
    const ico = document.createElement("span");
    ico.className = "row-ico " + (tone || "tone-blue");
    ico.appendChild(svgIcon(icon));
    const copy = document.createElement("span");
    copy.className = "list-row-copy";
    const strong = document.createElement("strong");
    strong.dataset.userText = ""; // a task goal, file name or question: never translated
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = meta;
    copy.append(strong, small);
    row.append(ico, copy);
    if (onClick) {
      const chev = svgIcon("i-right");
      chev.classList.add("row-chev");
      row.appendChild(chev);
    }
    return row;
  }

  function renderHomeActivity() {
    const root = document.getElementById("home-activity");
    if (!root) return;
    root.replaceChildren();
    document.getElementById("home-recent")?.classList.remove("is-empty");
    const rows = [];
    if (state.pendingAttachment) {
      rows.push(listRow({ icon: "i-file", tone: "tone-cyan", title: state.pendingAttachment.filename, meta: "Ready — ask about it in Chat", onClick: () => setActiveView("chat") }));
    }
    for (const entry of activityLog.slice(0, 3)) {
      rows.push(listRow({
        icon: ACTIVITY_ICONS[entry.type] || "i-sparkle",
        tone: entry.type === "developer" ? "tone-violet" : entry.type === "file" || entry.type === "image" ? "tone-cyan" : "tone-blue",
        title: entry.title,
        meta: `${ACTIVITY_LABELS[entry.type] || "Activity"} · ${formatRelativeTime(entry.at)}`,
        onClick: () => setActiveView(entry.type === "developer" && state.devAccess ? "developer" : entry.type === "task" || entry.type === "developer" ? "activity" : "chat"),
      }));
    }
    if (Array.isArray(latestTasks)) {
      for (const task of latestTasks.slice(0, Math.max(0, 4 - rows.length))) {
        rows.push(listRow({ icon: "i-task", tone: "tone-pink", title: task.goal, meta: `Task · ${task.status.toLowerCase()} · ${formatRelativeTime(task.createdAt)}`, onClick: () => setActiveView("activity") }));
      }
    }
    if (!rows.length && state.history.length) {
      const last = [...state.history].reverse().find((message) => message.role === "user");
      if (last) rows.push(listRow({ icon: "i-chat", tone: "tone-blue", title: summarizeUtterance(String(last.content || "").replace(/^📎\s*/, "")), meta: "Conversation", onClick: () => setActiveView("chat") }));
    }
    if (!rows.length) {
      if (latestTasks === undefined) {
        const skeleton = document.createElement("div");
        skeleton.className = "skeleton skeleton-row";
        skeleton.setAttribute("aria-hidden", "true");
        root.appendChild(skeleton);
        return;
      }
      if (latestTasks === null) {
        const failed = emptyState("Couldn't load your activity", "Check your connection and try again.");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn btn-secondary";
        retry.textContent = "Try again";
        retry.addEventListener("click", () => { void fetchTasks().catch(() => {}); });
        failed.appendChild(retry);
        root.appendChild(failed);
        return;
      }
      root.appendChild(emptyState("Nothing yet", "Your conversations and actions will appear here."));
      document.getElementById("home-recent")?.classList.add("is-empty");
      return;
    }
    document.getElementById("home-recent")?.classList.remove("is-empty");
    rows.forEach((row, index) => {
      row.style.animationDelay = index * 40 + "ms";
      root.appendChild(row);
    });
  }

  function setupActivityControls() {
    el.activitySearch?.addEventListener("input", () => {
      activityFilter.query = el.activitySearch.value.trim().toLowerCase();
      applyActivityFilter();
    });
    el.activityFilters?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      haptic();
      activityFilter.type = button.dataset.filter;
      for (const seg of el.activityFilters.querySelectorAll("[data-filter]")) {
        const active = seg === button;
        seg.classList.toggle("active", active);
        seg.setAttribute("aria-pressed", String(active));
      }
      applyActivityFilter();
    });
  }

  function matchesQuery(text) {
    return !activityFilter.query || String(text || "").toLowerCase().includes(activityFilter.query);
  }

  function renderActivityTimeline() {
    const root = el.activityTimeline;
    if (!root) return;
    root.replaceChildren();
    const type = activityFilter.type;
    const entries = activityLog.filter((entry) => {
      const typeOk = type === "all" || entry.type === type || (type === "conversation" && entry.type === "ai") || (type === "file" && entry.type === "image");
      return typeOk && matchesQuery(entry.title + " " + entry.meta);
    });
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "timeline-empty timeline-empty-rich";
      empty.appendChild(activityLog.length
        ? emptyState("No activity matches", "Try a different filter or clear the search.", { icon: "i-search" })
        : emptyState("Nothing yet this session", "Ask ZARVIS something and it shows up here.", { icon: "i-chat", action: { label: "Start a chat", onClick: () => setActiveView("chat") } }));
      root.appendChild(empty);
      return;
    }
    entries.slice(0, 60).forEach((entry, index) => {
      const item = document.createElement("li");
      item.className = "timeline-item";
      item.dataset.tone = entry.tone;
      item.style.animationDelay = Math.min(index * 30, 300) + "ms";
      const dot = document.createElement("span");
      dot.className = "timeline-dot";
      dot.appendChild(svgIcon(ACTIVITY_ICONS[entry.type] || "i-sparkle"));
      const body = document.createElement("div");
      body.className = "timeline-body";
      const title = document.createElement("strong");
      title.dataset.userText = "";
      title.textContent = entry.title;
      const meta = document.createElement("div");
      meta.className = "timeline-meta";
      const label = document.createElement("span");
      label.textContent = ACTIVITY_LABELS[entry.type] || "Activity";
      const when = document.createElement("span");
      when.textContent = formatRelativeTime(entry.at);
      meta.append(label, when);
      if (entry.meta) {
        const extra = document.createElement("span");
        extra.textContent = entry.meta;
        meta.appendChild(extra);
      }
      body.append(title, meta);
      item.append(dot, body);
      if (entry.thumb) {
        const thumb = document.createElement("img");
        thumb.className = "timeline-thumb";
        thumb.alt = "";
        thumb.src = entry.thumb;
        item.appendChild(thumb);
      }
      const more = document.createElement("button");
      more.type = "button";
      more.className = "timeline-more";
      more.setAttribute("aria-label", "Actions for " + (entry.title || "activity"));
      more.appendChild(svgIcon("i-more"));
      more.addEventListener("click", () => {
        window.ZarvisShell?.menu(more, entry.title || "Activity", [
          { label: "Open", icon: "i-right", hint: "Go to the related page", run: () => setActiveView(entry.type === "developer" && state.devAccess ? "developer" : entry.type === "task" || entry.type === "developer" ? "activity" : "chat") },
          { label: "Copy title", icon: "i-file", hint: "Copy to the clipboard", run: () => { navigator.clipboard?.writeText(entry.title || "").then(() => showToast("Copied"), () => showToast("Copy failed")); } },
          { label: "Remove from list", icon: "i-x", hint: "Only removes it from this session's list", run: () => {
            const at = activityLog.indexOf(entry);
            if (at >= 0) activityLog.splice(at, 1);
            if (entry.thumb) URL.revokeObjectURL(entry.thumb);
            renderActivityTimeline();
            renderHomeActivity();
          } },
        ]);
      });
      item.appendChild(more);
      root.appendChild(item);
    });
  }

  /** Shows/hides the timeline and task blocks for the chosen filter, and filters tasks by text. */
  function applyActivityFilter() {
    const type = activityFilter.type;
    const timelineBlock = document.querySelector('[data-activity-block="timeline"]');
    const taskBlock = document.querySelector('[data-activity-block="task"]');
    if (timelineBlock) timelineBlock.hidden = type === "task";
    if (taskBlock) taskBlock.hidden = type !== "all" && type !== "task";
    renderActivityTimeline();
    if (el.activityTaskList) {
      for (const card of el.activityTaskList.querySelectorAll(".task-card")) {
        card.hidden = !matchesQuery(card.textContent);
      }
    }
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

  /** Background refresh (Metrics page and its polling): keeps the Activity badge and Home list
   * current. A failure is already reflected in `latestTasks`, so it must not surface as an
   * unhandled rejection every few seconds while offline. */
  function refreshTasks() {
    return fetchTasks().catch((err) => {
      if (!(err instanceof SessionEndedError)) console.warn("Task refresh failed:", err);
    });
  }

  // User-triggerable transitions per status. No task executor exists yet (the backend refuses
  // resume/retry with task_execution_unavailable), so nothing here offers to start a task:
  // that would show work that is not happening.
  const TASK_ACTIONS = {
    PENDING: [{ action: "cancel", label: "Cancel", cls: "danger" }],
    RUNNING: [
      { action: "pause", label: "Pause", cls: "" },
      { action: "cancel", label: "Cancel", cls: "danger" },
    ],
    PAUSED: [{ action: "cancel", label: "Cancel", cls: "danger" }],
    FAILED: [],
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
    try {
      const res = await apiFetch(`/tasks/${taskId}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`Task ${action} failed:`, body.error || res.status);
        showToast("Couldn't update the task. Try again.");
        return;
      }
    } catch (err) {
      if (err instanceof SessionEndedError) return;
      console.error(err);
      showToast("Couldn't reach ZARVIS. Check your connection.");
      return;
    }
    void refreshActivity();
  }

  function formatRelativeTime(dateInput) {
    const diffMin = Math.round((Date.now() - new Date(dateInput).getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(dateInput).toLocaleDateString(dateLocale());
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
    await runTurn(utterance, isVoice, { clientTurnId: Logic.createClientTurnId() });
  }

  /** The actual orchestrator round trip, shared by a fresh submission (submitUtterance,
   * which first echoes the utterance as a user bubble) and Retry (addErrorBubble, which
   * deliberately does not — the failed attempt's own user bubble is still on screen, so
   * retrying the exact same text would otherwise show it twice; a retry is always treated as
   * typed/text-only, regardless of how the original turn started). */
  async function runTurn(utterance, isVoice = false, options = {}) {
    // One logical turn = one key. A Retry passes the failed attempt's key back in, so a turn
    // the server already finished is replayed rather than executed (and charged) again.
    const clientTurnId = options.clientTurnId || Logic.createClientTurnId();
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
          clientTurnId,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        console.error("Realtime orchestrator failed:", res.status, body.error || body.reason);
        showTurnFailure(body, utterance, clientTurnId);
        setOrbState("ERROR");
        recordLatency(utterance, Math.round(performance.now() - startedAt), false, isVoice);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullMessage = "";
      let assistantNode = null;
      let sentenceBuffer = "";
      const ttsTasks = new Set();
      let ttsUnavailable = false;
      let completed = false;
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
            // Out of voice quota: every further segment would fail the same way. Keep the
            // text reply, stop asking for speech in this turn.
            if (Logic.turnFailureKind({ code: err?.code }) !== "bootError") {
              ttsUnavailable = true;
              // Don't retry on the next turn either: back off (daily quota longer) so we stop
              // sending a 429 per reply while the voice quota is exhausted.
              const waitMs = err?.code === "AI_QUOTA_EXCEEDED" ? 10 * 60_000 : Math.max(30_000, Number(err?.retryAfterMs) || 0);
              ttsBlockedUntil = Date.now() + waitMs;
              for (const item of ttsQueue.splice(0)) item.ticket.done();
            }
          }).finally(() => {
            ttsTasks.delete(task);
            if (ttsQueue.length) drainTts();
          });
        }
      };

      const enqueueTts = (text, immediate = false) => {
        const clean = text.trim();
        if (!clean || !isVoice || !state.speak || ttsUnavailable || Date.now() < ttsBlockedUntil) return;
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
          throw new TurnFailedError(data);
        }
        if (event === "delta" && typeof data?.text === "string") {
          fullMessage += data.text;
          sentenceBuffer += data.text;
          if (!assistantNode) {
            thinkingNode.remove();
            assistantNode = addBubble("assistant", "", utterance);
            assistantNode.closest(".bubble")?.classList.add("is-streaming");
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
          completed = true;
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
          recordLatency(utterance, Math.round(performance.now() - startedAt), true, isVoice);
          renderToolActivity(data?.toolCalls);
          setOrbState("SUCCESS");
          if (assistantNode) renderFormattedText(assistantNode, fullMessage);
          drainTts();
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
      // The stream ended without `done` or `error` (platform timeout, dropped connection):
      // that is a failed turn, not a silent success — show it and offer Retry.
      if (!completed && !controller.signal.aborted) throw new Error("Turn stream ended before completion");
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
      showTurnFailure(err instanceof TurnFailedError ? err.payload : null, utterance, clientTurnId);
      setOrbState("ERROR");
      recordLatency(utterance, Math.round(performance.now() - startedAt), false, isVoice);
    } finally {
      if (ttsStartTimer) {
        clearTimeout(ttsStartTimer);
        ttsStartTimer = null;
      }
      // Segments that will never be played must release their turn, or later speech would wait forever.
      for (const item of ttsQueue.splice(0)) item.ticket.done();
      for (const streaming of el.conversation.querySelectorAll(".bubble.is-streaming")) streaming.classList.remove("is-streaming");
      thinkingNode.remove();
      if (currentTurnController === controller) currentTurnController = null;
      updateComposerMode(); // Send/Stop must reflect that no turn is in flight any more
    }
  }


  /** An exhausted daily AI quota cannot be fixed by retrying now: say so, offer no Retry.
   * A short rate limit and every other failure keep the Retry action. */
  function showTurnFailure(payload, utterance, clientTurnId) {
    const kind = Logic.turnFailureKind(payload);
    // Retrying cannot help today's exhausted quota or a message over the size limit.
    if (kind === "aiQuota" || kind === "tooLarge") addSystemNotice(COPY[state.lang][kind]);
    else addErrorBubble(COPY[state.lang][kind], () => runTurn(utterance, false, { clientTurnId }));
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

  // The page (not the conversation element) scrolls; keep the newest message above the
  // floating composer.
  function scrollConversationToBottom() {
    if (!el.conversation || state.activeView !== "chat") return;
    const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    toBottom();
    requestAnimationFrame(toBottom);
  }

  /** `at` is when the message was sent: now for a new message, the server's createdAt for
   * restored history, or null when unknown (then no time is shown rather than a wrong one). */
  function addBubble(role, text, utterance, at = new Date()) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.setAttribute("data-role", role);
    const label = document.createElement("span");
    label.className = "bubble-role";
    label.textContent = role === "user" ? "You" : role === "assistant" ? "ZARVIS" : role === "tool" ? "Action" : "Status";
    if (at instanceof Date && !Number.isNaN(at.getTime())) {
      const time = document.createElement("time");
      time.className = "bubble-time";
      time.dateTime = at.toISOString();
      time.textContent = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      label.append(" ", time);
    }
    bubble.appendChild(label);
    const body = document.createElement("div");
    body.className = "bubble-body";
    if (role === "assistant") renderFormattedText(body, text);
    else body.textContent = text;
    bubble.appendChild(body);
    if (role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "bubble-actions";
      const actionButton = (iconId, label) => {
        const button = document.createElement("button");
        button.type = "button";
        const labelNode = document.createElement("span");
        labelNode.textContent = label;
        button.append(svgIcon(iconId), labelNode);
        return { button, labelNode };
      };
      const { button: copyBtn, labelNode: copyLabel } = actionButton("i-file", "Copy");
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(bubblePlainText(body) || text);
          copyLabel.textContent = "Copied";
        } catch {
          copyLabel.textContent = "Copy failed";
        }
      });
      actions.appendChild(copyBtn);
      if (utterance) {
        const { button: again } = actionButton("i-refresh", "Regenerate");
        again.addEventListener("click", () => {
          bubble.remove();
          runTurn(utterance, false);
        });
        actions.appendChild(again);
      }
      if (typeof navigator.share === "function") {
        const { button: share } = actionButton("i-share", "Share");
        share.addEventListener("click", () => {
          navigator.share({ title: "ZARVIS", text: bubblePlainText(body) || text }).catch(() => {});
        });
        actions.appendChild(share);
      }
      const { button: download, labelNode: downloadLabel } = actionButton("i-download", "Download");
      download.addEventListener("click", () => {
        const blob = new Blob([bubblePlainText(body) || text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "zarvis-reply.txt";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        downloadLabel.textContent = "Saved";
      });
      actions.appendChild(download);
      const { button: listen } = actionButton("i-wave", "Listen");
      listen.addEventListener("click", () => {
        void speak(bubblePlainText(body) || text, null, true);
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
      row.className = "tool-row";
      row.dataset.status = statusCode;
      row.dataset.tone = TOOL_TONES[statusCode] || "";
      const top = document.createElement("div");
      top.className = "tool-row-top";
      const title = document.createElement("strong");
      title.textContent = skillDisplayName(call.skillId);
      title.title = call.skillId || "";
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
      recordActivity("ai", skillDisplayName(call.skillId), Logic.toolStatusLabel(statusCode), statusCode === "COMPLETED" ? "ok" : TOOL_TONES[statusCode] === "failed" ? "error" : "");
    }
    scrollConversationToBottom();
  }

  function skillDisplayName(skillId) {
    const skill = state.skills.find((item) => item.id === skillId);
    return skill ? skill.name : skillId || "Tool";
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
  /** A reply's readable text, without the code blocks' Copy buttons. */
  function bubblePlainText(body) {
    const clone = body.cloneNode(true);
    for (const button of clone.querySelectorAll(".code-copy")) button.remove();
    return clone.innerText || clone.textContent || "";
  }

  function renderFormattedText(container, text) {
    container.innerHTML = Logic.formatReplyHtml(text);
    for (const pre of container.querySelectorAll("pre.reply-code")) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "code-copy";
      copy.setAttribute("aria-label", "Copy code");
      copy.textContent = "Copy";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code")?.textContent || "");
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Copy failed";
        }
        setTimeout(() => { copy.textContent = "Copy"; }, 1800);
      });
      pre.prepend(copy);
    }
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
    scrollConversationToBottom();
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
    scrollConversationToBottom();
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
    scrollConversationToBottom();
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
      setExtractingState(true, file);
      try {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const res = await apiFetch("/documents/extract", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(`Image analysis failed (${res.status}):`, body.error);
          addSystemNotice(noticeForExtractError(body.error, body.code));
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
      setAttachmentPreview(file);
      setPendingAttachment(file.name, text);
      return;
    }

    // pdf / docx — real extraction happens server-side (see the section doc comment above).
    if (file.size > MAX_BINARY_UPLOAD_BYTES) {
      addSystemNotice(COPY[state.lang].oversizedFile);
      return;
    }
    setExtractingState(true, file);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const res = await apiFetch("/documents/extract", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`Document extraction failed (${res.status}):`, body.error);
        addSystemNotice(noticeForExtractError(body.error, body.code));
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

  function noticeForExtractError(code, aiCode) {
    if (code === "ai_quota_exceeded") return COPY[state.lang][Logic.turnFailureKind({ code: aiCode }) === "aiBusy" ? "aiBusy" : "aiQuota"];
    if (code === "unsupported_file_type") return COPY[state.lang].unsupportedFile;
    if (code === "document_too_long") return COPY[state.lang].oversizedFile;
    if (code === "empty_document") return COPY[state.lang].emptyFile;
    if (code === "image_analysis_unavailable") return COPY[state.lang].imageUnavailable;
    if (code === "ai_unavailable") return COPY[state.lang].imageAiDown;
    if (code === "file_too_large") return COPY[state.lang].oversizedFile;
    return COPY[state.lang].unreadableFile;
  }

  let attachmentPreviewUrl = null;
  let lastPreviewFile = null;

  /** Shows a local thumbnail for an image attachment (a blob: URL; nothing is uploaded for
   * the preview), or the file icon for documents. */
  function setAttachmentPreview(file) {
    const holder = el.attachmentChip?.querySelector(".attachment-ico");
    if (!holder) return;
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl = null;
    lastPreviewFile = file && classifyLocalFile(file) === "image" ? file : null;
    holder.replaceChildren();
    if (file && classifyLocalFile(file) === "image") {
      attachmentPreviewUrl = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.alt = "";
      img.src = attachmentPreviewUrl;
      holder.appendChild(img);
      holder.classList.add("has-preview");
    } else {
      holder.appendChild(svgIcon("i-file"));
      holder.classList.remove("has-preview");
    }
  }

  function setExtractingState(isExtracting, file) {
    // While the file is read the chip shows it with an indeterminate progress bar: the
    // request reports no percentage, so no fake one is shown.
    if (isExtracting && file) {
      setAttachmentPreview(file);
      el.attachmentName.textContent = file.name;
      el.attachmentStatus.textContent = COPY[state.lang].extracting;
      el.attachmentChip.hidden = false;
    }
    el.attachmentChip.classList.toggle("is-loading", isExtracting);
    el.attachmentRemoveBtn.hidden = isExtracting;
    if (!isExtracting && !state.pendingAttachment) {
      el.attachmentChip.hidden = true;
      setAttachmentPreview(null);
    }
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
    // An image attachment keeps its own small preview in Activity (a local blob: URL, never uploaded).
    const thumb = lastPreviewFile ? URL.createObjectURL(lastPreviewFile) : "";
    recordActivity(thumb ? "image" : "file", filename, "Ready to ask about", "ok", thumb);
    renderHomeActivity();
    el.input.focus();
  }

  function clearPendingAttachment() {
    state.pendingAttachment = null;
    el.attachmentChip.hidden = true;
    setAttachmentPreview(null);
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
    scrollConversationToBottom();
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
    document.body.dataset.orbState = newState;
    // A natural-language status ("Working…", "काम कर रहा हूँ…"), never the raw internal
    // state name — showing enum values like "EXECUTING" or "UNDERSTANDING" verbatim would be
    // exactly the kind of developer/debug leak the product content rules rule out. The
    // `dataset.state` above (unchanged) is what CSS/animations key off of.
    renderHeroStatus();
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
    if (busy && !el.sendBtn.classList.contains("stop-mode")) stopModeSince = Date.now();
    el.sendBtn.classList.toggle("stop-mode", busy);
    el.sendBtn.title = busy ? copy.stop : copy.send;
    el.sendBtn.setAttribute("aria-label", busy ? copy.stop : copy.send);
    el.sendLabel.textContent = busy ? copy.stop : copy.send;
  }

  // A turn is "in flight" for every state between UNDERSTANDING and the SPEAKING reply —
  // used by the composer's Send/Stop toggle (updateComposerMode) and cancelCurrentTurn's
  // Escape-key guard, both via isBusy() below.
  const BUSY_STATES = ["UNDERSTANDING", "EXECUTING", "SUCCESS", "SPEAKING"];
  /** When Send last turned into Stop, and how long a click right after that is ignored. */
  let stopModeSince = 0;
  const STOP_GRACE_MS = 600;
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
        .then((registration) => registration?.update())
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

    recognition.addEventListener("error", (event) => {
      el.micBtn.setAttribute("aria-pressed", "false");
      el.orb.setAttribute("aria-pressed", "false");
      // Silence or a deliberate stop is not a failure; only a real error shows the error state.
      const benign = event?.error === "no-speech" || event?.error === "aborted";
      if (!currentTurnController) setOrbState(benign ? "IDLE" : "ERROR");
      // Say why, in plain words; a deliberate stop ("aborted") needs no message.
      const copy = COPY[state.lang];
      const notice = {
        "not-allowed": copy.micDenied,
        "service-not-allowed": copy.micDenied,
        "audio-capture": copy.micDenied,
        "no-speech": copy.noSpeech,
        network: copy.voiceNetwork,
      }[event?.error] || (event?.error === "aborted" ? null : copy.voiceFailed);
      if (notice) addSystemNotice(notice);
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
    if (!recognition) {
      addSystemNotice(COPY[state.lang].voiceUnsupported);
      return;
    }
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

  // Spoken replies come from Gemini (see speakWithGemini / speakGeminiStream); the browser's
  // own speechSynthesis voices are not used, so the picker only lists Gemini's voices.
  function setupSpeechSynthesis() {
    populateVoiceSelect();
    el.voiceSelect?.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEYS.ttsVoice, el.voiceSelect.value);
      showToast("Voice: " + el.voiceSelect.value);
    });
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

  // Gemini is the only voice provider. Browser speechSynthesis is NOT a TTS fallback.
  async function speak(text, node, force = false) {
    if ((!state.speak && !force) || !text) return;
    if (node) attachWaveform(node);
    try {
      await speakWithGemini(text);
    } catch (err) {
      if (err?.name !== "AbortError") {
        console.warn("Gemini TTS unavailable:", err);
        // An explicit Listen tap gets visible feedback instead of silence.
        if (force) showToast(COPY[state.lang].ttsUnavailable);
      }
    } finally {
      if (node) detachWaveform(node);
      if (el.orb.dataset.state === "SPEAKING") setOrbState("IDLE");
    }
  }

  let activeAudio = null;
  // While the server reports the voice quota/rate limit exhausted, skip TTS requests until then.
  let ttsBlockedUntil = 0;
  // Every in-flight TTS request. Two reply segments stream at once, so Stop must abort all of
  // them, not only the most recently started one.
  const activeTtsControllers = new Set();
  let activeAudioContext = null;
  let ttsScheduledUntil = 0;
  const ttsSources = new Set();

  async function speakWithGemini(text) {
    const controller = new AbortController();
    activeTtsControllers.add(controller);
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
      activeTtsControllers.delete(controller);
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
    activeTtsControllers.add(controller);
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
        const error = new Error("Gemini streaming TTS HTTP " + res.status + ": " + detail);
        error.code = body?.code;
        error.retryAfterMs = body?.retryAfterMs;
        throw error;
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
      activeTtsControllers.delete(controller);
    }
  }

  async function waitForTtsPlayback(signal) {
    while (!signal?.aborted && ttsScheduledUntil > (activeAudioContext?.currentTime || 0) + 0.02) {
      const remaining = Math.max(20, (ttsScheduledUntil - (activeAudioContext?.currentTime || 0)) * 1000);
      await delay(Math.min(remaining, 120));
    }
  }

  function stopSpeaking() {
    for (const controller of activeTtsControllers) controller.abort();
    activeTtsControllers.clear();
    if (activeAudio) activeAudio.pause();
    for (const source of ttsSources) {
      try { source.stop(); } catch {}
    }
    ttsSources.clear();
    ttsScheduledUntil = 0;
    setOrbState("IDLE");
  }

  // Started last, once every `const`/`let` above is initialised: init() runs synchronously up to
  // its first `await`, so starting it earlier let setup code hit a temporal dead zone
  // ("Cannot access '...' before initialization") whenever it touched a later declaration.
  init().catch((err) => {
    // The technical detail (network failure, a platform error page, whatever) is only ever
    // logged here — never rendered into the UI. addErrorBubble always shows the same
    // friendly, translated connection message regardless of cause.
    console.error(err);
    addErrorBubble(COPY[state.lang].bootError, () => location.reload());
    setOrbState("ERROR");
  });
})();
