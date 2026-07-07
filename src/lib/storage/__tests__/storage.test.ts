import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createMemoryAdapter } from '@/lib/storage/adapters/memory'
import { createLibsqlAdapter } from '@/lib/storage/adapters/libsql'
import type { StorageAdapter } from '@/lib/storage/types'

const tmpPath = path.join(process.cwd(), '.data', `__storage_test_${Date.now()}.db`)
const tmpUrl = `file:${tmpPath}`

const adapters: Array<[string, () => StorageAdapter]> = [
  ['memory', () => createMemoryAdapter()],
  ['libsql', () => createLibsqlAdapter(tmpUrl)],
]

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.rmSync(tmpPath + suffix)
    } catch {
      // best-effort cleanup
    }
  }
})

describe.each(adapters)('StorageAdapter: %s', (_name, make) => {
  let store: StorageAdapter

  beforeEach(async () => {
    store = make()
    await store.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets, gets, and deletes a value', async () => {
    await store.kvSet('ns', 'k', { a: 1 })
    expect(await store.kvGet('ns', 'k')).toEqual({ a: 1 })
    await store.kvDelete('ns', 'k')
    expect(await store.kvGet('ns', 'k')).toBeNull()
  })

  it('returns null for a missing key', async () => {
    expect(await store.kvGet('ns', 'missing')).toBeNull()
  })

  it('keeps namespaces independent', async () => {
    await store.kvSet('a', 'k', 1)
    await store.kvSet('b', 'k', 2)
    expect(await store.kvGet('a', 'k')).toBe(1)
    expect(await store.kvGet('b', 'k')).toBe(2)
  })

  it('lists live entries in a namespace', async () => {
    await store.kvSet('list', 'k1', 'v1')
    await store.kvSet('list', 'k2', 'v2')
    const keys = (await store.kvList('list')).map((e) => e.key).sort()
    expect(keys).toEqual(['k1', 'k2'])
  })

  it('expires values after their TTL (get + list lazily remove)', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    await store.kvSet('ttl', 'k', 'v', { ttlMs: 1000 })
    expect(await store.kvGet('ttl', 'k')).toBe('v')
    now.mockReturnValue(1_001_001)
    expect(await store.kvGet('ttl', 'k')).toBeNull()
    expect(await store.kvList('ttl')).toEqual([])
  })

  it('increments atomically within a window, then resets after it expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    expect((await store.kvIncrement('rate', 'ip', { ttlMs: 60_000 })).count).toBe(1)
    expect((await store.kvIncrement('rate', 'ip', { ttlMs: 60_000 })).count).toBe(2)
    const third = await store.kvIncrement('rate', 'ip', { ttlMs: 60_000, amount: 3 })
    expect(third.count).toBe(5)
    expect(third.expiresAt).toBe(2_060_000) // window anchored to first increment
    now.mockReturnValue(2_061_000)
    expect((await store.kvIncrement('rate', 'ip', { ttlMs: 60_000 })).count).toBe(1)
  })

  it('clear(namespace) drops only that namespace', async () => {
    await store.kvSet('x', 'k', 1)
    await store.kvSet('y', 'k', 1)
    await store.clear('x')
    expect(await store.kvGet('x', 'k')).toBeNull()
    expect(await store.kvGet('y', 'k')).toBe(1)
  })

  it('appends and queries events (stream filter, newest-first, since, limit)', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    await store.appendEvent('chat', { q: 'a' })
    now.mockReturnValue(2000)
    await store.appendEvent('chat', { q: 'b' })
    now.mockReturnValue(3000)
    await store.appendEvent('other', { q: 'x' })

    const chat = await store.queryEvents({ stream: 'chat' })
    expect(chat.map((e) => (e.data as { q: string }).q)).toEqual(['b', 'a']) // newest first
    expect(chat.every((e) => e.stream === 'chat')).toBe(true)

    expect((await store.queryEvents({ stream: 'chat', since: 1500 })).map((e) => (e.data as { q: string }).q)).toEqual(['b'])
    expect((await store.queryEvents({ stream: 'chat', limit: 1, order: 'asc' }))[0].data.q).toBe('a')
  })
})
