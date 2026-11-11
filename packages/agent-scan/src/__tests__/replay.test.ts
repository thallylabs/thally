import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createReplayTransport, siteKeyFor } from '../net/capture.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import { stableStringify } from '../output/stable-json.js'
import { replaySite, scanSite } from '../scan.js'
import { scannerVersion } from '../version.js'
import { createFakeTransport } from './helpers.js'
import { fixtureSite } from './fixture-site.js'
import { startFixtureServer, type FixtureServer } from './fixture-server.js'

const GOLDEN = fileURLToPath(new URL('./fixtures/golden/', import.meta.url))
const quiet = { rateLimiter: noopRateLimiter(), sleep: async () => {}, now: () => new Date('2026-11-12T08:00:00.000Z') }

describe('captures and replay (AC5)', () => {
  it('replays a fake-transport capture byte for byte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-replay-'))
    const routes = fixtureSite({ markdown: false })
    routes['https://docs.example.com/guide/page-00'] = [{ status: 503 }, routes['https://docs.example.com/guide/page-00'] as never]
    const original = await scanSite('https://docs.example.com/', { transport: createFakeTransport(routes), captureDir: dir, captureBodies: true, ...quiet })
    const siteDir = join(dir, siteKeyFor('https://docs.example.com/'))
    expect(readdirSync(siteDir).sort()).toEqual(['bodies', 'exchanges.jsonl', 'meta.json'])
    const lines = readFileSync(join(siteDir, 'exchanges.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(original.requests.used)
    const replayed = await replaySite(siteDir)
    expect(stableStringify(replayed)).toBe(stableStringify(original))
  })

  it('records status, headers and body hash without bodies for the default share', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-nobodies-'))
    await scanSite('https://docs.example.com/', { transport: createFakeTransport(fixtureSite()), captureDir: dir, captureBodies: false, ...quiet })
    const siteDir = join(dir, siteKeyFor('https://docs.example.com/'))
    expect(existsSync(join(siteDir, 'bodies'))).toBe(false)
    const first = JSON.parse(readFileSync(join(siteDir, 'exchanges.jsonl'), 'utf8').split('\n')[0])
    expect(first).toMatchObject({ seq: 0, method: 'GET', url: 'https://docs.example.com/robots.txt', status: 200, error: null })
    expect(first.bodySha256).toMatch(/^[0-9a-f]{64}$/)
    expect(() => createReplayTransport(siteDir)).toThrow(/without bodies/)
  })

  it('returns capture_miss for requests that were never recorded', async () => {
    const transport = createReplayTransport(join(GOLDEN, readdirSync(GOLDEN).find((name) => !name.endsWith('.json'))!))
    expect(await transport.request({ url: 'https://unrecorded.example/', method: 'GET', headers: {}, timeoutMs: 1, maxBodyBytes: 1 })).toEqual({ error: 'capture_miss' })
  })

  it('replays the committed golden capture to the committed expected result', async () => {
    const siteKey = readdirSync(GOLDEN).find((name) => !name.endsWith('.json'))!
    const expected = readFileSync(join(GOLDEN, 'expected.json'), 'utf8').trim()
    const replayed = await replaySite(join(GOLDEN, siteKey))
    // The golden was recorded by scanner 0.1.0; only the version field may move.
    expect(stableStringify({ ...replayed, scannerVersion: JSON.parse(expected).scannerVersion })).toBe(expected)
    expect(replayed.scannerVersion).toBe(scannerVersion)
  })
})

describe('real transport against a local server', () => {
  let server: FixtureServer
  beforeAll(async () => {
    server = await startFixtureServer((origin) => fixtureSite({ origin }))
  })
  afterAll(() => server.close())

  it('scans over HTTP, captures, and replays identically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-http-'))
    const original = await scanSite(`${server.origin}/`, { allowPrivateNetwork: true, captureDir: dir, captureBodies: true, ...quiet })
    expect(original.status).toBe('ok')
    expect(original.score).toBe(100)
    const siteDir = join(dir, siteKeyFor(`${server.origin}/`))
    const replayed = await replaySite(siteDir, { allowPrivateNetwork: true })
    expect(stableStringify(replayed)).toBe(stableStringify(original))
    // A copied capture replays the same way anywhere.
    const copy = mkdtempSync(join(tmpdir(), 'agent-scan-copy-'))
    cpSync(siteDir, copy, { recursive: true })
    expect(stableStringify(await replaySite(copy, { allowPrivateNetwork: true }))).toBe(stableStringify(original))
  })

  it('replays a private-network capture without the flag, because the capture records it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-private-'))
    const original = await scanSite(`${server.origin}/`, { allowPrivateNetwork: true, captureDir: dir, captureBodies: true, ...quiet })
    const siteDir = join(dir, siteKeyFor(`${server.origin}/`))
    expect(JSON.parse(readFileSync(join(siteDir, 'meta.json'), 'utf8'))).toMatchObject({ allowPrivateNetwork: true })
    const replayed = await replaySite(siteDir)
    expect(replayed.status).toBe('ok')
    expect(stableStringify(replayed)).toBe(stableStringify(original))
  })

  it('refuses a loopback site without --allow-private-network', async () => {
    const result = await scanSite(`${server.origin}/`, quiet)
    expect(result).toMatchObject({ status: 'skipped', reason: 'private_address' })
  })
})
