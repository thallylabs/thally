import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readBatchInputs, runBatch } from '../batch.js'
import { methodology } from '../methodology/methodology.js'
import { CsvError, parseCsv } from '../output/csv.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import type { SiteResult } from '../types.js'
import { createFakeTransport, notFound, type FakeRoutes } from './helpers.js'
import { fixtureSite } from './fixture-site.js'

const quiet = { rateLimiter: noopRateLimiter(), sleep: async () => {}, now: () => new Date('2026-11-12T00:00:00.000Z') }

function sites(): FakeRoutes {
  return {
    ...fixtureSite({ origin: 'https://a.example.com' }),
    ...fixtureSite({ origin: 'https://b.example.com', llms: false, markdown: false }),
    'https://down.example.com/robots.txt': notFound,
    'https://down.example.com/': { error: 'dns' },
  }
}

function setup(csv: string) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-scan-batch-'))
  const input = join(dir, 'sample.csv')
  writeFileSync(input, csv)
  return { dir, input, out: join(dir, 'out') }
}

const readJsonl = (path: string) => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as SiteResult)

describe('batch outputs (AC6, AC8)', () => {
  it('writes results.jsonl, results.csv and summary.json, and survives a failing site', async () => {
    const { input, out } = setup('url\nhttps://a.example.com/\nhttps://down.example.com/\nhttps://b.example.com/\nhttps://a.example.com/\n')
    const report = await runBatch({ input, outDir: out, concurrency: 2, transport: createFakeTransport(sites()), ...quiet })
    expect(report).toEqual({ total: 3, alreadyDone: 0, scanned: 3, failed: [] })
    const results = readJsonl(join(out, 'results.jsonl'))
    expect(results.map((r) => r.status).sort()).toEqual(['error', 'ok', 'ok'])
    const csv = parseCsv(readFileSync(join(out, 'results.csv'), 'utf8'))
    expect(csv[0].slice(0, 9)).toEqual(['input', 'docs_root', 'status', 'reason', 'score', 'grade', 'platform', 'platform_confidence', 'thally_hosted'])
    expect(csv[0]).toContain('discovery.llms_txt_status')
    expect(csv[0]).toHaveLength(9 + methodology.categories.length + methodology.checks.length * 2 + 4)
    expect(csv.slice(1).map((row) => [row[0], row[2], row[3]])).toEqual([
      ['https://a.example.com/', 'ok', ''],
      ['https://down.example.com/', 'error', 'dns'],
      ['https://b.example.com/', 'ok', ''],
    ])
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'))
    expect(summary.generatedAt).toBe('2026-11-12T00:00:00.000Z')
    expect(summary.all.byStatus).toEqual({ error: 1, ok: 2 })
    expect(summary.all.byReason).toEqual({ dns: 1 })
    expect(summary.all.researchQuestions).toMatchObject({ okSites: 2, llmsTxt: 1, alternate: 1 })
    expect(summary.excludingThallyHosted.sites).toBe(3)
    expect(summary.platformsHighConfidence).toEqual({ docusaurus: { sites: 2, meanScore: expect.any(Number) } })
  })

  it('resumes: skips finished sites and repairs a truncated final line', async () => {
    const { input, out } = setup('url\nhttps://a.example.com/\nhttps://b.example.com/\n')
    const first = createFakeTransport(sites())
    await runBatch({ input, outDir: out, transport: first, ...quiet })
    const jsonl = join(out, 'results.jsonl')
    const lines = readFileSync(jsonl, 'utf8').trim().split('\n')
    // Simulate a crash mid-write of the second site.
    writeFileSync(jsonl, `${lines[0]}\n${lines[1].slice(0, 40)}`)
    const second = createFakeTransport(sites())
    const report = await runBatch({ input, outDir: out, transport: second, ...quiet })
    expect(report).toMatchObject({ alreadyDone: 1, scanned: 1 })
    const resumed = readJsonl(jsonl)
    expect(resumed.map((r) => r.input).sort()).toEqual(['https://a.example.com/', 'https://b.example.com/'])
    expect(second.requests.every((r) => r.url.startsWith('https://b.example.com'))).toBe(true)
    // A third run does nothing.
    const third = createFakeTransport({})
    expect(await runBatch({ input, outDir: out, transport: third, ...quiet })).toMatchObject({ alreadyDone: 2, scanned: 0 })
    expect(third.requests).toHaveLength(0)
  })

  it('re-runs error sites only with retryErrors, and the newest line wins', async () => {
    const { input, out } = setup('url\nhttps://down.example.com/\n')
    await runBatch({ input, outDir: out, transport: createFakeTransport(sites()), ...quiet })
    expect(await runBatch({ input, outDir: out, transport: createFakeTransport({}), ...quiet })).toMatchObject({ scanned: 0 })
    const fixed = { ...fixtureSite({ origin: 'https://down.example.com' }) }
    await runBatch({ input, outDir: out, transport: createFakeTransport(fixed), retryErrors: true, ...quiet })
    const csv = parseCsv(readFileSync(join(out, 'results.csv'), 'utf8'))
    expect(csv).toHaveLength(2)
    expect(csv[1][2]).toBe('ok')
  })

  it('keeps going when a site throws unexpectedly, and does not mark it done', async () => {
    const { input, out } = setup('url\nhttps://boom.example.com/\nhttps://a.example.com/\n')
    const failures: string[] = []
    const report = await runBatch({ input, outDir: out, transport: createFakeTransport(sites()), onFailure: (url) => failures.push(url), ...quiet })
    expect(report).toMatchObject({ scanned: 1, failed: ['https://boom.example.com/'] })
    expect(failures).toEqual(['https://boom.example.com/'])
    expect(readJsonl(join(out, 'results.jsonl')).map((r) => r.input)).toEqual(['https://a.example.com/'])
  })

  it('writes captures for each site when asked', async () => {
    const { input, out, dir } = setup('url\nhttps://a.example.com/\n')
    await runBatch({ input, outDir: out, captureDir: join(dir, 'captures'), captureBodies: 'all', transport: createFakeTransport(sites()), ...quiet })
    expect(existsSync(join(dir, 'captures'))).toBe(true)
  })
})

