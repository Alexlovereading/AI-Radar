// Data-access layer for site/data/entities.json.
//
// The JSON is imported directly at build time rather than read via node:fs at
// request time. This bakes the data into the build output, which is what lets
// this module run on edge/Workers runtimes with no runtime filesystem (e.g.
// Cloudflare Pages) as well as on Node — and it matches the project's
// git-scraping pattern: the pipeline commits a fresh site/data/entities.json
// to git on every run, and every redeploy picks up whatever was last committed.
//
// Both exports stay ASYNC even though there's no actual I/O left, so call
// sites (`await loadAllEntities()`) don't need to change if this ever grows a
// real data source again.

import entities from "../data/entities.json";

/**
 * Load the full entities array from site/data/entities.json.
 * @returns {Promise<Array<object>>}
 */
export async function loadAllEntities() {
  return entities;
}

/**
 * Load a single entity by its slug.
 * @param {string} slug
 * @returns {Promise<object|null>} the matching entity, or null if not found
 */
export async function loadEntity(slug) {
  return entities.find((entity) => entity.slug === slug) ?? null;
}
