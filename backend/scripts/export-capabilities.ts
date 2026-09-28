/**
 * Regenerates ../shared/capability-registry.json from src/capabilities/registry.ts — the JSON
 * copy the Android domain module's typed registry is checked against. Run:
 *   npm run capabilities:export
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITIES } from "../src/capabilities/registry.js";

const target = join(dirname(fileURLToPath(import.meta.url)), "../../shared/capability-registry.json");
writeFileSync(target, JSON.stringify({ version: 1, capabilities: CAPABILITIES }, null, 2) + "\n");
console.log(`Wrote ${CAPABILITIES.length} capabilities to ${target}`);
