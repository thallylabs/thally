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
