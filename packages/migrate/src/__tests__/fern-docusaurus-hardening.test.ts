/** Adversarial inputs for the Fern and Docusaurus migrators. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readDocusaurusRedirects, readDocusaurusSiteSettings } from '../docusaurus.js'
import { migrateRepository, renderMigrationFiles } from '../index.js'
import { pageIdFromReference } from '../path.js'

function docusaurusSite(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-harden-docusaurus-'))
  writeFileSync(join(root, 'docusaurus.config.ts'), "export default { presets: [['classic', { docs: { sidebarPath: './sidebars.ts' } }]] }")
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function migrateDocusaurus(files: Record<string, string>) {
  return migrateRepository({ repositoryDir: docusaurusSite(files), sourceUrl: 'https://github.com/acme/docs', platform: 'docusaurus' })
}

describe('Docusaurus route identity', () => {
  it.each(['/../../escape', '/%2e%2e/%2e%2e/escape', '/a/./b/../../../escape'])('never lets slug %s leave the content directory', (slug) => {
    const bundle = migrateDocusaurus({ 'docs/a.md': `---\nslug: ${slug}\n---\n# A\n`, 'docs/b.md': '# B\n' })
    for (const page of bundle.pages) expect(page.navigationId.split('/')).not.toContain('..')
    for (const file of renderMigrationFiles(bundle)) expect(file.path.split('/')).not.toContain('..')
  })
})

describe('shared page identity', () => {
  it('drops percent-encoded dot segments from a page reference', () => {
    expect(pageIdFromReference('%2e%2e/%2e%2e/x.md')).toBe('x')
    expect(pageIdFromReference('docs/%2E/x.md')).toBe('docs/x')
  })
})

describe('Docusaurus config parsing', () => {
  it('reads a config padded with 50k blank lines in linear time', () => {
    const root = docusaurusSite({ 'docusaurus.config.js': `${'\n'.repeat(50_000)}module.exports = {\n  title: 'Acme',\n}\n` })
    const started = Date.now()
    expect(readDocusaurusSiteSettings(root).name).toBe('Acme')
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('Docusaurus redirects', () => {
  const configWith = (redirects: string): string => `module.exports = { plugins: [['@docusaurus/plugin-client-redirects', { redirects: [${redirects}] }]] }`

  it('drops a wildcard Next.js cannot express instead of emitting a redirect that fails the build', () => {
    const root = docusaurusSite({ 'docusaurus.config.js': configWith("{ from: '/old/*/deep', to: '/new' }, { from: '/ok', to: '/fine' }") })
    const warnings: Array<{ message: string }> = []
    expect(readDocusaurusRedirects(root, warnings as never)).toEqual([{ source: '/ok', destination: '/fine' }])
    expect(warnings.map((warning) => warning.message).join(' ')).toContain('/old/*/deep')
  })

  it('translates a trailing wildcard to the Next.js form', () => {
    const root = docusaurusSite({ 'docusaurus.config.js': configWith("{ from: '/old/*', to: '/new/*' }") })
    expect(readDocusaurusRedirects(root, [])).toEqual([{ source: '/old/:path*', destination: '/new/:path*' }])
  })

  it.each(['//evil.example', '/%2f%2fevil.example', '/\\\\evil.example'])('rejects the destination %s', (to) => {
    const root = docusaurusSite({ 'docusaurus.config.js': configWith(`{ from: '/a', to: '${to}' }`) })
    expect(readDocusaurusRedirects(root, [])).toEqual([])
  })
})

describe('inlined partial size cap', () => {
  const huge = `${'Lorem ipsum dolor sit amet. '.repeat(80_000)}\n`

  it('does not inline a Docusaurus partial over 2 MB', () => {
    expect(huge.length).toBeGreaterThan(2_000_000)
    const bundle = migrateDocusaurus({
      'docs/a.mdx': "import Big from './_big.mdx'\n\n# A\n\n<Big />\n",
      'docs/_big.mdx': huge,
    })
    const page = bundle.pages.find((entry) => entry.navigationId === 'a')
    expect(page?.body.length).toBeLessThan(100_000)
    expect(bundle.warnings.map((warning) => warning.message).join(' ')).toContain('too large to inline')
  })

  it('does not inline a Docusaurus markdown document import over 2 MB', () => {
    const bundle = migrateDocusaurus({
      'docs/a.mdx': "import Big from './big.md'\n\n# A\n\n<Big />\n",
      'docs/big.md': huge,
    })
    const page = bundle.pages.find((entry) => entry.navigationId === 'a')
    expect(page?.body.length).toBeLessThan(100_000)
  })
})

function quarantinedPaths(bundle: ReturnType<typeof migrateRepository>): Array<string> {
  return (bundle.quarantinedFiles ?? []).map((file) => file.path).sort()
}

