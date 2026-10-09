"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../logic.js");
const registry = require("../../shared/capability-registry.json");

test("only explicit session codes end a session; everything else is 'unreachable'", () => {
  assert.equal(L.classifyRefreshFailure(401, "session_revoked"), "session_ended");
  assert.equal(L.classifyRefreshFailure(401, "refresh_token_reused"), "session_ended");
  assert.equal(L.classifyRefreshFailure(401, "session_invalid"), "session_ended");
  assert.equal(L.classifyRefreshFailure(401, undefined), "unreachable");
  assert.equal(L.classifyRefreshFailure(500, "session_revoked"), "unreachable");
  assert.equal(L.classifyRefreshFailure(0, undefined), "unreachable");
});

test("SSE parser returns complete events, keeps the partial remainder, drops malformed frames", () => {
  const { events, rest } = L.parseSseEvents('event: meta\ndata: {"conversationId":"c1"}\n\nevent: progress\ndata: {bad json}\n\nevent: delta\ndata: {"te');
  assert.deepEqual(events, [{ event: "meta", data: { conversationId: "c1" } }]);
  assert.equal(rest, 'event: delta\ndata: {"te');
  const flushed = L.parseSseEvents('event: done\ndata: {"message":"hi"}', true);
  assert.deepEqual(flushed.events, [{ event: "done", data: { message: "hi" } }]);
});

test("reply HTML escapes everything before applying the markdown subset", () => {
  const html = L.formatReplyHtml('<img src=x onerror=alert(1)> **bold** `code`\n- item <b>');
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<li>item &lt;b&gt;</li>"));
});

