# ZARVIS phone-automation security policy

This is the policy every phone action of ZARVIS runs under: opening apps, calls, reminders, notifications, screen reading,
taps, and everything else ZARVIS does on the phone for the user. It is written down once, in
[`shared/automation-policy.json`](./shared/automation-policy.json), and enforced in code. If this page and the JSON ever
disagree, the JSON is what runs.

No capability is marked WORKING by this policy. Every Android capability stays PARTIAL until it has been verified on a real
phone ([ZARVIS_PHASE1_DEVICE_CHECKLIST.md](./ZARVIS_PHASE1_DEVICE_CHECKLIST.md)).

## Where it is enforced

| Place | What it does |
|---|---|
| Android `ToolPipeline` (`android/domain/.../tooling/ToolPipeline.kt`) | It is the only way a phone action runs, and it applies every rule below to every on-device skill. |
| Android `AndroidOrchestrator` | It asks the same policy first, so no permission is explained for an action that would be refused. While actions are paused it offers the server no phone actions, and it reads the step limit from the policy. |
| Android domain tests (`AutomationPolicyTest`, `ToolPipelinePolicyTest`) | They check that every skill the app registers is in the policy with exactly its own rules, that no policy entry is stale, and that each rule is enforced. |
| Backend tests (`automationPolicy.test.ts`) | They check that the phone actions the server's planner may hand to the phone are exactly the policy's `brainHandoff` actions, under the same step limit and confirmation rules. |
| Backend `POST /orchestrator/device-result` | It accepts a phone's result only for an action the planner handed over in that conversation, and only once (`deviceResultBinding.test.ts`). |

## The rules

1. **Default deny.** An on-device action that is not listed in the policy is refused (`not_in_policy`) before anything is
   asked or done. A new phone action cannot run until it is written into the policy, with tests.
2. **Exact rules.** An action's risk, action class and capability must be exactly what the policy says. If they differ, the
   action is refused (`policy_mismatch`) instead of running under either set of rules, so a skill declared too weak can't
   skip a confirmation.
3. **Pause switch.** While the user has paused phone actions (Settings › Phone action safety), no phone action runs
   (`automation_paused`). Pause is checked:
   - before anything is asked;
   - again right after the user confirms, so pausing while a confirmation is open still stops the action.

   While paused, the server's planner is offered no phone actions, so it answers in words. If the setting can't be read,
   nothing runs either (`pause_setting_unreadable`): the check fails closed. Chat keeps working, and reminders already set
   still ring.
4. **Other apps.** An action that reads or acts inside the app in front (`actsInOtherApps`: today `screen.read` and
   `screen.tap`) must name the app it resolved (`targetPackage`). The pipeline checks that app itself, in addition to the
   skill's own check. It refuses:
   - banking, payment, trading, authenticator and password-manager apps (`sensitive_app`);
   - Android's own Settings, permission, install and System UI screens (`security_surface`);
   - an action that cannot say which app it reaches (`target_not_checked`).
5. **Confirmation.** An action is confirmed every time, showing exactly what will happen, when any of these is true:
   - its action class is `EXTERNAL_COMMUNICATION`, `FINANCIAL`, `DESTRUCTIVE` or `SECURITY_SENSITIVE`;
   - its risk is `HIGH` or `VERY_HIGH`;
   - the policy marks it `confirm`.

   The policy can only add a confirmation, never remove one. Permission and the pause are re-checked after the user approves.
6. **Private results.** The result of a `privateResult` action never leaves the phone. It isn't sent in the device-result
   report or to the server's voice, and the server records only that it was shown on the phone. These actions are the screen,
   notifications, screen time, location and a contact's number.
7. **Steps.** A multi-step request runs at most `maxPhoneSteps` (5) phone steps, each through all of the rules above, and
   stops at the first step that was declined, refused or failed.
8. **One report per handoff.** The phone's report of an action the server handed over is recorded only if all of these
   hold:
   - it is the same account;
   - it is the same conversation;
   - it names the same `toolCallId` and skill;
   - it arrives within 24 hours;
   - it is the first report for that action.

   A repeat gets `409 device_result_already_recorded`, and anything never handed over gets `404 unknown_device_action`.
   Neither records a reply or plans another step.
9. **History.** Every attempt is written to the phone's history, however it ended. Each entry has:
   - the time;
   - the action, as the user was asked to confirm it;
   - the outcome: Done, Finish in the app, You said no, Refused for safety, Paused, Needs access, or Didn't work.

   The history keeps the last 100 entries. It stays only on the phone: it isn't uploaded, and Android backup and device
   transfer exclude all ZARVIS data. It is cleared when the user signs out, deletes the account, or another account signs
   in, and the user can clear it at any time. A history that can't be written never changes an action's outcome.

## What ZARVIS never does

These promises are shown to the user, in English and Hindi, on Settings › Phone action safety, from the same JSON.

