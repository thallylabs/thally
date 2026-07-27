/**
 * Guards the MCP migration contract that keeps template creation distinct
 * from deliberate in-place content imports.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  migrateDocs: vi.fn(),
}))

vi.mock('create-thally-docs/migrate', () => ({
  migrateDocs: mocks.migrateDocs,
}))

import { getTool } from '../lib/tools.js'
import {
  handleImportDocs,
  handleMigrateDocs,
  migrateDocsSchema,
} from '../tools/migrate-docs.js'

const migrationResult = {
  pagesWritten: 35,
  assetsWritten: 4,
  projectDir: '/tmp/procta-docs',
  platform: 'thally' as const,
  warnings: [],
}

describe('MCP documentation migration modes', () => {
  beforeEach(() => {
    mocks.migrateDocs.mockReset()
    mocks.migrateDocs.mockResolvedValue(migrationResult)
  })

  it('never exposes or honors the in-place flag through migrate_docs', async () => {
    expect('into' in migrateDocsSchema.shape).toBe(false)

    await handleMigrateDocs({
      sourceUrl: 'https://docs.procta.org',
      projectDir: '/tmp/procta-docs',
      // Prove that even a stale client bypassing schema validation cannot
      // switch the handler away from template-first behavior.
      into: true,
    } as unknown as Parameters<typeof handleMigrateDocs>[0])

    expect(mocks.migrateDocs).toHaveBeenCalledWith(
      expect.objectContaining({
        into: false,
        yes: true,
      }),
    )
  })

  it('reports that a migration created a fresh Thally template', async () => {
    const message = await handleMigrateDocs({
      sourceUrl: 'https://docs.procta.org',
      projectDir: '/tmp/procta-docs',
    })

    expect(message).toContain('Created a fresh Thally template')
    expect(message).toContain('35 pages')
  })

  it('reserves in-place writes for the explicitly named import_docs tool', async () => {
    const message = await handleImportDocs({
      sourceUrl: 'https://github.com/example/docs',
      projectDir: '/tmp/existing-thally-docs',
    })

    expect(mocks.migrateDocs).toHaveBeenCalledWith(
      expect.objectContaining({
        into: true,
        yes: true,
      }),
    )
    expect(message).toContain('existing Thally project')

    const tool = getTool('import_docs')
    expect(tool?.description).toContain('explicitly requested')
    expect(getTool('migrate_docs')?.description).toContain('fresh canonical Thally template')
  })
})
