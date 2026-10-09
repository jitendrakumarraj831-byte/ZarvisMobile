/* ZARVIS MOBILE — execution cards.

   A card per tool run, in the chat. Every line on a card comes from something the backend really did:
   - live: the SSE `progress` events of the turn (tool_started, tool_stage, tool_finished) and the final `done` payload;
   - after a reload: the stored execution rows of GET /conversations/:id/executions.
   A stage that did not happen is not shown, and nothing is animated except the one stage that is running right now.
   The same output renderers show repository analysis and pull requests on the Developer page and in the Work pages. */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  let host = null;

  function icon(id) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ico");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Text that came from the user, a website or the model, not from the interface: the Hindi translator leaves it as it is. */
  function userData(node) {
    node.dataset.userText = "";
    return node;
  }

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  const isHttp = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

  /* ---------- Labels ---------- */

  const STATUS_LABEL = {
    RUNNING: "Running",
    COMPLETED: "Completed",
    FAILED: "Couldn't complete",
    DENIED: "Not done",
    CONFIRMATION_REQUIRED: "Needs your confirmation",
    PERMISSION_REQUIRED: "Needs permission",
    USER_ACTION_REQUIRED: "Needs your input",
    UNSUPPORTED: "Not available",
  };
  const STATUS_TONE = { RUNNING: "info", COMPLETED: "ok", CONFIRMATION_REQUIRED: "warn", PERMISSION_REQUIRED: "warn", USER_ACTION_REQUIRED: "warn", FAILED: "err", DENIED: "err", UNSUPPORTED: "err" };

  const CATEGORY_ICON = { WEB: "i-globe", RESEARCH: "i-search", DOCUMENTS: "i-file", DEVELOPER: "i-code", GITHUB: "i-github", BUSINESS: "i-briefcase", CREATIVE: "i-pen", AUTOMATION: "i-task" };
  const SKILL_ICON = (skillId) => {
    const prefix = String(skillId || "").split(".")[0];
    return { web: "i-globe", research: "i-search", docs: "i-file", developer: "i-code", business: "i-briefcase", creative: "i-pen", automation: "i-task" }[prefix] || "i-bolt";
  };
  void CATEGORY_ICON;

  const STAGE_ORDER = ["understand", "skill", "permission", "prepare", "confirm", "execute", "verify", "result"];
  /** A stage reads differently while it is happening and after it has: "Checking…" is never left on a finished step. */
  const STAGE_TITLE = {
    understand: { done: "Understood the request" },
    skill: { done: "Chose a skill" },
    permission: { active: "Checking permission and plan", done: "Permission and plan checked", failed: "Permission or plan refused" },
    prepare: { done: "Action prepared" },
    confirm: { waiting: "Waiting for your confirmation", done: "Confirmed by you", failed: "Not confirmed" },
    execute: { active: "Running the skill", done: "Ran the skill", failed: "The run failed" },
    verify: { active: "Checking the result", done: "Result checked", failed: "The check failed" },
    result: { done: "Result", failed: "Result" },
  };
  const stageTitle = (key, state) => (STAGE_TITLE[key] && (STAGE_TITLE[key][state] || STAGE_TITLE[key].done)) || key;

  const riskText = (risk) => ({ LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk", VERY_HIGH: "Very high risk" }[risk] || "");
  const classText = (cls) => ({ READ_ONLY: "Read only", LOW_IMPACT: "Low impact", EXTERNAL_COMMUNICATION: "Acts outside ZARVIS" }[cls] || "");

  /* ---------- Output renderers (shared with the Developer page) ---------- */

  function kv(rows) {
    const dl = h("dl", "exec-kv");
    for (const [label, value, dataRow] of rows) {
      if (value == null || value === "") continue;
      const row = h("div");
      row.append(h("dt", null, label));
      const dd = h("dd");
      if (value instanceof Node) dd.appendChild(value);
      else dd.textContent = String(value);
      if (dataRow) dd.dataset.userText = "";
      row.appendChild(dd);
      dl.appendChild(row);
    }
    return dl;
  }

  function link(url, label) {
    if (!isHttp(url)) return userData(h("span", null, label || String(url)));
    const a = userData(h("a", "exec-link", label || url));
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  /** Facts from the file tree only. They are not a code review and the copy says so. */
  function observations(structure) {
    const notes = [];
    if (structure.hasTests === false) notes.push("No test files were found in the repository tree.");
    if (structure.hasCi === false) notes.push("No CI workflow was found (.github/workflows).");
    if (structure.buildSystem === "Unknown") notes.push("ZARVIS couldn't identify the build system from the file names.");
    if (structure.primaryLanguage === "Unknown") notes.push("GitHub reports no main language for this repository.");
    return notes;
  }

  function renderRepoAnalysis(root, output) {
    const s = output && output.structure;
    if (!s) return;
    const box = h("div", "exec-panel");
    box.appendChild(h("h4", "exec-panel-title", "Repository"));
    box.appendChild(kv([
      ["Repository", link(s.repoUrl, String(s.repoUrl).replace(/^https?:\/\/(www\.)?github\.com\//, ""))],
      ["Main language", s.primaryLanguage, true],
      ["Build system", s.buildSystem, true],
      ["Tests in the tree", s.hasTests ? "Found" : "None found"],
      ["CI workflow", s.hasCi ? "Found" : "None found"],
      ["Files", String(s.fileCount)],
      ["Top-level folders", (s.topLevelDirs || []).join(", ") || "None", true],
      ["Read as", output.githubLogin ? "GitHub account " + output.githubLogin : "No GitHub account (public repositories only)", !!output.githubLogin],
    ]));
    const notes = observations(s);
    const obs = h("div", "exec-observe");
    obs.appendChild(h("h5", null, "Observations from the file tree"));
    if (notes.length) {
      const ul = h("ul");
      for (const note of notes) ul.appendChild(h("li", null, note));
      obs.appendChild(ul);
    } else {
      obs.appendChild(h("p", "muted", "Nothing stands out in the file tree. This is not a code review: ZARVIS read file names, not code."));
    }
    box.appendChild(obs);
    root.appendChild(box);
  }

  function renderCiChecks(root, data) {
    root.replaceChildren();
    const pr = data.pullRequest;
    const sum = data.summary;
    const head = h("p", "exec-ci-head");
    head.appendChild(document.createTextNode("Reported by GitHub for pull request #" + pr.number + " (" + (pr.merged ? "merged" : pr.state) + "): "));
    head.appendChild(h("strong", null, sum.total === 0 ? "no checks" : sum.passed + " passed · " + sum.failed + " failed · " + sum.pending + " pending"));
    root.appendChild(head);
    if (sum.total === 0) {
      root.appendChild(h("p", "muted", "GitHub reports no CI checks for the latest commit. ZARVIS has not run any tests, so there is no test result to show."));
      return;
    }
    const ul = h("ul", "exec-checks");
    for (const check of pr.checks) {
      const li = h("li");
      const state = check.status !== "completed" || check.conclusion === null ? "pending" : ["success", "neutral", "skipped"].includes(check.conclusion) ? "pass" : "fail";
      li.dataset.state = state;
      li.appendChild(icon(state === "pass" ? "i-check" : state === "fail" ? "i-x" : "i-clock"));
      const label = check.url && isHttp(check.url) ? link(check.url, check.name) : userData(h("span", null, check.name));
      li.appendChild(label);
      li.appendChild(h("small", null, state === "pending" ? (check.status === "completed" ? "no result" : check.status.replace(/_/g, " ")) : check.conclusion.replace(/_/g, " ")));
      ul.appendChild(li);
    }
    root.appendChild(ul);
  }

  async function loadCi(root, repoUrl, number, button) {
    if (button) button.disabled = true;
    root.replaceChildren(h("p", "muted", "Asking GitHub…"));
    root.setAttribute("aria-busy", "true");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await host.apiFetch("/developer/pr-status?repoUrl=" + encodeURIComponent(repoUrl) + "&number=" + encodeURIComponent(number), { signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        root.replaceChildren(h("p", "alert alert-error", body.error || "GitHub didn't answer (" + res.status + ")."));
        if (button) button.disabled = false;
        return;
      }
      renderCiChecks(root, body);
      if (button) {
        button.disabled = false;
        button.textContent = "Check again";
      }
    } catch (err) {
      if (!err || err.name !== "SessionEndedError") {
        console.error(err);
        // A network failure is a network failure; anything else is this page's own fault and must not be called one.
        const timedOut = err && err.name === "AbortError";
        const network = err instanceof TypeError && /fetch|network|load failed/i.test(err.message || "");
        root.replaceChildren(h("p", "alert alert-error", timedOut ? "ZARVIS took too long to answer. Try again in a moment." : network ? "Couldn't reach ZARVIS. Check your connection and try again." : "ZARVIS got the answer but couldn't show it. Try again."));
      }
      if (button) button.disabled = false;
    } finally {
      clearTimeout(timer);
      root.removeAttribute("aria-busy");
    }
  }

  function renderPullRequest(root, output, inputPreview) {
    const pr = output && output.pullRequest;
    if (!pr) return;
    const box = h("div", "exec-panel");
    box.appendChild(h("h4", "exec-panel-title", "Pull request"));
    box.appendChild(kv([
      ["Pull request", link(pr.url, "#" + pr.number + " on GitHub")],
      ["Branch", output.branch, true],
      ["Changed files", (output.files || []).length ? String(output.files.length) : "0"],
    ]));
    if ((output.files || []).length) {
      const ul = h("ul", "exec-files");
      for (const file of output.files) ul.appendChild(userData(h("li", null, file)));
      box.appendChild(ul);
    }
    if ((output.suggestedTests || []).length) {
      box.appendChild(h("h5", "exec-sub", "Checks the change suggests (ZARVIS did not run them)"));
      const ul = h("ul");
      for (const test of output.suggestedTests) ul.appendChild(userData(h("li", null, test)));
      box.appendChild(ul);
    }
    box.appendChild(h("p", "muted", "Tests: ZARVIS runs none. The only test evidence is what your repository's own checks report on GitHub."));
    const repoUrl = inputPreview && inputPreview.repoUrl;
    if (repoUrl) {
      const out = h("div", "exec-ci");
      const button = h("button", "btn btn-secondary btn-sm", "Check CI results on GitHub");
      button.type = "button";
      button.addEventListener("click", () => void loadCi(out, repoUrl, pr.number, button));
      box.append(button, out);
    }
    root.appendChild(box);
  }

  function renderSources(root, output, skillId) {
    const results = output && Array.isArray(output.results) ? output.results.filter((r) => r && isHttp(r.url)) : [];
    if (!results.length) return null;
    const wrap = h("div", "exec-sources");
    const badge = h("span", "z-badge z-badge-ok", "Live web");
    const toggle = h("button", "exec-sources-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.append(document.createTextNode("View sources (" + results.length + ") "), icon("i-right"));
    const list = h("ul", "exec-source-list");
    list.hidden = true;
    for (const r of results) {
      const li = userData(h("li"));
      li.appendChild(link(r.url, r.title || hostOf(r.url)));
      li.appendChild(h("small", null, hostOf(r.url)));
      list.appendChild(li);
    }
    const note = h("p", "muted exec-source-note", "Links returned by the search provider for this search. ZARVIS lists them; it does not open and read every page.");
    note.hidden = true;
    toggle.addEventListener("click", () => {
      const open = list.hidden;
      list.hidden = !open;
      note.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    wrap.append(badge, toggle, list, note);
    void skillId;
    return wrap;
  }

  /** The skill-specific part of a card or detail view. */
  function renderOutput(root, skillId, output, ctx = {}) {
    if (!output) return;
    if (skillId === "web.search") {
      const sources = renderSources(root, output, skillId);
      if (sources) root.appendChild(sources);
      return;
    }
    if (skillId === "developer.analyze_repo") return renderRepoAnalysis(root, output);
    if (skillId === "developer.implement") return renderPullRequest(root, output, ctx.inputPreview);
    if (/^research\.(compare|report|outline)$/.test(skillId)) {
      const wrap = h("div", "exec-sources");
      wrap.appendChild(h("span", "z-badge z-badge-info", "AI reasoning · not live"));
      wrap.appendChild(h("span", "muted", "Written from general knowledge. It is not sourced or current research."));
      root.appendChild(wrap);
    }
  }

  /* ---------- Cards ---------- */

  function summarizeEvidence(evidence) {
    if (!evidence) return "";
    if (evidence.check === "non_empty_result") {
      const keys = Array.isArray(evidence.outputKeys) ? evidence.outputKeys.join(", ") : "";
      return "The skill returned a non-empty result" + (keys ? " (" + keys + ")" : "") + (evidence.chargedCredits ? "; " + evidence.chargedCredits + " credit" + (evidence.chargedCredits === 1 ? "" : "s") + " charged." : ".");
    }
    return "";
  }

  /** Normalises the three shapes a tool run arrives in: live `done` toolCall, live progress, stored execution row. */
  function fromToolCall(call) {
    const outcome = call.outcome || {};
    const result = call.result || {};
    return {
      id: call.toolCallId,
      skillId: call.skillId,
      status: result.status || (outcome.kind === "success" ? "COMPLETED" : "FAILED"),
      summary: result.userSafeMessage || "",
      output: outcome.kind === "success" ? outcome.result && outcome.result.output : null,
      evidence: result.verificationEvidence || null,
      confirmation: outcome.kind === "confirmation_required" ? outcome.confirmation : null,
      credits: outcome.kind === "success" ? outcome.chargedCredits || 0 : 0,
    };
  }

  function fromExecution(row) {
    return {
      id: row.id,
      skillId: row.skillId,
      skillName: row.skillName,
      status: row.status,
      summary: row.summary,
      output: row.output,
      evidence: row.evidence,
      inputPreview: row.inputPreview,
      confirmationId: row.confirmationId,
      credits: row.creditsCharged || 0,
      at: row.createdAt,
      stored: true,
    };
  }

  class Card {
    constructor(model) {
      this.model = Object.assign({ stages: new Map() }, model);
      this.root = h("article", "exec-card");
      this.root.dataset.toolCallId = model.id || "";
      this.head = h("header", "exec-head");
      this.ico = h("span", "exec-ico");
      this.title = h("strong", "exec-title");
      this.chip = h("span", "z-badge exec-chip");
      this.chip.setAttribute("role", "status");
      this.head.append(this.ico, this.title, this.chip);
      this.input = userData(h("p", "exec-input"));
      this.steps = h("ol", "exec-steps");
      this.steps.setAttribute("aria-label", "What happened, in order");
      this.message = h("p", "exec-message");
      this.outputBox = h("div", "exec-output");
      this.where = h("div", "exec-where");
      this.confirmBox = h("div", "exec-confirm");
      this.details = h("details", "exec-details");
      this.detailsSummary = h("summary", null, "Details");
      this.detailsBody = h("div", "exec-details-body");
      this.details.append(this.detailsSummary, this.detailsBody);
      this.root.append(this.head, this.input, this.steps, this.message, this.confirmBox, this.outputBox, this.where, this.details);
      this.render();
    }

    /** A note belongs to the state it was written for: when a stage moves on without a new note, the old one is dropped. */
    stage(key, state, note) {
      const before = this.model.stages.get(key);
      this.model.stages.set(key, { state, note: note != null ? note : before && before.state === state ? before.note : "" });
      this.render();
    }

    patch(patch) {
      Object.assign(this.model, patch);
      this.render();
    }

    render() {
      const m = this.model;
      const name = m.skillName || (host && host.skillLabel ? host.skillLabel(m.skillId) : m.skillId) || "Tool";
      this.title.textContent = name;
      this.ico.replaceChildren(icon(SKILL_ICON(m.skillId)));
      const status = m.status || "RUNNING";
      this.chip.textContent = STATUS_LABEL[status] || status;
      this.chip.className = "z-badge exec-chip z-badge-" + (STATUS_TONE[status] || "info");
      this.root.dataset.status = status;
      this.root.setAttribute("aria-label", name + ": " + (STATUS_LABEL[status] || status));

      const preview = m.inputPreview ? Object.values(m.inputPreview).find((v) => typeof v === "string" && v) : "";
      this.input.hidden = !preview;
      this.input.textContent = preview ? "“" + String(preview).slice(0, 160) + (String(preview).length > 160 ? "…" : "") + "”" : "";

      // Stages: only those that really happened, in the order they happen.
      this.steps.replaceChildren();
      for (const key of STAGE_ORDER) {
        const entry = m.stages.get(key);
        if (!entry) continue;
        const li = h("li", "exec-step");
        li.dataset.state = entry.state;
        const dot = h("span", "exec-dot");
        dot.setAttribute("aria-hidden", "true");
        if (entry.state === "done") dot.appendChild(icon("i-check"));
        else if (entry.state === "failed") dot.appendChild(icon("i-x"));
        else if (entry.state === "waiting") dot.appendChild(icon("i-clock"));
        const text = h("span", "exec-step-text");
        text.appendChild(h("span", "exec-step-title", stageTitle(key, entry.state)));
        if (entry.note) text.appendChild(h("small", null, entry.note));
        li.append(dot, text);
        this.steps.appendChild(li);
      }
      this.steps.hidden = this.steps.children.length === 0;

      const finished = status !== "RUNNING";
      this.message.hidden = !(finished && m.summary && status !== "COMPLETED" && !m.confirmation);
      this.message.textContent = this.message.hidden ? "" : String(m.summary).replace(/\s+/g, " ").slice(0, 400);

      // Output the skill produced, from the real result.
      this.outputBox.replaceChildren();
      if (status === "COMPLETED" && m.output) renderOutput(this.outputBox, m.skillId, m.output, { inputPreview: m.inputPreview });
      this.outputBox.hidden = this.outputBox.children.length === 0;

      // Where the result can be followed up (Tasks, the Developer workspace).
      this.where.replaceChildren();
      const dest = status === "COMPLETED" && host.destination ? host.destination(m.skillId, status) : null;
      if (dest) {
        const go = h("button", "inline-link tool-row-link", dest.label);
        go.type = "button";
        go.dataset.go = dest.target;
        this.where.appendChild(go);
      }
      this.where.hidden = !dest;

      // Details: what ran, how risky it is, what was checked.
      this.detailsBody.replaceChildren();
      const rows = [];
      if (m.action) rows.push(["Action", m.action, true]);
      const risk = [riskText(m.riskLevel), classText(m.actionClass)].filter(Boolean).join(" · ");
      if (risk) rows.push(["Risk", risk]);
      const evidence = summarizeEvidence(m.evidence);
      if (evidence) rows.push(["Verified", evidence]);
      else if (finished && status === "COMPLETED") rows.push(["Verified", "The skill reported a result. No further check was recorded."]);
      if (m.credits) rows.push(["Credits charged", String(m.credits)]);
      if (m.at) rows.push(["Recorded", new Date(m.at).toLocaleString()]);
      if (m.stored) rows.push(["Source", "Read from the stored record of this run"]);
      if (rows.length) this.detailsBody.appendChild(kv(rows));
      this.details.hidden = rows.length === 0;
    }
  }

  /* ---------- Live turn ---------- */

  class LiveTurn {
    constructor(anchor) {
      this.anchor = anchor; // the "thinking" bubble: cards are inserted before it
      this.cards = new Map();
      this.understood = false;
    }

    place(card) {
      const thread = host.conversation;
      if (this.anchor && this.anchor.isConnected && this.anchor.parentNode === thread) thread.insertBefore(card.root, this.anchor);
      else thread.appendChild(card.root);
      host.scroll();
    }

    cardFor(id, skillId) {
      let card = this.cards.get(id);
      if (!card) {
        card = new Card({ id, skillId, status: "RUNNING" });
        this.cards.set(id, card);
        this.place(card);
      }
      return card;
    }

    /** A `progress` event from the stream. Returns true when it was a tool event. */
    progress(data) {
      if (!data || !data.toolCallId) return false;
      if (data.type === "tool_started") {
        const card = this.cardFor(data.toolCallId, data.skillId);
        card.patch({ skillName: data.skillName, riskLevel: data.riskLevel, actionClass: data.actionClass, inputPreview: data.inputPreview });
        card.stage("understand", "done");
        card.stage("skill", "done", [riskText(data.riskLevel), classText(data.actionClass)].filter(Boolean).join(" · "));
        return true;
      }
      if (data.type === "tool_stage") {
        const card = this.cardFor(data.toolCallId, data.skillId);
        switch (data.stage) {
          case "permitted": card.stage("permission", "active", "Permission granted"); break;
          case "entitled": card.stage("permission", "done", "Your plan and credits allow it"); break;
          case "prepared": card.patch({ action: data.action }); card.stage("prepare", "done"); break;
          case "confirmed": card.stage("confirm", "done", "You approved this exact action"); break;
          case "executing": card.stage("execute", "active", "Running now"); break;
          case "verifying": card.stage("execute", "done"); card.stage("verify", "active", "Checking what it returned"); break;
          default: break;
        }
        return true;
      }
      if (data.type === "tool_finished") {
        const card = this.cardFor(data.toolCallId, data.skillId);
        card.patch({ status: data.status, summary: data.summary || card.model.summary });
        this.settle(card, data.status);
        return true;
      }
      return false;
    }

    /** Marks the stages from the final status. Used live and when the result arrives with `done`. */
    settle(card, status) {
      const stages = card.model.stages;
      const active = STAGE_ORDER.filter((key) => (stages.get(key) || {}).state === "active");
      if (status === "COMPLETED") {
        for (const key of active) card.stage(key, "done");
        card.stage("verify", "done", summarizeEvidence(card.model.evidence) || "The skill returned a result");
        card.stage("result", "done", "Completed");
      } else if (status === "CONFIRMATION_REQUIRED") {
        card.stage("confirm", "waiting", "Nothing has been done yet. It needs your confirmation.");
      } else {
        for (const key of active) card.stage(key, "failed");
        if (!active.length) card.stage("result", "failed", STATUS_LABEL[status] || status);
        else card.stage("result", "failed", STATUS_LABEL[status] || status);
      }
    }

    /** The turn's final tool results (the `done` event): complete every card with its real output. */
    finalize(toolCalls, beforeNode) {
      const nodes = [];
      for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
        const model = fromToolCall(call);
        let card = this.cards.get(model.id);
        const created = !card;
        if (!card) {
          card = new Card({ id: model.id, skillId: model.skillId });
          this.cards.set(model.id, card);
          card.stage("skill", "done");
        }
        card.patch({ ...model, stages: card.model.stages, skillName: card.model.skillName });
        // A run whose stages were never streamed (a replayed turn) still passed them if it completed.
        if (created && model.status === "COMPLETED") {
          card.stage("permission", "done", "Permission and plan allowed it");
        }
        this.settle(card, model.status);
        if (model.confirmation) {
          card.patch({ action: model.confirmation.action, riskLevel: model.confirmation.riskLevel, actionClass: model.confirmation.actionClass, skillName: model.confirmation.skillName });
          card.stage("prepare", "done");
          card.confirmBox.replaceChildren();
          host.renderConfirmation(model.confirmation, card.confirmBox, {
            onResolved: (body) => {
              // The approved action ran (or was declined) on the server: the card shows exactly what it answered.
              const outcome = (body && body.outcome) || {};
              const ok = outcome.kind === "success";
              card.stage("confirm", outcome.kind === "confirmation_declined" ? "failed" : "done", outcome.kind === "confirmation_declined" ? "You declined" : "You confirmed");
              card.patch({
                status: (body && body.result && body.result.status) || card.model.status,
                summary: (body && body.message) || card.model.summary,
                output: ok ? outcome.result && outcome.result.output : null,
                evidence: body && body.result ? body.result.verificationEvidence : null,
                credits: ok ? outcome.chargedCredits || 0 : 0,
                confirmation: null,
              });
              card.stage("result", ok ? "done" : "failed", ok ? "Completed" : STATUS_LABEL[(body && body.result && body.result.status) || "FAILED"]);
              if (host.reply) host.reply((body && body.message) || "Done.");
            },
          });
          card.confirmBox.hidden = false;
        }
        if (created) {
          if (beforeNode && beforeNode.isConnected) beforeNode.parentNode.insertBefore(card.root, beforeNode);
          else host.conversation.appendChild(card.root);
        }
        nodes.push(card.root);
      }
      host.scroll();
      return nodes;
    }

    /** The turn ended without a result for these cards (stopped, failed): nothing is left looking busy. */
    abandon(reason) {
      for (const card of this.cards.values()) {
        if (card.model.status === "RUNNING") {
          card.patch({ status: "FAILED", summary: reason || "This run didn't finish." });
          this.settle(card, "FAILED");
        }
      }
    }
  }

  /* ---------- Stored runs (after a reload) ---------- */

  function renderStored(rows) {
    const cards = [];
    // A request for approval that was later approved is shown once, as the run it became.
    const ran = new Set(rows.filter((r) => r.confirmationId && r.status !== "CONFIRMATION_REQUIRED").map((r) => r.confirmationId));
    for (const row of rows) {
      if (row.status === "CONFIRMATION_REQUIRED" && row.confirmationId && ran.has(row.confirmationId)) continue;
      const model = fromExecution(row);
      const card = new Card(model);
      card.stage("skill", "done");
      if (model.status === "COMPLETED") {
        card.stage("permission", "done", "Permission and plan allowed it");
        card.stage("verify", "done", summarizeEvidence(model.evidence) || "The skill returned a result");
        card.stage("result", "done", "Completed");
      } else if (model.status === "CONFIRMATION_REQUIRED") {
        card.stage("confirm", "waiting", "It was waiting for a confirmation when this chat was saved. Open Activity or the project to see if it is still pending.");
      } else {
        card.stage("result", "failed", STATUS_LABEL[model.status] || model.status);
      }
      cards.push({ at: new Date(row.createdAt).getTime(), node: card.root });
    }
    return cards;
  }

  window.ZarvisExec = {
    init(hooks) {
      host = hooks;
    },
    startTurn(anchor) {
      return new LiveTurn(anchor);
    },
    renderStored,
    renderOutput,
    renderCiChecks,
    observations,
  };
})();
