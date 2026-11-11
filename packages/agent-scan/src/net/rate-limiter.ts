/**
 * Per-host minimum interval between request starts. Slots are reserved
 * synchronously, so concurrent callers for the same host queue in order and
 * the limiter can be shared by every site in a batch.
 */

import type { RateLimiter } from '../types.js'

/** Options for `createRateLimiter`. */
export interface RateLimiterOptions {
  minIntervalMs: number
  /** Milliseconds clock; default `Date.now`. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Default timer-based sleep. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Create a per-host limiter. */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? realSleep
  const nextStart = new Map<string, number>()
  return {
    async acquire(host: string): Promise<void> {
      const key = host.toLowerCase()
      const current = now()
      const slot = Math.max(current, nextStart.get(key) ?? current)
      nextStart.set(key, slot + options.minIntervalMs)
      if (slot > current) await sleep(slot - current)
    },
  }
}

/** A limiter that never waits; for replay and tests. */
export function noopRateLimiter(): RateLimiter {
  return { acquire: async () => {} }
}
