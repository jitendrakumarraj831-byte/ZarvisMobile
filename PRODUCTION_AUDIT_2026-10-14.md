# Production-readiness audit — PR #82 (2026-10-14)

Scope: pull request [#82](https://github.com/jitendrakumarraj831-byte/ZarvisMobile/pull/82) (`claude/awesome-goodall-adq0m9` → `main`):
the AI Model Gateway (Gemini primary, OpenRouter fallback), Edge neural voices with a Gemini voice
behind them, the web camera, Android "describe a photo". Requested by the owner **before** any merge.
Nothing was merged, nothing was deployed, no branch or commit was deleted or rewritten, and no secret
value was printed or committed.

## Decision

**C. CODE READY, PRODUCTION VERIFICATION PENDING.**

- Every defect this audit could confirm in the code was fixed on the branch, each with a test that
  fails without the fix, and the full suites pass again after the fixes (below).
- It is not **A** because Production could not be reached from this environment (no Vercel access, no
  Production logs, no Production variables), Android and the camera were never run on a real device,
  and the CI checks for the commits this audit added had not finished when this was written.
- It is not **B** because no unresolved issue found here needs a code change before a merge. What is
  open (§4) is either pre-existing, low, or a decision that belongs to the owner (§6, §7).

What has to happen before "merge" is safe to say, in order: (1) CI green on the final head of the PR;
(2) the owner's decisions in §9; (3) after a merge, the Production checks in §8 on the real deployment.

## 1. PR and Git safety

| | |
|---|---|
| PR | #82, **open, draft**, base `main`, head `claude/awesome-goodall-adq0m9`, `mergeable_state: clean` |
| Head before this audit | `b9e76bd680da7324a27dcdb4b95d24c185f804a4` (remote and local identical) |
| `main` | `7a6d2f06d5514bc3dbfdfb90b994850699e8c55f`; `git merge-base --is-ancestor origin/main HEAD` is true: **the branch contains all of `main`** |
| Size | 39 commits (before this audit), 142 files, +15,190 / −1,006 at `b9e76bd` (GitHub's count) |
| Schema changes | none: `git diff origin/main -- backend/src/store` is empty, no `CREATE/ALTER TABLE`. A rollback needs no data migration |
| This audit's commits | 6 new commits on top, pushed to the same branch with a normal push. No force-push, no rebase, no amend, no branch or tag deleted |
| Merge method | `main`'s history uses merge commits, the PR body cites commit hashes, and the branch already carries two merge commits. **A merge commit is the method that keeps those hashes valid; squash or rebase would not.** Branch-protection rules and required reviewers could not be read with the tools available here |
| CI on `b9e76bd` | 24 check runs: **23 success, 1 skipped** (the OpenRouter probe job, which only runs with its label). Names: smoke, CodeQL, audit, Vercel Preview Comments, probe (Edge, success), probe (OpenRouter, skipped), emulator 34/x86_64, 30/x86_64, 26/x86, 26/x86 harness-selftest, test-and-lint ×2, assemble-debug ×2, dev-backend-reachability ×2, backend ×2, web-e2e ×2, windows-build, Analyze (javascript-typescript, actions, java-kotlin). The PR description's "all 24 checks success" should read "23 success, 1 skipped" |

## 2. What was run, and the results

All numbers are from this audit's own runs on the fixed tree unless stated.

| Check | Result |
|---|---|
| `backend` `npm run build`, `tsc --noEmit` (backend and root entrypoint) | clean |
| `backend` full suite, in-memory store | 82 files, **1,046 passed**, 21 skipped (database tests) |
| `backend` full suite on a real **PostgreSQL 16** (`TEST_DATABASE_URL`) | 84 files, **1,169 passed**, 7 skipped (opt-in live-credential tests), **0 failed** (re-run after the dependency updates) |
| `node --test web/tests/*.test.js` | 68 / 68 |
| `web/e2e/camera.e2e.cjs`, real Chromium with a simulated camera | **7 / 7** (two new steps; both fail on the old client) |
| Secret scan | regex scan over every added line of the whole branch history: no key, token or connection string. `.env*` is git-ignored, only placeholders are tracked |
| `npm audit --omit=dev` | before: 7 (1 critical, 6 moderate). After in-range updates of express, body-parser, qs, proxy-addr: **3 moderate**, all `mammoth → argparse → sprintf-js`, whose only offered "fix" is a downgrade to mammoth 0.3.29 (not applied; the format-string DoS is not reachable through an upload) |
| Runtime audit against the **production-mode** server on **real Postgres** (`NODE_ENV=production`, random secrets) | 49 + 23 checks pass. The 4 "FAIL" lines of the first script are the script's own wrong assumptions, each explained: the Razorpay webhook is public by design and answers 503 when payments are off; `/auth/google` answers 503 by design without `GOOGLE_CLIENT_ID`; a text file is read in the browser, so the server answers 415; an image with no AI key answers 503 honestly |
| Browser voice audit, three backends (§5) | Edge healthy 10 pass / 1 fail (the failure is the test double's own voice picker, see §5); Edge refused + Gemini voice 2 pass / 7 warn / 0 fail; Edge unreachable + fallback off 1 pass / 0 fail |

Covered by the runtime audit and its repeatable counterparts in `backend/test`:

- **Authentication, JWT:** `alg=none` (also `None`), a different secret, HS512 with the right secret
  (the algorithm is pinned to HS256), an expired token, a refresh token used as an access token, a
  tampered payload, a missing signature, garbage, a 12 kB token, a Basic scheme, a session id that does
  not exist (a live server-side session is required), logout invalidating the access token at once,
  refresh-token reuse refused and revoking the whole session: **all refused as they should be**.
- **Isolation:** two accounts; read, edit and delete of the other's project, note and file, every list,
  an `accountId` in the query string: all 403/404 and nothing of the other account.
- **Transport:** malformed JSON, a 3 MB body (413), unknown routes, non-UUID ids, `__proto__` keys,
  `nosniff`, a CSP with `frame-ancestors`, `Permissions-Policy: camera=(self), geolocation=()`,
  `Referrer-Policy`, no `X-Powered-By`, CORS (a foreign origin gets none, the configured one exactly,
  never credentials with a wildcard), the login rate limit (429 at the 20th failure).
- **Voice endpoints:** no token, wrong types, empty, hostile text and voice values, a 2 MB text.
- **Uploads:** no file, no token, an executable (415), 5 MB (413), an empty file, a malformed PDF and
  DOCX (422, no crash), path-traversal names (a label only; content goes to the database).
- **Database:** the whole suite on real Postgres, including the schema-concurrency, non-UUID-id and
  turn-idempotency tests.

**Web and Android are separate.** Web: everything above, run in a real browser where it has a UI.
**Android: not built or run in this environment** (no SDK; Maven Central answered 429 through the
proxy). CI built it and ran its unit tests, lint and the emulators on `b9e76bd`; the camera and "describe
a photo" were **never run on a real phone: unverified**. This audit changed no Android code.

## 3. Findings fixed in this audit

Severity is for this product as deployed, where a guest account is free to create. "Pre-existing"
means the code is on `main` and the PR did not introduce it. Each fix has a test in the repository that
fails without it.

| # | Sev. | Where | Root cause | Reproduction and result | Commit |
|---|---|---|---|---|---|
| F1 | **High** (availability) | `backend/src/documents/extractText.ts` (pre-existing) | `unpdf` was given any PDF. A page-heavy PDF costs far more than linearly: 4,000 empty pages took 3 s, 20,000 took 105 s | 2 MB PDF, 20,000 empty pages, authenticated. **Before:** 105 s with the whole server unresponsive (one health poll in 105 s), 4.6 GB peak. **After:** `413 document_too_long` in 0.56 s, 191 MB. Repro: `PAGES=20000` script; durable test `test/documents/expansionGuard.test.ts` | `3710032` |
| F2 | **High** (availability) | `extractText.ts`, `processUpload.ts` (pre-existing) | The 4 MB cap counts compressed bytes. Deflate turns 300 kB into 300 MB; nothing counted the result | A 0.3 MB DOCX or PDF that unpacks to 300 MB: memory 114 → 760 MB (PDF) and 1.4 GB for 600 MB (DOCX), `/health` waiting ~3 s behind it. **After:** both refused in 0.2–0.4 s at 131–142 MB. `expansionGuard.ts` counts inflated bytes through a constant-memory stream; it never trusts the file's own declared sizes and refuses a zip the extractor could read differently | `3710032` |
| F3 | Medium | `backend/src/api/routes/tts.ts` (this PR) | A client that stops reading the stream holds a synthesis slot, a socket and a decoder until it leaves; 24 such connections deny voice on an instance | Reviewer repro: two non-reading clients, slots still held after 7.5 s, an honest request got 503. **After:** dropped after 15 s, slot released; a reading client is never dropped. `test/tts/ttsHardening.test.ts` | `f3d200c` |
| F4 | Low–Med | `geminiTtsProvider.ts` (this PR) | The header timeout stopped when headers arrived; a body that then went quiet pinned the slot | One chunk, then silence: pending after 4 s with `timeoutMs=300`. **After:** `TIMEOUT` after 20 s of silence, slot back | `f3d200c` |
| F5 | Low–Med (privacy, spend) | `fallbackTtsProvider.ts`, `guard.ts` (this PR) | This server's own "busy" answer was treated as an Edge failure, so a crowd here sent texts to Google | With the Edge pool full, the text was sent to Gemini. **After:** the busy error is marked `local` and never falls back | `f3d200c` |
| F6 | Low (privacy) | `tts.ts` `logFailure` (this PR) | The log carried 200 characters of a service's error, which can include the spoken text | A Google 400 body echoing the prompt appeared in the log. **After:** only a status and a code | `f3d200c` |
| F7 | Med–Low | `backend/src/security/redact.ts` (pattern added by this PR) | The JWT pattern rescanned to the end of the string from every `-eyJ`: quadratic. Reachable unauthenticated: the server logs a bad URL parameter through it | 80,000 characters: 4.2 s. **After:** 0.2 s (bounded segment). Real and long-header JWTs are still redacted | `9194f1c` |
| F8 | **High** (privacy claim) | `backend/src/skills/index.ts`, `PRIVACY.md` (code pre-existing, claim added by this PR) | `PRIVACY.md` said web search is "never sent to OpenRouter", but search has its own OpenRouter fallback that ignored `AI_FALLBACK_PROVIDER=none` | With both keys, a Gemini 4xx/5xx sent the query to `openrouter.ai`; `AI_FALLBACK_PROVIDER=none` changed nothing. **After:** `none` keeps the query on Gemini while Gemini is configured (8 tests), and the privacy text and `AI_MODEL_GATEWAY.md` state what search really does | `9194f1c`, docs |
| F9 | Low | `api/routes/billing.ts` (pre-existing) | `payments_unavailable` fell into the generic "log an error, answer 500" branch | A webhook POST with payments off: 500 and an error log line. **After:** 503 `payments_unavailable`, no error log (Razorpay retries 5xx either way) | `9194f1c` |
| F10 | Low | `api/index.ts` (this PR) | A bad `AI_MODEL_CATALOG_JSON` says "is not valid JSON" and matched the Play Billing branch first | `/health` named `play_billing_config_invalid`. **After:** `ai_provider_config_invalid` | `9194f1c` |
| F11 | Low | `web/app.js`, `styles.css` (this PR) | Camera sheet: Cancel pressed while the JPEG is being made still uploaded the photo; Escape did nothing with focus on the page; `open()` left an old stream running; a page restored from the back/forward cache showed a dead sheet; `object-fit: cover` showed ~75 % of a 16:9 frame while the whole frame was sent | `camera.e2e.cjs`: two new steps fail on the old client, pass now. Service-worker cache bumped | `05a829f` |
| F12 | Low | `SECURITY.md`, `AI_MODEL_GATEWAY.md` (this PR) | Docs overclaimed: "provider error bodies are not copied into messages"; "client disconnect: no fallback, no further model call" (true for planner calls only); web search "Gemini only" | Corrected, with the limits listed in §4 | docs commit |
| F13 | Hygiene | root and backend lockfiles | `npm audit` advisories in proxy-addr (critical), qs, body-parser, express | In-range updates only, nothing else touched (§2). The proxy-addr advisory was already not reachable: `trust proxy` is a hop count, which never compiles a subnet | `dd42100` |

## 4. Open findings, not fixed

None of these is introduced by this PR's own logic unless stated, and none changes the decision. Each
says why it was left.

| # | Sev. | Where | What | Why left, and what to do |
|---|---|---|---|---|
| O1 | Medium | `extractText.ts` | Extraction runs in the server's own process with no timeout and no memory limit. F1/F2 close the measured ways to abuse it, but a PDF whose stream sits behind a second filter (ASCII85 before Flate) is not counted | A worker thread with `resourceLimits` and a timeout is the real fix; it is a design change to the upload pipeline, which the brief asked not to make unnecessarily |
| O2 | Medium | `ai/contentGenerator.ts`, `agents/orchestrator.ts`, `skills/webSearch.ts`, `processUpload.ts` | Calls made inside skills, web search and image analysis take no `AbortSignal`. If the client leaves, their retries, a fallback and the credit charge still happen (reviewer repro: 7 Gemini calls, 1 OpenRouter call after the abort, 1 charge) | Needs a signal threaded through `ContentGenerator`, `SkillExecutionContext` and the search providers. Documented in `AI_MODEL_GATEWAY.md` §8; planner calls (the common path) do stop |
| O3 | Medium | `geminiProvider.ts`, `openRouterProvider.ts`, `geminiVision.ts` | Provider timeouts bound the wait for headers only; a body that stalls pins the request until the platform's limit | Already stated in `AI_MODEL_GATEWAY.md` §8. Fix: keep the timer until the body is read |
| O4 | Low | `ai/errorTaxonomy.ts`, `openRouterErrors.ts` | Unlisted 4xx statuses (409, 418, 451, 501…) are treated as an outage and fall back | Map unknown 4xx other than 408/429 to invalid-request |
| O5 | Low | `config/env.ts`, `openRouterProvider.ts` | An API key containing a line break makes undici throw a message that contains the key; safe only because every sink is the redacting logger | Validate the key's characters at startup |
| O6 | Low | `agents/orchestrator.ts` | A model can name any registered skill, not only the ones offered this turn. Permission, entitlement and confirmation checks still apply | Reject calls outside the offered set |
| O7 | Low | `processUpload.ts` | The declared image type is trusted: a text file labelled `image/png` is sent to the paid vision model; on a 503 one upload made 9 provider requests | Sniff magic bytes (503→415 mapping) and cap retries for large payloads |
| O8 | Low | Android `AiServiceErrors.codeOf`, `PhotoDescriptionResults` | The server's 429 for a per-minute limit carries `error: "ai_quota_exceeded"` and `code: "AI_RATE_LIMITED"`; Android reads `error` first and tells the person they hit "today's" limit. The web client reads `code` and is right | Android fix, which could not be built here. One line in `codeOf`/`fromHttp` plus a unit test |
| O9 | Low | provider error text | A provider's error body is cut to 300 (Gemini) or 600 (OpenRouter, key-scrubbed) characters into an internal message that reaches the server log, in the image-analysis path too. A provider that echoes the request could leave a fragment there | Documented in `SECURITY.md` and `PRIVACY.md`. Log status and code only, as the voice route now does |
| O10 | Info | `web/app.js` | Text read from a photo goes into the user's message unmarked. A photographed sign could steer the assistant (suspected, not demonstrated). Skills that change anything ask for confirmation | Wrap attachment text in a delimited, untrusted block |
| O11 | Info | web | A photo picked from the gallery or a file is uploaded as it is, EXIF and location included (the camera sheet and Android re-encode and carry none) | Stated in `PRIVACY.md`. Re-encode in the browser too |
| O12 | Info | `/health` | `database: "not_configured"` answers 200 "ok". In production with no `POSTGRES_URL` the server runs on the in-memory store, which a serverless cold start empties | Not changed. The smoke checklist (§8) requires `database: "ok"` |
| O13 | Info | gateway | The quota cooldown is per provider, not per model; per-instance counters; no circuit breaker for 5xx (a Gemini outage costs ~7 s before the fallback); `fetch` follows redirects (`x-goog-api-key` is forwarded on a same-protocol redirect; hosts are fixed) | Listed in the reviewer reports; hardening, not defects |

## 5. Voice fallback: what a user gets, before `TTS_FALLBACK_PROVIDER=none` is set

The owner asked for this test first. The real web client ran in real Chromium (`web/e2e/tts-audit.cjs`)
against the real backend code. This sandbox cannot reach Microsoft (`getaddrinfo ENOTFOUND
speech.platform.bing.com`), which gives Edge's failure for free; Google's service is replaced by a local
stand-in that speaks PCM, so **the sound quality of Gemini's voice was not tested**.

| Setup | What the person gets | Result |
|---|---|---|
| Edge works | Edge voice, correct voice per language (en, hi, Hinglish), streaming in order, Stop and cancel work | 10 pass, 1 fail. The failure (Hinglish) is the stand-in's own voice picker, which knows four Hindi words; the real detector classifies that sentence as Hinglish. It is a test-double defect, not a product one |
| Edge refused, Gemini voice available (the default) | The reply is spoken by Gemini's voice (`X-Zarvis-TTS: gemini-stream`, voice `gemini:Kore`); first sound ~80 ms; Stop and cancel work; the Listen button works | 2 pass, 7 **warn** (a fallback voice is a WARN on purpose, so Edge being down stays visible), 0 fail |
| Edge refused, `TTS_FALLBACK_PROVIDER=none` (the real server in production mode) | The reply appears as text, the orb returns to idle, no sound; the next message is answered. Endpoints answer `503 tts_unavailable` with "The reply is still shown as text." Nothing is sent to Google | 1 pass, 0 fail; server log: kind and system error only |

What this means for the choice: with `none`, **Edge being down is silent voice, not a broken app**. The
cost is that spoken replies stop for everyone whenever Microsoft refuses the deployment, which has
already happened once (HTTP 403 until the token was updated). With the fallback on, spoken replies
continue, the spoken text is also sent to Google, and the Gemini speech quota is small (the earlier live
run spent it). It is a privacy-against-availability decision for the owner; both behave cleanly.

## 6. Privacy

`PRIVACY.md` now has a section, "Where your data goes (as built)", written from the code: chat and
attachment text, photos (camera, picker, gallery), PDF/DOCX, photo metadata, spoken replies and the
fallback voice, web search, dictation, logs. Corrected in it: web search can reach OpenRouter (and no
longer does so when `AI_FALLBACK_PROVIDER=none`); the photo itself is never stored, only the description
text; EXIF travels with a gallery pick on the web. **Not verified, and said so there:** what Google,
Microsoft and OpenRouter do with data they receive, and whether it differs between free and paid Gemini
plans (`ai.google.dev` could not be reached from here). The public privacy notice must name Google,
Microsoft and OpenRouter and be checked against the plan the production key is on.

## 7. Licensing

Full record, with the licence's own words: `THIRD_PARTY_NOTICES.md`. Summary:

- `backend/src/tts/edgeToken.ts` is a TypeScript port of `drm.py` from `edge-tts` 7.3.1. The `LICENSE` in
  that release's source distribution says *"The MIT license is used for 'src/edge_tts/srt_composer.py'
  only. All remaining files are licensed under the LGPLv3."* So the port is a derivative of LGPL-3.0
  code. Its header says so and keeps the notice.
- Added: `LICENSES/LGPL-3.0.txt` and `LICENSES/GPL-3.0.txt` (the LGPL's §4 asks for copies of both with
  a Combined Work), and a correction of the file header: the repository is **public**, so the file's
  source is already available to anyone.
- **Not concluded:** whether publishing the repository or running the backend as a service triggers §4
  for the rest of the backend is a legal question. Two routes that avoid it: write the token from a
  description rather than from upstream's source, or use only the Gemini voice (`TTS_PROVIDER=gemini`).
- The repository has no `LICENSE` of its own. A scan of the 133 production npm packages found only
  permissive licences, and `jszip` offered as `MIT OR GPL-3.0-or-later` (used as MIT). **Unchecked:**
  `mpg123-decoder` declares MIT but says it is based on mpg123 (compiled to WebAssembly); mpg123's own
  licence was not looked up. Android dependencies were not scanned.
- Separately from the licence: Edge's voice service is Microsoft's, undocumented, and used without an
  account or contract, with browser-like headers. Nothing here grants a right to use it.

## 8. Production: what could not be verified, rollback, and the smoke checklist

**Not verifiable from here, stated plainly:** the Production deployment, its logs, its health, its
environment variables, and Vercel's project settings. Nothing in this document says Production works.
The only evidence about deployments is for Previews (CI's live smoke test and browser audit on
`b9e76bd`: 31 checks passed, 2 warnings, 0 failed; 11 scenarios passed, 1 warning, 0 failed).

### Variables (names only; values are never in this repository)

| Name | Production needs it? | If missing |
|---|---|---|
| `JWT_SECRET` | **Yes** | The server **refuses to start** with `NODE_ENV=production`. Only presence is checked, not length: use 32+ random characters |
| `POSTGRES_URL` or `DATABASE_URL` | **Yes** | **Silently runs on the in-memory store**; `/health` says `database: "not_configured"` with HTTP 200 (O12). TLS verification is on by default; `POSTGRES_CA_CERT` or an explicit `POSTGRES_SSL_MODE=no-verify` for a private CA |
| `GEMINI_API_KEY` | **Yes** (chat, vision, search, fallback voice) | AI answers fail honestly with 503, `/health` says `provider: none` |
| `INTEGRATION_ENCRYPTION_KEY` (base64, 32 bytes) | For stored integration credentials | Those integrations are reported unavailable instead of storing weakly |
| `CORS_ORIGINS` | Optional | Defaults cover `zarvismobile.com`, `www`, and localhost |
| `OPENROUTER_API_KEY` (+ `OPENROUTER_MODEL`, `OPENROUTER_MODEL_CAPABILITIES=tools`) | Only for the AI fallback | No fallback; Gemini only |
| `AI_PRIMARY_PROVIDER`, `AI_FALLBACK_PROVIDER` (`none` also removes search's OpenRouter fallback), `AI_QUOTA_COOLDOWN_MS`, `AI_MODEL_CATALOG_JSON`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_CONTEXT_TOKENS`, `OPENROUTER_TIMEOUT_MS` | Optional | Defaults |
| `TTS_PROVIDER` (`edge`, `gemini`, `none`), `TTS_FALLBACK_PROVIDER` (`gemini`, `none`), `TTS_HI_VOICE`, `TTS_EN_VOICE`, `TTS_HINGLISH_VOICE`, `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | Optional | Edge voices, Gemini voice behind them when `GEMINI_API_KEY` is set |
| `GOOGLE_CLIENT_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PLAY_BILLING_SERVICE_ACCOUNT_JSON`, `PLAY_BILLING_PACKAGE_NAME`, `PRICE_*`, `PRO_CREDITS_*` | Only for those features | Sign-in with Google / Razorpay / Play Billing honestly unavailable (Play Billing fails closed in production) |
| CI only: `OPENROUTER_API_KEY` (repository secret), `VERCEL_AUTOMATION_BYPASS_SECRET`, `EXPECT_*_VOICE` (repository variables) | — | The probes and live checks skip or warn |

### Preview versus Production

- Vercel scopes variables per environment. A Preview does not see a variable set only for Production,
  and a changed variable applies to new deployments only: set each one for each environment, redeploy.
- The code has **no** `VERCEL_ENV` branch. Preview and Production behave the same given the same
  variables; every fail-closed rule keys on `NODE_ENV=production`. Whether Vercel sets that in Previews
  was not verified here.
- Previews sit behind Deployment Protection (CI uses a bypass secret); Production is public.
- Per the PR description, Production last ran a **promoted build of this branch** with Preview values
  (observed 2026-10-04, not re-observed). A build from `main` replaces it and the Production-scoped
  values then apply. If `OPENROUTER_*` is not set for Production, the fallback is off after the merge.
- Edge's voice was refused on the Preview until the token fix. Production uses Vercel's network too, so
  it is likely to behave like the Preview, but that is an expectation, not a check.

### Rollback (nothing here was run)

1. **Before merging:** nothing to roll back; the PR is open and `main` is untouched.
2. **After merging, code:** on `main`, `git revert -m 1 <merge-commit>` (a new commit, history kept),
   then redeploy. Do not force-push `main`. There is no schema change in this PR, so no data step.
3. **After a bad Production deploy, fastest:** promote the previous good deployment in Vercel (Instant
   Rollback) and fix forward on the branch.
4. **Without any redeploy of code, by variable (then redeploy to apply):** `TTS_PROVIDER=none` switches
   spoken replies off; `TTS_FALLBACK_PROVIDER=none` keeps text off Google's voice; `AI_FALLBACK_PROVIDER=none`
   (or removing `OPENROUTER_API_KEY`) removes the OpenRouter fallback and search's fallback.
5. **Android:** the app is a separate release; nothing in this audit changed it.

### Post-deployment smoke checklist

Run in this order against `https://www.zarvismobile.com` (or the Preview), and write down the answer of
each. Do not call a deployment successful from the build log alone.

1. **Deployment:** the deployment's state is Ready, the function log has no startup error, and the log
   has an `AI gateway ready` line naming the providers (never a key).
2. **`GET /health`** returns HTTP 200 with `{"status":"ok","provider":"google","database":"ok"}`. Any
   other `database` value is a failure here. With the fallback set: `aiFallback: true`, `aiFallbackTools: true`.
   A 500 names the cause (`jwt_secret_missing_or_invalid`, `ai_provider_config_invalid`, …).
3. `node scripts/live-smoke.mjs` with `BASE_URL=<the deployment>` (and `ONLY=tts` for just the voice).
   Expect no FAIL. A WARN naming the fallback voice means Edge is refusing this deployment.
4. `node web/e2e/tts-audit.cjs` with `ZARVIS_URL=<the deployment>`.
5. **By hand, on a phone and a desktop browser:** sign in and send a message; refresh and confirm the
   session and the conversation survived (a database check, not an in-memory one); hear a reply in
   English and in Hindi; press Stop; attach a PDF and a DOCX; take a photo with the camera sheet and
   confirm it is described and the camera light goes off; check the browser console for CSP errors.
6. **Billing, only if enabled:** one test payment; the webhook answers 200 (not 503) in the Razorpay
   dashboard's delivery log.
7. **Privacy:** the public privacy notice names Google, Microsoft and OpenRouter and matches
   `PRIVACY.md`; the Gemini plan behind the production key was checked against Google's current terms.
8. Watch for 15 minutes: function memory, duration and 5xx counts in Vercel; no `Document refused`
   spike, no `TTS client stopped reading` spike.

## 9. Pending manual tests and decisions

Manual tests nobody has run:

- Android: "describe a photo", the photo picker, the voice, on a real phone. **Unverified.**
- Web camera on a real phone's camera (CI used a simulated one). **Unverified.**
- How any voice sounds, Gemini's included. **Unverified.**
- Edge's voice on the Production network. **Unverified.**
- An end-to-end Gemini quota event falling back to OpenRouter in a deployment, with the function log read.
- Android release build, signing, store listing: out of scope.

Decisions that belong to the owner:

1. `TTS_FALLBACK_PROVIDER`: keep the Gemini voice behind Edge (availability, spoken text also goes to
   Google) or `none` (privacy, silent voice when Edge is refused). §5.
2. Whether to keep Microsoft's unofficial voice service on by default at all, given its terms are not
   a contract (`TTS_PROVIDER=gemini` is the alternative).
3. The LGPL question in §7, with a lawyer if it matters to the release.
4. The public privacy notice (§6) and the production Gemini plan.
5. The open findings in §4, in order O2, O1, O8, O7.

## 10. Exact next steps

1. Wait for CI on the final head of PR #82. If any check is red, say which, and fix it before anything else.
2. Read this document and `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`; make the decisions in §9.
3. If the answer is to merge: **a merge commit**, by the owner (this audit does not merge).
4. Check Production's variables against §8 *before* the merge, in the Vercel project settings.
5. After the merge and the Production deployment: the checklist in §8, then report what each step answered.
6. Open issues for O1–O13.
