import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The Postgres-backed suites (store, schema concurrency) share one database; run in
    // parallel they deadlock on each other's DDL (seen as a CI-only "40P01 deadlock detected").
    // Test files run one after another; tests inside a file are unaffected.
    fileParallelism: false,
  },
});
