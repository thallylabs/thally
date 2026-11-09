/** Fern adapter gaps found migrating real Fern sites: routes, nav, warnings, links and frontmatter. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'

/** Write `files` (paths relative to `fern/`) and migrate the resulting Fern repository. */
function migrateFern(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'thally-fern-gaps-'))
  const fernRoot = join(root, 'fern')
  mkdirSync(fernRoot, { recursive: true })
  writeFileSync(join(fernRoot, 'fern.config.json'), JSON.stringify({ organization: 'acme' }))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(fernRoot, path)), { recursive: true })
    writeFileSync(join(fernRoot, path), content)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
}

describe('B3: authored underscore slugs stay the route', () => {
  it('keeps baml_client as the route and redirects the hyphenated form to it', () => {
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - section: Generated\n    slug: baml_client\n    contents:\n      - page: With options\n        path: baml_client/with-options.mdx\n',
      'baml_client/with-options.mdx': '---\ntitle: With options\n---\n\nBody.',
    })
    expect(bundle.pages.map((page) => page.id)).toContain('baml_client/with-options')
    expect(bundle.docsConfig.redirects).toContainEqual({ source: '/baml-client/with-options', destination: '/baml_client/with-options' })
    expect(bundle.docsConfig.redirects ?? []).not.toContainEqual(expect.objectContaining({ source: '/baml_client/with-options' }))
  })
})
