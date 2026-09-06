import { Orchestrator } from "./agents/orchestrator.js";
import { getProvider, defaultModelConfig } from "./ai/providerFactory.js";
import { GeminiTtsProvider } from "./ai/geminiTts.js";
import { AuthService } from "./auth/authService.js";
import { StoreEntitlementPort, StorePermissionPort, StoreUsagePort } from "./billing/entitlements.js";
import { MockPlayBillingVerifier } from "./billing/playBillingVerifier.js";
import { env } from "./config/env.js";
import { RequestFlagConfirmationPort } from "./security/confirmationPort.js";
import { buildSkillRegistry } from "./skills/index.js";
import { InMemoryStore } from "./store/inMemoryStore.js";
import { PostgresStore } from "./store/postgresStore.js";
import type { Store } from "./store/store.js";
import { TaskService } from "./tasks/taskService.js";
import { ToolPipeline } from "./tooling/toolPipeline.js";
import { env } from "./config/env.js";

/**
 * Default store: Postgres when DATABASE_URL/POSTGRES_URL is configured, otherwise the
 * in-memory store (fine for local dev/tests, but its state does not survive a serverless
 * cold start — see store/inMemoryStore.ts and store/postgresStore.ts).
 */
function defaultStore(): Store {
  return env.databaseUrl ? new PostgresStore(env.databaseUrl) : new InMemoryStore();
}

/**
 * Composition root — wires the Store, ports, ToolPipeline, and Orchestrator together once
 * at process startup. See ARCHITECTURE.md for what each piece does and why it's shaped
 * this way.
 */
export function buildContainer(store: Store = defaultStore()) {
  const registry = buildSkillRegistry();
  const entitlementPort = new StoreEntitlementPort(store);
  const usagePort = new StoreUsagePort(store);
  const permissionPort = new StorePermissionPort(store);
  const confirmationPort = new RequestFlagConfirmationPort();

  const pipeline = new ToolPipeline(registry, permissionPort, entitlementPort, usagePort, confirmationPort);
  const provider = getProvider(defaultModelConfig);
  const orchestrator = new Orchestrator(registry, entitlementPort, pipeline, provider, defaultModelConfig);
  const authService = new AuthService(store);
  const taskService = new TaskService(store);
  const billingVerifier = new MockPlayBillingVerifier();
  const ttsProvider = env.geminiApiKey ? new GeminiTtsProvider(env.geminiApiKey, env.geminiTtsModel, env.geminiTtsVoice) : null;

  return { store, registry, pipeline, orchestrator, authService, entitlementPort, usagePort, taskService, billingVerifier, ttsProvider };
}

export type Container = ReturnType<typeof buildContainer>;
