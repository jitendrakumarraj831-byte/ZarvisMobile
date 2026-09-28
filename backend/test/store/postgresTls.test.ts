import { describe, expect, it } from "vitest";
import { poolConfigFor } from "../../src/store/postgresStore.js";

describe("Postgres TLS configuration", () => {
  it("verifies certificates by default for remote hosts, even with sslmode=require in the URL", () => {
    const config = poolConfigFor("postgres://u:p@db.example.com:5432/app?sslmode=require", undefined, undefined);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("sslmode");
  });

  it("uses a provided CA certificate", () => {
    expect(poolConfigFor("postgres://u:p@db.example.com/app", undefined, "PEM").ssl).toEqual({ rejectUnauthorized: true, ca: "PEM" });
  });

  it("only skips verification on explicit opt-out", () => {
    expect(poolConfigFor("postgres://u:p@db.example.com/app", "no-verify", undefined).ssl).toEqual({ rejectUnauthorized: false });
  });

  it("uses plain TCP for localhost", () => {
    expect(poolConfigFor("postgres://u:p@localhost/app", undefined, undefined).ssl).toBe(false);
  });
});
