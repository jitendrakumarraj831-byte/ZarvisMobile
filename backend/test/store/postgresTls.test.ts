import { describe, expect, it } from "vitest";
import { classifyDatabaseError, poolConfigFor } from "../../src/store/postgresStore.js";

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

describe("classifyDatabaseError (secret-free /health database status)", () => {
  const err = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});
  it("names an untrusted TLS certificate", () => {
    expect(classifyDatabaseError(err("self-signed certificate in certificate chain", "SELF_SIGNED_CERT_IN_CHAIN"))).toBe("tls_certificate_untrusted");
    expect(classifyDatabaseError(err("unable to get local issuer certificate"))).toBe("tls_certificate_untrusted");
  });
  it("names bad credentials, an unreachable host and a schema problem", () => {
    expect(classifyDatabaseError(err('password authentication failed for user "x"', "28P01"))).toBe("auth_failed");
    expect(classifyDatabaseError(err("connect ECONNREFUSED 10.0.0.1:5432", "ECONNREFUSED"))).toBe("unreachable");
    expect(classifyDatabaseError(err("getaddrinfo ENOTFOUND db.example.com", "ENOTFOUND"))).toBe("unreachable");
    expect(classifyDatabaseError(err("health check timed out"))).toBe("unreachable");
    expect(classifyDatabaseError(err('permission denied for table users', "42501"))).toBe("schema_error");
    expect(classifyDatabaseError(err("something else"))).toBe("error");
  });
});
