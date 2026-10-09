import { Orchestrator } from "./agents/orchestrator.js";
import { getProvider, defaultModelConfig } from "./ai/providerFactory.js";
import { GeminiTtsProvider } from "./ai/geminiTts.js";
import { AuthService } from "./auth/authService.js";
import { GoogleIdTokenVerifier } from "./auth/googleIdToken.js";
import { StoreEntitlementPort, StorePermissionPort, StoreUsagePort } from "./billing/entitlements.js";
import { PaymentService } from "./billing/paymentService.js";
import { RazorpayClient } from "./billing/razorpay.js";
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
import { TaskRunner } from "./tasks/taskRunner.js";
import { TaskService } from "./tasks/taskService.js";
import { AgentCatalog } from "./agents/agentCatalog.js";
import { WorkspaceService } from "./workspace/workspaceService.js";
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
  /** Test seam: a Google ID-token verifier with a fake key set. Production builds one from GOOGLE_CLIENT_ID. */
  googleVerifier?: GoogleIdTokenVerifier | null;
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
  // One TaskService for the Tasks API and for the automation skills, so cancelling a workflow in chat also stops a step that is running.
  const taskService = new TaskService(store);
  const registry = buildSkillRegistry(store, githubAccess, taskService);
  const entitlementPort = new StoreEntitlementPort(store);
  const usagePort = new StoreUsagePort(store);
  const permissionPort = new StorePermissionPort(store);
  const confirmationService = new ServerConfirmationService(store);

  // Every call the pipeline evaluates leaves a row in the executions ledger (Activity, Research, Developer read it).
  const pipeline = new ToolPipeline(registry, permissionPort, entitlementPort, usagePort, confirmationService, undefined, {
    record: (record) => store.recordExecution(record),
  });
  const provider = getProvider(defaultModelConfig);
  const orchestrator = new Orchestrator(registry, entitlementPort, pipeline, provider, defaultModelConfig, store);
  const authService = new AuthService(store);
  const googleVerifier = options.googleVerifier ?? (env.googleClientId ? new GoogleIdTokenVerifier(env.googleClientId, env.googleJwksUrl) : null);
  // A task step is an ordinary orchestrator turn, started by the user; the runner is not a second brain.
  const taskRunner = new TaskRunner(store, orchestrator, registry);
  taskService.bindRunner(taskRunner);
  const workspace = new WorkspaceService(store);
  const agentCatalog = new AgentCatalog(registry, entitlementPort, store, githubAccess);
  const billingVerifier = env.playBillingServiceAccountJson
    ? new GooglePlayBillingVerifier(env.playBillingServiceAccountJson, env.playBillingPackageName)
    : env.isProduction
      ? new FailClosedPlayBillingVerifier()
      : new MockPlayBillingVerifier();
  const razorpay = env.razorpayKeyId && env.razorpayKeySecret
    ? new RazorpayClient(env.razorpayKeyId, env.razorpayKeySecret, env.razorpayWebhookSecret, env.razorpayApiBaseUrl)
    : null;
  const paymentService = new PaymentService(store, razorpay);
  const ttsProvider = env.geminiApiKey ? new GeminiTtsProvider(env.geminiApiKey, env.geminiTtsModel, env.geminiTtsVoice) : null;

  return {
    store,
    registry,
    pipeline,
    orchestrator,
    authService,
    googleVerifier,
    entitlementPort,
    usagePort,
    taskService,
    taskRunner,
    workspace,
    agentCatalog,
    billingVerifier,
    paymentService,
    ttsProvider,
    confirmationService,
    githubAccess,
  };
}

export type Container = ReturnType<typeof buildContainer>;
