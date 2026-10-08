import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import { buildContainer, type Container } from "../../src/container.js";
import { buildServer } from "../../src/server.js";
import { InMemoryStore } from "../../src/store/inMemoryStore.js";
import { PostgresStore } from "../../src/store/postgresStore.js";
import type { Store } from "../../src/store/store.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Every suite that touches storage runs on the in-memory store, and on Postgres when TEST_DATABASE_URL is set. */
export const STORES: Array<[string, () => Store]> = [
  ["in-memory store", () => new InMemoryStore()],
  ...(TEST_DATABASE_URL ? ([["postgres store", () => new PostgresStore(TEST_DATABASE_URL)]] as Array<[string, () => Store]>) : []),
];

export interface Harness {
  app: Express;
  container: Container;
  store: Store;
}

export function harness(store: Store): Harness {
  const container = buildContainer(store);
  return { app: buildServer(container), container, store };
}

export interface Guest {
  token: string;
  accountId: string;
}

export async function newGuest(app: Express): Promise<Guest> {
  const res = await request(app).post("/api/v1/auth/guest");
  expect(res.status).toBe(201);
  const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`);
  return { token: res.body.accessToken as string, accountId: me.body.accountId as string };
}

export const auth = (guest: Guest | string) => ({ Authorization: `Bearer ${typeof guest === "string" ? guest : guest.token}` });

/** One orchestrator turn (JSON) as `guest`; returns the response body. */
export async function say(app: Express, guest: Guest, utterance: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post("/api/v1/orchestrator/turn").set(auth(guest)).send({ utterance, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { message: string; conversationId: string; toolCalls: Array<{ toolCallId: string; skillId: string; outcome: { kind: string }; result: { status: string } }> };
}
