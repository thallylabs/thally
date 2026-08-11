/**
 * Managed-content build regression coverage.
 *
 * The executable generated modules must remain byte-for-byte constant as a
 * documentation corpus grows; only the immutable static-asset tree may grow.
 */

import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

interface GeneratedSnapshot {
  runtimeSources: string
  runtimeDocs: string
  manifest: {
    version: number
    files: Record<string, { modifiedAtMs: number }>
  }
}

const temporaryRoots: Array<string> = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createProject(pageCount: number): string {
  const root = mkdtempSync(path.join(tmpdir(), 'thally-managed-content-'))
  temporaryRoots.push(root)
  mkdirSync(path.join(root, 'src/content'), { recursive: true })
  mkdirSync(path.join(root, 'snippets'), { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })
  writeFileSync(path.join(root, 'docs.json'), '{"tabs":[]}\n', 'utf8')
  writeFileSync(path.join(root, 'AGENTS.md'), '# Project guidance\n', 'utf8')
  writeFileSync(
    path.join(root, 'public/openapi.json'),
    '{"openapi":"3.1.0","info":{"title":"Example","version":"1"},"paths":{}}\n',
    'utf8',
  )
  for (let index = 0; index < pageCount; index += 1) {
    writeFileSync(
      path.join(root, `src/content/page-${index}.mdx`),
      `---\ntitle: Page ${index}\n---\n\n${'Body content. '.repeat(30)}\n`,
      'utf8',
    )
  }
  return root
}

function runManagedGenerator(root: string): GeneratedSnapshot {
  const repositoryRoot = process.cwd()
  execFileSync(
    path.join(repositoryRoot, 'node_modules/.bin/tsx'),
    [path.join(repositoryRoot, 'scripts/build-runtime-sources.mts')],
    {
      cwd: root,
      env: { ...process.env, THALLY_CONTENT_SOURCE: 'assets' },
      stdio: 'pipe',
    },
  )
  return {
    runtimeSources: readFileSync(path.join(root, 'src/generated/runtime-sources.ts'), 'utf8'),
    runtimeDocs: readFileSync(path.join(root, 'src/generated/runtime-docs.ts'), 'utf8'),
    manifest: JSON.parse(
      readFileSync(path.join(root, 'public/_thally/content/manifest.json'), 'utf8'),
    ) as GeneratedSnapshot['manifest'],
  }
}

describe('managed content build', () => {
  it(
    'keeps generated Worker modules constant while the asset corpus grows',
    { timeout: 30_000 },
    () => {
      const small = runManagedGenerator(createProject(2))
      const largeRoot = createProject(1_000)
      const large = runManagedGenerator(largeRoot)

      expect(large.runtimeSources).toBe(small.runtimeSources)
      expect(large.runtimeDocs).toBe(small.runtimeDocs)
      expect(Object.keys(small.manifest.files)).toHaveLength(5)
      expect(Object.keys(large.manifest.files)).toHaveLength(1_003)
      expect(
        readFileSync(
          path.join(largeRoot, 'public/_thally/content/src/content/page-999.mdx'),
          'utf8',
        ),
      ).toContain('title: Page 999')
      expect(
        readFileSync(path.join(largeRoot, 'public/_thally/content/public/openapi.json'), 'utf8'),
      ).toContain('"openapi":"3.1.0"')
    },
  )

  it('is idempotent and never inventories its generated asset tree', { timeout: 30_000 }, () => {
    const root = createProject(3)
    const first = runManagedGenerator(root)
    const second = runManagedGenerator(root)

    expect(second.manifest).toEqual(first.manifest)
    expect(Object.keys(second.manifest.files)).toHaveLength(6)
    expect(Object.keys(second.manifest.files).some((file) => file.includes('_thally'))).toBe(false)
    expect(readdirSync(path.join(root, 'public/_thally/content/public'))).toEqual([
      'openapi.json',
    ])
  })
})
