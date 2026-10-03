/**
 * Minimal GitHub REST API stub for the Phase 1 browser E2E (start the backend with
 * GITHUB_API_BASE_URL=http://localhost:3200). Only the token "ghp_" + "e".repeat(36) is valid;
 * it can push to any repo. Every write is recorded and exposed at GET /__writes.
 */
"use strict";
const http = require("node:http");
const VALID = "Bearer ghp_" + "e".repeat(36);
const writes = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://stub");
  const authed = req.headers.authorization === VALID;
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__writes") return send(200, { writes });
  if (url.pathname === "/user") return authed ? send(200, { login: "e2e-user" }, { "x-oauth-scopes": "repo" }) : send(401, { message: "Bad credentials" });
  const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return send(404, { message: "Not Found" });
  const [, owner, repo, rest = ""] = m;
  if (req.method !== "GET") {
    writes.push(`${req.method} ${url.pathname}`);
    return send(201, { commit: { sha: "stub" }, number: 1, html_url: `https://github.com/${owner}/${repo}/pull/1` });
  }
  if (rest === "") return send(200, { full_name: `${owner}/${repo}`, default_branch: "main", language: "TypeScript", private: false, ...(authed ? { permissions: { push: true, pull: true } } : {}) });
  if (rest === "/languages") return send(200, { TypeScript: 100 });
  if (rest.startsWith("/git/trees/")) return send(200, { tree: [{ path: "package.json", type: "blob" }, { path: "src/index.ts", type: "blob" }] });
  if (rest === "/contents") return send(200, [{ name: "src", type: "dir" }]);
  if (rest.startsWith("/contents/")) return send(200, { content: Buffer.from("{}").toString("base64"), encoding: "base64", sha: "abc" });
  if (rest.startsWith("/git/ref/")) return send(200, { object: { sha: "base" } });
  return send(404, { message: "Not Found" });
});
server.listen(Number(process.env.STUB_PORT || 3200), () => console.log("github stub listening"));