- Send a message, email or post for you. Before opening a message draft, ZARVIS shows the exact recipient and text for your approval; the draft then opens in the app and you press Send.
- Pay, buy, transfer money or subscribe.
- Read or tap inside banking, payment, trading, authenticator or password apps.
- Act inside Android Settings, permission or install screens, or give itself any access.
- Read password, OTP or PIN fields.
- Tap buttons that pay, buy, delete, sign in, grant access or accept terms, in English, Hindi or Hinglish.
- Act in the background or without you asking. There is no wake word.
- Upload what it reads from your screen, notifications, screen time, location or contacts.

## The actions

| Action | Risk | Class | Confirmed every time | Result stays on phone | Reaches other apps | Server may hand it over |
|---|---|---|---|---|---|---|
| `phone.open_app` | LOW | LOW_IMPACT | | | | ✓ |
| `app.search` | LOW | LOW_IMPACT | | | | ✓ |
| `message.draft` | MEDIUM | EXTERNAL_COMMUNICATION | ✓ (exact recipient and text before opening) | | | ✓ |
| `phone.find_contact` | MEDIUM | READ_ONLY | | ✓ | | ✓ |
| `phone.call` | HIGH | EXTERNAL_COMMUNICATION | ✓ | | | ✓ |
| `personal.reminder` | LOW | LOW_IMPACT | | | | ✓ |
| `alarm.set` | LOW | LOW_IMPACT | (you save it in Clock) | | | ✓ |
| `calendar.create_event` | MEDIUM | LOW_IMPACT | (you save it) | | | ✓ |
| `device.open_settings` | LOW | LOW_IMPACT | | | | ✓ |
| `bluetooth.open_settings` | MEDIUM | LOW_IMPACT | | | | |
| `location.current` | MEDIUM | READ_ONLY | | ✓ | | ✓ |
| `camera.capture_photo` | MEDIUM | READ_ONLY | | | | ✓ |
| `photos.pick_photo` | MEDIUM | READ_ONLY | | | | ✓ |
| `photos.describe_photo` | MEDIUM | READ_ONLY | | | | ✓ |
| `files.pick_document` | MEDIUM | READ_ONLY | | | | ✓ |
| `notifications.read_recent` | HIGH | READ_ONLY | ✓ | ✓ | | ✓ |
| `notifications.speak_on` | MEDIUM | LOW_IMPACT | | | | ✓ |
| `notifications.speak_off` | LOW | LOW_IMPACT | | | | ✓ |
| `usage.screen_time` | HIGH | READ_ONLY | ✓ | ✓ | | ✓ |
| `device.global_action` | VERY_HIGH | SECURITY_SENSITIVE | ✓ | | | ✓ |
| `screen.read` | VERY_HIGH | SECURITY_SENSITIVE | ✓ | ✓ | ✓ | ✓ |
| `screen.tap` | VERY_HIGH | SECURITY_SENSITIVE | ✓ | | ✓ | ✓ |
| `assistant.setup` | MEDIUM | LOW_IMPACT | | | | ✓ |

## Sensitive apps

`SensitiveApps` (`android/domain/.../privacy/SensitiveApps.kt`) is deliberately conservative: a false positive only refuses
more. It recognises sensitive apps in two ways:

- **Words in the package name:** bank, upi, wallet, paypal, authenticator, authy, paytm, phonepe, Google Pay's `nbu.paisa`,
  bhim, mobikwik, freecharge, password managers, groww, upstox, trading and broker.
- **Known packages that carry none of those words.** Each was checked against its store listing:
  - HDFC Bank `com.snapwork.hdfc`
  - SBI apps `com.sbi.*`
  - Axis Mobile `com.axis.mobile`
  - PNB ONE `com.Version1`
  - CRED `com.dreamplug.androidapp`
  - Zerodha `com.zerodha.*`
  - Angel One `com.msf.angelmobile`
  - Samsung Wallet `com.samsung.android.spay*`

The same detection hides banking alerts in notification summaries.

## Adding a phone action

1. Write the skill, with the narrowest risk and action class that are true.
2. Add it to `shared/automation-policy.json`, with its rules and whether the server may hand it over.
3. Register it in `OnDeviceSkillRegistryFactory` and build it in `AutomationPolicyTest`, which fails until both are done.
4. If the server may hand it over, add it to `backend/src/capabilities/deviceActions.ts`. `automationPolicy.test.ts` fails
   until both lists agree.
5. If it reads or acts inside another app, set `actsInOtherApps`, and make its preparer put the resolved `targetPackage` in
   the input.
6. Add tests for what it refuses as well as what it does.

## Known limits

- Sensitive-app detection uses package names only. A banking app with an unusual package name that is not on the list is
  not recognised. The screen skills also refuse password fields, and taps on pay, buy, delete, allow and sign-in buttons are
  refused in any app.
- History entries keep the action as it was described. For a call, that includes the contact's name and number. They are
  stored in the app's private storage, not encrypted separately, and excluded from backup.
- Refusal messages from the pipeline follow the app language (English or Hindi). Most skills' own messages are still in
  English.
- Nothing here has been verified on a physical phone yet.
