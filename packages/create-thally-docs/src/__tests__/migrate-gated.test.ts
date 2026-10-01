/** Access-restricted pages are quarantined on disk and reported prominently, last. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installDepsMock, initGitMock, validateMigrationMock, fixture } = vi.hoisted(() => ({
  fixture: { gated: true, oversized: false, droppedGated: 0 },
  installDepsMock: vi.fn(),
  initGitMock: vi.fn(),
  validateMigrationMock: vi.fn(),
}))

vi.mock('../utils.js', () => ({ installDeps: installDepsMock, initGit: initGitMock }))
vi.mock('../migrate/validate.js', () => ({ validateMigration: validateMigrationMock }))
vi.mock('@thallylabs/migrate', async (importOriginal) => {
  const original = await importOriginal<typeof import('@thallylabs/migrate')>()
  return {
  ...original,
  // The file-limit drop itself is tested in packages/migrate; here only the CLI/report plumbing.
  migrateRepository: (options: Parameters<typeof original.migrateRepository>[0]) => {
    const bundle = original.migrateRepository(options)
    return fixture.droppedGated > 0 ? { ...bundle, droppedGatedPages: fixture.droppedGated } : bundle
  },
  cloneGitHubRepository: async (_source: unknown, directory: string) => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'docs.json'), JSON.stringify({ navigation: { pages: ['intro', 'private'] } }))
    writeFileSync(join(directory, 'intro.mdx'), '---\ntitle: Intro\n---\n\nHello\n')
    if (fixture.oversized) {
      writeFileSync(join(directory, 'private.mdx'), `---\ntitle: Private\ngroups: [admin]\n---\n\n${'x'.repeat(2_100_000)}\n`)
      return
    }
    writeFileSync(join(directory, 'private.mdx'), `---\ntitle: Private\n${fixture.gated ? 'groups: [admin]\n' : ''}---\n\nSecret\n\n![p](/img/p.png)\n`)
    mkdirSync(join(directory, 'img'), { recursive: true })
    writeFileSync(join(directory, 'img/p.png'), 'PNG')
  },
  }
})

import { migrateDocs } from '../migrate/index.js'

describe('gated page migration output', () => {
  beforeEach(() => {
    fixture.gated = true
    fixture.oversized = false
    fixture.droppedGated = 0
    vi.clearAllMocks()
    validateMigrationMock.mockResolvedValue({ content: 'passed', build: 'passed', messages: [] })
  })

  it('writes the quarantine outside published paths and prints gated warnings last', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-gated-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' })

    expect(result.pagesWritten).toBe(1)
    expect(existsSync(join(projectDir, 'src/content/private.mdx'))).toBe(false)
    expect(readFileSync(join(projectDir, 'migration-quarantine/private.mdx'), 'utf8')).toContain('Secret')
    const report = JSON.parse(readFileSync(result.reportPath, 'utf8')) as { quarantined: number; quarantinedAssets: number; warnings: Array<{ code: string }> }
    expect(report.quarantined).toBe(1)
    expect(report.quarantinedAssets).toBe(1)
    expect(existsSync(join(projectDir, 'public/img/p.png'))).toBe(false)
    expect(report.warnings.some((warning) => warning.code === 'gated-page')).toBe(true)
    const printed = warn.mock.calls.map((call) => String(call[0]))
    const header = printed.findIndex((line) => line.includes('ACCESS-RESTRICTED CONTENT'))
    expect(header).toBeGreaterThanOrEqual(0)
    expect(printed.slice(header).filter((line) => line.includes('private.mdx'))).toHaveLength(1)
    expect(printed.slice(0, header).some((line) => line.includes('private.mdx'))).toBe(false)
  })

  it('counts gated pages dropped by the file limit in the report and the restricted-content block', async () => {
    fixture.droppedGated = 3
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-gated-dropped-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' })
    const report = JSON.parse(readFileSync(result.reportPath, 'utf8')) as { quarantined: number; droppedGatedPages: number }
    expect(report.droppedGatedPages).toBe(3)
    expect(report.quarantined).toBe(1)
    const printed = warn.mock.calls.map((call) => String(call[0]))
    const header = printed.findIndex((line) => line.includes('ACCESS-RESTRICTED CONTENT'))
    expect(printed.slice(header).some((line) => /3 access-restricted page\(s\) were dropped by the file limit/.test(line))).toBe(true)
  }, 30_000)

  it('reports zero dropped gated pages when none were dropped', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-gated-nodrop-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [] }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' })
    expect((JSON.parse(readFileSync(result.reportPath, 'utf8')) as { droppedGatedPages: number }).droppedGatedPages).toBe(0)
  }, 30_000)

  it('git-ignores the quarantine folder without clobbering or duplicating .gitignore entries', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-gated-ignore-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [] }))
    writeFileSync(join(projectDir, '.gitignore'), '/node_modules\n.env')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const options = { sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' as const }

    await migrateDocs(options)
    await migrateDocs(options)

    const lines = readFileSync(join(projectDir, '.gitignore'), 'utf8').split('\n')
    expect(lines.slice(0, 2)).toEqual(['/node_modules', '.env'])
    expect(lines.filter((line) => line === '/migration-quarantine/')).toHaveLength(1)
  })

  it('creates .gitignore when absent and leaves a pre-existing quarantine entry alone', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'thally-cli-gated-fresh-'))
    writeFileSync(join(fresh, 'docs.json'), JSON.stringify({ tabs: [] }))
    const existing = mkdtempSync(join(tmpdir(), 'thally-cli-gated-existing-'))
    writeFileSync(join(existing, 'docs.json'), JSON.stringify({ tabs: [] }))
    writeFileSync(join(existing, '.gitignore'), 'migration-quarantine\n')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (const projectDir of [fresh, existing]) {
      await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' })
    }
    expect(readFileSync(join(fresh, '.gitignore'), 'utf8')).toContain('/migration-quarantine/')
    expect(readFileSync(join(existing, '.gitignore'), 'utf8')).toBe('migration-quarantine\n')
  })

  it('adds the quarantine entry again when a later .gitignore line re-includes the folder', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-gated-negated-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [] }))
    writeFileSync(join(projectDir, '.gitignore'), 'migration-quarantine\n!migration-quarantine/\n')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' })
    const lines = readFileSync(join(projectDir, '.gitignore'), 'utf8').split('\n')
    expect(lines.lastIndexOf('/migration-quarantine/')).toBeGreaterThan(lines.lastIndexOf('!migration-quarantine/'))
  })

  const reviewLines = async (gated: boolean, oversized = false): Promise<Array<string>> => {
    fixture.gated = gated
    fixture.oversized = oversized
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-gated-review-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await migrateDocs({ sourceUrl: 'https://github.com/acme/docs', projectDir, into: true, yes: true, platform: 'mintlify' })
    return warn.mock.calls.map((call) => String(call[0])).filter((line) => /migration-quarantine\/assets\/ and the dashboard access settings/.test(line))
  }

  it('tells a gated site once to review the quarantined assets and the dashboard access settings', async () => {
    expect(await reviewLines(true)).toHaveLength(1)
  })

  it('never shows that review instruction for a site with no withheld content', async () => {
    expect(await reviewLines(false)).toHaveLength(0)
  })

  it('tells the user to review when the only restricted page is oversized and has no assets', async () => {
    expect(await reviewLines(true, true)).toHaveLength(1)
  })
})
