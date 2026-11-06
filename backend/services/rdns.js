const dns = require('dns').promises;

// In-process PTR cache — keyed by IP
const cache = new Map();
const CACHE_TTL_MS  = 30 * 60 * 1000; // 30 minutes for hits
const MISS_TTL_MS   =  5 * 60 * 1000; // 5 minutes for misses/timeouts
const LOOKUP_TIMEOUT_MS = 800;         // bail out after 800ms — must fit within
                                       // Postfix's policy service timeout budget

function isPrivate(ip) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1)/.test(ip);
}

async function reverseLookup(ip) {
  if (!ip || isPrivate(ip)) return null;

  const cached = cache.get(ip);
  if (cached) {
    const ttl = cached.ptr ? CACHE_TTL_MS : MISS_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.ptr;
  }

  try {
    const result = await Promise.race([
      dns.reverse(ip),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PTR timeout')), LOOKUP_TIMEOUT_MS)
      ),
    ]);
    const ptr = result?.[0] || null;
    cache.set(ip, { ptr, ts: Date.now() });
    return ptr;
  } catch (e) {
    // Cache the miss so repeated lookups for the same IP don't all time out
    cache.set(ip, { ptr: null, ts: Date.now() });
    if (e.message !== 'PTR timeout') {
      // Only log real errors, not expected timeouts
      console.warn(`[rdns] lookup failed for ${ip}: ${e.message}`);
    }
    return null;
  }
}

// Warm the cache for an IP in the background — call this as early as possible
// so the PTR is ready by the time the policy check runs
function prefetch(ip) {
  if (!ip || isPrivate(ip)) return;
  const cached = cache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return;
  reverseLookup(ip).catch(() => {});
}

module.exports = { reverseLookup, prefetch };