import { Orchestrator } from "./agents/orchestrator.js";
import { getModelGateway } from "./ai/providerFactory.js";
import type { ModelGateway } from "./ai/modelGateway.js";
import { GeminiTtsProvider } from "./ai/geminiTts.js";
import { AuthService } from "./auth/authService.js";
import { StoreEntitlementPort, StorePermissionPort, StoreUsagePort } from "./billing/entitlements.js";
import { FailClosedPlayBillingVerifier, GooglePlayBillingVerifier, MockPlayBillingVerifier } from "./billing/playBillingVerifier.js";
import { env } from "./config/env.js";
import { GitHubAccessService, type GitHubClientFactory } from "./github/githubAccess.js";
import { RealGitHubClient } from "./github/githubClient.js";
import { ServerConfirmationService } from "./security/confirmationService.js";
import { SecretBox } from "./security/secretBox.js";
import { buildSkillRegistry } from "./skills/index.js";
import { InMemoryStore } from "./store/inMemoryStore.js";
import { PostgresStore } from "./store/postgresStore.js";
import type { Store } from "./store/store.js";
import { TaskService } from "./tasks/taskService.js";
import { ToolPipeline } from "./tooling/toolPipeline.js";

/**
 * Default store: Postgres when DATABASE_URL/POSTGRES_URL is configured, otherwise the
 * in-memory store (fine for local dev/tests, but its state does not survive a serverless
 * cold start — see store/inMemoryStore.ts and store/postgresStore.ts).
 */
function defaultStore(): Store {
  return env.databaseUrl ? new PostgresStore(env.databaseUrl) : new InMemoryStore();
}

export interface ContainerOptions {
  /** Test seam: build GitHub clients without network access. Production uses RealGitHubClient. */
  githubClientFactory?: GitHubClientFactory;
  /** Test seam: the AI Model Gateway. Production uses the process-wide one built from the environment. */
  modelGateway?: ModelGateway;
}

/**
 * Composition root — wires the Store, ports, ToolPipeline, and Orchestrator together once
 * at process startup.
 */
export function buildContainer(store: Store = defaultStore(), options: ContainerOptions = {}) {
  const secretBox = SecretBox.fromEnv(env.integrationEncryptionKey, env.jwtSecret, env.isProduction);
  const githubAccess = new GitHubAccessService(
    store,
    secretBox,
    options.githubClientFactory ?? ((token) => new RealGitHubClient(token, env.githubApiBaseUrl)),
  );
  // Every AI call in the process goes through this one gateway (ai/modelGateway.ts). Building it
  // validates the AI configuration, so a bad setting stops startup here with a clear message.
  const modelGateway = options.modelGateway ?? getModelGateway();
  const registry = buildSkillRegistry(store, githubAccess, modelGateway);
  const entitlementPort = new StoreEntitlementPort(store);
  const usagePort = new StoreUsagePort(store);
  const permissionPort = new StorePermissionPort(store);
  const confirmationService = new ServerConfirmationService(store);

  const pipeline = new ToolPipeline(registry, permissionPort, entitlementPort, usagePort, confirmationService);
  const orchestrator = new Orchestrator(registry, entitlementPort, pipeline, modelGateway, modelGateway.defaultModelConfig(), store);
  const authService = new AuthService(store);
  const taskService = new TaskService(store);
  const billingVerifier = env.playBillingServiceAccountJson
    ? new GooglePlayBillingVerifier(env.playBillingServiceAccountJson, env.playBillingPackageName)
    : env.isProduction
      ? new FailClosedPlayBillingVerifier()
      : new MockPlayBillingVerifier();
  const ttsProvider = env.geminiApiKey ? new GeminiTtsProvider(env.geminiApiKey, env.geminiTtsModel, env.geminiTtsVoice) : null;

  return {
    store,
    registry,
    pipeline,
    orchestrator,
    authService,
    entitlementPort,
    usagePort,
    taskService,
    billingVerifier,
    ttsProvider,
    confirmationService,
    githubAccess,
    modelGateway,
  };
}

export type Container = ReturnType<typeof buildContainer>;
