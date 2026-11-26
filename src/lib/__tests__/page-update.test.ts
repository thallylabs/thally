/** Page dates are provenance, not filesystem/build observation timestamps. */

import { createHash } from 'node:crypto'
import { collectRuntimeContentFiles, writeManagedContentAssets } from '../../../scripts/lib/runtime-content-files'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attachPageUpdates } from '../../../scripts/lib/page-updates'
import { parseFrontmatter } from '@/lib/frontmatter'
import { normalizePageUpdateDate, normalizePageUpdateMetadata, resolvePageUpdate } from '@/lib/page-update'

const directories: Array<string> = []
const filePath = 'src/content/guide.mdx'
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'thally-page-dates-'))
  directories.push(root)
  mkdirSync(path.join(root, 'src/content'), { recursive: true })
  writeFileSync(path.join(root, filePath), '# Guide')
  return root
}
function sources(root: string) { return { [filePath]: { content: readFileSync(path.join(root, filePath), 'utf8') } } }
function git(root: string, args: Array<string>, date?: string) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  }).trim()
}
function commit(root: string, date: string) {
  git(root, ['add', '.'])
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'test: update documentation fixture'], date)
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('canonical page dates', () => {
  it('validates real ISO dates and preserves optional explicit aliases', () => {
    expect(normalizePageUpdateDate('2026-02-30')).toBeUndefined()
    expect(normalizePageUpdateDate('yesterday')).toBeUndefined()
    expect(normalizePageUpdateDate('2024-02-29')).toBe('2024-02-29')
    const automatic = { date: '2025-01-01', source: 'git' as const }
    const frontmatter = parseFrontmatter('---\nlast_updated: 2026-11-27\nlastUpdated: 2020-01-01\n---\nContent').data
    expect(resolvePageUpdate(frontmatter, automatic)).toEqual({ date: '2026-11-27', source: 'frontmatter' })
    expect(resolvePageUpdate({ lastUpdated: '2020-01-01' }, automatic)?.date).toBe('2020-01-01')
    expect(resolvePageUpdate({ last_updated: 'invalid' }, automatic)).toEqual(automatic)
    expect(normalizePageUpdateMetadata({ date: '2026-01-01', source: 'mtime' })).toBeUndefined()
  })

  it('records Published once without Git and changes only the edited file hash', () => {
    const root = fixture()
    const first = sources(root)
    attachPageUpdates(root, first, '2025-01-01T00:00:00Z')
    expect(first[filePath]).toMatchObject({ pageUpdate: { date: '2025-01-01T00:00:00Z', source: 'first-published' } })
    const unchanged = sources(root)
    attachPageUpdates(root, unchanged, '2026-01-01T00:00:00Z')
    expect(unchanged).toEqual(first)
    writeFileSync(path.join(root, filePath), '# Changed guide')
    const changed = sources(root)
    attachPageUpdates(root, changed, '2026-02-01T00:00:00Z')
    expect(changed[filePath]).toMatchObject({ pageUpdate: { date: '2026-02-01T00:00:00Z', source: 'content-change' } })
  })

  it('uses the latest clean physical-path commit and ignores unrelated commits', () => {
    const root = fixture()
    git(root, ['init', '-b', 'main'])
    writeFileSync(path.join(root, '.gitignore'), '.thally/\n')
    commit(root, '2020-01-01T12:00:00Z')
    const first = sources(root)
    attachPageUpdates(root, first)
    expect(first[filePath]).toMatchObject({ pageUpdate: { date: expect.stringMatching(/^2020-01-01T12:00:00(?:Z|\+00:00)$/), source: 'git' } })
    writeFileSync(path.join(root, 'README.md'), 'Unrelated')
    commit(root, '2021-01-01T12:00:00Z')
    const same = sources(root)
    attachPageUpdates(root, same)
    expect(same).toEqual(first)
    writeFileSync(path.join(root, filePath), '# Committed new guide')
    commit(root, '2022-01-01T12:00:00Z')
    const updated = sources(root)
    attachPageUpdates(root, updated)
    expect(updated[filePath]).toMatchObject({ pageUpdate: { date: expect.stringMatching(/^2022-01-01T12:00:00(?:Z|\+00:00)$/), source: 'git' } })
  })

  it('does not mistake shallow-boundary checkout history for a source update', () => {
    const root = fixture()
    git(root, ['init', '-b', 'main'])
    commit(root, '2020-01-01T12:00:00Z')
    writeFileSync(path.join(root, 'README.md'), 'Unrelated')
    commit(root, '2021-01-01T12:00:00Z')
    const clone = mkdtempSync(path.join(tmpdir(), 'thally-page-shallow-'))
    directories.push(clone)
    git(clone, ['clone', '--depth=1', `file://${root}`, '.'])
    const imported = sources(clone)
    attachPageUpdates(clone, imported, '2026-01-01T00:00:00Z')
    expect(imported[filePath]).toMatchObject({ pageUpdate: { date: '2026-01-01T00:00:00Z', source: 'first-published' } })
  })

  it('honors trusted per-file provenance ahead of a retained generator cache', () => {
    const root = fixture()
    attachPageUpdates(root, sources(root), '2020-01-01T00:00:00Z')
    const trusted = { [filePath]: { content: '# Guide', pageUpdate: { date: '2026-01-01', source: 'git' as const } } }
    attachPageUpdates(root, trusted)
    expect(trusted[filePath].pageUpdate).toEqual({ date: '2026-01-01', source: 'git' })
  })
})


