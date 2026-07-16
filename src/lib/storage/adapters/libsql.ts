import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient as createWebClient, type Client } from '@libsql/client/web'
import type { KvEntry, StorageAdapter, StorageEvent } from '@/lib/storage/types'

/**
 * Ensure the parent directory exists for an on-disk `file:` libSQL URL. Skipped
 * for in-memory (`:memory:`) and remote (`libsql://`, `http`) targets.
 */
function ensureParentDir(url: string): void {
  if (!url.startsWith('file:')) return
  const filePath = url.slice('file:'.length)
  if (!filePath || filePath.startsWith(':')) return
  const dir = path.dirname(filePath)
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function live(expiresAt: unknown, now: number): boolean {
  return expiresAt === null || expiresAt === undefined || Number(expiresAt) > now
}

/**
 * libSQL-backed {@link StorageAdapter}. Durable and, against a remote
 * (`libsql://`/Turso) URL, shared across instances. Backed by a single
 * `storage_kv` table keyed by `(namespace, key)` with an optional `expires_at`.
 */
export function createLibsqlAdapter(url: string, authToken?: string): StorageAdapter {
  let clientPromise: Promise<Client> | null = null

  const getClient = (): Promise<Client> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        ensureParentDir(url)
        // The package root selects a native SQLite binding under Node, which
        // cannot even be evaluated in workerd. Remote databases use libSQL's
        // fetch/WebSocket client in every runtime. Only a local `file:` URL
        // resolves the Node entry, and the computed specifier prevents edge
        // bundlers from eagerly instantiating that native-only dependency.
        const createClient = url.startsWith('file:')
          ? (await import('@libsql/' + 'client')).createClient
          : createWebClient
        const client = createClient({ url, authToken })
        await client.execute(`CREATE TABLE IF NOT EXISTS storage_kv (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER,
          PRIMARY KEY (namespace, key)
        )`)
        await client.execute(`CREATE TABLE IF NOT EXISTS storage_events (
          id TEXT PRIMARY KEY,
          stream TEXT NOT NULL,
          ts INTEGER NOT NULL,
          data TEXT NOT NULL
        )`)
        await client.execute('CREATE INDEX IF NOT EXISTS idx_events_stream_ts ON storage_events (stream, ts)')
        return client
      })()
      // Drop a failed init so the next call retries instead of wedging.
      clientPromise.catch(() => {
        clientPromise = null
      })
    }
    return clientPromise
  }

  const UPSERT = `INSERT INTO storage_kv (namespace, key, value, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`

  return {
    async kvGet(namespace, key) {
      const client = await getClient()
      const res = await client.execute({
        sql: 'SELECT value, expires_at FROM storage_kv WHERE namespace = ? AND key = ?',
        args: [namespace, key],
      })
      const row = res.rows[0]
      if (!row) return null
      const now = Date.now()
      if (!live(row.expires_at, now)) {
        // Guard on expiry so a fresh write landing in the SELECT→DELETE gap isn't clobbered.
        await client.execute({
          sql: 'DELETE FROM storage_kv WHERE namespace = ? AND key = ? AND expires_at IS NOT NULL AND expires_at <= ?',
          args: [namespace, key, now],
        })
        return null
      }
      return JSON.parse(String(row.value))
    },

    async kvSet(namespace, key, value, options) {
      const client = await getClient()
      const expiresAt = options?.ttlMs ? Date.now() + options.ttlMs : null
      await client.execute({ sql: UPSERT, args: [namespace, key, JSON.stringify(value ?? null), expiresAt] })
    },

    async kvDelete(namespace, key) {
      const client = await getClient()
      await client.execute({ sql: 'DELETE FROM storage_kv WHERE namespace = ? AND key = ?', args: [namespace, key] })
    },

    async kvList<T = unknown>(namespace: string): Promise<Array<KvEntry<T>>> {
      const client = await getClient()
      const now = Date.now()
      const res = await client.execute({
        sql: 'SELECT key, value, expires_at FROM storage_kv WHERE namespace = ?',
        args: [namespace],
      })
      const out: Array<KvEntry<T>> = []
      const expired: Array<string> = []
      for (const row of res.rows) {
        if (live(row.expires_at, now)) out.push({ key: String(row.key), value: JSON.parse(String(row.value)) as T })
        else expired.push(String(row.key))
      }
      if (expired.length) {
        const placeholders = expired.map(() => '?').join(', ')
        // Guard on expiry so a concurrent fresh write isn't deleted (SELECT→DELETE gap).
        await client.execute({
          sql: `DELETE FROM storage_kv WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at <= ? AND key IN (${placeholders})`,
          args: [namespace, now, ...expired],
        })
      }
      return out
    },

    async kvIncrement(namespace, key, options) {
      const client = await getClient()
      const amount = options?.amount ?? 1
      const now = Date.now()
      // Read-modify-write in a transaction so concurrent increments stay atomic.
      const tx = await client.transaction('write')
      try {
        const res = await tx.execute({
          sql: 'SELECT value, expires_at FROM storage_kv WHERE namespace = ? AND key = ?',
          args: [namespace, key],
        })
        const row = res.rows[0]
        let count: number
        let expiresAt: number | null
        if (row && live(row.expires_at, now)) {
          const current = Number(JSON.parse(String(row.value)))
          count = (Number.isFinite(current) ? current : 0) + amount
          expiresAt = row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at)
        } else {
          count = amount
          expiresAt = options?.ttlMs ? now + options.ttlMs : null
        }
        await tx.execute({ sql: UPSERT, args: [namespace, key, JSON.stringify(count), expiresAt] })
        await tx.commit()
        return { count, expiresAt }
      } catch (err) {
        await tx.rollback()
        throw err
      }
    },

    async appendEvent(stream, data, ts) {
      const client = await getClient()
      const event: StorageEvent = { id: randomUUID(), stream, ts: ts ?? Date.now(), data }
      await client.execute({
        sql: 'INSERT INTO storage_events (id, stream, ts, data) VALUES (?, ?, ?, ?)',
        args: [event.id, event.stream, event.ts, JSON.stringify(event.data)],
      })
      return event
    },

    async queryEvents(query) {
      const client = await getClient()
      const clauses = ['stream = ?']
      const args: Array<string | number> = [query.stream]
      if (query.since !== undefined) {
        clauses.push('ts >= ?')
        args.push(query.since)
      }
      const order = query.order === 'asc' ? 'ASC' : 'DESC'
      let sql = `SELECT id, stream, ts, data FROM storage_events WHERE ${clauses.join(' AND ')} ORDER BY ts ${order}`
      if (query.limit) {
        sql += ' LIMIT ?'
        args.push(query.limit)
      }
      const res = await client.execute({ sql, args })
      return res.rows.map((row) => ({
        id: String(row.id),
        stream: String(row.stream),
        ts: Number(row.ts),
        data: JSON.parse(String(row.data)) as Record<string, unknown>,
      }))
    },

    async clear(namespace) {
      const client = await getClient()
      if (namespace) {
        await client.execute({ sql: 'DELETE FROM storage_kv WHERE namespace = ?', args: [namespace] })
      } else {
        await client.execute('DELETE FROM storage_kv')
        await client.execute('DELETE FROM storage_events')
      }
    },
  }
}
