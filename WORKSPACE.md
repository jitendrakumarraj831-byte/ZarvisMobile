# ZARVIS web workspace

The web client is a personal AI workspace on top of the same ZARVIS Brain the Android app uses. Nothing here is a second
AI. The rule of the whole system still holds:

> The LLM proposes. Policy decides. The ToolPipeline executes. Verification determines what actually succeeded.

This document says what the workspace is, what it stores, which endpoints it adds, and, just as important, what it does
**not** do.

## Pages

| Page | What it is | Source of truth |
| --- | --- | --- |
| Home | Prompt box, quick prompts, "continue" row, open-task count | `/conversations`, `/tasks` |
| Chat | The conversation, with an execution card for every tool run | SSE events of the turn; after a reload the stored ledger |
| Work → Projects | Name, goal, description, chats, files, research, tasks, decisions, memory, activity, **Continue work** | `/projects/:id` (one read) |
| Work → Files | Upload, search, filter, preview, summarize, explain, extract, compare, create output, rename, move, delete | `/files` |
| Work → Research | Web searches with sources, key facts and notes with citations, comparisons/reports/outlines, Markdown export | `/executions`, `/notes?kind=research` |
| Work → Tasks | Tracked tasks with a truthful lifecycle | `/tasks` |
| Work → Outputs | Replies saved as files, recent results that can be saved | `/files` (generated ones), `/executions` |
| Agents | Personal, Research, Documents, Creative, Business, Developer: skills, permissions, limits, current work, recent results | `/agents`, `/agents/:id` (views over the SkillRegistry) |
| Activity | One merged feed of tool runs, tasks, files, notes, chats and projects | `/activity` |
| Plans & Usage | Plan, credits, real usage by skill | `/usage/summary` |
| Settings → Memory | What ZARVIS remembers: only what the user saved | `/memory`, `/notes` |
| Capabilities | Every capability with WORKING / PARTIAL / PLANNED / UNSUPPORTED | `web/feature-pages.js` (unit tested) |

Phone tab bar: Home, Work, Chat, Agents, Settings. Plans & Usage, Activity and Profile are in the menu drawer.

## Truthfulness rules the code enforces

- **Execution cards show only what happened.** A stage appears when the matching `progress` SSE event arrives; a stage
  that did not happen is not drawn, and only the stage running right now is animated. A finished stage is worded in the
  past tense ("Ran the skill"), and a failed tool never reads as completed.
- **Confirmations are the server's.** A confirmation is issued by the pipeline, bound to the exact input, single-use,
  and expires. The card says "Nothing has been done yet" until the server answers the approval.
- **Tasks are records, not background jobs.** `QUEUED → RUNNING → EXECUTING → VERIFYING → WAITING →
  CONFIRMATION_REQUIRED → COMPLETED`, plus `FAILED`, `CANCELLED`, `BLOCKED`. A step runs, as one ordinary orchestrator
  turn, only when the user presses Run. Progress is the number of finished steps. A task is `COMPLETED` only when every
  step finished and its last result was verified by tool evidence. The legacy `status` field stays on the wire for the
  Android app; `lifecycle` is the truthful one and wins if they disagree.
- **Research never invents a source.** A research note can cite only URLs that appear in the results of the
  `web.search` execution it names; the server rejects anything else with 400. The UI separates "Live web" from "AI
  reasoning · not live".
- **Memory is only what the user saves.** Nothing is remembered automatically. Each item can be paused, edited or
  deleted; memory can be switched off altogether. At most the newest 20 active items per scope are given to the
  planner, and the chat window is the last 40 messages of that chat.
- **Files keep text, not originals.** An upload is read (text directly; PDF, DOCX and images by the server) and only the
  extracted text (at most 60,000 characters) is stored. A "saved" toast appears only after the server answered 2xx.
- **Developer tests are GitHub's, not ZARVIS's.** ZARVIS runs no tests. The only test evidence shown is the pull
  request's own check-runs read from GitHub (`GET /developer/pr-status`); with no checks the UI says there is no test
  result.