describe('date override and validation boundary', () => {
  it('accepts unquoted last_updated through the real YAML parser and prefers it over legacy dates', () => {
    const parsed = parseFrontmatter('---\nlast_updated: 2026-11-27\nlastUpdated: 2020-01-01\n---\nBody')
    expect(resolvePageUpdate(parsed.data, { date: '2025-01-01', source: 'git' })).toEqual({ date: '2026-11-27', source: 'frontmatter' })
  })
  it.each(['2026-02-30', 'yesterday', '2026-13-01', '2026-11-27T99:00:00Z'])('rejects invalid dates: %s', (date) => {
    expect(normalizePageUpdateDate(date)).toBeUndefined()
    expect(normalizePageUpdateMetadata({ date, source: 'git' })).toBeUndefined()
  })
  it('falls back to valid automatic provenance when authored metadata is invalid', () => {
    expect(resolvePageUpdate({ last_updated: '2026-02-30' }, { date: '2026-02-28', source: 'first-published' })).toEqual({ date: '2026-02-28', source: 'first-published' })
  })
})


describe('generated provenance integrity', () => {
  it.each(['directory', 'file'])('rejects a symlinked cache %s without changing an outside file', (kind) => {
    const root = fixture()
    const outside = fixture()
    const sentinel = path.join(outside, 'page-updates.json')
    writeFileSync(sentinel, 'outside sentinel')
    if (kind === 'directory') symlinkSync(outside, path.join(root, '.thally'))
    else { mkdirSync(path.join(root, '.thally')); symlinkSync(sentinel, path.join(root, '.thally/page-updates.json')) }
    expect(() => attachPageUpdates(root, sources(root))).toThrow('Page date cache path')
    expect(readFileSync(sentinel, 'utf8')).toBe('outside sentinel')
  })
  it('does not trust Git status when assume-unchanged hides modified physical bytes', () => {
    const root = fixture()
    git(root, ['init', '-b', 'main'])
    commit(root, '2020-01-01T12:00:00Z')
    git(root, ['update-index', '--assume-unchanged', filePath])
    writeFileSync(path.join(root, filePath), '# Changed but status-hidden')
    const result = sources(root)
    attachPageUpdates(root, result, '2026-11-27')
    expect(result[filePath]).toMatchObject({ pageUpdate: { date: '2026-11-27', source: 'first-published' } })
  })
  it('keeps physical OpenAPI identity distinct from sanitized published identity', async () => {
    const root = fixture()
    const raw = JSON.stringify({ openapi: '3.1.0', info: { title: 'Example', version: '1' }, paths: { '/secret': { get: { 'x-excluded': true, responses: { 200: { description: 'OK' } } } }, '/public': { get: { responses: { 200: { description: 'OK' } } } } } })
    writeFileSync(path.join(root, 'openapi.json'), raw)
    const first = collectRuntimeContentFiles(root)
    const identity = createHash('sha256').update(raw).digest('hex')
    expect(first['openapi.json'].rawSha256).toBe(identity)
    expect(first['openapi.json'].content).not.toBe(raw)
    const manifest = await writeManagedContentAssets(root, first)
    expect(manifest.files['openapi.json'].rawSha256).toBe(identity)
    expect(manifest.files['openapi.json'].sha256).toBe(createHash('sha256').update(first['openapi.json'].content).digest('hex'))
    expect(manifest.files['openapi.json'].sha256).not.toBe(identity)
  })
})
