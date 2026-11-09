/** Mintlify migration gaps: custom stylesheets, page text and heading anchors. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'

function migrate(files: Record<string, string | Buffer>, config: Record<string, unknown> = { navigation: { pages: ['index'] } }) {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-gaps-'))
  const all: Record<string, string | Buffer> = { 'docs.json': JSON.stringify({ name: 'Acme', ...config }), ...files }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
}

const messages = (bundle: ReturnType<typeof migrate>) => bundle.warnings.map((warning) => warning.message)

describe('custom stylesheets', () => {
  const files = {
    'index.mdx': '---\ntitle: Home\n---\n\nHello\n',
    'styles.css': '@font-face { font-family: F; src: url("/fonts/a.woff2") format("woff2"), url(/fonts/gone.woff2); }\n.hero { background: url(/images/bg.png?v=2); }\n.x { background: url(/../outside.png); }\n.y { background: url(https://cdn.example.com/z.png); }\n',
    'fonts/a.woff2': Buffer.from('font'),
    'images/bg.png': Buffer.from('png'),
  }

  it('declares a copied source stylesheet in docs.json stylesheets and no longer says it is not applied', () => {
    const bundle = migrate(files)
    expect(bundle.docsConfig.stylesheets).toContain('/styles.css')
    expect(bundle.assets.some((asset) => asset.path === 'styles.css')).toBe(true)
    expect(messages(bundle).join('\n')).not.toContain('NOT applied')
  })

  it('copies the root-relative url() targets that exist and warns once about the missing ones', () => {
    const bundle = migrate(files)
    const paths = bundle.assets.map((asset) => asset.path)
    expect(paths).toContain('fonts/a.woff2')
    expect(paths).toContain('images/bg.png')
    expect(paths).not.toContain('outside.png')
    const missing = bundle.warnings.filter((warning) => warning.message.includes('/fonts/gone.woff2'))
    expect(missing).toHaveLength(1)
    expect(missing[0].message).toContain('/../outside.png')
    expect(missing[0].message).not.toContain('cdn.example.com')
  })
})
