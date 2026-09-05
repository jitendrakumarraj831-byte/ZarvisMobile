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
      hero: "What would you like me to do?",
      placeholder: "Type your task…",
      send: "Send",
      mic: "Speak",
      thinking: "Thinking…",
      bootError: "Couldn't reach the ZARVIS backend. Is it running?",
    },
    hi: {
      hero: "आप क्या करवाना चाहते हैं?",
      placeholder: "अपना काम लिखें…",
      send: "भेजें",
      mic: "बोलें",
      thinking: "सोच रहा हूँ…",
      bootError: "ZARVIS बैकएंड तक नहीं पहुँच पाया। क्या यह चल रहा है?",
    },
  };

  const el = {
    orb: document.getElementById("orb"),
    orbWrap: document.querySelector(".orb-wrap"),
    heroTitle: document.getElementById("hero-title"),
    heroStatus: document.getElementById("hero-status"),
    conversation: document.getElementById("conversation"),
    categories: document.getElementById("categories"),
    input: document.getElementById("text-input"),
    sendBtn: document.getElementById("send-btn"),
    sendLabel: document.querySelector("#send-btn .send-label"),
    micBtn: document.getElementById("mic-btn"),
    langToggle: document.getElementById("lang-toggle"),
    voiceOutToggle: document.getElementById("voice-out-toggle"),
    voiceSelect: document.getElementById("voice-select"),
    providerBadge: document.getElementById("provider-badge"),
    installBtn: document.getElementById("install-btn"),
  };

  const state = {
    lang: localStorage.getItem(STORAGE_KEYS.lang) || "hi",
    speak: localStorage.getItem(STORAGE_KEYS.speak) !== "off",
    // Hands-free "wake word" mode arms itself automatically on load (see init()) but this
    // flag is intentionally session-only (never persisted to localStorage) — the mute/armed
    // choice always resets fresh on the next reload rather than remembering a muted state
    // indefinitely, so it can't end up silently listening in a way nobody remembers
    // enabling (MASTER_SPEC.md §15, "never secretly monitor the device").
    autoListen: false,
    // True only for the very first turn of a session — lets the system prompt ask Gemini
    // for a warmer, more "attractive" welcome-style reply once, without every later message
    // paying that same introductory tax.
    firstTurn: true,
  };

  // Common mishearings of "Zarvis" from real speech recognizers (most STT models have
  // never seen this word and fall back to the much more common "Jarvis") — matched
  // case-insensitively against the transcript. This is a software approximation of a wake
  // word, not a true low-power OS wake-word detector: it only works while this tab is open
  // and in the foreground, and every second of "armed" audio is sent to the browser's
  // speech-recognition service exactly like a manual mic tap would be.
  const WAKE_WORDS = ["zarvis", "ज़ार्विस", "जार्विस", "जारविस", "jarvis", "sarvis"];

  // Declared here (not near their setup functions below) because init() runs synchronously
  // up to its first `await` and calls those setup functions immediately — a `let` declared
  // later in this same scope would still be in its temporal dead zone at that point,
  // throwing "Cannot access '...' before initialization".
  let recognition = null;
  let cachedVoices = [];

  init().catch((err) => {
    console.error(err);
    addBubble("system", `${COPY[state.lang].bootError}\n\n${err instanceof Error ? err.message : String(err)}`);
    setOrbState("ERROR");
  });

  async function init() {
    setupSpeechSynthesis();
    applyLanguage();
    el.voiceOutToggle.setAttribute("aria-pressed", String(state.speak));
    setupSpeechRecognition();
    setupInstallPrompt();

    el.sendBtn.addEventListener("click", () => submitUtterance(el.input.value));
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitUtterance(el.input.value);
    });
    el.langToggle.addEventListener("click", () => {
      state.lang = state.lang === "en" ? "hi" : "en";
      localStorage.setItem(STORAGE_KEYS.lang, state.lang);
      applyLanguage();
    });
    el.voiceOutToggle.addEventListener("click", () => {
      state.speak = !state.speak;
      localStorage.setItem(STORAGE_KEYS.speak, state.speak ? "on" : "off");
      el.voiceOutToggle.setAttribute("aria-pressed", String(state.speak));
    });

    await ensureSession();
    await Promise.all([loadHealth(), loadSkills()]);
    setOrbState("IDLE");

    // Hands-free mode arms itself automatically on load — no tap needed, per explicit
    // request. The orb remains a manual mute/unmute toggle for whenever it isn't wanted.
    // The browser still owns the actual permission gate: on a first-ever visit this
    // triggers its native "allow microphone" prompt (SpeechRecognition doesn't require a
    // preceding click the way getUserMedia's autoplay-style policies do); once granted, it
    // stays silent on every later visit.
    toggleAutoListen();
  }

  function resolveApiBase() {
    const params = new URLSearchParams(location.search);
    const override = params.get("api");
    if (override) return override.replace(/\/$/, "");
    return `${location.origin}/api/v1`;
  }

  function applyLanguage() {
    const copy = COPY[state.lang];
    el.langToggle.textContent = state.lang.toUpperCase();
    el.heroTitle.textContent = copy.hero;
    el.input.placeholder = copy.placeholder;
    // Set only the label span's text, not the whole button — sendBtn also contains an SVG
    // icon that el.sendBtn.textContent = ... would silently wipe out.
    el.sendLabel.textContent = copy.send;
    el.micBtn.title = copy.mic;
    populateVoiceSelect(); // available voices differ between "en" and "hi"
  }

  // ---- Session (guest account bootstrap + refresh) -------------------------------------

  async function ensureSession() {
    if (localStorage.getItem(STORAGE_KEYS.accessToken)) return;
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

  async function apiFetch(path, options = {}, retried = false) {
    const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401 && !retried) {
      const refreshed = await tryRefresh();
      if (refreshed) return apiFetch(path, options, true);
    }
    return res;
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

  // ---- Health / skill catalogue ---------------------------------------------------------

  async function loadHealth() {
    try {
      const res = await fetch(`${API_BASE.replace(/\/api\/v1$/, "")}/health`);
      const body = await res.json();
      const live = body.provider === "google";
      el.providerBadge.innerHTML = `<span class="status-dot ${live ? "live" : "mock"}" aria-hidden="true"></span>${live ? "Gemini" : "Mock"}`;
      el.providerBadge.title = live
        ? "Live Google Gemini calls (GEMINI_API_KEY is set)"
        : "Deterministic MockAIProvider — set GEMINI_API_KEY on the backend for live Gemini";
    } catch {
      el.providerBadge.innerHTML = `<span class="status-dot" aria-hidden="true"></span>Offline`;
    }
  }

  async function loadSkills() {
    const res = await apiFetch("/skills");
    if (!res.ok) return;
    const { skills } = await res.json();
    el.categories.innerHTML = "";
    for (const skill of skills) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "category-chip" + (skill.upgradeRequired ? " locked" : "");
      chip.textContent = skill.name;
      chip.title = skill.description;
      chip.addEventListener("click", () => {
        el.input.value = exampleFor(skill.description);
        el.input.focus();
      });
      el.categories.appendChild(chip);
    }
  }

  function exampleFor(description) {
    const match = description.match(/"([^"]+)"/);
    return match ? match[1] : description;
  }

  // ---- Conversation turn -----------------------------------------------------------------

  async function submitUtterance(rawText) {
    const utterance = rawText.trim();
    if (!utterance) return;
    el.input.value = "";
    addBubble("user", utterance);

    setOrbState("UNDERSTANDING");
    await delay(250);
    setOrbState("EXECUTING");

    const isFirstTurn = state.firstTurn;
    state.firstTurn = false; // set before the request, not after — a failed first turn
    // shouldn't get a second "warm welcome" pass on retry.

    try {
      const res = await apiFetch("/orchestrator/turn", {
        method: "POST",
        body: JSON.stringify({
          utterance,
          locale: state.lang,
          userName: localStorage.getItem(STORAGE_KEYS.userName),
          isFirstTurn,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addBubble("assistant", body.error || `Request failed (${res.status}).`);
        setOrbState("ERROR");
        return;
      }
      const result = await res.json();
      addBubble("assistant", result.message || "…");
      // Awaited so the orb actually stays SPEAKING for the duration of playback — without
      // this, the fire-and-forget call returns almost immediately (it only runs
      // synchronously up to its first internal await) and the setOrbState("IDLE") below
      // would fire right after, overwriting SPEAKING a fraction of a second in. That
      // matters beyond cosmetics: auto-listen mode (see startListening()) uses the orb
      // state to know when ZARVIS has actually finished talking before re-arming the mic —
      // starting to listen while still speaking would pick up its own voice.
      await speak(result.message);
    } catch (err) {
      console.error(err);
      addBubble("system", COPY[state.lang].bootError);
      setOrbState("ERROR");
      return;
    }
    setOrbState("IDLE");
    if (state.autoListen) startListening();
  }

  function addBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    el.conversation.appendChild(bubble);
    el.conversation.scrollTop = el.conversation.scrollHeight;
  }

  function setOrbState(newState) {
    el.orb.dataset.state = newState;
    el.heroStatus.textContent = newState;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- Install as an app (PWA) -----------------------------------------------------------
  // Chrome/Edge/Android fire `beforeinstallprompt` only once the page passes installability
  // checks (manifest.webmanifest + a registered service worker, see sw.js) — capture that
  // event so the Install button can trigger the browser's own native install prompt on tap,
  // rather than showing a button that does nothing on browsers that don't support it (never
  // fake success). iOS Safari never fires this event at all; there the button instead
  // explains the manual "Share -> Add to Home Screen" step, since no programmatic install
  // API exists there.

  let deferredInstallPrompt = null;

  function setupInstallPrompt() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.error("Service worker registration failed:", err));
    }

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (isStandalone) return; // already installed/running as an app — nothing to offer.

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      el.installBtn.hidden = false;
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      el.installBtn.hidden = true;
    });

    if (isIos) {
      // No beforeinstallprompt on iOS — show the button unconditionally with instructions.
      el.installBtn.hidden = false;
    }

    el.installBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        el.installBtn.hidden = true;
        return;
      }
      if (isIos) {
        addBubble("system", "iPhone/iPad par install karne ke liye: Share button (⬆) dabao, phir \"Add to Home Screen\" chuno.");
      }
    });
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
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.addEventListener("result", (event) => {
      const transcript = event.results[0][0].transcript;
      if (state.autoListen) {
        const command = extractCommandAfterWakeWord(transcript);
        if (command === undefined) return; // no wake word at all — ignore background speech
        if (command === "") {
          acknowledgeWakeWord(); // just "Zarvis" alone — confirm we heard it, keep listening
          return;
        }
        submitUtterance(command);
        return;
      }
      submitUtterance(transcript);
    });

    recognition.addEventListener("end", () => {
      if (state.autoListen) {
        // A turn already in flight restarts listening itself once it's actually done
        // speaking (see submitUtterance/speak) — restarting here too would race it and
        // risk the mic picking up ZARVIS's own reply.
        const busy = ["UNDERSTANDING", "EXECUTING", "SPEAKING"].includes(el.orb.dataset.state);
        if (!busy) setTimeout(startListening, 300);
        return;
      }
      el.micBtn.setAttribute("aria-pressed", "false");
      if (el.orb.dataset.state === "LISTENING") setOrbState("IDLE");
    });

    recognition.addEventListener("error", (event) => {
      // "no-speech" (silence) and "aborted" (we called .stop(), or a restart raced an old
      // session) are routine while always-on — don't drop out of hands-free mode for those.
      if (state.autoListen && (event.error === "no-speech" || event.error === "aborted")) return;
      if (state.autoListen) toggleAutoListen();
      el.micBtn.setAttribute("aria-pressed", "false");
      setOrbState("IDLE");
    });

    el.micBtn.addEventListener("click", () => {
      if (state.autoListen) return; // the mic is already armed by hands-free mode
      startListening();
    });

    el.orb.addEventListener("click", toggleAutoListen);
    el.orb.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleAutoListen();
      }
    });
  }

  function toggleAutoListen() {
    if (!recognition) return;
    state.autoListen = !state.autoListen;
    el.orb.setAttribute("aria-pressed", String(state.autoListen));
    el.orbWrap.classList.toggle("auto-listen", state.autoListen);
    if (state.autoListen) {
      addBubble(
        "system",
        state.lang === "hi"
          ? `Hands-free mode ON — "ज़ार्विस" bol kar apna command boliye.`
          : `Hands-free mode ON — say "Zarvis" followed by your command.`,
      );
      startListening();
    } else {
      stopListening();
      setOrbState("IDLE");
    }
  }

  function startListening() {
    if (!recognition) return;
    recognition.lang = state.lang === "hi" ? "hi-IN" : "en-US";
    el.micBtn.setAttribute("aria-pressed", "true");
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
  }

  /** Returns the text after the wake word, or `null` if no wake word was heard at all. */
  /**
   * Returns the command text after the wake word, `""` if the wake word was said alone
   * (nothing after it), or `undefined` if no wake word was heard at all — three genuinely
   * different outcomes the caller needs to tell apart (submit / acknowledge / ignore),
   * unlike a single `null` for both "nothing to do" cases.
   */
  function extractCommandAfterWakeWord(transcript) {
    const lower = transcript.toLowerCase();
    for (const word of WAKE_WORDS) {
      const idx = lower.indexOf(word);
      if (idx === -1) continue;
      return transcript.slice(idx + word.length).replace(/^[\s,.:!।-]+/, "").trim();
    }
    return undefined;
  }

  /** A short, attractive acknowledgment when the user says just "Zarvis" with no command
   * yet — mirrors how a real voice assistant confirms it heard the wake word, rather than
   * silently doing nothing. Restarts listening itself once done speaking, same as a normal
   * turn (see submitUtterance). */
  async function acknowledgeWakeWord() {
    const reply = state.lang === "hi" ? "जी बोलिए, मैं सुन रहा हूँ! 👋" : "Yes? I'm listening!";
    addBubble("assistant", reply);
    await speak(reply);
    if (state.autoListen) startListening();
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
  async function speak(text) {
    if (!state.speak || !text) return;
    setOrbState("SPEAKING");
    let playedLive = false;
    try {
      playedLive = await speakWithGemini(text);
    } catch (err) {
      console.warn("Gemini voice unavailable, falling back to the browser's voice:", err);
    }
    if (!playedLive) speakWithBrowser(text);
  }

  async function speakWithGemini(text) {
    const res = await apiFetch("/tts/synthesize", { method: "POST", body: JSON.stringify({ text }) });
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    try {
      await new Promise((resolve, reject) => {
        audio.addEventListener("ended", resolve, { once: true });
        audio.addEventListener("error", () => reject(new Error("Audio playback failed")), { once: true });
        audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    setOrbState("IDLE");
    return true;
  }

  function speakWithBrowser(text) {
    if (!window.speechSynthesis) {
      setOrbState("IDLE");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const langPrefix = state.lang === "hi" ? "hi" : "en";
    utterance.lang = state.lang === "hi" ? "hi-IN" : "en-US";
    const voice = pickVoice(langPrefix);
    if (voice) utterance.voice = voice;
    utterance.onend = () => setOrbState("IDLE");
    utterance.onerror = () => setOrbState("IDLE");
    window.speechSynthesis.speak(utterance);
  }
})();
