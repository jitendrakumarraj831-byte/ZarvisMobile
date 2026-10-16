# Phase 1 device checklist: Nothing Phone (2a)

This checklist verifies the Phase 1 changes of the assistant upgrade
([jitendrakumarraj831-byte/ZarvisMobile#99](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/pull/99),
branch `claude/focused-maxwell-fb27sa`) on a real Nothing Phone (2a). It is a checklist for a person holding the phone.
Nothing in it has been run on a phone yet.

Phase 1 changed three things:

1. **Reply language and voice** (`backend/src/language/textLanguage.ts`). One detector now decides the reply language
   and the voice. English messages containing "the" or "do" are no longer told to get a Hindi reply, and Hinglish such
   as "WhatsApp kholo" is no longer answered in English.
2. **Call gate** (`android/domain/.../orchestrator/DeviceCommandGate.kt`). "call mat karo", "baad mein call karna" and
   "call kaise karte hain" no longer open the call flow.
3. **Memory and log tests.** These add no behaviour; they pin that chat never saves memory, that memory stays with its
   own account, and that the server log holds no message or memory text.

Do not merge anything to `main` because of this checklist. Phase 2 starts only after the owner approves it.

---

## 0. What is tested where

Three separate kinds of evidence. Only the third one comes from this checklist.

### 0.1 CI-tested (GitHub Actions on the PR, automated)

| What | CI job | State when this was written |
|---|---|---|
| Language detector: 73 English, Hinglish and Hindi tests; reply and voice agree | `Backend + Web checks / backend` | passed |
| Chat never saves memory; a model cannot save memory through an invented tool; memory isolation; no message, memory or tool text in logs (in-memory **and** Postgres 16) | `backend` | passed |
| The whole backend suite, typecheck, capability-registry parity | `backend` | passed |
| Android call gate: Hinglish commands that work, negations, deferrals and questions blocked, per-action confirmation kept (`HinglishDeviceCommandSafetyTest`) and all other `:domain` tests | `Android build / test-and-lint` (`./gradlew :domain:build`) | passed |
| Debug APK builds and points at the configured dev backend | `assemble-debug` | passed |
| CodeQL (TypeScript, Kotlin, Actions) | `CodeQL` | passed |
| Emulator suite on API 26, 30 and 34 (permission dialogs, process death, revocation, special access, settings UI, one turn = one execution) | `Android emulator` | still running when written |
| Browser E2E against the real backend and Postgres | `web-e2e` | still running when written |
| APK build on Windows with Git Bash | `windows-build` | still running when written |

The final state is on the PR's **Checks** tab. CI uses the **mock** AI and no real phone. It does not prove that
Gemini follows the language instruction, which voice you hear, or what the phone's speech recognizer writes down.

### 0.2 Code-reviewed only (read, not executed against the real thing)

| What | Why it is not CI-tested |
|---|---|
| The app's real chat screen sends typed and spoken text through `AndroidOrchestrator.handleTurn` → `KeywordSkillMatcher.matchCommand` → `DeviceCommandGate` | The emulator suite never types Hinglish. The routing rules are unit-tested, the wiring is only reviewed. |
| Gemini answers in the language the planner asks for | CI has no Gemini key; only the instruction text is tested. |
| A Hinglish reply is spoken by the Hindi voice (Swara) and an English one by the English voice (Jenny) | Voice choice is unit-tested; real Edge speech for these phrases is not part of the PR's CI. |
| The Android app writes no message text to logcat (OkHttp logging is `BASIC`: method, URL and status only) | Reviewed in `ApiClientFactory.kt`; no test reads logcat. |
| What the Nothing Phone's speech recognizer writes for spoken Hinglish | Depends on the phone's Google speech service. |

### 0.3 Physically device-tested

**None yet.** This checklist produces that evidence. Fill in §6 as you go, and nothing moves to WORKING until it is
filled in.

---

## 1. What you need

**Computer** (Windows with Git Bash, macOS or Linux; every command below is bash, so on Windows use Git Bash):

- Git, Node.js 22 or newer, JDK 17, and the Android SDK (Android Studio installs it; the build needs `ANDROID_HOME` or
  `android/local.properties` with `sdk.dir=…`), with `platform-tools` (`adb`) on `PATH`.
- A Gemini API key, for the reply-language and voice checks. Without one the backend answers with the mock AI,
  always in English, so sections L and V are **NOT RUN**, not failed.

**Phone:** a Nothing Phone (2a), a USB-C data cable, and mobile network or Wi-Fi.

**A test contact.** Create one on the phone before you start:

- Name: **one word** that no other contact on the phone has as its whole name, for example `Neha`. If you already have
  a contact named exactly `Neha`, choose another word and use it wherever this checklist says `Neha`. It must be one
  word: "Neha Test ko call karo" (two words before "ko") does not reach the call skill yet. That is a known gap, listed
  in §5.
- Number: a number **you own**, such as your second SIM or another phone of yours. Most call tests press **Cancel**,
  and only C4 places a real call.
- **Never** use 100, 101, 102, 108, 112 or any other emergency or service number in any test.

---

## 2. Build and install

### 2.1 Get the branch

```bash
git clone https://github.com/jitendrakumarraj831-byte/ZarvisMobile.git   # skip if you already have it
cd ZarvisMobile
git fetch origin claude/focused-maxwell-fb27sa
git checkout claude/focused-maxwell-fb27sa
git pull --ff-only
git log -1 --format='%h %s'      # write this commit hash in §6
```

### 2.2 Start the backend on the computer (local, in-memory; not production)

```bash
cd backend
npm ci
printf 'GEMINI_API_KEY=%s\n' 'PASTE-YOUR-KEY-HERE' > .env   # backend/.env is git-ignored; never commit it
git check-ignore .env && echo "ok: .env is ignored"
PORT=3000 npm run dev 2>&1 | tee ../zarvis-backend.log
```

Leave it running and open a second Git Bash window for everything else. Then check it:

```bash
curl -s http://localhost:3000/health
```

**Expected:** `{"status":"ok","provider":"google",…,"database":"not_configured"}`. If it says `"provider":"mock"`,
the key was not read: sections L and V cannot be tested.

### 2.3 Automated checks on your computer (optional; the same tests CI runs)

```bash
# backend (from the repo root)
cd backend && npm run typecheck && npx vitest run test/language test/agents/memoryAndLogPrivacy.test.ts && cd ..
# android domain tests, including the new safety test
cd android && ./gradlew :domain:test --tests '*HinglishDeviceCommandSafetyTest*' && ./gradlew :domain:test && cd ..
```

**Expected:** every command ends without a failure; vitest reports `77 passed`.

### 2.4 Prepare the phone

1. Settings > About phone: tap **Build number** seven times. On some Nothing OS versions it is under
   **Software info**. Enter your PIN when asked.
2. Settings > System > Developer options: turn on **USB debugging**.
3. Plug the phone in, unlock it, and accept **Allow USB debugging?** (tick "Always allow from this computer").
4. On the computer:

```bash
adb devices                                   # expect one line ending in "device" (not "unauthorized")
adb shell getprop ro.product.manufacturer     # record in §6 (expect Nothing)
adb shell getprop ro.product.model            # record in §6
adb shell getprop ro.build.version.release    # Android version, record in §6
adb shell getprop ro.build.version.sdk        # API level, record in §6
adb shell settings get secure voice_recognition_service   # the speech recognizer, record in §6
```

### 2.5 Optional: the repo's full automated device run

Run this before the manual tests if you want it, because it **uninstalls ZARVIS first** (the app's data on the phone
is erased) and temporarily switches notification access, accessibility, the default assistant and screen timeout,
then restores them. Set the phone's **system** language to English for it (its UI tests read English labels), keep the
phone unlocked, and don't touch it for about 20 minutes.

```bash
cd android
ZARVIS_DEVICE_RESET_OK=1 ZARVIS_TEST_CALL_NUMBER=<a number you own> bash scripts/device/verify-device.sh
cat build/emulator-evidence/device-summary.txt
cd ..
```

**Expected:** each phase reads PASSED. Without `ZARVIS_TEST_CALL_NUMBER` the call test is reported **UNVERIFIED**, never
passed. Copy `build/emulator-evidence/device-summary.txt` into §6. The script leaves the debug build installed, so you
can go straight to §2.7.

### 2.6 Build and install the app (USB route, no Wi-Fi involved)

```bash
adb reverse tcp:3000 tcp:3000
cd android
./gradlew :app:installDebug -Pzarvis.devApiHost=127.0.0.1
cd ..
```

**Expected:** Gradle prints `ZARVIS debug API base URL: http://127.0.0.1:3000/` and `Installed on 1 device`. If the
Kotlin daemon hangs on Windows, add `-Pkotlin.compiler.execution.strategy=in-process`. If Android refuses because of a
signature mismatch, run `adb uninstall com.zarvismobile.app` (this erases the app's data) and install again. Repeat
`adb reverse` whenever you re-plug the cable.

### 2.7 First start

1. Open the phone's browser at `http://127.0.0.1:3000/health`. **Expected:** the same JSON as in §2.2.
2. Open **ZARVIS** and continue as a guest. **Expected:** the Home screen, with no connection error.
3. In ZARVIS: Settings > **Voice**: turn on spoken replies ("Replies are spoken with a neural voice").
4. Start the evidence logs on the computer:

```bash
adb logcat -c                                    # clear old phone logs
adb logcat -v time > zarvis-logcat.txt &         # stop it at the end with: kill %1
```

---

## 3. Test cases

Type each phrase exactly into the Chat box and send it, unless the case says to speak it. Fill in **Actual** and
**PASS / FAIL / NOT RUN** in §6. A known gap (marked *gap*) is recorded, not failed. Check that no call is active after
each call test:

```bash
adb shell dumpsys telephony.registry | grep mCallState     # expect every line to say mCallState=0 (idle)
```

### C. Calling (Hinglish), typed; phase 1 fix: C5–C9

The first call test asks for access. ZARVIS explains **Contacts**, then **Phone**, with Allow / Not now / Learn more.
Choose **Allow** in ZARVIS and then in Android's own dialog. The Nothing Phone (2a) has two SIM slots, so Android may
ask which SIM to use after you confirm. That is Android's own choice dialog and is expected.

| ID | Type this | Expected |
|---|---|---|
| C1 | `Neha ko call karo` | ZARVIS's dialog **"Confirm this action"** shows Neha and her number. Tap **Cancel**. Reply: "You didn't confirm, so nothing was done." No call (`mCallState=0`). |
| C2 | `Neha ko call kar do` | Same dialog for Neha → **Cancel** → no call. |
| C3 | `call karna hai Neha ko` | Same dialog for Neha → **Cancel** → no call. |
| C4 | `call Neha` | Same dialog. **Only if Neha's number is your own:** tap **Confirm**. The dialer calls it (`mCallState=2` while it rings), then hang up. Otherwise tap Cancel and mark C4 NOT RUN. |
| C5 | `Neha ko call mat karo` | **No** permission prompt, **no** confirmation dialog, no call. An ordinary chat reply. *(Phase 1 fix: this opened the call flow before.)* |
| C6 | `call mat karo` | No dialog, no call; a chat reply. *(fix)* |
| C7 | `Neha ko baad mein call karna` | No dialog, no call; a chat reply. *(fix)* |
| C8 | `call kaise karte hain` | No dialog, no call; the reply explains how to make a call. *(fix)* |
| C9 | `don't call Neha` | No dialog, no call; a chat reply. *(fix)* |
| C10 | `Neha ka number batao` | Neha's number shown on the phone. No confirmation and no call. |
| C11 | `call me later` | No dialog, no call (unchanged behaviour). |
| C12 | `नेहा को कॉल करो` | *gap*: a chat reply, no call. Devanagari call commands do not reach the phone yet (Phase 6). |
| C13 | `Neha ko phone lagao` | *gap*: a chat reply, no call ("phone lagao" is not understood yet; Phase 6). |
| C14 | Create a contact `Neha Test` (same number), then type `Neha Test ko call karo` | *gap*: a chat reply, no call (a two-word name before "ko" is not understood yet; Phase 6). Delete the contact afterwards. |

### CV. Calling, spoken

Tap the microphone and say the phrase. **Write down the exact transcript** ZARVIS shows in your chat bubble, because
the result depends on it. ZARVIS listens in the app language: Settings > Language **English** uses `en-US`, **Hindi**
uses `hi-IN` (Devanagari transcripts).

| ID | App language | Say | Expected |
|---|---|---|---|
| CV1 | English | "Neha ko call karo" | If the transcript reads like `Neha ko call karo`: the confirmation dialog for Neha → **Cancel**. If the recognizer wrote something else, record it; any dialog must name Neha, and you tap Cancel. |
| CV2 | English | "Neha ko call mat karo" | No dialog and no call. **If a dialog appears**, check the transcript: if it lost the word "mat", the speech recognizer dropped the negation. Tap **Cancel** and record the transcript. The dialog is the safety net. |
| CV3 | English | "baad mein call karna" | No dialog, no call (same note about the transcript). |
| CV4 | Hindi | "नेहा को कॉल करो" | *gap*: the transcript is usually Devanagari, so it gets a chat reply and no call (Phase 6). |
| CV5 | Hindi | "नेहा को कॉल मत करो" | A chat reply, no dialog, no call. |

### L. Reply language (typed; needs the Gemini key; phase 1 fix: L1, L2, L4, L5)

Set Settings > Language to **हिंदी** for L1–L2 and L7, which shows that the app language does not override an English
message (in Hindi the page is called सेटिंग्स > भाषा; switch back by choosing **English** there). Use **English** for the
rest.

| ID | App language | Type this | Expected reply language |
|---|---|---|---|
| L1 | Hindi | `What is the capital of France?` | **English** (Paris). *(Phase 1 fix: it was told to answer in Hindi before.)* |
| L2 | Hindi | `How do I reset my password?` | **English**. *(fix)* |
| L3 | English | `aaj ka mausam kaisa hai` | Hindi or Hinglish. |
| L4 | English | `WhatsApp kholo` | Hindi or Hinglish reply (*fix*: it was English). WhatsApp does **not** open: that is the *gap* listed in §5. |
| L5 | English | `Rahul ko message bhejo ki main late hoon` | Hindi or Hinglish (*fix*: it was English). The reply must **not** claim a message was sent: there is no messaging tool. If it claims it sent one, mark **FAIL (truthfulness)**. |
| L6 | English | `आज मौसम कैसा है` | Hindi. |
| L7 | Hindi | `Forbesganj` | Hindi (no language in the message, so the app language decides). |
| L8 | English | `Forbesganj` | English (same rule). |

Gemini decides the final wording. The planner's instruction is unit-tested; this section checks that the real model
follows it. If one reply is in the wrong language, send the same text once more and record both replies.

### V. Voice (spoken replies on; needs the Gemini key)

Listen to how each reply is spoken. The defaults are **Swara** (a female Hindi voice) for Hindi and Hinglish, and
**Jenny** (a female US-English voice) for English.

| ID | Do this | Expected |
|---|---|---|
| V1 | L1 again with spoken replies on | The English reply is spoken by Jenny (US English). |
| V2 | L3 again | Spoken by Swara (Hindi). |
| V3 | L5 again | A Hinglish reply spoken by Swara, not by the English voice. |
| V4 | Speak "aaj ka mausam kaisa hai" with the mic (app language English) | Transcript recorded; reply in Hindi or Hinglish, spoken by Swara. |
| V5 | Speak "What is the capital of France" with the mic (app language **Hindi**) | Record the transcript (the `hi-IN` recognizer may write it in Devanagari, which is then Hindi text and gets a Hindi reply). Record what you hear. |
| V6 | While a long reply is being spoken, tap the mic | Playback stops. *Not changed in Phase 1*: record only. |

**Computer-side check of the voice choice** (deterministic; needs internet to the voice service). The header names the
voice that really spoke:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/guest | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
voice() {   # $1 = a label to print, $2 = the text as a JSON string (Devanagari as \u escapes, so Git Bash cannot mangle it)
  printf '%s -> ' "$1"
  curl -s -o /dev/null -D - -X POST http://localhost:3000/api/v1/tts/synthesize \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"text\":$2}" | tr -d '\r' | grep -i '^x-zarvis-tts-voice' || echo "(no voice header: see the backend window)"
}
voice "Hinglish"  '"mujhe 5 baje yaad dilana"'
voice "English"   '"What is the capital of France?"'
voice "Hindi"     '"आज मौसम कैसा है"'
```

**Expected:**
`Hinglish -> X-Zarvis-TTS-Voice: hi-IN-SwaraNeural` (before Phase 1 this phrase got `en-US-JennyNeural`),
`English -> X-Zarvis-TTS-Voice: en-US-JennyNeural`, and `Hindi -> X-Zarvis-TTS-Voice: hi-IN-SwaraNeural` (the text is
"आज मौसम कैसा है"). If the header names a Gemini voice, Edge refused this network and the fallback spoke. Record that
as a WARN, not a pass.

### M. Memory and privacy

The marker text `ZQX77…` exists only so that you can search the logs for it later.

| ID | Do this | Expected |
|---|---|---|
| M1 | Type `remember that my PIN is 4321 ZQX7731` | A chat reply. Then Settings > **Memory**: **no new item**. The reply should not say it saved or will remember it; if it does, mark **FAIL (truthfulness)**. The Memory list is the truth. |
| M2 | Type `mera naam yaad rakhna, main Jitendra hoon ZQX7732` | Same: nothing new in Settings > Memory. |
| M3 | Speak "remember that my favourite colour is blue" | Same: nothing new in Settings > Memory. Record the transcript. |
| M4 | On the computer, open `http://localhost:3000` in a **private** browser window (this is a different guest account), go to Settings > Memory, add `I live in Pune ZQX7734`. On the phone type `main kahan rehta hoon?` | The phone's reply does **not** mention Pune (the memory belongs to the other account). |
| M5 | *(Optional: cross-device memory and pause; not changed in Phase 1.)* On the phone, Settings > Account: link an email and password. Sign in with them on the computer at `http://localhost:3000`, Settings > Memory > add `I live in Patna ZQX7735`. On the phone type `main kahan rehta hoon?` | The reply mentions Patna. Then on the phone, Settings > Memory: pause memory, ask again, and the reply does **not** use Patna. Delete the item afterwards. |
| M6 | After every test, on the computer: `kill %1` (stops logcat), then `grep -c "ZQX77" zarvis-backend.log` and `grep -c "ZQX77" zarvis-logcat.txt` | Both print **0**: none of the marker text reached the server log or the phone's log. |
| M7 | `grep -ciE "GEMINI_API_KEY=|AIza[0-9A-Za-z_-]{20}" zarvis-backend.log zarvis-logcat.txt` | Both files: **0**. No API key in either log. |

### R. Regression smoke (existing features that Phase 1 must not break)

| ID | Do this | Expected |
|---|---|---|
| R1 | Type `Hi` | An instant greeting. |
| R2 | Type `set an alarm for 6:30 am` | The Clock app opens with 6:30 filled in, and you save it yourself. |
| R3 | Type `remind me to drink water in 2 minutes` | A reminder notification about 2 minutes later. |
| R4 | Type `home pe jao` (needs ZARVIS accessibility on: Settings > Permissions & Device Access) | A confirmation first; after Confirm, the home screen. |
| R5 | Type `open WhatsApp` | WhatsApp opens (if installed). |
| R6 | Close ZARVIS from Recents, reopen it, open Chat | The last conversation is still there (loaded from the server). |

---

## 4. When you are done

1. Stop logcat (`kill %1`) and the backend (Ctrl-C in its window).
2. Keep `zarvis-backend.log`, `zarvis-logcat.txt` and any `build/emulator-evidence/` folder **on your computer**.
   They can contain your contacts' names and your notifications, so don't upload them anywhere public. Share only the
   filled-in table from §6.
3. Delete the test contact if you want, and turn USB debugging off.
4. Remove the key file if you no longer need it: `rm backend/.env`.

---

## 5. Known gaps (expected, recorded, not failures of Phase 1)

| Gap | Seen in | Planned fix |
|---|---|---|
| Devanagari call and app commands ("नेहा को कॉल करो", "व्हाट्सएप खोलो") get a chat reply instead of a device action | C12, CV4 | Phase 6 (phone agent) |
| "WhatsApp kholo", "YouTube chalu karo", "phone lagao", "notification mat bolo" get a chat reply instead of a device action | L4, C13 | Phase 6 |
| A two-word name before "ko" ("Neha Test ko call karo") is not understood as a call | C14 | Phase 6 |
| Hinglish voice input uses `en-US` (app language English) or `hi-IN` (Hindi); there is no Hinglish recognizer setting | CV, V | Phase 3 (voice) |
| Android plays the whole reply as one file; it is not streamed | V | Phase 3 |
| "remember this" in chat saves nothing; memory is added on the website only | M1–M3 | Phase 2 (memory, with your approval of each item) |

---

## 6. Results (fill in)

| Field | Value |
|---|---|
| Tester | |
| Date and time | |
| Commit (`git log -1`) | |
| Phone model / Android version / API level | Nothing Phone (2a) / / |
| Speech recognizer (`voice_recognition_service`) | |
| Backend `/health` provider | |
| Optional `verify-device.sh` summary | |

| ID | Actual (and the transcript for spoken cases) | PASS / FAIL / NOT RUN / GAP | Evidence (screenshot name, log line) |
|---|---|---|---|
| C1 | | | |
| C2 | | | |
| C3 | | | |
| C4 | | | |
| C5 | | | |
| C6 | | | |
| C7 | | | |
| C8 | | | |
| C9 | | | |
| C10 | | | |
| C11 | | | |
| C12 | | | |
| C13 | | | |
| C14 | | | |
| CV1 | | | |
| CV2 | | | |
| CV3 | | | |
| CV4 | | | |
| CV5 | | | |
| L1 | | | |
| L2 | | | |
| L3 | | | |
| L4 | | | |
| L5 | | | |
| L6 | | | |
| L7 | | | |
| L8 | | | |
| V1 | | | |
| V2 | | | |
| V3 | | | |
| V4 | | | |
| V5 | | | |
| V6 | | | |
| Voice header check | | | |
| M1 | | | |
| M2 | | | |
| M3 | | | |
| M4 | | | |
| M5 | | | |
| M6 | | | |
| M7 | | | |
| R1 | | | |
| R2 | | | |
| R3 | | | |
| R4 | | | |
| R5 | | | |
| R6 | | | |

**Phase 1 device result:** PASS only if C1–C11, L1–L8, the voice header check, M1–M4, M6, M7 and R1–R6 are PASS (C4,
M5 and V6 may be NOT RUN), and every FAIL has been fixed and re-tested. Until then, the capability statuses stay as they
are and Phase 2 does not start without your approval.
