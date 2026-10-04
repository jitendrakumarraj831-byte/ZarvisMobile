#!/usr/bin/env node
/**
 * Live API smoke test for a deployed ZARVIS (Vercel preview or production), the way the web
 * client uses it. Run by .github/workflows/preview-smoke.yml after each successful deployment:
 *
 *   BASE_URL=https://…vercel.app [BYPASS=<Vercel protection bypass>] node scripts/live-smoke.mjs
 *
 * Every check prints PASS, WARN or FAIL. WARN is for an honest provider-side condition that is
 * not a deployment defect (an exhausted AI quota) or for something the model chose not to do;
 * it is never counted as a pass in the reports. Any FAIL exits 1.
 *
 * No token, password or secret is ever printed. The sign-up account this creates is deleted at
 * the end. Gemini cost per run: 1 model answer, 1 web search turn (~3 requests), 1 TTS request.
 */

let BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("BASE_URL is required");
  process.exit(2);
}
const BYPASS = process.env.BYPASS || "";
const results = [];

function report(status, name, detail = "") {
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
  if (status === "WARN" && process.env.GITHUB_ACTIONS) console.log(`::warning::${name}: ${detail}`);
  if (status === "FAIL" && process.env.GITHUB_ACTIONS) console.log(`::error::${name}: ${detail}`);
}

async function call(method, path, { token, body, raw, headers = {}, timeoutMs = 60_000 } = {}) {
  const h = { ...headers };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  const text = method === "HEAD" ? "" : await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, text, json };
}

/** POST /orchestrator/turn-stream; returns the parsed SSE events. */
async function turn(token, utterance, extra = {}) {
  const res = await call("POST", "/api/v1/orchestrator/turn-stream", { token, body: { utterance, locale: "en", history: [], ...extra }, timeoutMs: 120_000 });
  const events = [];
  for (const frame of res.text.split("\n\n")) {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!event) continue;
    let parsed;
    try { parsed = data ? JSON.parse(data) : undefined; } catch { parsed = undefined; }
    events.push({ event, data: parsed });
  }
  return { status: res.status, events, done: events.find((e) => e.event === "done")?.data, error: events.find((e) => e.event === "error")?.data };
}

const quota = (code) => code === "AI_QUOTA_EXCEEDED" || code === "AI_RATE_LIMITED";

