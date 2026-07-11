/**
 * Thally durable storage (F1).
 *
 * A small, adapter-based key–value layer that new v2.1 surfaces build on:
 * durable rate-limiting for the public MCP endpoint (A6), assistant insights and
 * the docs-task queue (A5), and the audit log (C3). Two adapters ship — `memory`
 * (tests / opt-out) and `libsql` (zero-config file by default, Turso/libSQL via
 * `THALLY_DATABASE_URL`) — resolved once via {@link getStorage}.
 *
 * Scope note: this is intentionally KV-only. An append-only event log with a
 * typed query surface is deferred to its first real consumer (A5/C3), because
 * the v2.0 analytics store already showed aggregation wants typed columns, not
 * generic JSON events — so the query shape should be pinned by real use.
 */

export interface KvSetOptions {
  /** Time-to-live in ms. Omit for a value that never expires. */
  ttlMs?: number
}

export interface KvIncrementOptions {
  /** Window length in ms — a fresh window starts when the key is absent/expired. */
  ttlMs?: number
  /** Amount to add (default 1). */
  amount?: number
}

export interface KvIncrementResult {
  /** The counter value after this increment. */
  count: number
  /** Epoch ms when the current window expires, or null if it never expires. */
  expiresAt: number | null
}

export interface KvEntry<T = unknown> {
  key: string
  value: T
}

/** An append-only event (chat insights, audit). Immutable once written. */
export interface StorageEvent {
  id: string
  stream: string
  ts: number
  data: Record<string, unknown>
}

export interface EventQuery {
  stream: string
  /** Inclusive lower bound (epoch ms). */
  since?: number
  /** Max events to return. */
  limit?: number
  /** Default 'desc' (most recent first). */
  order?: 'asc' | 'desc'
}

export interface StorageAdapter {
  /** Read a value, or null if absent/expired. Expired entries are lazily removed. */
  kvGet<T = unknown>(namespace: string, key: string): Promise<T | null>
  /** Write a value, optionally with a TTL. Overwrites any existing entry. */
  kvSet<T = unknown>(namespace: string, key: string, value: T, options?: KvSetOptions): Promise<void>
  /** Remove a key. No-op if absent. */
  kvDelete(namespace: string, key: string): Promise<void>
  /** List all live (non-expired) entries in a namespace. Expired entries are lazily removed. */
  kvList<T = unknown>(namespace: string): Promise<Array<KvEntry<T>>>
  /**
   * Atomically add to a numeric counter within a TTL window. When the key is
   * absent or its window has expired, it resets to `amount` with a fresh window.
   * Returns the new count and the window's expiry. Used for rate limiting.
   */
  kvIncrement(namespace: string, key: string, options?: KvIncrementOptions): Promise<KvIncrementResult>
  /** Append an immutable event to a stream. */
  appendEvent(stream: string, data: Record<string, unknown>, ts?: number): Promise<StorageEvent>
  /** Query a stream by time, newest-first by default. */
  queryEvents(query: EventQuery): Promise<Array<StorageEvent>>
  /** Drop everything, or a single namespace. Primarily for tests/maintenance. */
  clear(namespace?: string): Promise<void>
}
