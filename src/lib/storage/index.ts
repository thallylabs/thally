import path from 'node:path'
import { createLibsqlAdapter } from '@/lib/storage/adapters/libsql'
import { createMemoryAdapter } from '@/lib/storage/adapters/memory'
import type { StorageAdapter } from '@/lib/storage/types'

const DEFAULT_DB_FILE = `file:${path.join(process.cwd(), '.data', 'thally.db')}`

let cached: StorageAdapter | null = null

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)
}

function isWorkerdRuntime(): boolean {
  return globalThis.navigator?.userAgent === 'Cloudflare-Workers'
}

function createAdapter(): StorageAdapter {
  // Explicit opt-out and tests use the in-memory adapter.
  if ((process.env.THALLY_STORAGE ?? process.env.DOX_STORAGE) === 'memory' || isTestEnv()) return createMemoryAdapter()

  // A configured URL (Turso/libSQL) is durable and, if remote, cross-instance.
  const configured = (process.env.THALLY_DATABASE_URL ?? process.env.DOX_DATABASE_URL)?.trim()
  if (configured) return createLibsqlAdapter(configured, (process.env.THALLY_DATABASE_TOKEN ?? process.env.DOX_DATABASE_TOKEN)?.trim())

  // Cloudflare Workers has a read-only virtual filesystem and cannot persist a
  // local libSQL database. Keep the zero-config runtime functional in memory;
  // production durability still requires the documented remote database URL.
  if (isWorkerdRuntime()) return createMemoryAdapter()

  // Zero-config default: a durable on-disk file, like the analytics store.
  return createLibsqlAdapter(DEFAULT_DB_FILE)
}

/** The process-wide storage adapter, resolved from the environment once. */
export function getStorage(): StorageAdapter {
  if (!cached) cached = createAdapter()
  return cached
}

/** True when a remote (cross-instance-durable) store is configured. */
export function isRemoteStorage(): boolean {
  const url = (process.env.THALLY_DATABASE_URL ?? process.env.DOX_DATABASE_URL)?.trim() ?? ''
  return url.startsWith('libsql://') || url.startsWith('http://') || url.startsWith('https://')
}

/** Test hook: drop the memoized adapter so the next call re-resolves. */
export function __resetStorageForTests(): void {
  cached = null
}

export type { StorageAdapter } from '@/lib/storage/types'
export { createMemoryAdapter } from '@/lib/storage/adapters/memory'
export { createLibsqlAdapter } from '@/lib/storage/adapters/libsql'
