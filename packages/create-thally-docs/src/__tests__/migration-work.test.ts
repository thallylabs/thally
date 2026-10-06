/** Worker migration remains equivalent to shared projections and keeps timers responsive. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { migrateRepository, migrateUrl, renderMigrationFiles } from '@thallylabs/migrate'
import { checkContent, convertRepository, discoverUrl, renderFiles } from '../migration-work.js'
import { runCheck, type LintIssue } from '../check.js'

const directories: Array<string> = []
const compiledWorker = new URL('../../dist/migration-worker.js', import.meta.url)
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'thally-worker-test-'))
  directories.push(path)
  return path
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('migration worker execution', () => {
  it('matches repository conversion and rendered bytes including gated content', async () => {
    const path = directory()
    writeFileSync(join(path, 'docs.json'), JSON.stringify({ navigation: { pages: ['intro', 'private'] } }))
    writeFileSync(join(path, 'intro.mdx'), '---\ntitle: Intro\n---\n\nHello\n\n![logo](/img/logo.png)\n')
    writeFileSync(join(path, 'private.mdx'), '---\ntitle: Private\ngroups: [admin]\n---\n\nPrivate body\n')
    mkdirSync(join(path, 'img'))
    writeFileSync(join(path, 'img/logo.png'), Buffer.from([0, 1, 2, 255]))
    const options = { repositoryDir: path, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' as const }
    const expected = migrateRepository(options)
    const actual = await convertRepository(options, { workerUrl: compiledWorker })
    // Structured clone intentionally turns Buffers into portable Uint8Arrays.
    expect(actual).toEqual(structuredClone(expected))
    expect(await renderFiles(actual, {}, { workerUrl: compiledWorker })).toEqual(structuredClone(renderMigrationFiles(expected, {})))
  })

  it('preserves public URL rejection through the asynchronous worker adapter', async () => {
    const options = { sourceUrl: 'file:///private/docs' }
    const expected = await migrateUrl(options).catch((error: Error) => error)
    await expect(discoverUrl(options, { workerUrl: compiledWorker })).rejects.toThrow((expected as Error).message)
  })

  it('matches silent content checking and returns all diagnostics to the host', async () => {
    const path = directory()
    writeFileSync(join(path, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['missing'] }] }] }))
    mkdirSync(join(path, 'src/content'), { recursive: true })
    writeFileSync(join(path, 'src/content/orphan.mdx'), '---\ntitle: Orphan\n---\n\nBody\n')
    let diagnostics: Array<LintIssue> = []
    const code = await runCheck(path, { fix: false, ci: true, silent: true, onIssues: (issues) => { diagnostics = issues } })
    expect(await checkContent(path, { workerUrl: compiledWorker })).toEqual({ code, diagnostics })
  })

  it('keeps the event loop responsive while a worker does synchronous work', async () => {
    const path = join(directory(), 'worker.mjs')
    writeFileSync(path, `import { parentPort } from 'node:worker_threads';
      const until = Date.now() + 120; while (Date.now() < until) {}
      parentPort.postMessage({ result: { pages: [] } });`)
    let ticked = false
    const timer = setTimeout(() => { ticked = true }, 10)
    try {
      await convertRepository({ repositoryDir: '', sourceUrl: 'https://github.com/acme/docs' }, { workerUrl: pathToFileURL(path) })
      expect(ticked).toBe(true)
    } finally { clearTimeout(timer) }
  })

  it('preserves operation errors and causes, and suppresses worker log output', async () => {
    const path = join(directory(), 'worker.mjs')
    writeFileSync(path, `import { parentPort } from 'node:worker_threads';
      console.log('worker-only log'); console.error('worker-only diagnostic');
      parentPort.postMessage({ error: new Error('Exact conversion error', { cause: new Error('Source cause') }) });`)
    const stdout = vi.spyOn(process.stdout, 'write')
    const stderr = vi.spyOn(process.stderr, 'write')
    await expect(convertRepository({ repositoryDir: '', sourceUrl: 'https://github.com/acme/docs' }, { workerUrl: pathToFileURL(path) })).rejects.toMatchObject({ message: 'Exact conversion error', cause: { message: 'Source cause' } })
    expect(stdout.mock.calls.map((call) => String(call[0])).join('')).not.toContain('worker-only log')
    expect(stderr.mock.calls.map((call) => String(call[0])).join('')).not.toContain('worker-only diagnostic')
  })

  it('rejects unexpected worker exits instead of leaving progress waiting forever', async () => {
    const path = join(directory(), 'worker.mjs')
    writeFileSync(path, 'process.exit(0)')
    await expect(convertRepository({ repositoryDir: '', sourceUrl: 'https://github.com/acme/docs' }, { workerUrl: pathToFileURL(path) })).rejects.toThrow('exited before returning a result (exit 0)')
  })
})
