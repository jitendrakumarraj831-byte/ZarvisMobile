/**
 * Vercel serverless entrypoint — wraps the exact same Express app `backend/src/server.ts`
 * builds (see MASTER_SPEC.md §12a, DEVELOPMENT.md "Deploying to Vercel"). Vercel's Node.js
 * runtime treats a default-exported Express app as a request handler directly, so no
 * separate adapter code is needed; this file only wires the same `buildContainer()` +
 * `buildServer()` composition root `backend/src/index.ts` uses for a normal long-running
 * process.
 *
 * `bootstrapEnv` is imported for local parity (`vercel dev`) — in a real Vercel deployment,
 * environment variables come from the Vercel project's own configured env vars, not a
 * `.env` file, and `process.loadEnvFile()` finding nothing there is a no-op (see
 * backend/src/bootstrapEnv.ts).
 *
 * `buildContainer()` picks `backend/src/store/postgresStore.ts` over the in-memory store
 * whenever `POSTGRES_URL`/`DATABASE_URL` is set (see `backend/src/container.ts`) — required
 * for a serverless deployment, since the in-memory store's plain in-process `Map`s do not
 * survive a request landing on a different, cold instance (this broke refresh tokens and
 * every authenticated endpoint in production before the Postgres store existed). See
 * DEVELOPMENT.md "Deploying to Vercel" for setup.
 */
import "../backend/src/bootstrapEnv.js";
import { buildContainer } from "../backend/src/container.js";
import { buildServer } from "../backend/src/server.js";

const container = buildContainer();
const app = buildServer(container);

export default app;
