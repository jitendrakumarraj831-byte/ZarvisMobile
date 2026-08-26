# DEVELOPER AGENT

Companion to [MASTER_SPEC.md §13 (Developer Agent Architecture)](./MASTER_SPEC.md#13-developer-agent-architecture)
and [§14 (GitHub Architecture)](./MASTER_SPEC.md#14-github-architecture).

## Purpose

Let a user (technical or not) say things like "मेरे GitHub project को check करके errors
ठीक करो" and have the system safely analyze a repository, propose a plan, make changes on a
branch, validate them, and open a pull request for human review — never push directly to a
protected branch, never force-push, never rewrite history.

## Sub-agents

| Agent | Responsibility | Risk of its own actions |
|---|---|---|
| Requirement Agent | Turns the natural-language ask into a concrete, scoped spec | LOW (no side effects) |
| Planning Agent | Breaks the spec into ordered, reviewable steps | LOW |
| Repository Agent | Clones/reads the repo, builds a structural understanding (languages, build system, tests, CI) | LOW (read-only) |
| Coding Agent | Writes/edits code on a feature branch | MEDIUM |
| Testing Agent | Runs/writes tests | MEDIUM |
| Debugging Agent | Diagnoses failures, iterates fixes | MEDIUM |
| Code Review Agent | Self-review pass over the diff before it reaches a human | LOW (review only) |
| Security Agent | Scans the diff for injected vulnerabilities/secrets | LOW (review only) |
| Deployment Agent | Opens a PR / triggers a deploy pipeline | MEDIUM — **never auto-merges** |

## Flow

```
Requirement Analysis → Project Analysis → Plan → Code → Test → Debug →
Security Review → Final Review → User Approval → Commit / PR / Deployment
```

Each arrow is a checkpoint the Orchestrator records as a `TaskStep` (§18 of MASTER_SPEC),
so the user sees live progress and can pause/cancel at any point, and a failure at any
stage routes back to Debugging rather than silently pushing a broken result forward.

## Guardrails (non-negotiable)

- **Read-only analysis requires no confirmation** (LOW risk) — the Repository Agent can
  always look before anything is proposed.
- **Any write is at least MEDIUM risk** and is summarized to the user in plain language
  before it happens (what files, what kind of change, why).
- **Direct pushes to a protected/default branch, force-push, and history rewriting are
  always HIGH risk** and require an explicit, action-specific confirmation — the default
  and expected path is always *branch + pull request*, never a direct commit to `main`.
- The Deployment Agent **never auto-merges** a PR it opened; merging is a human decision.
- If the requested change is ambiguous or the repository's structure doesn't clearly
  support it, the agent stops at the Planning stage and asks the user rather than guessing
  destructively.

## GitHub integration boundary

The mobile app never holds a GitHub credential. `backend/src/github/GitHubClient` wraps a
GitHub App installation (preferred) or OAuth token; every repository operation (read
files, create branch, commit, open PR) goes through this one client so there is a single
place enforcing "no direct writes to default branch" and "no force-push," and a single
place that would need to change if the underlying GitHub API version changes. See
[MASTER_SPEC.md §14](./MASTER_SPEC.md#14-github-architecture).

## What ships in this pass vs. later

This repository's MVP implements `developer.analyze_repo` — the Repository Agent's
read-only structural analysis, backend-executed, behind the full Tool pipeline, with a
mocked GitHub data source so it runs without a live GitHub App installation. The
write-capable stages (Coding/Testing/Debugging/Security/Deployment agents, real GitHub App
wiring, PR creation) are architected (interfaces + routing exist) and scheduled for Phases
7–8 of [MASTER_SPEC.md §28](./MASTER_SPEC.md#28-development-phases) — see
[MASTER_SPEC.md §29](./MASTER_SPEC.md#29-mvp-scope) for the exact boundary.