/** A one-page PDF whose text is "ZARVIS smoke test" (valid xref offsets computed below). */
function tinyPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // content stream, below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 20 70 Td (ZARVIS smoke test) Tj ET";
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** "www.example.com" and "example.com" are the same site; anything else is not. */
function sameSite(a, b) {
  const strip = (host) => host.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

/**
 * Where a redirect from GET /health points: Vercel's own login (Deployment Protection), the
 * same site's canonical address (e.g. apex -> www, followed once: tokens and the bypass secret
 * are only ever sent to that same site), or somewhere else (reported, never followed).
 */
function classifyRedirect(status, location) {
  if (!location) return { kind: "unknown" };
  let target;
  try { target = new URL(location, BASE + "/health"); } catch { return { kind: "unknown" }; }
  if (/(^|\.)vercel\.com$/i.test(target.hostname) || /sso|login/i.test(target.pathname)) return { kind: "protection", target };
  const base = new URL(BASE);
  const protocolOk = target.protocol === "https:" || base.protocol === "http:";
  if (protocolOk && sameSite(target.hostname, base.hostname) && target.pathname.replace(/\/$/, "") === "/health") {
    return { kind: "canonical", target };
  }
  return { kind: "elsewhere", target };
}

async function main() {
  console.log(`Deployment: ${BASE}`);
  console.log(`Vercel protection bypass secret: ${BYPASS ? "configured" : "not configured"}`);

  // ---- Health ------------------------------------------------------------------------------
  let health = await call("GET", "/health");
  if ([301, 302, 303, 307, 308].includes(health.status)) {
    const location = health.headers.get("location");
    const redirect = classifyRedirect(health.status, location);
    if (redirect.kind === "canonical") {
      const from = BASE;
      BASE = redirect.target.origin;
      console.log(`     ${from} redirects (HTTP ${health.status}) to ${BASE}; testing that address`);
      health = await call("GET", "/health");
    } else if (redirect.kind === "protection") {
      report("FAIL", "reach the API", `Vercel Deployment Protection answered HTTP ${health.status} (redirect to its login); the API was not reached. ${BYPASS ? "The bypass secret was rejected." : "Set the VERCEL_AUTOMATION_BYPASS_SECRET repository secret."}`);
      return;
    } else {
      report("FAIL", "reach the API", `HTTP ${health.status} redirect to ${redirect.target ? redirect.target.href : "(no Location header)"}; not followed (another site or path), so the API was not reached`);
      return;
    }
  }
  if ((health.status === 401 && /vercel/i.test(health.text)) || [301, 302, 303, 307, 308].includes(health.status)) {
    report("FAIL", "reach the API", `Vercel Deployment Protection answered HTTP ${health.status}; the API was not reached. ${BYPASS ? "The bypass secret was rejected." : "Set the VERCEL_AUTOMATION_BYPASS_SECRET repository secret."}`);
    return;
  }
  const h = health.json ?? {};
  console.log(`     health: ${JSON.stringify({ status: h.status, provider: h.provider, aiFallback: h.aiFallback, aiFallbackTools: h.aiFallbackTools, database: h.database, reason: h.reason })}`);
  report(health.status === 200 && h.database !== undefined ? "PASS" : "FAIL", "GET /health", `HTTP ${health.status}`);
  if (h.aiFallback && h.aiFallbackTools === false) {
    // Not a failure: the deployment works as configured. But a fallback that cannot take a chat turn's
    // planner step does nothing for chat when the primary provider is out of quota or down.
    report("WARN", "the AI fallback cannot serve chat turns", "a fallback provider is configured but its model does not declare tool support, so chat turns will not fall back (set OPENROUTER_MODEL_CAPABILITIES=tools for a model that supports tool calling)");
  }
  const provider = h.provider;
  // The providers that can answer a chat turn. Web search needs Gemini's Google Search grounding.
  const liveProvider = provider === "google" ? "Gemini" : provider === "openrouter" ? "OpenRouter" : undefined;

  // ---- Auth lifecycle ----------------------------------------------------------------------
  const guest = await call("POST", "/api/v1/auth/guest");
  report(guest.status === 201 ? "PASS" : "FAIL", "guest session", `HTTP ${guest.status}`);
  if (guest.status !== 201) return;
  const guestToken = guest.json.accessToken;
  const me = await call("GET", "/api/v1/auth/me", { token: guestToken });
  report(me.status === 200 ? "PASS" : "FAIL", "GET /auth/me with the guest token (session persists across instances)", `HTTP ${me.status}`);

  const email = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Smoke-${crypto.randomUUID()}`;
  const signup = await call("POST", "/api/v1/auth/signup", { body: { email, password } });
  report(signup.status === 201 ? "PASS" : "FAIL", "email sign-up", `HTTP ${signup.status}${signup.json?.code ? " " + signup.json.code : ""}`);
  let accountToken;
  if (signup.status === 201) {
    const login = await call("POST", "/api/v1/auth/login", { body: { email, password } });
    report(login.status === 200 ? "PASS" : "FAIL", "email login with the new account", `HTTP ${login.status}`);
    const wrong = await call("POST", "/api/v1/auth/login", { body: { email, password: password + "x" } });
    report(wrong.status === 401 ? "PASS" : "FAIL", "login with a wrong password is refused", `HTTP ${wrong.status}`);
    if (login.status === 200) {
      const refreshed = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: login.json.refreshToken } });
      report(refreshed.status === 200 && refreshed.json?.refreshToken !== login.json.refreshToken ? "PASS" : "FAIL", "refresh rotates the refresh token", `HTTP ${refreshed.status}`);
      const replay = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: login.json.refreshToken } });
      report(replay.status === 401 ? "PASS" : "FAIL", "replaying a used refresh token is refused", `HTTP ${replay.status} ${replay.json?.code ?? ""}`);
      // The replay revoked that session (by design), so sign in again for the rest.
      const again = await call("POST", "/api/v1/auth/login", { body: { email, password } });
      accountToken = again.json?.accessToken;
      const logout = await call("POST", "/api/v1/auth/logout", { token: accountToken });
      const after = await call("GET", "/api/v1/auth/me", { token: accountToken });
      report(logout.status === 204 && after.status === 401 ? "PASS" : "FAIL", "logout revokes the access token", `logout HTTP ${logout.status}, then /auth/me HTTP ${after.status}`);
      accountToken = (await call("POST", "/api/v1/auth/login", { body: { email, password } })).json?.accessToken;
    }
  }

  // ---- Error handling ----------------------------------------------------------------------
  const noAuth = await call("POST", "/api/v1/orchestrator/turn", { body: { utterance: "Hi" } });
  report(noAuth.status === 401 ? "PASS" : "FAIL", "a turn without a token is refused", `HTTP ${noAuth.status}`);
  const malformed = await call("POST", "/api/v1/orchestrator/turn", { token: guestToken, raw: "{not json", headers: { "content-type": "application/json" } });
  report(malformed.status === 400 && malformed.json?.code === "invalid_json" ? "PASS" : "FAIL", "malformed JSON is 400 invalid_json", `HTTP ${malformed.status} ${malformed.json?.code ?? ""}`);
  const badKey = await call("POST", "/api/v1/orchestrator/turn", { token: guestToken, body: { utterance: "Hi", clientTurnId: "x y" } });
  report(badKey.status === 400 ? "PASS" : "FAIL", "a malformed clientTurnId is 400", `HTTP ${badKey.status} ${badKey.json?.code ?? ""}`);

  // ---- Chat: streaming, idempotency, a real model answer -------------------------------------
  const clientTurnId = `smoke-${crypto.randomUUID()}`;
  const hi = await turn(guestToken, "Hi", { isFirstTurn: true, clientTurnId });
  report(hi.status === 200 && hi.done ? "PASS" : "FAIL", "streamed greeting turn (meta/delta/done; no AI call)", `events: ${hi.events.map((e) => e.event).join(",")}`);
  const replay = await turn(guestToken, "Hi", { clientTurnId });
  report(replay.done?.replayed === true && replay.done?.message === hi.done?.message ? "PASS" : "FAIL", "re-sent turn with the same clientTurnId is replayed, not run again", `replayed=${replay.done?.replayed}`);

  const model = await turn(guestToken, "Reply with the single word OK.");
  if (model.done) {
    // The response deliberately does not say which provider produced it, so this can only name the
    // deployment's DEFAULT provider (from /health). With a fallback configured the answer may have
    // come from either; the function log's `AI call` line records which.
    report(
      liveProvider ? "PASS" : "FAIL",
      "a turn that needs the AI model",
      liveProvider
        ? `an AI answer was returned (default provider: ${liveProvider}${h.aiFallback ? "; a fallback provider is also configured, and the response does not say which one answered" : ""})`
        : `answered by provider ${provider}, not a live AI provider`,
    );
  } else if (quota(model.error?.code)) {
    report("WARN", "a turn that needs the AI model", `the AI provider is reachable but out of quota (${model.error.code}); no answer verified`);
  } else if (model.error?.code === "AI_UNAVAILABLE" && model.error.retryable) {
    report("WARN", "a turn that needs the AI model", "the AI provider is temporarily unavailable; no answer verified");
  } else {
    report("FAIL", "a turn that needs the AI model", `no answer: ${JSON.stringify({ status: model.status, code: model.error?.code, retryable: model.error?.retryable })}`);
  }

  // ---- Web Search ----------------------------------------------------------------------------
  // Web search needs Google Search grounding, which only Gemini provides: a deployment without
  // Gemini cannot search, and says so instead of failing.
  if (provider !== "google") {
    report("WARN", "web search", `needs Gemini (Google Search grounding); this deployment answers with provider ${provider}, so search was not exercised`);
  } else {
    const searchPrompt = "Use web search to find the capital city of Australia, then answer in one sentence with the source.";
    let search = await turn(guestToken, searchPrompt);
    let searches = (search.done?.toolCalls ?? []).filter((c) => c.skillId === "web.search");
    if (searches.length === 1 && searches[0].outcome?.result?.reason === "ai_rate_limited") {
      // A per-minute limit, usually from the model calls just before. Respect it: wait out one
      // window and ask once more (a new turn). A daily quota is not retried.
      console.log("     web search hit the per-minute limit; waiting 65 s, then one more attempt");
      await new Promise((resolve) => setTimeout(resolve, 65_000));
      search = await turn(guestToken, searchPrompt);
      searches = (search.done?.toolCalls ?? []).filter((c) => c.skillId === "web.search");
    }
    if (searches.length === 1 && searches[0].result?.status === "COMPLETED") {
      const sources = (searches[0].outcome?.result?.output?.results ?? []).length;
      report(provider === "google" ? "PASS" : "FAIL", "web search ran exactly once and completed", provider === "google" ? `${sources} sources` : `provider ${provider}: not a real search`);
    } else if (searches.length > 1) {
      report("FAIL", "web search ran exactly once", `${searches.length} executions for one request`);
    } else if (searches.length === 1 && /quota|rate/.test(searches[0].outcome?.result?.reason ?? "")) {
      // The user-facing message carries the provider's advised wait; no secret is in it.
      report("WARN", "web search", `ran once; Gemini quota: ${searches[0].outcome.result.reason} (${String(searches[0].outcome.result.userMessage ?? "").slice(0, 160)})`);
    } else if (quota(search.error?.code)) {
      report("WARN", "web search", `planner out of quota (${search.error.code}); search not exercised`);
    } else if (searches.length === 0 && search.done) {
      report("WARN", "web search", "the model answered without calling web.search; search not exercised");
    } else {
      report("FAIL", "web search", JSON.stringify({ status: search.status, code: search.error?.code, result: searches[0]?.result?.status }));
    }
  }

  // ---- File upload ---------------------------------------------------------------------------
  const form = new FormData();
  form.append("file", new Blob([tinyPdf()], { type: "application/pdf" }), "smoke.pdf");
  const upload = await call("POST", "/api/v1/documents/extract", { token: guestToken, raw: form });
  report(upload.status === 200 && /ZARVIS smoke test/.test(upload.json?.text ?? "") ? "PASS" : "FAIL", "PDF upload is extracted", `HTTP ${upload.status} ${upload.json?.error ?? ""}`);
  const bad = new FormData();
  bad.append("file", new Blob([Buffer.from("MZ\u0090\u0000")], { type: "application/x-msdownload" }), "smoke.exe");
  const unsupported = await call("POST", "/api/v1/documents/extract", { token: guestToken, raw: bad });
  report(unsupported.status === 415 ? "PASS" : "FAIL", "an unsupported file type is refused (415)", `HTTP ${unsupported.status}`);

  // ---- TTS -----------------------------------------------------------------------------------
  const tts = await call("POST", "/api/v1/tts/synthesize", { token: guestToken, body: { text: "Hello from ZARVIS." }, timeoutMs: 90_000 });
  const type = tts.headers.get("content-type") || "";
  if (tts.status === 200 && /audio/.test(type)) report("PASS", "TTS returns audio", type);
  else if (tts.status === 429) report("WARN", "TTS", `quota (${tts.json?.code ?? "429"}); no audio verified`);
  else report("FAIL", "TTS returns audio", `HTTP ${tts.status} ${type} ${tts.json?.code ?? ""}`);

  // ---- Cleanup -------------------------------------------------------------------------------
  if (accountToken) {
    const del = await call("DELETE", "/api/v1/account", { token: accountToken });
    const gone = await call("POST", "/api/v1/auth/login", { body: { email, password } });
    report(del.status === 204 && gone.status === 401 ? "PASS" : "FAIL", "delete the sign-up account; its login stops working", `delete HTTP ${del.status}, login HTTP ${gone.status}`);
  }
}

main()
  .catch((err) => report("FAIL", "smoke run", err instanceof Error ? err.message : String(err)))
  .finally(() => {
    const count = (s) => results.filter((r) => r === s).length;
    console.log(`\n${count("PASS")} passed, ${count("WARN")} warnings, ${count("FAIL")} failed`);
    process.exit(count("FAIL") ? 1 : 0);
  });
