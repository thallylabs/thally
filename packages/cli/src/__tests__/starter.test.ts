/** CLI confirmation-boundary coverage for immutable starter updates. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScaffoldRelease } from 'create-thally-docs/release'
import type { StarterUpdateResult } from 'create-thally-docs/starter-update'

import { runStarterCommand } from '../commands/starter.js'
import { parseArgs } from '../router.js'

const updateStarterProject = vi.hoisted(() => vi.fn())

vi.mock('create-thally-docs/starter-update', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('create-thally-docs/starter-update')
  >()
  return { ...original, updateStarterProject }
})

const release = {
  starterVersion: 2,
} as ScaffoldRelease

const result: StarterUpdateResult = {
  previousRelease: { starterVersion: 1 } as ScaffoldRelease,
  targetRelease: release,
  plan: {
    copyPaths: ['framework/runtime.ts'],
    deletePaths: [],
    conflictPaths: [],
    manualReviewPaths: [],
    preservedPaths: [],
    unchangedPaths: [],
    targetPreconditions: {
      'framework/runtime.ts': { kind: 'file', sha256: '0'.repeat(64) },
    },
  },
  isUpToDate: false,
  applied: false,
}

afterEach(() => {
  vi.restoreAllMocks()
  updateStarterProject.mockReset()
})

describe('thally starter update', () => {
  it('ships an unpublished-version-safe exact toolchain dependency chain', () => {
    const readPackage = (name: string) => JSON.parse(
      readFileSync(join(process.cwd(), 'packages', name, 'package.json'), 'utf8'),
    ) as { version: string; dependencies?: Record<string, string> }
    const createPackage = readPackage('create-thally-docs')
    const mcpPackage = readPackage('mcp')
    const cliPackage = readPackage('cli')

    expect(createPackage.version).toBe('0.10.2')
    expect(mcpPackage.version).toBe('0.10.2')
    expect(mcpPackage.dependencies?.['create-thally-docs']).toBe('0.10.2')
    expect(cliPackage.version).toBe('0.8.2')
    expect(cliPackage.dependencies).toMatchObject({
      '@thallylabs/mcp': '0.10.2',
      'create-thally-docs': '0.10.2',
    })
  })

  it('is a dry run unless --apply explicitly confirms mutation', async () => {
    updateStarterProject.mockResolvedValue(result)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(
      runStarterCommand(parseArgs(['starter', 'update'])),
    ).resolves.toBe(0)
    expect(updateStarterProject).toHaveBeenLastCalledWith({
      targetDir: process.cwd(),
      apply: false,
      confirmed: false,
    })

    updateStarterProject.mockResolvedValue({ ...result, applied: true })
    await expect(
      runStarterCommand(parseArgs(['starter', 'update', '--apply'])),
    ).resolves.toBe(0)
    expect(updateStarterProject).toHaveBeenLastCalledWith({
      targetDir: process.cwd(),
      apply: true,
      confirmed: true,
    })
  })

  it('returns a non-zero dry-run result when customer conflicts need review', async () => {
    updateStarterProject.mockResolvedValue({
      ...result,
      plan: {
        ...result.plan,
        conflictPaths: ['framework/runtime.ts'],
      },
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(
      runStarterCommand(parseArgs(['starter', 'update'])),
    ).resolves.toBe(1)
  })
})
