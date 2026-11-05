/** The migration report records what produced it: command line, source commit, engine. */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MigrationFetcher } from '@thallylabs/migrate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { scaffoldMock, installDepsMock, initGitMock, validateMigrationMock, clones } = vi.hoisted(() => ({
  scaffoldMock: vi.fn(),
  installDepsMock: vi.fn(),
  initGitMock: vi.fn(),
  validateMigrationMock: vi.fn(),
  /** Commit of each mocked clone, by repository name. */
  clones: new Map<string, string>(),
}))

vi.mock('../scaffold.js', () => ({ scaffold: scaffoldMock }))
vi.mock('../utils.js', () => ({ installDeps: installDepsMock, initGit: initGitMock }))
vi.mock('../migrate/validate.js', () => ({ validateMigration: validateMigrationMock }))
vi.mock('../migration-work.js', async () => {
  const engine = await import('@thallylabs/migrate')
  return { convertRepository: engine.migrateRepository, renderFiles: engine.renderMigrationFiles }
})
// A real git repository at the clone target, as `git clone` leaves it: the docs root is the
// repository root, so the sourceRef import deletes its dot-directories (`.git` included).
vi.mock('@thallylabs/migrate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@thallylabs/migrate')>()),
  sourceRefOversizeReason: async () => null,
  cloneGitHubRepository: async (source: { repo: string }, directory: string) => {
    const { execFileSync: run } = await import('node:child_process')
    const { mkdirSync: mkdir, writeFileSync: write } = await import('node:fs')
    const main = source.repo === 'docs'
    mkdir(directory, { recursive: true })
    write(`${directory}/docs.json`, JSON.stringify({ navigation: { pages: main ? ['intro', { sourceRef: 'acme/sdk' }] : ['sdk-intro'] } }))
    write(`${directory}/${main ? 'intro' : 'sdk-intro'}.mdx`, '---\ntitle: Page\n---\n\nHello\n')
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
    const git = (...args: Array<string>) => run('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: directory, env, encoding: 'utf8' }).trim()
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'fixture')
    clones.set(source.repo, git('rev-parse', 'HEAD'))
  },
}))

import { migrateDocs } from '../migrate/index.js'
import { engineProvenance, gitCommit, gitHead, redactArgv } from '../migrate/provenance.js'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const engineVersion = (JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as { version: string }).version

/** Git as a fixture author, without any repository-location variables the test runner inherited. */
function git(directory: string, ...args: Array<string>): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: directory, env, encoding: 'utf8' }).trim()
}

function commitAll(directory: string): string {
  git(directory, 'init', '-q')
  git(directory, 'add', '-A')
  git(directory, 'commit', '-q', '-m', 'fixture')
  return git(directory, 'rev-parse', 'HEAD')
}

function localFixture(): { source: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'thally-provenance-'))
  const source = join(root, 'source')
  const output = join(root, 'site')
  mkdirSync(source)
  mkdirSync(output)
  writeFileSync(join(output, 'docs.json'), JSON.stringify({ tabs: [] }))
  writeFileSync(join(source, 'docs.json'), JSON.stringify({ $schema: 'https://mintlify.com/docs.json', navigation: { groups: [{ group: 'Docs', pages: ['introduction'] }] } }))
  writeFileSync(join(source, 'introduction.mdx'), '---\ntitle: Welcome\n---\n\nHello.\n')
  return { source, output }
}

function readReport(path: string): { raw: string; provenance: Record<string, unknown> } {
  const raw = readFileSync(path, 'utf8')
  return { raw, provenance: JSON.parse(raw).provenance }
}

