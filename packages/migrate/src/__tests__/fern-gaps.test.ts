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

describe('B6/B7/V4: dropped Fern config is reported', () => {
  const page = { 'index.mdx': '---\ntitle: Home\n---\n\nHi.' }
  const nav = 'navigation:\n  - page: Home\n    path: index.mdx\n'
  const messages = (docsYml: string): Array<string> => migrateFern({ 'docs.yml': docsYml, ...page }).warnings.map((warning) => warning.message)

  it('warns about css, font files, analytics and js', () => {
    const all = messages(`css: ./assets/styles.css\ntypography:\n  bodyFont:\n    name: Open Sans\n    paths:\n      - path: ./assets/os.woff2\n  codeFont:\n    name: Mono\nanalytics:\n  posthog:\n    api-key: x\njs:\n  - path: ./custom.js\n${nav}`)
    expect(all).toContainEqual(expect.stringMatching(/stylesheets were not imported.*styles\.css/))
    expect(all).toContainEqual(expect.stringMatching(/font files \(bodyFont\) were not imported/))
    expect(all).toContainEqual(expect.stringMatching(/analytics settings \(posthog\).*never migrated/))
    expect(all).toContainEqual(expect.stringMatching(/scripts were not imported.*custom\.js/))
  })

  it('stays quiet when none of them is set', () => {
    expect(messages(nav).join('\n')).not.toMatch(/not imported/)
  })
})

const sdkSpec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'T', version: '1' },
  paths: {
    '/assistant': {
      post: { operationId: 'AssistantController_create', tags: ['Assistants'], summary: 'Create Assistant', 'x-fern-sdk-group-name': 'assistants', 'x-fern-sdk-method-name': 'create', responses: { 200: { description: 'ok' } } },
    },
    '/analytics': {
      get: { operationId: 'AnalyticsController_query', tags: ['Analytics'], summary: 'Query', 'x-fern-sdk-group-name': ['analytics'], 'x-fern-sdk-method-name': 'getAll', responses: { 200: { description: 'ok' } } },
    },
    '/call/{id}': {
      get: { operationId: 'CallController_findOne', tags: ['Calls'], summary: 'Get Call', responses: { 200: { description: 'ok' } } },
    },
  },
})

describe('V1/V7: Fern API reference operation URLs', () => {
  const bundle = migrateFern({
    'docs.yml': 'redirects:\n  - source: /old-assistants\n    destination: /api-reference/assistants/create\nnavigation:\n  - tab: guide\n    layout:\n      - page: Home\n        path: index.mdx\n  - tab: ref\n    layout:\n      - api: API Reference\n        skip-slug: true\ntabs:\n  guide:\n    display-name: Guide\n    slug: guide\n  ref:\n    display-name: API Reference\n    slug: api-reference\n',
    'generators.yml': 'api:\n  specs:\n    - openapi: openapi.json\n',
    'openapi.json': sdkSpec,
    'index.mdx': '---\ntitle: Home\n---\n\nSee [create](/api-reference/assistants/create) and [analytics](/api-reference/analytics/get-all) and [call](/api-reference/calls/get).',
  })
  const redirect = (source: string): string | undefined => bundle.docsConfig.redirects?.find((entry) => entry.source === source)?.destination

  it('redirects SDK-named and derived operation URLs to the operation pages', () => {
    expect(redirect('/api-reference/assistants/create')).toMatch(/^\/api\/default\/.*assistant/)
    expect(redirect('/api-reference/analytics/get-all')).toMatch(/^\/api\/default\//)
    expect(redirect('/api-reference/calls/get')).toMatch(/^\/api\/default\//)
  })

  it('points docs.yml redirects that end on an operation URL at the operation page', () => {
    expect(redirect('/old-assistants')).toBe(redirect('/api-reference/assistants/create'))
  })

  it('resolves content links to the operation instead of the API overview', () => {
    const body = bundle.pages.find((page) => page.title === 'Home')!.body
    expect(body).toContain(`(${redirect('/api-reference/assistants/create')})`)
    expect(body).toContain(`(${redirect('/api-reference/analytics/get-all')})`)
  })
})

describe('B8/V6: links to the site\'s own custom domain', () => {
  const bundle = migrateFern({
    'docs.yml': 'instances:\n  - url: acme.docs.buildwithfern.com\n    custom-domain: docs.example.com\nredirects:\n  - source: /old\n    destination: /guide/b\nnavigation:\n  - section: Guide\n    contents:\n      - page: A\n        path: a.mdx\n      - page: B\n        path: b.mdx\n',
    'a.mdx': '---\ntitle: A\n---\n\n[b](https://docs.example.com/guide/b#top) [old](https://docs.example.com/old) <a href="https://docs.example.com/guide/b">x</a> [gone](https://docs.example.com/missing/page) [other](https://example.org/guide/b)\n',
    'b.mdx': '---\ntitle: B\n---\n\nB.',
  })
  const body = bundle.pages.find((page) => page.title === 'A')!.body

  it('turns resolvable links into internal paths, following redirects', () => {
    expect(body).toContain('[b](/guide/b#top)')
    expect(body).toContain('[old](/guide/b)')
    expect(body).toContain('<a href="/guide/b">')
  })

  it('keeps unresolvable and foreign links absolute and warns', () => {
    expect(body).toContain('https://docs.example.com/missing/page')
    expect(body).toContain('https://example.org/guide/b')
    expect(bundle.warnings.map((warning) => warning.message)).toContainEqual(expect.stringMatching(/1 link.*docs\.example\.com\/missing\/page/))
  })
})

describe('B12: a page without a frontmatter title takes its docs.yml label', () => {
  it('uses the page: label, not a title made from the slug', () => {
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - page: Multi-Modal (Images / Audio)\n    path: multi-modal.mdx\n  - page: Titled\n    path: titled.mdx\n',
      'multi-modal.mdx': 'Body text only.',
      'titled.mdx': '---\ntitle: Own Title\n---\n\nBody.',
    })
    expect(bundle.pages.find((page) => page.body.startsWith('Body text'))?.title).toBe('Multi-Modal (Images / Audio)')
    expect(bundle.pages.find((page) => page.body.startsWith('Body.'))?.title).toBe('Own Title')
  })
})
