'use strict';

/**
 * Small in-memory TTL cache with a hard size cap (oldest entry evicted first).
 * Used to avoid repeated calls to geocoding, air-quality and LLM APIs for the
 * same inputs, which keeps latency and cost down.
 */
class TtlCache {
  /**
   * @param {{ ttlMs: number, maxEntries?: number, now?: () => number }} options
   */
  constructor({ ttlMs, maxEntries = 500, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency so frequently used keys survive eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
  }

  /**
   * Returns the cached value or computes, caches and returns it.
   * Concurrent callers for the same key share one in-flight promise.
   */
  async wrap(key, producer) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = Promise.resolve().then(producer);
    this.set(key, pending);
    try {
      const value = await pending;
      this.set(key, value);
      return value;
    } catch (error) {
      this.store.delete(key);
      throw error;
    }
  }

  get size() {
    return this.store.size;
  }
}

module.exports = { TtlCache };
