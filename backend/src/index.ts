import "./bootstrapEnv.js";
import { buildContainer } from "./container.js";
import { env } from "./config/env.js";
import { buildServer } from "./server.js";
import { logger } from "./security/redact.js";

const container = buildContainer();
const app = buildServer(container);

const server = app.listen(env.port, () => {
  logger.info(`ZARVIS MOBILE backend listening on port ${env.port}`);
});
// Node closes an idle keep-alive connection after 5 s, but the Android client (OkHttp) re-checks a pooled connection before a
// POST only after 10 s idle, so a request sent 5-10 s after the previous one could be written to a connection the server had
// just closed ("unexpected end of stream"), and a POST is not retried. Keep idle connections longer than clients and proxies
// (Render's is about 60 s) do; headersTimeout must stay above keepAliveTimeout.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
