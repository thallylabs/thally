/** Access-restricted pages are quarantined on disk and reported prominently, last. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installDepsMock, initGitMock, validateMigrationMock } = vi.hoisted(() => ({
  installDepsMock: vi.fn(),
  initGitMock: vi.fn(),
  validateMigrationMock: vi.fn(),
}))

vi.mock('../utils.js', () => ({ installDeps: installDepsMock, initGit: initGitMock }))
vi.mock('../migrate/validate.js', () => ({ validateMigration: validateMigrationMock }))
vi.mock('@thallylabs/migrate', async (importOriginal) => ({
  ...await importOriginal<typeof import('@thallylabs/migrate')>(),
  cloneGitHubRepository: async (_source: unknown, directory: string) => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'docs.json'), JSON.stringify({ navigation: { pages: ['intro', 'private'] } }))
    writeFileSync(join(directory, 'intro.mdx'), '---\ntitle: Intro\n---\n\nHello\n')
    writeFileSync(join(directory, 'private.mdx'), '---\ntitle: Private\ngroups: [admin]\n---\n\nSecret\n')
  },
}))

import { migrateDocs } from '../migrate/index.js'

describe('gated page migration output', () => {
  beforeEach(() => {
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
    const report = JSON.parse(readFileSync(result.reportPath, 'utf8')) as { quarantined: number; warnings: Array<{ code: string }> }
    expect(report.quarantined).toBe(1)
    expect(report.warnings.some((warning) => warning.code === 'gated-page')).toBe(true)
    const printed = warn.mock.calls.map((call) => String(call[0]))
    const header = printed.findIndex((line) => line.includes('ACCESS-RESTRICTED CONTENT'))
    expect(header).toBeGreaterThanOrEqual(0)
    expect(printed.slice(header).filter((line) => line.includes('private.mdx'))).toHaveLength(1)
    expect(printed.slice(0, header).some((line) => line.includes('private.mdx'))).toBe(false)
  })

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
})
