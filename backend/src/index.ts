import "./bootstrapEnv.js";
import { buildContainer } from "./container.js";
import { env } from "./config/env.js";
import { buildServer } from "./server.js";
import { logger } from "./security/redact.js";

const container = buildContainer();
const app = buildServer(container);

app.listen(env.port, () => {
  logger.info(`ZARVIS MOBILE backend listening on port ${env.port}`);
});