describe('Docusaurus draft pages', () => {
  it.each(['true', '"true"', 'yes', '1'])('quarantines a page with draft: %s and keeps draft: false public', (value) => {
    const bundle = migrateDocusaurus({
      'docs/live.md': '---\ndraft: false\n---\n# Live\n',
      'docs/unreleased.md': `---\ndraft: ${value}\n---\n# Unreleased\n`,
      'docs/plain.md': '# Plain\n',
    })
    expect(bundle.pages.map((page) => page.navigationId).sort()).toEqual(['live', 'plain'])
    expect(JSON.stringify(bundle.docsConfig.tabs)).not.toContain('unreleased')
    expect(quarantinedPaths(bundle)).toEqual(['migration-quarantine/unreleased.md'])
    expect(bundle.warnings.some((warning) => warning.code === 'gated-page' && warning.source === 'unreleased.md')).toBe(true)
  })

  it('quarantines a draft whose frontmatter is invalid YAML', () => {
    const bundle = migrateDocusaurus({
      'docs/unreleased.md': '---\ntitle: "unterminated\ndraft: true\n---\n# Unreleased\n',
      'docs/plain.md': '# Plain\n',
    })
    expect(bundle.pages.map((page) => page.navigationId)).toEqual(['plain'])
    expect(quarantinedPaths(bundle)).toEqual(['migration-quarantine/unreleased.md'])
  })

  it('does not inline a draft page that a published page imports', () => {
    const bundle = migrateDocusaurus({
      'docs/live.mdx': "import Secret from './unreleased.md'\n\n# Live\n\n<Secret />\n",
      'docs/unreleased.md': '---\ndraft: true\n---\nTOP-SECRET-LAUNCH-DATE\n',
    })
    expect(bundle.pages.map((page) => page.body).join('\n')).not.toContain('TOP-SECRET-LAUNCH-DATE')
  })
})

function fernSite(docsYml: string, pages: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'thally-harden-fern-'))
  mkdirSync(join(root, 'fern'))
  writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
  writeFileSync(join(root, 'fern', 'docs.yml'), docsYml)
  for (const [path, content] of Object.entries(pages)) {
    mkdirSync(join(root, 'fern', path, '..'), { recursive: true })
    writeFileSync(join(root, 'fern', path), content)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' })
}

describe('Fern role-restricted pages', () => {
  const nav = (extra = ''): string => `navigation:\n  - section: Guides\n${extra}    contents:\n      - page: Open\n        path: open.mdx\n      - page: Internal\n        path: internal.mdx\n`

  it('quarantines a page whose frontmatter sets viewers', () => {
    const bundle = fernSite(nav(), { 'open.mdx': '# Open\n', 'internal.mdx': '---\nviewers: [admin]\n---\n# Internal\n' })
    expect(bundle.pages.map((page) => page.title)).toEqual(['Open'])
    expect(quarantinedPaths(bundle)).toEqual(['migration-quarantine/internal.mdx'])
    expect(JSON.stringify(bundle.docsConfig.tabs)).not.toContain('internal')
  })

  it('quarantines every page under a docs.yml section that sets viewers', () => {
    const bundle = fernSite(
      'navigation:\n  - section: Open\n    contents:\n      - page: Open\n        path: open.mdx\n  - section: Staff\n    viewers: [staff]\n    contents:\n      - page: Internal\n        path: internal.mdx\n',
      { 'open.mdx': '# Open\n', 'internal.mdx': '# Internal\n' },
    )
    expect(bundle.pages.map((page) => page.title)).toEqual(['Open'])
    expect(quarantinedPaths(bundle)).toEqual(['migration-quarantine/internal.mdx'])
    expect(JSON.stringify(bundle.docsConfig.tabs)).not.toContain('Staff')
  })

  it('quarantines a docs.yml page that sets viewers', () => {
    const bundle = fernSite(
      'navigation:\n  - page: Open\n    path: open.mdx\n  - page: Internal\n    path: internal.mdx\n    viewers: [staff]\n',
      { 'open.mdx': '# Open\n', 'internal.mdx': '# Internal\n' },
    )
    expect(bundle.pages.map((page) => page.title)).toEqual(['Open'])
    expect(quarantinedPaths(bundle)).toEqual(['migration-quarantine/internal.mdx'])
  })
})

describe('Docusaurus excluded documents', () => {
  it('does not publish files under an underscore directory', () => {
    const bundle = migrateDocusaurus({
      'docs/guide.mdx': "import Note from './_partials/note.mdx'\n\n# Guide\n\n<Note />\n",
      'docs/_partials/note.mdx': 'Shared note.\n',
      'docs/sub/_shared/deep.md': '# Deep partial\n',
      'docs/__tests__/spec.md': '# Spec\n',
    })
    expect(bundle.pages.map((page) => page.navigationId)).toEqual(['guide'])
    expect(bundle.pages[0].body).toContain('Shared note.')
  })
})
