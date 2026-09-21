# Production Handoff

Final release-candidate state for ZarvisMobile. This document is the single reference for
what's done, what's verified, and exactly what the app owner must provide before this build
can ship. See `DEVELOPMENT.md` for day-to-day dev setup and `SECURITY.md`/`SUBSCRIPTIONS.md`
for the design rationale behind the signing/billing decisions referenced here.

## A. Current commit

- Branch: `main`
- Commit: `5fe8002ea5ad601662d2c1cb1ad2805a526a5843`
- CI (Android build workflow) on this commit: **green** — https://github.com/jitendrakumarraj831-byte/ZarvisMobile/actions/runs/35592536526
- Backend: `npm run build` clean, 105 tests passed / 4 skipped (skipped tests require a real Postgres instance — `TEST_DATABASE_URL`)

## B. Exact build commands

Backend (from `backend/`):
```
npm ci
npm run build
npm test
```

Android (from `android/`, requires a machine with real Android SDK access — this repo's own
sandbox cannot resolve `dl.google.com` and cannot run these; CI does):
```
./gradlew :domain:test
./gradlew :app:assembleDebug
./gradlew :app:assembleRelease
./gradlew :app:bundleRelease
```

## C. Exact APK/AAB artifact paths

Produced by `.github/workflows/android-build.yml` on every push. From the latest green run
on `main` (run 35592536526, expires 2026-12-20 — re-run the workflow to regenerate after
that):

| Artifact (CI upload name) | File path | Signed? |
|---|---|---|
| `app-debug-apk-emulator` | `android/app/build/outputs/apk/debug/app-debug.apk` | debug-signed (Android's default debug key — fine for emulator/dev only) |
| `app-release-unsigned` | `android/app/build/outputs/apk/release/app-release-unsigned.apk` | **No** |
| `app-release-unsigned` | `android/app/build/outputs/bundle/release/app-release.aab` | **No** |

The debug APK is built with `-Pzarvis.devApiHost=10.0.2.2` (emulator alias) — it cannot
reach a backend from a physical phone; that's expected and by design (see `DEVELOPMENT.md`).

## D. Required production environment variables

Set these on the backend's production host (e.g. Vercel project settings). None are
committed anywhere in this repository — see `backend/.env.example` for the full template.

| Variable | Required for | If unset |
|---|---|---|
| `JWT_SECRET` | All auth | **Server refuses to start** if `NODE_ENV=production` (fails closed by design) |
| `POSTGRES_URL` or `DATABASE_URL` | Persistent storage across serverless cold starts | Falls back to in-memory store (data lost on every cold start) |
| `GEMINI_API_KEY` | Live AI orchestrator + Gemini native TTS | Falls back to `MockAIProvider` + on-device Android TTS |
| `PLAY_BILLING_SERVICE_ACCOUNT_JSON` | Real Play Billing verification | Falls back to `MockPlayBillingVerifier` (any non-empty token "verifies") |
| `PLAY_BILLING_PACKAGE_NAME` | Play Billing verification (must match the Android `applicationId`) | Defaults to `com.zarvismobile.app` |
| `PUBLIC_APP_URL`, `CORS_ORIGINS` | Web client / CORS | Already default to `zarvismobile.com` — override only for a different domain |

## E. Keystore setup requirements

`android/app/build.gradle.kts` already resolves signing credentials from, in order: (1)
environment variables, (2) `android/app/keystore.properties` (git-ignored). **No keystore,
password, or credential has been generated, invented, or committed** — you must supply a
real one.

To generate a keystore yourself (standard Android tooling, run this on your own machine —
not something to hand a credential-generating step to):
```
keytool -genkeypair -v -keystore release.keystore -alias zarvis -keyalg RSA -keysize 2048 -validity 10000
```

Then provide, either as environment variables in your build/CI environment:
```
RELEASE_STORE_FILE=/absolute/path/to/release.keystore
RELEASE_STORE_PASSWORD=<your store password>
RELEASE_KEY_ALIAS=zarvis
RELEASE_KEY_PASSWORD=<your key password>
```
or as `android/app/keystore.properties` (already in `.gitignore` — never commit this file):
```
storeFile=/absolute/path/to/release.keystore
storePassword=<your store password>
keyAlias=zarvis
keyPassword=<your key password>
```
Once either is present, `./gradlew :app:assembleRelease :app:bundleRelease` will produce
**signed** artifacts automatically — no code change needed.

## F. Gemini setup requirements

1. Get an API key from https://aistudio.google.com/apikey.
2. Set `GEMINI_API_KEY` in the backend's production environment (same variable powers both
   the AI orchestrator and native TTS, via `GEMINI_TTS_MODEL`/`GEMINI_TTS_VOICE`, which
   already have sensible defaults in `backend/.env.example`).
