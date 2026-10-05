import { Orchestrator } from "./agents/orchestrator.js";
import { getProvider, defaultModelConfig } from "./ai/providerFactory.js";
import { GeminiTtsProvider } from "./ai/geminiTts.js";
import { AuthService } from "./auth/authService.js";
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
  const registry = buildSkillRegistry(store, githubAccess);
  const entitlementPort = new StoreEntitlementPort(store);
  const usagePort = new StoreUsagePort(store);
  const permissionPort = new StorePermissionPort(store);
  const confirmationService = new ServerConfirmationService(store);

  const pipeline = new ToolPipeline(registry, permissionPort, entitlementPort, usagePort, confirmationService);
  const provider = getProvider(defaultModelConfig);
  const orchestrator = new Orchestrator(registry, entitlementPort, pipeline, provider, defaultModelConfig, store);
  const authService = new AuthService(store);
  const taskService = new TaskService(store);
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
    entitlementPort,
    usagePort,
    taskService,
    billingVerifier,
    paymentService,
    ttsProvider,
    confirmationService,
    githubAccess,
  };
}

export type Container = ReturnType<typeof buildContainer>;
