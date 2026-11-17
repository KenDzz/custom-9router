import { createHash } from "node:crypto";

/**
 * Derive a stable, non-reversible affinity key from a client API key so the raw
 * key never travels further than the request handler.
 * @param {string|null} apiKey
 * @returns {string|null}
 */
export function affinityKeyFromApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) return null;
  return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 32)}`;
}

/**
 * Rendezvous (highest-random-weight) hashing: map an affinity key to one of the
 * connections deterministically and without shared state. Upstream prompt
 * caches live per account, so keeping a caller on one account keeps its cache
 * warm. When a connection drops out (locked, excluded, disabled) only the keys
 * mapped to it move; when it comes back they return to it.
 * @param {Array<{id: string}>} connections
 * @param {string|null} affinityKey
 * @returns {object|null}
 */
export function pickAffinityConnection(connections, affinityKey) {
  if (!affinityKey || !Array.isArray(connections) || connections.length === 0) return null;
  let best = null;
  let bestScore = "";
  for (const connection of connections) {
    if (!connection?.id) continue;
    const score = createHash("sha256").update(`${affinityKey}\u0000${connection.id}`).digest("hex");
    if (!best || score > bestScore) {
      best = connection;
      bestScore = score;
    }
  }
  return best;
}
