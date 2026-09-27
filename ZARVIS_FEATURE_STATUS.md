# ZARVIS feature status

Status is based on the code after the international product pass, not on marketing copy.

| Feature | Status | Why |
|---|---|---|
| AI Workspace / Chat | WORKING | Web uses `POST /orchestrator/turn-stream`. Android uses `POST /orchestrator/turn` and now keeps `conversationId`. |
| Streaming replies | PARTIAL | The stream route still finishes the turn, then sends chunks. The client renders those chunks as they arrive. |
| Voice input | WORKING | Web uses one-shot browser speech recognition. Android uses `SpeechRecognizer` and now requests `RECORD_AUDIO`. |
| Voice output | WORKING | Gemini TTS is the only engine. The selected voice name is sent on synthesize and synthesize-stream. Spoken replies on the web start after a voice turn and can be turned off. |
| Wake word / continuous listen | NOT SUPPORTED | Listening starts from a tap and stops after one utterance. |
| Phone: open app | WORKING | Android `phone.open_app` through ToolPipeline. No runtime permission. Web shows Continue on Android. |
| Phone: find contact | PARTIAL | Android skill is real. Contacts permission is requested at runtime. A loose keyword no longer hijacks unrelated chat. |
| Phone: call | PARTIAL | Android skill is real, confirmation stays in the pipeline, and a raw number does not require Contacts. Web cannot place the call. |
| Phone: system settings | NOT SUPPORTED | No skill and no button. |
| Web search | PARTIAL | `web.search` runs when the model selects it and Gemini grounding is configured. Sources are not invented in the UI. |
| Research compare / report / outline | PARTIAL | These skills write from model knowledge. The research page says they are not live search. |
| Documents | WORKING | Upload, extract, then ask in Chat. The chip says ready only after extraction returns text. Image and document errors use the server code. |
| Image generation | NOT SUPPORTED | The product can analyze an attached image. It cannot generate one. |
| Creative writing | WORKING | `creative.write_message`, `write_poem`, and `brainstorm` run through the orchestrator. |
| Business drafts | WORKING | Social post, customer reply, and invoice draft skills run. Nothing is published or sent. |
| Tasks / automation | PARTIAL | Create, list, pause, resume, cancel, and retry change task status. Steps are not executed. |
| Developer analyze | WORKING | `POST /developer/analyze` from the web workspace and the Android developer screen. Public repos do not need a token. |
| Developer plan | PARTIAL | There is no separate plan skill. Implement builds its own plan inside the implementation request. |
| Developer implement | PARTIAL | Real branch, files, and pull request after confirmation, PRO entitlement, and a server `GITHUB_TOKEN`. The token is shared by the process. Web now asks before sending `confirmed: true`. |
| Developer verify | NOT SUPPORTED | No separate verification agent. |
| Plans / entitlements | PARTIAL | Current plan, credits, and trial date come from `GET /entitlements/me`. Checkout is not connected, so the UI does not invent a price or grant PRO. |
| Billing verification | PARTIAL | Production without Play credentials fails closed. Non-production still uses the mock verifier so local tests can exercise the route. A purchase token can be consumed once. |
| Settings that change behavior | WORKING | Language, appearance, spoken replies, Gemini voice, clear session, and delete account. |
| Settings without a control | NOT SUPPORTED | Web notifications, data export, and a separate memory browser. The pages say so. |
| Guest session | WORKING | First visit creates a guest account. Clearing the Android session bootstraps a new guest on the next turn. |
| Account ownership for tasks | WORKING | Task read and status changes return 404 for another account. |
