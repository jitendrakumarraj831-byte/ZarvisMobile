/**
 * Loads backend/.env into process.env before anything else runs — see .env.example and
 * DEVELOPMENT.md. Uses Node's built-in `process.loadEnvFile` (no `dotenv` dependency
 * needed); missing the file is expected and fine (MockAIProvider etc. remain the default —
 * see AI_ARCHITECTURE.md), any other failure is not swallowed.
 *
 * Must be the first import in index.ts: ESM executes imports in source order, and
 * config/env.ts reads `process.env.*` into module-level constants at import time, so this
 * has to run before config/env.ts (or anything importing it) is ever imported.
 */
try {
  process.loadEnvFile();
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
