// Data-access layer for site/data/entities.json.
//
// Both exports are ASYNC — callers must `await` them. This is safe and
// idiomatic inside Next.js Server Components (async components / async data
// loading are natively supported there).
//
// Caching isn't worth the complexity at this scale (a handful of entities),
// so we just read the file fresh on every call.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENTITIES_PATH = path.join(__dirname, "..", "data", "entities.json");

/**
 * Load and parse the full entities array from site/data/entities.json.
 * @returns {Promise<Array<object>>}
 */
export async function loadAllEntities() {
  const raw = await readFile(ENTITIES_PATH, "utf-8");
  return JSON.parse(raw);
}

/**
 * Load a single entity by its slug.
 * @param {string} slug
 * @returns {Promise<object|null>} the matching entity, or null if not found
 */
export async function loadEntity(slug) {
  const entities = await loadAllEntities();
  return entities.find((entity) => entity.slug === slug) ?? null;
}
