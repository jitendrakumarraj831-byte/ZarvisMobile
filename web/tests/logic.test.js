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
  assert.ok(html.includes('<pre class="reply-code" data-lang="js"><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>'));
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
  assert.equal(L.goShortcutTarget("z"), null);
  assert.equal(L.goShortcutTarget(undefined), null);
});

test("breadcrumbs: Home is the root, sub-pages link back through their parent", () => {
  assert.deepEqual(L.breadcrumbs({ view: "home" }), []);
  assert.deepEqual(L.breadcrumbs({ view: "activity" }), [{ label: "Home", view: "home" }, { label: "Activity" }]);
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
  assert.deepEqual(L.parseGoTarget("settings"), { view: "settings", settingsPage: null });
  assert.deepEqual(L.parseGoTarget("settings:permissions"), { view: "settings", settingsPage: "permissions" });
  assert.deepEqual(L.parseGoTarget("history"), { action: "history" });
  for (const bad of ["", null, undefined, "nowhere", "plans:extra", "settings:a:b", "settings:../x", "history:1", "feature", "Plans"]) {
    assert.equal(L.parseGoTarget(bad), null, String(bad));
  }
});

test("moved addresses still open the right page", () => {
  assert.deepEqual(L.resolveLegacyRoute("settings", "subscription"), { view: "plans", sub: undefined });
  assert.deepEqual(L.resolveLegacyRoute("settings", "data"), { view: "settings", sub: "privacy" });
  assert.deepEqual(L.resolveLegacyRoute("settings", "voice"), { view: "settings", sub: "voice" });
  assert.deepEqual(L.resolveLegacyRoute("plans", undefined), { view: "plans", sub: undefined });
});
