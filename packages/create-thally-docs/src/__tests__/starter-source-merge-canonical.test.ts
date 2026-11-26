/** Constructed two-date-edit customization over exact public runtime snapshots. */
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { applyStarterRuntimeSyncPlan, planStarterRuntimeSync } from '../starter-sync.js'

const fixture = join(import.meta.dirname, 'fixtures/starter-source-merge')
const base = readFileSync(join(fixture, '607-docs.ts.txt'), 'utf8')
const previousTarget = readFileSync(join(fixture, '429-docs.ts.txt'), 'utf8')
const dateImport = "import pageDates from '@/generated/page-dates.json'\n"
const reactImport = "import type { ComponentType } from 'react'\n"
const originalDate = "lastUpdated: fm.lastUpdated ?? '',"
const customDate = "lastUpdated: fm.lastUpdated ?? (pageDates as Record<string, string>)[pageId] ?? '',"
const directories: string[] = []

function customDates(source: string): string {
  expect(source.split(reactImport)).toHaveLength(2)
  expect(source.split(originalDate)).toHaveLength(2)
  return source.replace(reactImport, reactImport + dateImport).replace(originalDate, customDate)
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('constructed canonical runtime/date customization', () => {
  it.each([
    ['429 canonical', () => previousTarget],
    ['current combined target', () => readFileSync(join(process.cwd(), 'src/data/docs.ts'), 'utf8')],
  ] as const)('merges 607 plus the two relayed edits into %s', (_label, targetSource) => {
    const workspace = mkdtempSync(join(tmpdir(), 'thally-canonical-source-merge-'))
    directories.push(workspace)
    const old = join(workspace, 'old'), next = join(workspace, 'next'), target = join(workspace, 'local')
    const upstream = targetSource()
    write(old, 'src/data/docs.ts', base)
    write(next, 'src/data/docs.ts', upstream)
    write(target, 'src/data/docs.ts', customDates(base))
    write(target, 'src/generated/page-dates.json', '{"example":"2026-01-01"}\n')
    const ownership = { frameworkSyncEligible: ['src/data/docs.ts'], userOwnedNeverOverwrite: ['src/generated/**'], manualReview: [] }
    const plan = planStarterRuntimeSync(old, next, target, ownership)
    expect(plan.conflictPaths).toEqual([])
    expect(plan.mergedContents?.['src/data/docs.ts']).toBe(customDates(upstream))
    applyStarterRuntimeSyncPlan(next, target, plan, ownership, { confirmed: true })
    const merged = readFileSync(join(target, 'src/data/docs.ts'), 'utf8')
    expect(merged).toBe(customDates(upstream))
    expect(merged).toContain('export async function ensureAuthoritativeDocPublication')
    expect(merged).toContain('publishedRecordLoads')
    expect(merged.replace(dateImport, '').replace(customDate, originalDate)).toBe(upstream)
    expect(readFileSync(join(target, 'src/generated/page-dates.json'), 'utf8')).toBe('{"example":"2026-01-01"}\n')
  })
})
