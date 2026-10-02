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
