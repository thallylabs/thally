import { randomUUID } from 'node:crypto'
import type { KvEntry, StorageAdapter, StorageEvent } from '@/lib/storage/types'

interface Row {
  value: unknown
  expiresAt: number | null
}

function isLive(row: Row | undefined, now: number): row is Row {
  return Boolean(row) && (row!.expiresAt === null || row!.expiresAt > now)
}

/**
 * In-memory {@link StorageAdapter} — the default for tests and for deployments
 * that don't configure a database. Per-instance and non-durable; fine for dev
 * and for soft, per-instance rate limits.
 */
export function createMemoryAdapter(): StorageAdapter {
  const store = new Map<string, Map<string, Row>>()
  const events: Array<StorageEvent> = []
  const ns = (namespace: string): Map<string, Row> => {
    let m = store.get(namespace)
    if (!m) {
      m = new Map()
      store.set(namespace, m)
    }
    return m
  }

  return {
    async kvGet(namespace, key) {
      const m = store.get(namespace)
      const row = m?.get(key)
      if (!row) return null
      if (!isLive(row, Date.now())) {
        m!.delete(key)
        return null
      }
      return row.value as never
    },

    async kvSet(namespace, key, value, options) {
      ns(namespace).set(key, {
        value,
        expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : null,
      })
    },

    async kvDelete(namespace, key) {
      store.get(namespace)?.delete(key)
    },

    async kvList<T = unknown>(namespace: string): Promise<Array<KvEntry<T>>> {
      const m = store.get(namespace)
      if (!m) return []
      const now = Date.now()
      const out: Array<KvEntry<T>> = []
      for (const [key, row] of m) {
        if (!isLive(row, now)) {
          m.delete(key)
          continue
        }
        out.push({ key, value: row.value as T })
      }
      return out
    },

    async kvIncrement(namespace, key, options) {
      const amount = options?.amount ?? 1
      const now = Date.now()
      const m = ns(namespace)
      const row = m.get(key)
      if (isLive(row, now)) {
        const current = typeof row.value === 'number' ? row.value : 0
        const count = current + amount
        row.value = count
        return { count, expiresAt: row.expiresAt }
      }
      const expiresAt = options?.ttlMs ? now + options.ttlMs : null
      m.set(key, { value: amount, expiresAt })
      return { count: amount, expiresAt }
    },

    async appendEvent(stream, data, ts) {
      const event: StorageEvent = { id: randomUUID(), stream, ts: ts ?? Date.now(), data }
      events.push(event)
      return event
    },

    async queryEvents(query) {
      let out = events.filter((e) => e.stream === query.stream)
      if (query.since !== undefined) out = out.filter((e) => e.ts >= query.since!)
      out = out.sort((a, b) => (query.order === 'asc' ? a.ts - b.ts : b.ts - a.ts))
      return query.limit ? out.slice(0, query.limit) : out
    },

    async clear(namespace) {
      if (namespace) store.delete(namespace)
      else {
        store.clear()
        events.length = 0
      }
    },
  }
}
