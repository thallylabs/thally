/** End-to-end CLI materialization through the shared public URL engine. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MigrationFetcher } from '@thallylabs/migrate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { scaffoldMock, installDepsMock, initGitMock } = vi.hoisted(() => ({
  scaffoldMock: vi.fn(),
  installDepsMock: vi.fn(),
  initGitMock: vi.fn(),
}))

vi.mock('../scaffold.js', () => ({ scaffold: scaffoldMock }))
vi.mock('../utils.js', () => ({ installDeps: installDepsMock, initGit: initGitMock }))

import { migrateDocs } from '../migrate/index.js'

describe('CLI migration flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discovers, merges, and writes a live docs migration into an existing project', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-cli-migrate-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{ tab: 'Existing', groups: [{ group: 'Keep', pages: ['existing', 'introduction'] }] }],
    }))
    const fetcher: MigrationFetcher = async (url) => {
      if (url.toString() === 'https://docs.example.com/docs') {
        return {
          finalUrl: url,
          contentType: 'text/html',
          body: '<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Documentation homepage with enough useful content to migrate safely.</p></main></body></html>',
        }
      }
      if (url.toString() === 'https://docs.example.com/docs.md') {
        return {
          finalUrl: url,
          contentType: 'text/markdown',
          body: '---\ntitle: Imported docs\ndescription: Migrated documentation.\n---\n\n# Imported docs\n\nThe imported page body.',
        }
      }
      throw new Error('not found')
    }

    const result = await migrateDocs({
      sourceUrl: 'https://docs.example.com/docs',
      projectDir,
      into: true,
      yes: true,
      fetcher,
    })

    expect(result.pagesWritten).toBe(1)
    expect(readFileSync(join(projectDir, 'src/content/introduction.mdx'), 'utf8')).toContain('The imported page body.')
    const config = JSON.parse(readFileSync(join(projectDir, 'docs.json'), 'utf8')) as { tabs: Array<{ tab: string }> }
    expect(config.tabs.map((tab) => tab.tab)).toEqual(['Existing'])
  })

  it('replaces starter content only when scaffolding a fresh migration', async () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'thally-cli-fresh-migrate-'))
    const projectDir = join(parentDir, 'site')
    scaffoldMock.mockImplementationOnce(async ({ projectDir: targetDir }: { projectDir: string }) => {
      mkdirSync(join(targetDir, 'src/content/es'), { recursive: true })
      writeFileSync(join(targetDir, 'docs.json'), JSON.stringify({
        tabs: [{ tab: 'Starter', groups: [{ group: 'Start', pages: ['introduction', 'quickstart'] }] }],
      }))
      writeFileSync(join(targetDir, 'src/content/introduction.mdx'), 'Starter introduction')
      writeFileSync(join(targetDir, 'src/content/quickstart.mdx'), 'Starter quickstart')
      writeFileSync(join(targetDir, 'src/content/es/introduction.mdx'), 'Starter translation')
      writeFileSync(join(targetDir, 'openapi.yaml'), 'openapi: 3.0.0')
      return { projectDir: targetDir }
    })
    const fetcher: MigrationFetcher = async (url) => {
      if (url.toString() === 'https://docs.example.com/docs') {
        return {
          finalUrl: url,
          contentType: 'text/html',
          body: '<html><head><title>Docs</title></head><body><main><h1>Docs</h1><p>Documentation homepage with enough useful content to migrate safely.</p></main></body></html>',
        }
      }
      if (url.toString() === 'https://docs.example.com/docs.md') {
        return {
          finalUrl: url,
          contentType: 'text/markdown',
          body: '---\ntitle: Imported docs\ndescription: Migrated documentation.\n---\n\n# Imported docs\n\nThe imported page body.',
        }
      }
      throw new Error('not found')
    }

    await migrateDocs({
      sourceUrl: 'https://docs.example.com/docs',
      projectDir,
      into: false,
      yes: true,
      fetcher,
    })

    expect(readFileSync(join(projectDir, 'src/content/introduction.mdx'), 'utf8')).toContain('The imported page body.')
    expect(existsSync(join(projectDir, 'src/content/quickstart.mdx'))).toBe(false)
    expect(existsSync(join(projectDir, 'src/content/es/introduction.mdx'))).toBe(false)
    expect(existsSync(join(projectDir, 'openapi.yaml'))).toBe(false)
    expect(installDepsMock).toHaveBeenCalledWith(projectDir)
    expect(initGitMock).toHaveBeenCalledWith(projectDir)
  })
})
