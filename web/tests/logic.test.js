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