test("ordered segments play in request order even if a later one downloads first", async () => {
  const order = [];
  const segments = L.createOrderedSegments();
  const first = segments.next();
  const second = segments.next();
  const secondRun = second.ready.then(() => {
    order.push("second");
    second.done();
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(order, [], "second must wait for first");
  await first.ready;
  order.push("first");
  first.done();
  await secondRun;
  assert.deepEqual(order, ["first", "second"]);
});

test("web permission summaries are truthful for every capability in the shared registry", () => {
  assert.equal(registry.capabilities.length, 16);
  for (const capability of registry.capabilities) {
    const summary = L.webAccessSummary(capability, "prompt");
    assert.ok(summary.length > 0);
    if (capability.platforms.web.status === "UNSUPPORTED") {
      // The exact registry reason is shown, plus where it does work.
      assert.ok(summary.startsWith(capability.platforms.web.note), capability.id);
      assert.match(summary, /Android app/);
    }
  }
  const mic = registry.capabilities.find((c) => c.id === "microphone");
  assert.match(L.webAccessSummary(mic, "denied"), /Blocked/);
  assert.match(L.webAccessSummary(mic, "granted"), /Allowed/);
});

test("status labels cover every blueprint status", () => {
  for (const s of ["COMPLETED", "DENIED", "PERMISSION_REQUIRED", "USER_ACTION_REQUIRED", "CONFIRMATION_REQUIRED", "UNSUPPORTED", "FAILED"]) {
    assert.notEqual(L.toolStatusLabel(s), "Unknown");
  }
  for (const s of ["WORKING", "PARTIAL", "PLANNED", "UNSUPPORTED"]) assert.notEqual(L.capabilityStatusLabel(s), "Unknown");
});

test("reply formatting: headings, numbered lists, fenced code and safe links", () => {
  const html = L.formatReplyHtml("## Plan\n1. first\n2. second\n```js\nconst a = \"<b>\";\n```\nSee [docs](https://ex.com/a?b=1&c=2) or https://x.org/p.\n[bad](javascript:alert(1))");
  assert.ok(html.includes('<div class="reply-heading reply-h2">Plan</div>'));
  assert.ok(html.includes('<ol class="reply-list reply-ol"><li>first</li><li>second</li></ol>'));
  // The code is coloured now; what must never change is the text and that it stays escaped.
  const block = html.match(/<pre class="reply-code" data-lang="js"><code>([\s\S]*?)<\/code><\/pre>/);
  assert.ok(block, "a js code block");
  assert.equal(block[1].replace(/<\/?span[^>]*>/g, ""), "const a = &quot;&lt;b&gt;&quot;;");
  assert.ok(!block[1].includes("<b>"));
  assert.ok(html.includes('<a href="https://ex.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a>'));
  assert.ok(html.includes('<a href="https://x.org/p" target="_blank" rel="noopener noreferrer">https://x.org/p</a>.'));
  assert.ok(!html.includes('href="javascript'));
});

test("reply formatting: an unclosed fence (mid-stream) renders as code, and quotes never break out of href", () => {
  const partial = L.formatReplyHtml("Here:\n```\nline 1\nline 2");
  assert.ok(partial.endsWith("<pre class=\"reply-code\"><code>line 1\nline 2</code></pre>"));
  const hostile = L.formatReplyHtml('go https://a.b/"onmouseover=alert(1) now');
  assert.ok(hostile.includes('<a href="https://a.b/" target="_blank" rel="noopener noreferrer">https://a.b/</a>&quot;onmouseover=alert(1)'));
  assert.ok(!/<a [^>]*onmouseover/.test(hostile));
});

test("reply HTML renders italic and horizontal rules the way Gemini writes them", () => {
  const html = L.formatReplyHtml(
    "**4. Phone & App Features** *(ZARVIS App ke zariye)*\n---\nCompare (jaise *iPhone vs Samsung*).\n***\n*Tip: replace the placeholders*\n- * not italic\n2 * 3 * 4 and snake_case_name stay literal",
  );
  assert.match(html, /<strong>4\. Phone &amp; App Features<\/strong> <em>\(ZARVIS App ke zariye\)<\/em>/);
  assert.match(html, /\(jaise <em>iPhone vs Samsung<\/em>\)/);
  assert.match(html, /<em>Tip: replace the placeholders<\/em>/);
  assert.equal((html.match(/<hr class="reply-rule">/g) || []).length, 2);
  assert.match(html, /<li>\* not italic<\/li>/);
  assert.match(html, /2 \* 3 \* 4 and snake_case_name stay literal/);
  assert.doesNotMatch(html, /<em>(?:\s| 3 )/);
});

test("a failed turn shows quota/rate-limit copy only for those structured errors", () => {
  assert.equal(L.turnFailureKind({ type: "AI_QUOTA_EXCEEDED", retryable: false }), "aiQuota");
  assert.equal(L.turnFailureKind({ code: "AI_QUOTA_EXCEEDED" }), "aiQuota");
  assert.equal(L.turnFailureKind({ code: "AI_RATE_LIMITED", retryAfterMs: 4000 }), "aiBusy");
  assert.equal(L.turnFailureKind({ code: "rate_limited" }), "aiBusy");
  assert.equal(L.turnFailureKind({ error: "The request could not be completed.", retryable: true }), "bootError");
  assert.equal(L.turnFailureKind(undefined), "bootError");
});

test("turn failures: in-progress duplicates and oversized messages get their own honest copy", () => {
  assert.equal(L.turnFailureKind({ code: "turn_in_progress" }), "turnBusy");
  assert.equal(L.turnFailureKind({ code: "payload_too_large" }), "tooLarge");
  assert.equal(L.turnFailureKind({ code: "AI_QUOTA_EXCEEDED" }), "aiQuota");
  assert.equal(L.turnFailureKind(null), "bootError");
});

test("clientTurnId: unique per call, accepted by the backend's key format", () => {
  const ids = new Set(Array.from({ length: 50 }, () => L.createClientTurnId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,100}$/);
  // Browsers without crypto.randomUUID (older Safari, insecure origins) still get a valid key.
  const fallback = L.createClientTurnId({ getRandomValues: (a) => a.fill(171) });
  assert.match(fallback, /^[A-Za-z0-9_-]{8,100}$/);
});

test("?api= can only point at this origin: tokens are never sent to a host from a link", () => {
  const o = "https://zarvismobile.com";
  assert.equal(L.resolveApiBase("", o), o + "/api/v1");
  assert.equal(L.resolveApiBase("?api=/api/v1/", o), o + "/api/v1");
  assert.equal(L.resolveApiBase("?api=https://zarvismobile.com/api/v2", o), o + "/api/v2");
  assert.equal(L.resolveApiBase("?api=https://attacker.example/api/v1", o), o + "/api/v1");
  assert.equal(L.resolveApiBase("?api=//attacker.example/api/v1", o), o + "/api/v1");
  assert.equal(L.resolveApiBase("?api=https://zarvismobile.com.attacker.example/api", o), o + "/api/v1");
  assert.equal(L.resolveApiBase("?api=javascript:alert(1)", o), o + "/api/v1");
});

// ---- Chat page: chat list, day labels, slash commands, refine prompts, export, navigation ----

test("a chat title is the first line of the first message, tidy and bounded", () => {
  assert.equal(L.deriveChatTitle("  Plan my launch week\nwith details"), "Plan my launch week");
  assert.equal(L.deriveChatTitle("## **Bold** `code` heading"), "Bold code heading");
  assert.equal(L.deriveChatTitle(""), "New chat");
  assert.equal(L.deriveChatTitle(null), "New chat");
  const long = L.deriveChatTitle("x".repeat(200));
  assert.equal(Array.from(long).length, 48);
  assert.ok(long.endsWith("…"));
  assert.equal(L.deriveChatTitle(long), long, "a derived title stays the same when derived again");
  // Devanagari and emoji are cut on whole characters, never in the middle of one.
  assert.doesNotMatch(L.deriveChatTitle("😀".repeat(60)), /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test("the stored chat list is read defensively", () => {
  assert.deepEqual(L.parseChatIndex("not json"), []);
  assert.deepEqual(L.parseChatIndex('{"a":1}'), []);
  const parsed = L.parseChatIndex(JSON.stringify([
    { id: "a", title: "Older", updatedAt: 1 },
    { id: "b", title: "Newer", updatedAt: 2 },
    { id: "b", title: "Duplicate", updatedAt: 3 },
    { id: "bad id!", title: "x", updatedAt: 4 },
    { id: "c", title: "No time" },
    null,
  ]));
  assert.deepEqual(parsed.map((chat) => chat.id), ["b", "a"]);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: "c" + i, title: "t", updatedAt: i }));
  assert.equal(L.parseChatIndex(JSON.stringify(many)).length, L.CHAT_INDEX_MAX);
});

test("upsert keeps one entry per chat, newest first, and only retitles when given a title", () => {
  let list = L.upsertChat([], { id: "a", title: "First chat", updatedAt: 10 });
  list = L.upsertChat(list, { id: "b", title: "Second chat", updatedAt: 20 });
  assert.deepEqual(list.map((chat) => chat.id), ["b", "a"]);
  list = L.upsertChat(list, { id: "a", updatedAt: 30 });
  assert.deepEqual(list.map((chat) => [chat.id, chat.title]), [["a", "First chat"], ["b", "Second chat"]]);
  list = L.upsertChat(list, { id: "a", title: "Renamed", updatedAt: 31 });
  assert.equal(list[0].title, "Renamed");
  assert.equal(L.upsertChat([], { id: "z", updatedAt: 1 })[0].title, "New chat");
  assert.deepEqual(L.removeChat(list, "a").map((chat) => chat.id), ["b"]);
  assert.deepEqual(L.removeChat(list, "missing").length, 2);
});

test("server chats are merged into the browser list without losing or resurrecting anything", () => {
  const local = [
    { id: "a", title: "Trip plan", updatedAt: 100 },
    { id: "b", title: "New chat", updatedAt: 50 },
    { id: "only-here", title: "Just started", updatedAt: 400 },
  ];
  const server = [
    { id: "a", title: "something older the server named it", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: new Date(300).toISOString() },
    { id: "b", title: "Tax questions", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: new Date(40).toISOString() },
    { id: "new-device", title: "From my phone", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: new Date(200).toISOString() },
    { id: "removed", title: "I deleted this", createdAt: "1970-01-01T00:00:00.000Z", updatedAt: new Date(500).toISOString() },
    { id: "bad time", title: "x", updatedAt: "not a date" },
    { id: "../etc", title: "x", updatedAt: new Date(1).toISOString() },
    null,
  ];
  const merged = L.mergeServerChats(local, server, ["removed"]);
  assert.deepEqual(merged.map((chat) => chat.id), ["only-here", "a", "new-device", "b"]);
  const byId = Object.fromEntries(merged.map((chat) => [chat.id, chat]));
  assert.equal(byId.a.title, "Trip plan"); // a title already shown is not replaced…
  assert.equal(byId.a.updatedAt, 300); // …but the newer time wins
  assert.equal(byId.b.title, "Tax questions"); // the placeholder takes the server's name
  assert.equal(byId.b.updatedAt, 50); // and the older server time does not move it back
  assert.equal(byId["new-device"].title, "From my phone");
  // A hidden chat the browser still has stays out too, and junk input is harmless.
  assert.deepEqual(L.mergeServerChats(local, [], ["a"]).map((chat) => chat.id), ["only-here", "b"]);
  assert.deepEqual(L.mergeServerChats(local, null).length, 3);
  assert.deepEqual(L.mergeServerChats([], undefined), []);
});

test("server chats are capped like any other chat list", () => {
  const server = Array.from({ length: L.CHAT_INDEX_MAX + 20 }, (_, i) => ({ id: "c" + i, title: "Chat " + i, updatedAt: new Date(1000 + i).toISOString() }));
  const merged = L.mergeServerChats([], server);
  assert.equal(merged.length, L.CHAT_INDEX_MAX);
  assert.equal(merged[0].id, "c" + (L.CHAT_INDEX_MAX + 19)); // newest kept
});

test("hidden chat ids are validated, de-duplicated and bounded", () => {
  assert.deepEqual(L.parseHiddenChats("not json"), []);
  assert.deepEqual(L.parseHiddenChats('{"a":1}'), []);
  assert.deepEqual(L.parseHiddenChats('["a",5,"b c","ok-1"]'), ["a", "ok-1"]);
  assert.deepEqual(L.hideChat(["a", "b"], "a"), ["b", "a"]);
  let hidden = [];
  for (let i = 0; i < 300; i++) hidden = L.hideChat(hidden, "id" + i);
  assert.equal(hidden.length, 200);
  assert.equal(hidden[199], "id299");
});

test("chats are searchable by title", () => {
  const list = [{ id: "a", title: "Launch plan", updatedAt: 2 }, { id: "b", title: "Recipe ideas", updatedAt: 1 }];
  assert.deepEqual(L.filterChats(list, " LAUNCH ").map((chat) => chat.id), ["a"]);
  assert.equal(L.filterChats(list, "").length, 2);
  assert.equal(L.filterChats(list, "zzz").length, 0);
});

test("days are calendar days: today, yesterday, this week, older", () => {
  const now = new Date(2026, 9, 8, 0, 30).getTime(); // 8 Oct 2026, half past midnight
  const at = (day, hour = 12) => new Date(2026, 9, day, hour).getTime();
  assert.equal(L.dayBucket(at(8, 0), now), "today");
  assert.equal(L.dayBucket(at(7, 23), now), "yesterday"); // an hour and a half ago, but yesterday
  assert.equal(L.dayBucket(at(3), now), "week");
  assert.equal(L.dayBucket(at(1), now), "older");
  assert.equal(L.dayLabel(at(8), now), "Today");
  assert.equal(L.dayLabel(at(7), now), "Yesterday");
  assert.match(L.dayLabel(at(1), now, "en-IN"), /2026/);
  assert.notEqual(L.dayKey(at(7)), L.dayKey(at(8)));
  assert.equal(L.dayKey(at(8, 1)), L.dayKey(at(8, 23)));
  const groups = L.groupChatsByDay([
    { id: "o", title: "o", updatedAt: at(1) },
    { id: "t", title: "t", updatedAt: at(8, 0) },
    { id: "y", title: "y", updatedAt: at(7) },
    { id: "t2", title: "t2", updatedAt: at(8, 0) - 1000 * 60 * 60 * 24 + 1000 * 60 * 60 * 23 },
  ], now);
  assert.deepEqual(groups.map((group) => group.label), ["Today", "Yesterday", "Older"]);
  assert.deepEqual(groups[0].items.map((chat) => chat.id), ["t"]);
});

test("the slash menu appears only for '/' plus a command-name prefix", () => {
  assert.equal(L.matchSlashCommands("/").length, L.SLASH_COMMANDS.length);
  assert.deepEqual(L.matchSlashCommands("/res").map((command) => command.name), ["research"]);
  assert.equal(L.matchSlashCommands("/RES")[0].name, "research");
  assert.equal(L.matchSlashCommands("hello /res").length, 0);
  assert.equal(L.matchSlashCommands("/research something").length, 0, "typing past the command closes the menu");
  assert.equal(L.matchSlashCommands("").length, 0);
  assert.equal(L.matchSlashCommands("/zzzz").length, 0);
  // Names that merely contain the text come after the ones that start with it.
  const names = L.matchSlashCommands("/e").map((command) => command.name);
  assert.ok(names.indexOf("explain") < names.indexOf("research"));
});

test("every slash command is either a prompt to edit or a known action", () => {
  const actions = new Set(["attach", "voice", "new", "history", "export", "shortcuts"]);
  const names = new Set();
  for (const command of L.SLASH_COMMANDS) {
    assert.match(command.name, /^[a-z]+$/);
    assert.ok(!names.has(command.name), "duplicate command " + command.name);
    names.add(command.name);
    if (command.kind === "prompt") assert.ok(command.prompt.endsWith(" ") || command.prompt.endsWith(":"), command.name);
    else assert.ok(actions.has(command.action), "unknown action for " + command.name);
    assert.ok(command.label && command.hint && command.icon);
  }
});

test("refine actions: five follow-ups, with the last one switching to the other language", () => {
  const en = L.refineActions("en");
  const hi = L.refineActions("hi");
  assert.equal(en.length, 5);
  assert.equal(en[4].id, "hindi");
  assert.equal(hi[4].id, "english");
  assert.deepEqual(en.slice(0, 4), hi.slice(0, 4));
  for (const action of en) assert.match(action.prompt, /last answer/);
});

test("export keeps the whole conversation, in order, and names a safe file", () => {
  const messages = [
    { role: "user", text: "Plan my week", time: "9:30 am" },
    { role: "assistant", text: "## Monday\n- Write\n\n\n\n- Review", time: "9:31 am" },
  ];
  const md = L.chatToMarkdown(messages, { title: "Weekly plan", exportedAt: "8 Oct 2026" });
  assert.ok(md.startsWith("# Weekly plan\n\n_Exported 8 Oct 2026_\n\n**You** · 9:30 am\n\nPlan my week\n\n**ZARVIS** · 9:31 am\n\n## Monday"));
  assert.ok(!/\n{3,}/.test(md), "no runs of blank lines");
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
  const text = L.chatToText(messages, { title: "Weekly plan" });
  assert.ok(text.startsWith("Weekly plan\n\nYou (9:30 am):\nPlan my week\n\nZARVIS (9:31 am):\n"));
  assert.equal(L.chatToMarkdown([], {}).trim(), "# ZARVIS chat");
  assert.equal(L.exportFileName("Plan: my/launch week?!"), "plan-my-launch-week.md");
  assert.equal(L.exportFileName("???"), "zarvis-chat.md");
  assert.equal(L.exportFileName("नमस्ते दुनिया", "txt"), "नमस्ते-दुनिया.txt");
  assert.ok(L.exportFileName("a".repeat(200)).length <= 43);
});

test("go-to shortcuts only point at real pages", () => {
  for (const key of Object.keys(L.GO_SHORTCUTS)) assert.ok(L.breadcrumbs({ view: L.goShortcutTarget(key) }) !== undefined);
  assert.equal(L.goShortcutTarget("C"), "chat");
  assert.equal(L.goShortcutTarget("t"), "tasks");
  assert.equal(L.goShortcutTarget("a"), "activity");
  assert.equal(L.goShortcutTarget("z"), null);
  assert.equal(L.goShortcutTarget(undefined), null);
});

test("breadcrumbs: Home is the root, sub-pages link back through their parent", () => {
  assert.deepEqual(L.breadcrumbs({ view: "home" }), []);
  assert.deepEqual(L.breadcrumbs({ view: "activity" }), [{ label: "Home", view: "home" }, { label: "Activity" }]);
  assert.deepEqual(L.breadcrumbs({ view: "tasks" }), [{ label: "Home", view: "home" }, { label: "Tasks" }]);
  assert.deepEqual(L.breadcrumbs({ view: "settings", settingsTitle: "Voice" }), [
    { label: "Home", view: "home" },
    { label: "Settings", view: "settings", closeSubpage: true },
    { label: "Voice" },
  ]);
  assert.deepEqual(L.breadcrumbs({ view: "settings" }), [{ label: "Home", view: "home" }, { label: "Settings" }]);
  assert.deepEqual(L.breadcrumbs({ view: "feature", featureTitle: "Research" }), [
    { label: "Home", view: "home" },
    { label: "Capabilities", view: "capabilities" },
    { label: "Research" },
  ]);
});

test("in-text links only point at pages that exist", () => {
  assert.deepEqual(L.parseGoTarget("plans"), { view: "plans" });
  assert.deepEqual(L.parseGoTarget("activity"), { view: "activity" });
  assert.deepEqual(L.parseGoTarget("tasks"), { view: "work", workTab: "tasks" }); // Tasks live inside Work now
  assert.deepEqual(L.parseGoTarget("work"), { view: "work" });
  assert.deepEqual(L.parseGoTarget("work:files"), { view: "work", workTab: "files" });
  assert.deepEqual(L.parseGoTarget("agents"), { view: "agents" });
  assert.deepEqual(L.parseGoTarget("agents:research"), { view: "agents", agentId: "research" });
  assert.deepEqual(L.parseGoTarget("settings"), { view: "settings", settingsPage: null });
  assert.deepEqual(L.parseGoTarget("settings:permissions"), { view: "settings", settingsPage: "permissions" });
  assert.deepEqual(L.parseGoTarget("history"), { action: "history" });
  for (const bad of ["", null, undefined, "nowhere", "plans:extra", "settings:a:b", "settings:../x", "history:1", "feature", "Plans", "work:nowhere", "tasks:1", "agents:../x", "agents:a:b", "work:files:x"]) {
    assert.equal(L.parseGoTarget(bad), null, String(bad));
  }
});

test("moved addresses still open the right page", () => {
  assert.deepEqual(L.resolveLegacyRoute("settings", "subscription"), { view: "plans", sub: undefined });
  assert.deepEqual(L.resolveLegacyRoute("settings", "data"), { view: "settings", sub: "privacy" });
  assert.deepEqual(L.resolveLegacyRoute("settings", "voice"), { view: "settings", sub: "voice" });
  assert.deepEqual(L.resolveLegacyRoute("plans", undefined), { view: "plans", sub: undefined });
  assert.deepEqual(L.resolveLegacyRoute("tasks", undefined), { view: "work", sub: "tasks" });
  assert.deepEqual(L.resolveLegacyRoute("work", "files"), { view: "work", sub: "files" });
});

test("the trail above Work and Agent pages links back to the section", () => {
  assert.deepEqual(L.breadcrumbs({ view: "work", workTitle: "Files" }), [{ label: "Home", view: "home" }, { label: "Work", view: "work" }, { label: "Files" }]);
  assert.deepEqual(L.breadcrumbs({ view: "agents", agentTitle: "Research agent" }), [{ label: "Home", view: "home" }, { label: "Agents", view: "agents" }, { label: "Research agent" }]);
  assert.deepEqual(L.breadcrumbs({ view: "work" }), [{ label: "Home", view: "home" }, { label: "Work" }]);
  assert.deepEqual(L.breadcrumbs({ view: "plans" }), [{ label: "Home", view: "home" }, { label: "Plans & Usage" }]);
});

test("the go-to shortcuts reach Work and Agents and only pages that exist", () => {
  assert.equal(L.goShortcutTarget("w"), "work");
  assert.equal(L.goShortcutTarget("e"), "agents");
  assert.equal(L.goShortcutTarget("t"), "tasks");
  for (const target of Object.values(L.GO_SHORTCUTS)) assert.ok(L.parseGoTarget(target), target + " is not a page");
});

test("open tasks are counted from the real lifecycle: a failed or finished task is not open", () => {
  const t = (lifecycle) => ({ lifecycle });
  assert.equal(L.openTaskCount([t("QUEUED"), t("RUNNING"), t("WAITING"), t("CONFIRMATION_REQUIRED"), t("BLOCKED"), t("EXECUTING"), t("VERIFYING")]), 7);
  assert.equal(L.openTaskCount([t("COMPLETED"), t("FAILED"), t("CANCELLED")]), 0);
  assert.equal(L.openTaskCount([{ status: "PENDING" }, null, undefined]), 0); // no lifecycle: nothing is assumed
  assert.equal(L.openTaskCount(null), 0);
});

test("feature status words are the four honest ones", () => {
  assert.deepEqual(L.FEATURE_STATUSES, ["WORKING", "PARTIAL", "PLANNED", "UNSUPPORTED"]);
  assert.equal(L.isFeatureStatus("WORKING"), true);
  assert.equal(L.isFeatureStatus("ACTIVE"), false);
  assert.equal(L.isFeatureStatus("working"), false);
});

test("reply formatting: pipe tables become a scrollable, labelled table with alignment, escaped cells and inline markdown", () => {
  const html = L.formatReplyHtml("Prices:\n\n| Item | Qty | Note |\n|:--|:-:|--:|\n| **Tea** | 2 | a \\| b |\n| <b>x</b> | 3 |\n\nDone");
  assert.match(html, /<div class="reply-table-wrap" role="region" tabindex="0" aria-label="Table"><table class="reply-table">/);
  assert.match(html, /<th scope="col">Item<\/th><th scope="col" class="al-c">Qty<\/th><th scope="col" class="al-r">Note<\/th>/);
  assert.match(html, /<td><strong>Tea<\/strong><\/td><td class="al-c">2<\/td><td class="al-r">a \| b<\/td>/);
  // A short row is padded to the header width; HTML in a cell is escaped.
  assert.match(html, /<td>&lt;b&gt;x&lt;\/b&gt;<\/td><td class="al-c">3<\/td><td class="al-r"><\/td>/);
  assert.ok(!html.includes("<b>x"));
  assert.match(html, /<div class="reply-line">Done<\/div>$/);
});

test("reply formatting: a table needs its delimiter row, so a header seen mid-stream is plain text and 'a | b' prose is not a table", () => {
  assert.doesNotMatch(L.formatReplyHtml("| Item | Qty |"), /<table/);
  assert.doesNotMatch(L.formatReplyHtml("Use a | b to choose.\n---"), /<table/);
  // Different cell counts are not a table either.
  assert.doesNotMatch(L.formatReplyHtml("| a | b |\n|---|"), /<table/);
  assert.match(L.formatReplyHtml("| a | b |\n|---|---|"), /<table[^>]*><thead>.*<\/thead><tbody><\/tbody><\/table>/);
});

test("reply formatting: block quotes, deeper headings and strikethrough", () => {
  const html = L.formatReplyHtml("> Note **this**\n>\n> and that\nplain\n#### Small heading\n~~old~~ new, 2 ~ 3 ~ 4");
  assert.match(html, /<blockquote class="reply-quote"><div class="reply-line">Note <strong>this<\/strong><\/div><div class="reply-spacer" aria-hidden="true"><\/div><div class="reply-line">and that<\/div><\/blockquote><div class="reply-line">plain<\/div>/);
  assert.match(html, /<div class="reply-heading reply-h3">Small heading<\/div>/);
  assert.match(html, /<del>old<\/del> new, 2 ~ 3 ~ 4/);
  // A ">" inside a code fence is code, not a quote.
  assert.doesNotMatch(L.formatReplyHtml("```\n> not a quote\n```"), /blockquote/);
  // An unclosed quote at the end of a streaming reply is closed.
  assert.ok(L.formatReplyHtml("> still typing").endsWith("</blockquote>"));
});

test("syntax highlighting colours comments, strings, numbers, keywords and literals, and escapes everything it emits", () => {
  const js = L.highlightCode('const n = 42; // answer\nlet s = "<img onerror=x>"; return null', "ts");
  assert.match(js, /<span class="tok-kw">const<\/span> n = <span class="tok-num">42<\/span>; <span class="tok-com">\/\/ answer<\/span>/);
  assert.match(js, /<span class="tok-str">&quot;&lt;img onerror=x&gt;&quot;<\/span>/);
  assert.match(js, /<span class="tok-lit">null<\/span>/);
  assert.ok(!js.includes("<img"));
  // Identifiers that merely contain a keyword are left alone.
  assert.doesNotMatch(L.highlightCode("constant forEach iffy", "js"), /tok-kw/);
  const py = L.highlightCode('def f(x):\n    """doc"""\n    return None  # done', "python");
  assert.match(py, /<span class="tok-kw">def<\/span> f/);
  assert.match(py, /<span class="tok-str">&quot;&quot;&quot;doc&quot;&quot;&quot;<\/span>/);
  assert.match(py, /<span class="tok-lit">None<\/span>/);
  assert.match(py, /<span class="tok-com"># done<\/span>/);
  const json = L.highlightCode('{"name": "zarvis", "n": -1.5e3, "ok": true}', "json");
  assert.match(json, /<span class="tok-attr">&quot;name&quot;<\/span>: <span class="tok-str">&quot;zarvis&quot;<\/span>/);
  assert.match(json, /<span class="tok-num">-1\.5e3<\/span>/);
  assert.match(json, /<span class="tok-lit">true<\/span>/);
  const sh = L.highlightCode('export PATH="$HOME/bin:$PATH" # set', "bash");
  assert.match(sh, /<span class="tok-kw">export<\/span> PATH=<span class="tok-str">&quot;\$HOME\/bin:\$PATH&quot;<\/span> <span class="tok-com"># set<\/span>/);
  assert.match(L.highlightCode("SELECT id FROM t WHERE x = 'a''b' -- c", "sql"), /<span class="tok-kw">SELECT<\/span> id <span class="tok-kw">FROM<\/span> t <span class="tok-kw">WHERE<\/span> x = <span class="tok-str">&#39;a&#39;&#39;b&#39;<\/span> <span class="tok-com">-- c<\/span>/);
  const css = L.highlightCode("@media (min-width: 700px) { a:hover { color: #fff; margin: 0 8px } }", "css");
  assert.match(css, /<span class="tok-kw">@media<\/span>/);
  assert.match(css, /<span class="tok-attr">color<\/span>: <span class="tok-num">#fff<\/span>/);
  assert.match(css, /<span class="tok-num">8px<\/span>/);
  const html = L.highlightCode('<a href="x" data-a=\'b\'>hi</a><!-- c -->', "html");
  assert.match(html, /<span class="tok-tag">&lt;a<\/span> <span class="tok-attr">href<\/span>=<span class="tok-str">&quot;x&quot;<\/span>/);
  assert.match(html, /<span class="tok-tag">&gt;<\/span>hi<span class="tok-tag">&lt;\/a<\/span><span class="tok-tag">&gt;<\/span>/);
  assert.match(html, /<span class="tok-com">&lt;!-- c --&gt;<\/span>/);
});

test("syntax highlighting never changes the text, only wraps it; unknown languages and huge blocks stay plain", () => {
  const samples = [
    ["js", "const a = `x ${y}`; /* unclosed"],
    ["python", "s = 'unterminated\nx = 1"],
    ["json", '{"a": [1, 2, {"b": null}], "c": "unterminated'],
    ["html", "<div class=\"a\"><p>text &amp; more</p><!-- open"],
    ["css", "a { b: c; } /* open"],
    ["sql", "select * from t; -- c"],
    ["shell", "echo $HOME ${X} 'q"],
  ];
  const textOf = (html) => html.replace(/<\/?span[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  for (const [lang, code] of samples) assert.equal(textOf(L.highlightCode(code, lang)), code, lang);
  assert.equal(L.highlightCode("const a = 1 < 2", "cobol"), "const a = 1 &lt; 2");
  assert.equal(L.highlightCode("const a = 1", ""), "const a = 1");
  const big = "const a = 1;\n".repeat(4000);
  assert.ok(!L.highlightCode(big, "js").includes("<span"));
  assert.equal(L.highlightLanguage("TypeScript"), "js");
  assert.equal(L.highlightLanguage("zsh"), "shell");
  assert.equal(L.highlightLanguage("brainfuck"), null);
});

test("a fenced block in a reply is coloured, keeps its language label and its copy text, and an unknown language stays plain", () => {
  const html = L.formatReplyHtml("```python\nprint(\"hi\")  # greet\n```\n```unknownlang\nprint(\"hi\")\n```");
  assert.match(html, /<pre class="reply-code" data-lang="python"><code>print\(<span class="tok-str">&quot;hi&quot;<\/span>\)  <span class="tok-com"># greet<\/span><\/code><\/pre>/);
  assert.match(html, /<pre class="reply-code" data-lang="unknownlang"><code>print\(&quot;hi&quot;\)<\/code><\/pre>/);
});

test("a refused or unanswered payment confirmation never reads as 'payment received'", () => {
  const rejected = L.paymentVerifyOutcome(400, "invalid_signature");
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.tone, "err");
  assert.match(rejected.message, /plan was not changed/);
  assert.equal(L.paymentVerifyOutcome(400, "payment_mismatch").kind, "rejected");
  assert.equal(L.paymentVerifyOutcome(404, "order_not_found").kind, "rejected");
  const pending = L.paymentVerifyOutcome(402, "payment_not_captured");
  assert.equal(pending.kind, "pending");
  assert.equal(pending.tone, "warn");
  assert.ok(pending.polls > rejected.polls, "a bank still processing is worth waiting for; a rejection is not");
  for (const [status, code] of [[0, undefined], [502, "gateway_error"], [504, "gateway_error"], [503, "payments_unavailable"], [500, undefined], [429, undefined]]) {
    const o = L.paymentVerifyOutcome(status, code);
    assert.equal(o.kind, "unreachable", `${status} ${code}`);
    assert.match(o.message, /If you were charged/);
  }
  for (const o of [rejected, pending, L.paymentVerifyOutcome(0)]) assert.doesNotMatch(o.message, /received|successful|thank/i);
});

test("projects: search covers name, goal and description; sorts are stable and never invent a project", () => {
  const mk = (name, goal, openTasks, updatedAt, description = "") => ({ id: name, name, goal, description, counts: { openTasks }, updatedAt });
  const list = [mk("Website relaunch", "Ship the marketing site", 1, "2026-10-01T10:00:00Z"), mk("apple pie", "Bake", 0, "2026-10-03T10:00:00Z", "Grandma's recipe"), mk("Tax filing", "File returns", 3, "2026-10-02T10:00:00Z"), mk("Project 10", "", 0, "2026-09-01T10:00:00Z"), mk("Project 2", "", 0, "2026-09-02T10:00:00Z")];
  assert.deepEqual(L.filterProjects(list).map((p) => p.name), ["apple pie", "Tax filing", "Website relaunch", "Project 2", "Project 10"]);
  assert.deepEqual(L.filterProjects(list, { sort: "name" }).map((p) => p.name), ["apple pie", "Project 2", "Project 10", "Tax filing", "Website relaunch"], "case-insensitive, numbers in order");
  assert.deepEqual(L.filterProjects(list, { sort: "tasks" }).map((p) => p.name).slice(0, 2), ["Tax filing", "Website relaunch"]);
  assert.deepEqual(L.filterProjects(list, { query: "  MARKETING " }).map((p) => p.name), ["Website relaunch"], "goal");
  assert.deepEqual(L.filterProjects(list, { query: "grandma" }).map((p) => p.name), ["apple pie"], "description");
  assert.deepEqual(L.filterProjects(list, { query: "zzz" }), []);
  assert.deepEqual(L.filterProjects(list, { sort: "nonsense" }).map((p) => p.name), L.filterProjects(list).map((p) => p.name), "an unknown sort falls back to most recent");
  assert.equal(list[0].name, "Website relaunch", "the input is not reordered");
  assert.deepEqual(L.filterProjects(null), []);
  assert.deepEqual(L.PROJECT_SORTS.map(([key]) => key), ["recent", "name", "tasks"]);
});

test("tasks: every real lifecycle belongs to exactly one board column, and nothing is flattened or invented", () => {
  const LIFECYCLES = ["QUEUED", "RUNNING", "WAITING", "CONFIRMATION_REQUIRED", "EXECUTING", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED"]; // backend TaskLifecycle
  const keys = L.TASK_GROUPS.map(([key]) => key);
  for (const lifecycle of LIFECYCLES) assert.ok(keys.includes(L.taskGroup({ lifecycle })), lifecycle + " has a column");
  assert.deepEqual(Object.fromEntries(LIFECYCLES.map((l) => [l, L.taskGroup({ lifecycle: l })])), {
    QUEUED: "queued", RUNNING: "running", WAITING: "waiting", CONFIRMATION_REQUIRED: "waiting", EXECUTING: "running", VERIFYING: "running", COMPLETED: "finished", FAILED: "stopped", CANCELLED: "finished", BLOCKED: "stopped",
  });
  // A run that stopped answering is stopped, not "in progress"; a stale state that is not a run stays where it is.
  assert.equal(L.taskGroup({ lifecycle: "EXECUTING", stale: true }), "stopped");
  assert.equal(L.taskGroup({ lifecycle: "QUEUED", stale: true }), "queued");
  // A lifecycle this client has never heard of is shown as such rather than as one of the known states.
  assert.equal(L.taskGroup({ lifecycle: "SOMETHING_NEW" }), "unknown");
  assert.equal(L.taskGroup(null), "unknown");
  const tasks = [...LIFECYCLES.map((lifecycle, i) => ({ id: lifecycle, lifecycle, goal: "task " + lifecycle, createdAt: "2026-10-0" + (i % 9 + 1) + "T00:00:00Z", steps: [] })), { id: "x", lifecycle: "SOMETHING_NEW", goal: "mystery", steps: [] }];
  const board = L.taskBoard(tasks);
  assert.deepEqual(board.map((c) => c.key), [...keys, "unknown"]);
  assert.equal(board.reduce((n, c) => n + c.tasks.length, 0), tasks.length, "every task is on the board once");
  assert.deepEqual(board.find((c) => c.key === "unknown").tasks.map((t) => t.id), ["x"]);
  assert.equal(L.taskBoard(tasks.slice(0, 10)).length, keys.length, "no Other column when there is nothing unknown");
  assert.deepEqual(L.taskBoard([]).map((c) => c.tasks.length), [0, 0, 0, 0, 0], "an empty board still has its columns");
});

test("tasks: filters, search and sort work on the server's own words; counts match what each filter shows", () => {
  const mk = (id, lifecycle, goal, createdAt, extra = {}) => ({ id, lifecycle, goal, createdAt, updatedAt: createdAt, steps: [], ...extra });
  const tasks = [
    mk("a", "QUEUED", "Prepare the weekly report", "2026-10-01T00:00:00Z", { projectId: "p1", steps: [{ description: "Collect the numbers" }] }),
    mk("b", "EXECUTING", "Renew the domain", "2026-10-02T00:00:00Z"),
    mk("c", "FAILED", "Send invoices", "2026-10-03T00:00:00Z", { error: { message: "SMTP refused the message" } }),
    mk("d", "COMPLETED", "Plan the launch", "2026-10-04T00:00:00Z", { result: { summary: "Launch plan written" } }),
    mk("e", "CANCELLED", "Old idea", "2026-10-05T00:00:00Z"),
    mk("f", "WAITING", "Write the summary", "2026-10-06T00:00:00Z"),
    mk("g", "RUNNING", "Hung run", "2026-10-07T00:00:00Z", { stale: true }),
  ];
  const ids = (list) => list.map((t) => t.id);
  assert.deepEqual(ids(L.filterTasks(tasks)), ["g", "f", "e", "d", "c", "b", "a"], "recently updated first");
  assert.deepEqual(ids(L.filterTasks(tasks, { sort: "oldest" })), ["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { sort: "newest" })), ["g", "f", "e", "d", "c", "b", "a"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { filter: "open", sort: "oldest" })), ["a", "b", "f"], "open = not started, in progress, waiting for you");
  assert.deepEqual(ids(L.filterTasks(tasks, { filter: "stopped", sort: "oldest" })), ["c", "g"], "a stale run is stopped");
  assert.deepEqual(ids(L.filterTasks(tasks, { filter: "finished", sort: "oldest" })), ["d", "e"], "completed and cancelled are history");
  assert.deepEqual(L.taskCounts(tasks), { all: 7, open: 3, stopped: 2, finished: 2 });
  for (const filter of ["all", "open", "stopped", "finished"]) assert.equal(L.filterTasks(tasks, { filter }).length, L.taskCounts(tasks)[filter], filter);
  // Search covers the goal, the steps, the result, the error, the project name and the status wording.
  assert.deepEqual(ids(L.filterTasks(tasks, { query: "COLLECT" })), ["a"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { query: "smtp" })), ["c"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { query: "launch plan written" })), ["d"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { query: "website", projectName: (id) => (id === "p1" ? "Website relaunch" : "") })), ["a"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { query: "queued", label: (l) => (l === "QUEUED" ? "Queued · not started" : l) })), ["a"]);
  assert.deepEqual(ids(L.filterTasks(tasks, { query: "zzz" })), []);
  assert.deepEqual(ids(L.filterTasks(tasks, { filter: "open", query: "report" })), ["a"], "filter and search combine");
  assert.equal(tasks[0].id, "a", "the input is not reordered");
  assert.deepEqual(L.filterTasks(undefined), []);
  assert.deepEqual(L.TASK_FILTERS.map(([k]) => k), ["all", "open", "stopped", "finished"]);
});

test("Home dashboard: slices real lists, never pads them, and only calls an account new when everything was read and is empty", () => {
  const project = (id, updatedAt, status = "ACTIVE") => ({ id, name: id, status, updatedAt, counts: {} });
  const file = (id, createdAt) => ({ id, name: id, createdAt });
  const task = (id, lifecycle, updatedAt) => ({ id, goal: id, lifecycle, updatedAt, createdAt: updatedAt, steps: [] });
  const tool = (id, at, type = "tool") => ({ id, type, title: id, at });
  const d = L.homeDashboard({
    chats: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }],
    projects: [project("old", "2026-09-01T00:00:00Z"), project("new", "2026-10-05T00:00:00Z"), project("gone", "2026-10-09T00:00:00Z", "ARCHIVED"), project("mid", "2026-10-01T00:00:00Z"), project("older", "2026-08-01T00:00:00Z")],
    files: [file("f1", "2026-10-01T00:00:00Z"), file("f2", "2026-10-03T00:00:00Z")],
    tasks: [task("t1", "QUEUED", "2026-10-01T00:00:00Z"), task("t2", "COMPLETED", "2026-10-02T00:00:00Z"), task("t3", "FAILED", "2026-10-03T00:00:00Z"), task("t4", "WAITING", "2026-10-04T00:00:00Z")],
    tools: [tool("a", "2026-10-01T00:00:00Z"), tool("note", "2026-10-09T00:00:00Z", "note"), tool("b", "2026-10-02T00:00:00Z")],
  });
  assert.deepEqual(d.chats.map((c) => c.id), ["c1", "c2", "c3"], "three chats, in the order given");
  assert.deepEqual(d.projects.map((p) => p.id), ["new", "mid", "old"], "recent first; archived and the fourth are left out");
  assert.deepEqual(d.files.map((f) => f.id), ["f2", "f1"], "two files are two files, not padded to three");
  assert.deepEqual(d.tasks.open.map((t) => t.id), ["t4", "t1"], "open tasks only: finished and stopped ones are not offered as work to continue");
  assert.deepEqual(d.tasks.counts, { all: 4, open: 2, stopped: 1, finished: 1 });
  assert.deepEqual(d.tools.map((t) => t.id), ["b", "a"], "tool runs only, newest first");
  assert.equal(d.allKnown, true);
  assert.equal(d.empty, false);

  const none = L.homeDashboard({ chats: [], projects: [], files: [], tasks: [], tools: [] });
  assert.equal(none.empty, true, "everything read and nothing there: a new account");
  assert.equal(L.homeDashboard({ chats: [{ id: "c" }], projects: [], files: [], tasks: [], tools: [] }).empty, false, "one chat is enough to not be new");
  assert.equal(L.homeDashboard({ chats: [], projects: [project("p", "2026-10-01T00:00:00Z", "ARCHIVED")], files: [], tasks: [], tools: [] }).empty, true, "only an archived project: nothing active to show");
  // A source that failed to load is unknown, and unknown is never "empty".
  const partial = L.homeDashboard({ chats: [], projects: [], files: null, tasks: [], tools: [] });
  assert.equal(partial.files, null);
  assert.equal(partial.allKnown, false);
  assert.equal(partial.empty, false, "a failed read must not make the account look new");
  assert.equal(L.homeDashboard().empty, false, "nothing read at all is not 'empty'");
  assert.equal(L.homeDashboard({ limit: 1, chats: [{ id: "a" }, { id: "b" }], projects: [], files: [], tasks: [], tools: [] }).chats.length, 1);
});

test("an entry point is offered only when the build has a skill behind it; unread skills hide nothing", () => {
  const skills = [{ category: "WEB" }, { category: "CREATIVE" }, { category: "DOCUMENTS", upgradeRequired: true }];
  assert.equal(L.entryAvailable(["WEB", "RESEARCH"], skills), true, "one of the categories is enough");
  assert.equal(L.entryAvailable(["BUSINESS"], skills), false);
  assert.equal(L.entryAvailable(["DEVELOPER"], skills), false);
  assert.equal(L.entryAvailable(["DOCUMENTS"], skills), true, "needing an upgrade is still listed");
  assert.equal(L.entryAvailable([], skills), true, "a page link has no skill behind it");
  assert.equal(L.entryAvailable(undefined, skills), true);
  assert.equal(L.entryAvailable(["WEB"], null), true, "skills not read yet: nothing is hidden on a guess");
  assert.equal(L.entryAvailable(["WEB"], []), false, "an empty catalogue offers nothing that needs a skill");
});
