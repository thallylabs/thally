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

/** A docs.yml with `count` tabs, one page each. */
function manyTabs(count: number, layout = ''): Record<string, string> {
  const ids = Array.from({ length: count }, (_, index) => `t${index}`)
  const tabs = ids.map((id) => `  ${id}:\n    display-name: Tab ${id}\n`).join('')
  const navigation = ids.map((id) => `  - tab: ${id}\n    layout:\n      - page: Page ${id}\n        path: ${id}.mdx\n`).join('')
  return {
    'docs.yml': `${layout}tabs:\n${tabs}navigation:\n${navigation}`,
    ...Object.fromEntries(ids.map((id) => [`${id}.mdx`, `---\ntitle: Page ${id}\n---\n\nBody.`])),
  }
}

describe('B5/V14: Fern header tabs keep the tab bar', () => {
  it('does not force dropdown display for header or default tab placement', () => {
    expect(migrateFern(manyTabs(7, 'layout:\n  tabs-placement: header\n')).docsConfig.navigation?.display).toBeUndefined()
    expect(migrateFern(manyTabs(7)).docsConfig.navigation?.display).toBeUndefined()
  })

  it('warns when sidebar-placed tabs still switch to a dropdown', () => {
    const bundle = migrateFern(manyTabs(7, 'layout:\n  tabs-placement: sidebar\n'))
    expect(bundle.docsConfig.navigation?.display).toBe('dropdown')
    expect(bundle.warnings.map((warning) => warning.message)).toContainEqual(expect.stringMatching(/more than six tabs.*dropdown/))
  })
})