describe('migration report provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clones.clear()
    validateMigrationMock.mockResolvedValue({ content: 'passed', build: 'passed', messages: [] })
  })

  it('records the command line, the source commit and the engine for a local fixture', async () => {
    const { source, output } = localFixture()
    const commit = commitAll(source)
    const argv = ['migrate', 'local-directory', '--platform', 'mintlify', '--source-ref', 'acme/sdk=sdk', '--api-key', 'sk-not-a-real-key']

    const result = await migrateDocs({ sourceUrl: source, sourceDirectory: source, projectDir: output, into: true, yes: true, platform: 'mintlify', skipValidation: true, argv })

    const { raw, provenance } = readReport(result.reportPath)
    expect(provenance.argv).toEqual(['migrate', 'local-directory', '--platform', 'mintlify', '--source-ref', 'acme/sdk=sdk', '--api-key', '<redacted>'])
    expect(provenance.sources).toEqual([{ role: 'primary', url: 'local-directory', commit, dirty: false }])
    expect(provenance.engine).toMatchObject({ name: 'create-thally-docs', version: engineVersion })
    expect(raw).not.toContain('sk-not-a-real-key')
    expect(raw).not.toContain(source)
  })

  it('records the commit of the cloned repository and of each sourceRef repository', async () => {
    const { output } = localFixture()
    const result = await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir: output, into: true, yes: true, platform: 'mintlify', skipValidation: true, sourceRefs: [{ repo: 'acme/sdk', mountPath: 'sdk' }] })

    expect(result.pagesWritten).toBe(2)
    expect(readReport(result.reportPath).provenance.sources).toEqual([
      { role: 'primary', url: 'https://github.com/acme/docs', ref: 'HEAD', commit: clones.get('docs') },
      { role: 'sourceRef', url: 'https://github.com/acme/sdk', ref: 'HEAD', mountPath: 'sdk', commit: clones.get('sdk') },
    ])
    expect(clones.get('docs')).toMatch(/^[0-9a-f]{40,64}$/)
    expect(clones.get('sdk')).not.toBe(clones.get('docs'))
  })

  it('records a live site without a commit, and no argv when the caller gave none', async () => {
    const { output } = localFixture()
    const fetcher: MigrationFetcher = async (url) => {
      if (url.toString() === 'https://docs.example.com/docs') {
        return { finalUrl: url, contentType: 'text/html', body: '<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Documentation homepage with enough useful content to migrate safely.</p></main></body></html>' }
      }
      if (url.toString() === 'https://docs.example.com/docs.md') {
        return { finalUrl: url, contentType: 'text/markdown', body: '---\ntitle: Imported docs\n---\n\n# Imported docs\n\nThe imported page body.' }
      }
      throw new Error('not found')
    }
    const result = await migrateDocs({ sourceUrl: 'https://docs.example.com/docs', projectDir: output, into: true, yes: true, skipValidation: true, fetcher })

    const { provenance } = readReport(result.reportPath)
    expect(provenance.sources).toEqual([{ role: 'primary', url: 'https://docs.example.com/docs', commit: null }])
    expect(provenance).not.toHaveProperty('argv')
  })

  it('reports the engine commit only when run from a Thally checkout', () => {
    let prefix = ''
    try {
      prefix = git(packageDirectory, 'rev-parse', '--show-prefix')
    } catch {
      // An unpacked source tree is not a checkout.
    }
    expect(engineProvenance().commit).toBe(prefix === 'packages/create-thally-docs/' ? git(packageDirectory, 'rev-parse', 'HEAD') : null)
  })

  it('reports an uncommitted source as dirty and a non-git folder as having no commit', () => {
    const { source } = localFixture()
    expect(gitCommit(source, { atRoot: true })).toBeNull()
    commitAll(source)
    expect(gitHead(source)?.dirty).toBe(false)
    writeFileSync(join(source, 'added.mdx'), '# Added after the commit\n')
    expect(gitHead(source)?.dirty).toBe(true)
    // A clone must be its own checkout root, or its folder's enclosing repository would answer for it.
    mkdirSync(join(source, 'nested'))
    expect(gitCommit(join(source, 'nested'))).not.toBeNull()
    expect(gitCommit(join(source, 'nested'), { atRoot: true })).toBeNull()
    expect(gitCommit(source, { atRoot: true })).not.toBeNull()
  })

  it('ignores GIT_DIR and friends inherited from a git hook', () => {
    const outer = localFixture().source
    commitAll(outer)
    const inner = localFixture().source
    const innerCommit = commitAll(inner)
    vi.stubEnv('GIT_DIR', join(outer, '.git'))
    vi.stubEnv('GIT_WORK_TREE', outer)
    try {
      expect(gitHead(inner)?.commit).toBe(innerCommit)
      expect(gitCommit(join(tmpdir()), { atRoot: true })).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps credentials out of the recorded command line', () => {
    expect(redactArgv([
      'migrate', 'https://user:pass@docs.example.com/guide?token=abc#top', '--openapi', 'https://api.example.com/spec.json?key=secret',
      '--api-key', 'sk-secret', '--api-key=sk-inline', '--branch', 'main', '--source-ref', 'acme/sdk=sdk', 'https://docs.example.com',
    ])).toEqual([
      'migrate', 'https://docs.example.com/guide', '--openapi', 'https://api.example.com/spec.json',
      '--api-key', '<redacted>', '--api-key=<redacted>', '--branch', 'main', '--source-ref', 'acme/sdk=sdk', 'https://docs.example.com',
    ])
  })
})
