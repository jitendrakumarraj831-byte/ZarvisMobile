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
 * Known limitation (documented, not hidden — Product Principle #4 "Never fake success"):
 * `backend/src/store/inMemoryStore.ts` holds accounts/tasks/usage in a plain in-process
 * Map. Every serverless invocation may land on a different, cold instance, so this store
 * does not reliably persist across requests in production the way a normal long-running
 * server does — fine for a solo demo within one warm instance, not for real multi-user
 * production. See DEVELOPMENT.md for the swap-in-a-real-database path before a real launch.
 */
import "../backend/src/bootstrapEnv.js";
import { buildContainer } from "../backend/src/container.js";
import { buildServer } from "../backend/src/server.js";

const container = buildContainer();
const app = buildServer(container);

export default app;