describe('batch inputs', () => {
  it('reads included docs roots from a frame CSV', () => {
    const csv = 'rank,repo,repo_id,stars,archived,homepage,docs_root,decision,reason,duplicate_of,frozen_on\r\n' +
      '1,o/a,1,10,false,https://a.test,https://docs.a.test/,include,docs_subdomain,,2026-11-12\r\n' +
      '2,o/b,2,9,false,,,exclude,no_homepage,,2026-11-12\r\n' +
      '3,"o/c,quoted",3,8,false,https://c.test,https://c.test/docs/,include,docs_path,,2026-11-12\r\n'
    expect(readBatchInputs(csv)).toEqual(['https://docs.a.test/', 'https://c.test/docs/'])
  })

  it('rejects a CSV without a usable column', () => {
    expect(() => readBatchInputs('site\nhttps://a.test/\n')).toThrow(/url/)
  })

  it('ignores an appended blank line', () => {
    const { input } = setup('url\nhttps://a.test/\n')
    appendFileSync(input, '\n\n')
    expect(readBatchInputs(readFileSync(input, 'utf8'))).toEqual(['https://a.test/'])
  })
})

describe('parseCsv', () => {
  it('fails fast on an unterminated quote, naming the line where it opened', () => {
    let caught: unknown
    try {
      parseCsv('url\r\nhttps://a.test/\r\n"https://b.test/\r\nhttps://c.test/\r\n')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CsvError)
    expect((caught as CsvError).line).toBe(3)
    expect((caught as Error).message).toContain('line 3')
    expect(() => parseCsv('url\n"a\n')).toThrow(/line 2/)
  })

  it('still accepts quoted fields that span lines and escaped quotes', () => {
    expect(parseCsv('a,b\n"x\ny","say ""hi"""\n')).toEqual([['a', 'b'], ['x\ny', 'say "hi"']])
  })
})