- **Android-only actions are not pretended.** Calls, contacts and notification access are UNSUPPORTED on the web and
  say so.

## Data and API added in this phase

New tables (Postgres and the in-memory store share one `Store` interface): `projects`, `workspace_notes`,
`workspace_files`, `tool_executions`; new columns: `conversations.project_id`, `accounts.memory_enabled`,
`confirmations.task_id`, and `tasks.project_id / updated_at / lifecycle / meta`. Account deletion cascades over all of
them.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` | Projects; `GET /projects/:id` returns the whole workspace and the Continue work block in one read |
| `POST /conversations/:id/project` | Move a chat into or out of a project |
| `GET/POST /notes`, `PATCH/DELETE /notes/:id` | Decisions, project memory, research notes (kinds: `decision`, `memory`, `note`, `research`) |
| `GET /memory`, `PUT /memory/settings`, `DELETE /memory/personal` | The Memory page |
| `GET /files`, `GET/PATCH/DELETE /files/:id`, `POST /files/text`, `POST /files/upload` | Files |
| `GET /executions`, `GET /executions/:id`, `GET /conversations/:id/executions` | The tool-execution ledger |
| `GET /activity` | The merged feed |
| `GET /agents`, `GET /agents/:id` | Agent profiles over the SkillRegistry |
| `GET /usage/summary` | Credits and usage by skill |
| `GET /developer/pr-status` | Check-runs of a pull request, from GitHub |
| `POST /tasks/:id/run`, `/retry`, `/cancel` | The task step runner (atomic claim; a double press cannot run a step twice) |

A turn may carry `projectId` and `agentId`. With an agent, only that agent's skills are offered to the planner; an
unknown agent is a 400 (`invalid_agent`). With a project, its goal, decisions and project memory are added to the
planner prompt.

## Limits of this phase (honest list)

- **No background automation.** Nothing runs on a schedule or without the user pressing Run. This is `PLANNED`.
- **No original files.** Only extracted text is kept, so a file cannot be downloaded back.
- **Research reads search results, not pages.** ZARVIS lists the links a search returned; it does not open and read each
  page, and a "source" is never a page ZARVIS read.
- **Developer: no test runner, no merge.** Pull requests are opened after an explicit confirmation and are never merged
  by ZARVIS. Live GitHub writes are covered by a GitHub test double, not yet by a live-GitHub CI job.
- **Memory and context are bounded** (20 items per scope, 40 chat messages) and are not semantic search.
- **Agent descriptions, skill descriptions and limitations come from the server in English**; their names, taglines and
  quick actions are translated.
- **Hindi:** the interface strings of the new pages are translated; the Developer result area, the Permission Center rows
  and the Metrics page keep their previous coverage.
- **Rate limits are per server process** (in-process counters), as before.

## Tests

- Backend: `cd backend && npx vitest run` (set `TEST_DATABASE_URL` to also run the Postgres store). The workspace
  adds `test/workspace/*`, `test/tasks/taskRunner.test.ts`, `test/agents/agentsApi.test.ts` and extends the contract
  test so every API path called by any web file must be a served route.
- Web units: `node --test web/tests/*.test.js` (includes the honest-status test of the capability catalogue).
- Browser (Chromium, real backend and Postgres, GitHub API stub):
  - `web/e2e/phase1.e2e.cjs`: auth, sessions, chat, developer, navigation, Hindi.
  - `web/e2e/quality.e2e.cjs`: nine widths from 320 to 1920 on every page, axe in light, dark and Hindi, keyboard,
    offline shell, voice, duplicate submission.
  - `web/e2e/workspace.e2e.cjs`: projects and Continue work, files, research and citations, tasks, agents, activity,
    memory, execution cards (live stages, confirmation, failure, stored), pull-request evidence, composer files,
    navigation, offline and a stalled server.
  Guest sign-ups are limited to 60 an hour per server process, so CI runs the workspace suite against its own backend.
