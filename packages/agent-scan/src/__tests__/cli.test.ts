import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { helpText, runCli, type CliIo } from '../cli.js'
import { methodology } from '../methodology/methodology.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import type { SiteResult } from '../types.js'
import { scannerVersion } from '../version.js'
import { createFakeTransport, notFound, type FakeRoutes } from './helpers.js'
import { fixtureSite } from './fixture-site.js'

function io(routes: FakeRoutes = {}) {
  const out: string[] = []
  const err: string[] = []
  const value: CliIo = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    transport: createFakeTransport(routes),
    rateLimiter: noopRateLimiter(),
    sleep: async () => {},
    now: () => new Date('2026-11-12T00:00:00.000Z'),
    env: {},
  }
  return { io: value, out: () => out.join(''), err: () => err.join('') }
}

describe('thally-scan CLI (AC6)', () => {
  it('scan --json prints the canonical result', async () => {
    const run = io(fixtureSite())
    expect(await runCli(['scan', 'https://docs.example.com/', '--json'], run.io)).toBe(0)
    const result = JSON.parse(run.out()) as SiteResult
    expect(result).toMatchObject({ status: 'ok', score: 100, grade: 'A' })
    expect(run.out().endsWith('\n')).toBe(true)
  })

  it('scan prints the score and one line per check', async () => {
    const run = io(fixtureSite({ llms: false }))
    expect(await runCli(['scan', 'https://docs.example.com/'], run.io)).toBe(0)
    const text = run.out()
    expect(text).toMatch(/^https:\/\/docs\.example\.com\/ {2}score \d+ \([A-F]\)/)
    expect(text).toContain('FAIL  discovery.llms_txt')
    expect(text).toContain('PASS  retrieval.alternate')
    expect(text).toContain('(not scored)')
    expect(text.split('\n').filter((line) => /^(PASS|FAIL|N\/A )/.test(line))).toHaveLength(19)
  })

  it('exits 3 when the site is an error or skipped', async () => {
    const run = io({ 'https://down.example.com/robots.txt': notFound, 'https://down.example.com/': { error: 'dns' } })
    expect(await runCli(['scan', 'https://down.example.com/'], run.io)).toBe(3)
    expect(run.out()).toContain('ERROR (dns)')
  })

  it('exits 2 on usage errors', async () => {
    for (const argv of [['scan'], ['scan', 'a', 'b'], ['scan', 'x', '--nope'], ['batch', '--input', 'x'], ['frame'], ['frame', '--out', 'x', '--limit', '2000'], ['bogus'], []]) {
      const run = io()
      expect(await runCli(argv, run.io), argv.join(' ')).toBe(2)
    }
  })

  it('--help lists every command and every flag the parser accepts', async () => {
    const run = io()
    expect(await runCli(['--help'], run.io)).toBe(0)
    const text = run.out()
    for (const word of ['scan', 'batch', 'frame', '--json', '--captures', '--capture-bodies', '--replay', '--input', '--out', '--concurrency', '--retry-errors', '--limit', '--allow-private-network', '--version', 'GITHUB_TOKEN']) {
      expect(text).toContain(word)
    }
    const scanHelp = io()
    expect(await runCli(['scan', '--help'], scanHelp.io)).toBe(0)
    expect(scanHelp.out()).toBe(helpText('scan'))
  })

  it('batch writes outputs and resumes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-cli-'))
    const input = join(dir, 'sites.csv')
    writeFileSync(input, 'url\nhttps://docs.example.com/\n')
    const run = io(fixtureSite())
    expect(await runCli(['batch', '--input', input, '--out', join(dir, 'out'), '--concurrency', '2'], run.io)).toBe(0)
    for (const file of ['results.jsonl', 'results.csv', 'summary.json']) expect(existsSync(join(dir, 'out', file))).toBe(true)
    expect(run.out()).toContain('scanned: 1')
    const again = io({})
    expect(await runCli(['batch', '--input', input, '--out', join(dir, 'out')], again.io)).toBe(0)
    expect(again.out()).toContain('already done: 1  scanned: 0')
  })

  it('scan --captures then --replay reproduces the JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-cli-replay-'))
    const run = io(fixtureSite())
    await runCli(['scan', 'https://docs.example.com/', '--json', '--captures', dir, '--capture-bodies', 'all'], run.io)
    const replay = io()
    const siteDir = join(dir, (await import('../net/capture.js')).siteKeyFor('https://docs.example.com/'))
    expect(await runCli(['scan', '--replay', siteDir, '--json'], replay.io)).toBe(0)
    expect(replay.out()).toBe(run.out())
    expect(readFileSync(join(siteDir, 'meta.json'), 'utf8')).toContain('"bodies":true')
  })

  it('every command prints the version with --version', async () => {
    for (const command of ['scan', 'batch', 'frame']) {
      const run = io()
      expect(await runCli([command, '--version'], run.io), command).toBe(0)
      expect(run.out()).toBe(`${scannerVersion} (${methodology.id} v${methodology.version})\n`)
    }
  })

  it('help states exit codes per command, with batch separate from scan', async () => {
    const batchHelp = io()
    expect(await runCli(['batch', '--help'], batchHelp.io)).toBe(0)
    expect(batchHelp.out()).toContain('0  the batch finished, even if some sites have status error or skipped')
    expect(batchHelp.out()).toContain('1  at least one site failed unexpectedly')
    expect(batchHelp.out()).toContain('2  usage error')
    expect(batchHelp.out()).not.toContain('3  ')
    const scanHelp = io()
    await runCli(['scan', '--help'], scanHelp.io)
    expect(scanHelp.out()).toContain('3  the site could not be scored (status error or skipped)')
    const all = io()
    await runCli(['--help'], all.io)
    expect(all.out()).toContain('Exit codes (scan):')
    expect(all.out()).toContain('Exit codes (batch):')
  })

  it('rejects --capture-bodies without --captures', async () => {
    const scan = io(fixtureSite())
    expect(await runCli(['scan', 'https://docs.example.com/', '--capture-bodies', 'all'], scan.io)).toBe(2)
    expect(scan.err()).toContain('--capture-bodies needs --captures')
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-cli-cb-'))
    const input = join(dir, 'sites.csv')
    writeFileSync(input, 'url\nhttps://docs.example.com/\n')
    const batch = io(fixtureSite())
    expect(await runCli(['batch', '--input', input, '--out', join(dir, 'out'), '--capture-bodies', '50'], batch.io)).toBe(2)
    expect(existsSync(join(dir, 'out'))).toBe(false)
  })

  it('batch exits 2 on an unterminated quote and names the line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-cli-csv-'))
    const input = join(dir, 'sites.csv')
    writeFileSync(input, 'url\nhttps://docs.example.com/\n"https://broken.example.com/\nhttps://other.example.com/\n')
    const run = io(fixtureSite())
    expect(await runCli(['batch', '--input', input, '--out', join(dir, 'out')], run.io)).toBe(2)
    expect(run.err()).toContain('line 3')
    expect(run.err()).toContain('unterminated')
  })

  it('the built binary prints help', () => {
    const bin = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
    if (!existsSync(bin)) return
    const text = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
    expect(text).toBe(helpText())
  })
})
