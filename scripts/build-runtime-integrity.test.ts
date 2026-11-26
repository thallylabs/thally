/** Actual generator admission fails before deleting or replacing tracked output. */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

/** Mirror the actual generator while keeping module resolution and writes isolated. */
function bootstrapFixture(mode: 'workspace' | 'published' | 'unavailable') {
  const root = mkdtempSync(join(tmpdir(), 'thally-generator-bootstrap-'))
  const repository = process.cwd(), modules = join(root, 'modules'), site = join(root, 'site')
  const write = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  mkdirSync(join(modules, 'scripts'), { recursive: true })
  mkdirSync(join(modules, 'node_modules/@mdx-js'), { recursive: true })
  copyFileSync(join(repository, 'scripts/build-runtime-sources.mts'), join(modules, 'scripts/build-runtime-sources.mts'))
  symlinkSync(join(repository, 'scripts/lib'), join(modules, 'scripts/lib'), 'dir')
  symlinkSync(join(repository, 'src'), join(modules, 'src'), 'dir')
  symlinkSync(join(repository, 'node_modules/@mdx-js/mdx'), join(modules, 'node_modules/@mdx-js/mdx'), 'dir')
  const installedCore = join(modules, 'node_modules/@thallylabs/core')
  write(join(installedCore, 'package.json'), readFileSync(join(repository, 'packages/core/package.json'), 'utf8'))
  if (mode === 'workspace') {
    const workspaceCore = join(modules, 'packages/core')
    write(join(workspaceCore, 'package.json'), '{"type":"module"}')
    write(join(workspaceCore, 'src/starter-integrity.ts'), readFileSync(join(repository, 'packages/core/src/starter-integrity.ts'), 'utf8'))
  } else if (mode === 'published') {
    mkdirSync(join(installedCore, 'dist'), { recursive: true })
    copyFileSync(join(repository, 'packages/core/dist/starter-integrity.js'), join(installedCore, 'dist/starter-integrity.js'))
  }
  write(join(site, 'docs.json'), '{"tabs":[{"tab":"Docs","pages":["intro"]}]}')
  write(join(site, 'src/content/intro.mdx'), '---\ntitle: Introduction\n---\n\nAn authored page for the isolated generator bootstrap regression.\n')
  // A customer's cwd is not the workspace containing the generator module.
  write(join(site, 'packages/core/src/starter-integrity.ts'), "throw new Error('must not import customer cwd Core')")
  const run = () => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(modules, 'scripts/build-runtime-sources.mts')], {
    cwd: site, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
  })
  return { root, modules, site, installedCore, run }
}

it('bootstraps workspace postinstall with no built Core integrity export', () => {
  const fixture = bootstrapFixture('workspace')
  try {
    expect(existsSync(join(fixture.installedCore, 'dist'))).toBe(false)
    const result = fixture.run()
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(result.status).toBe(0)
    expect(readFileSync(join(fixture.site, 'src/generated/runtime-sources.ts'), 'utf8')).toContain('An authored page')
  } finally { rmSync(fixture.root, { recursive: true, force: true }) }
})

it('uses the published Core export in standalone sites without workspace sources', () => {
  const fixture = bootstrapFixture('published')
  try {
    expect(existsSync(join(fixture.modules, 'packages'))).toBe(false)
    const result = fixture.run()
    expect(result.status).toBe(0)
    expect(readFileSync(join(fixture.site, 'src/generated/runtime-docs.ts'), 'utf8')).toContain('intro.mdx')
  } finally { rmSync(fixture.root, { recursive: true, force: true }) }
})

it('fails closed before generating when neither Core entry is available', () => {
  const fixture = bootstrapFixture('unavailable')
  try {
    expect(fixture.run().status).toBe(1)
    expect(existsSync(join(fixture.site, 'src/generated'))).toBe(false)
  } finally { rmSync(fixture.root, { recursive: true, force: true }) }
})

it('reports reserved tracked outputs before any generator mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'thally-build-integrity-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    const path = 'public/_thally/content/keep.txt', sentinel = 'generated-body-must-not-be-logged'
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), sentinel)
    execFileSync('git', ['add', '--', path], { cwd: root })
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(process.cwd(), 'scripts/build-runtime-sources.mts')], {
      cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
    })
    expect(result.status).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('Reserved generated runtime output is tracked in Git')
    expect(output).not.toContain(sentinel)
    expect(readFileSync(join(root, path), 'utf8')).toBe(sentinel)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