3. No Android-side change is needed — the app already calls the backend's
   `/api/v1/orchestrator/turn` and `/api/v1/tts/synthesize` endpoints and reads whatever the
   backend is configured to do.

## G. Google Play Billing setup requirements

1. In Play Console, create the subscription product(s) for this app.
2. Update `PRODUCT_ID_TO_PLAN` in `backend/src/api/routes/billing.ts` to map your real
   product IDs to a plan (`PRO` is the only MVP-activated paid plan — see MASTER_SPEC.md §19).
3. In Play Console → Setup → API access, create/link a service account with access to this
   app's financial data, and download its JSON key.
4. Set in the backend's production environment:
   - `PLAY_BILLING_SERVICE_ACCOUNT_JSON` — the full JSON key file contents (as a string)
   - `PLAY_BILLING_PACKAGE_NAME` — must exactly match `android/app/build.gradle.kts`'s
     `applicationId` (`com.zarvismobile.app`)

Once set, `container.ts` automatically swaps `MockPlayBillingVerifier` for the real
`GooglePlayBillingVerifier` — no code change needed.

## H. Final physical-device smoke-test checklist

Not performed by this session (no physical device access). Run all six on the final signed
build before release:

1. Gemini TTS audio actually plays through the device speaker/headset
2. Voice interrupt/cancel: starting a new utterance mid-response stops the previous one cleanly
3. A reminder notification fires at its scheduled time
4. A reminder still fires after a full device reboot
5. Settings → Delete Account: the account is gone server-side and the app recovers with a fresh session
6. Onboarding, Conversation, Tasks, Developer, and Settings screens: keyboard/system-bar insets don't clip content or controls

## I. Exact steps to produce the final signed AAB

1. Generate your keystore (see §E) if you haven't already.
2. Set the four `RELEASE_*` environment variables, or write `android/app/keystore.properties`.
3. Set `GEMINI_API_KEY` and the `PLAY_BILLING_*` variables in the backend's production
   environment (§F, §G) — these affect the *backend*, not the AAB itself, but should be live
   before the release build is tested end-to-end.
4. From `android/`, run:
   ```
   ./gradlew :app:bundleRelease
   ```
5. The signed AAB is at `android/app/build/outputs/bundle/release/app-release.aab`.
6. Upload that AAB to Play Console. Run the §H smoke-test checklist on a physical device
   (installed via `bundletool` or a Play Console internal testing track) before any public release.

## J. Final statement

**Complete (code-side, CI-verified):** every in-scope feature from the accepted feature
matrix; backend build+tests; Android debug/release/AAB compile in CI; release signing
resolution logic; Gemini and Play Billing integration code, gated safely behind their
respective credentials with no fake success on failure; account deletion cascade; all UI
inset fixes; JWT fail-closed production behavior; no secrets committed.

**Requires your action, none of which this session can perform:**
1. A real production keystore + its 4 credentials (§E)
2. `GEMINI_API_KEY` (§F)
3. Google Play Console subscription setup + billing service-account JSON (§G)
4. The physical-device smoke test (§H), on a build made after the credentials above are supplied

This build is **not** fully production-ready until all four are done.
