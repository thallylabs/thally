/** Adversarial inputs for the Fern and Docusaurus migrators. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readDocusaurusSiteSettings } from '../docusaurus.js'
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
