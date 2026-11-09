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
    expect(redirect('/api-reference/calls/call-controller-find-one')).toMatch(/^\/api\/default\//)
  })

  it('reads SDK names from the overrides files generators.yml lists', () => {
    const overridden = migrateFern({
      'docs.yml': 'navigation:\n  - tab: guide\n    layout:\n      - page: Home\n        path: index.mdx\n  - tab: ref\n    layout:\n      - api: API Reference\n        skip-slug: true\ntabs:\n  guide:\n    display-name: Guide\n    slug: guide\n  ref:\n    display-name: API Reference\n    slug: api-reference\n',
      'generators.yml': 'api:\n  specs:\n    - openapi: openapi.json\n      overrides: ./overrides.yml\n',
      'openapi.json': sdkSpec,
      'overrides.yml': 'paths:\n  /call/{id}:\n    get:\n      x-fern-sdk-group-name:\n        - calls\n      x-fern-sdk-method-name: get\n',
      'index.mdx': '---\ntitle: Home\n---\n\nHi.',
    })
    expect(overridden.docsConfig.redirects?.find((entry) => entry.source === '/api-reference/calls/get')?.destination).toMatch(/^\/api\/default\//)
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
    'a.mdx': '---\ntitle: A\n---\n\n[b](https://docs.example.com/guide/b) [old](https://docs.example.com/old) <a href="https://docs.example.com/guide/b">x</a> [gone](https://docs.example.com/missing/page) [other](https://example.org/guide/b) [real](https://docs.example.com/guide/b#intro-section) [bad](https://docs.example.com/guide/b#no-such-heading)\n',
    'b.mdx': '---\ntitle: B\n---\n\n## Intro Section\n\nB.',
  })
  const body = bundle.pages.find((page) => page.title === 'A')!.body

  it('turns resolvable links into internal paths, following redirects', () => {
    expect(body).toContain('[b](/guide/b)')
    expect(body).toContain('[old](/guide/b)')
    expect(body).toContain('<a href="/guide/b">')
    expect(body).toContain('[real](/guide/b#intro-section)')
  })

  it('keeps a link absolute when its fragment names no heading on the page', () => {
    expect(body).toContain('(https://docs.example.com/guide/b#no-such-heading)')
  })

  it('keeps unresolvable and foreign links absolute and warns', () => {
    expect(body).toContain('https://docs.example.com/missing/page')
    expect(body).toContain('https://example.org/guide/b')
    expect(bundle.warnings.map((warning) => warning.message)).toContainEqual(expect.stringMatching(/2 link.*docs\.example\.com\/missing\/page/))
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

describe('B13: API tab only when navigation references an api section', () => {
  const files = {
    'generators.yml': 'api:\n  specs:\n    - openapi: openapi.json\n',
    'openapi.json': sdkSpec,
    'index.mdx': '---\ntitle: Home\n---\n\nHi.',
  }
  const withNav = (nav: string) => migrateFern({ ...files, 'docs.yml': `${nav}  - page: Home\n    path: index.mdx\n` })

  it('adds no API tab when every api: entry is commented out', () => {
    const bundle = withNav('navigation:\n  # - api: API Reference\n')
    expect(bundle.docsConfig.tabs.some((tab) => tab.api)).toBe(false)
    expect(bundle.assets.some((asset) => asset.path.endsWith('openapi.json'))).toBe(false)
  })

  it('adds the API tab when navigation has an api: entry', () => {
    const bundle = withNav('navigation:\n  - api: API Reference\n')
    expect(bundle.docsConfig.tabs.some((tab) => tab.api)).toBe(true)
  })

  it('names the unreferenced spec in one warning that says how to add the tab', () => {
    const messages = withNav('navigation:\n  # - api: API Reference\n').warnings.map((warning) => warning.message)
    expect(messages.filter((message) => message.includes('does not reference'))).toEqual([
      'The OpenAPI spec openapi.json is in the repository, but docs.yml does not reference it, so no API tab was created. To publish an API reference from it, add an "api:" entry to the navigation in docs.yml, for example "- api: API Reference".',
    ])
  })

  it('does not warn when navigation has an api: entry', () => {
    expect(withNav('navigation:\n  - api: API Reference\n').warnings.map((warning) => warning.message).join('\n')).not.toContain('does not reference')
  })
})

describe('B14/V12: Fern icons', () => {
  const bundle = migrateFern({
    'docs.yml': 'tabs:\n  guide:\n    display-name: Guide\n    icon: fa-light fa-browser\n  ext:\n    display-name: Playground\n    icon: fa-regular fa-robot\n    href: https://example.com/play\nnavigation:\n  - tab: guide\n    layout:\n      - section: Basics\n        icon: fa-duotone fa-gears\n        contents:\n          - page: With icon\n            path: a.mdx\n            icon: fa-light fa-vial\n          - page: Own icon\n            path: b.mdx\n            icon: fa-light fa-vial\n          - page: Odd\n            path: c.mdx\n            icon: fa-light fa-made-up-name\n          - page: Brand\n            path: d.mdx\n            icon: fa-brands fa-react\n          - page: Solid\n            path: e.mdx\n            icon: fa-solid fa-book\n  - tab: ext\n',
    'a.mdx': 'A body.',
    'b.mdx': '---\ntitle: B\nicon: rocket\n---\n\nB body.',
    'c.mdx': 'C body.',
    'd.mdx': 'D body.',
    'e.mdx': 'E body.',
  })
  const tab = (name: string) => bundle.docsConfig.tabs.find((entry) => entry.tab === name)

  it('selects the Font Awesome library, as the source uses it', () => {
    expect(bundle.docsConfig.icons).toEqual({ library: 'fontawesome' })
  })

  it('keeps Font Awesome names on tabs, groups and pages, without the style prefix, and carries the style to pages', () => {
    expect(tab('Guide')?.icon).toBe('browser')
    expect(tab('Guide')?.groups?.[0].icon).toBe('gears')
    const page = bundle.pages.find((entry) => entry.body === 'A body.')
    expect(page).toMatchObject({ icon: 'vial', iconType: 'regular' })
    expect(bundle.pages.find((entry) => entry.body === 'D body.')).toMatchObject({ icon: 'react', iconType: 'brands' })
    expect(bundle.pages.find((entry) => entry.body === 'E body.')).toMatchObject({ icon: 'book', iconType: 'solid' })
  })

  it('keeps a page frontmatter icon over the docs.yml one and an href tab icon', () => {
    expect(bundle.pages.find((page) => page.body === 'B body.')?.icon).toBe('rocket')
    expect(tab('Playground')).toMatchObject({ href: 'https://example.com/play', icon: 'robot' })
  })

  it('warns once about names in a Pro style, which Thally draws from the Free set', () => {
    const warnings = bundle.warnings.map((warning) => warning.message).filter((message) => message.includes('Font Awesome Pro'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('made-up-name')
    expect(warnings[0]).toContain('vial')
    expect(warnings[0]).not.toContain('react')
    expect(warnings[0]).not.toContain('robot')
  })
})

describe('B16: loose pages in a Fern tab', () => {
  it('group them under the tab name, in docs.yml order', () => {
    const bundle = migrateFern({
      'docs.yml': 'tabs:\n  guide:\n    display-name: Guide\nnavigation:\n  - tab: guide\n    layout:\n      - section: First\n        contents:\n          - page: One\n            path: one.mdx\n      - page: Loose\n        path: loose.mdx\n',
      'one.mdx': '---\ntitle: One\n---\n\nOne.',
      'loose.mdx': '---\ntitle: Loose\n---\n\nLoose.',
    })
    const groups = bundle.docsConfig.tabs[0].groups!
    expect(groups.map((group) => group.group)).toEqual(['First', 'Guide'])
    expect(groups.some((group) => group.group === 'Overview')).toBe(false)
  })
})

describe('V2: Fern changelog date URLs', () => {
  it('redirects /route/YYYY/M/D to the dated page', () => {
    const bundle = migrateFern({
      'docs.yml': 'tabs:\n  releases:\n    display-name: What is new\n    slug: whats-new\n    changelog: whats-new\nnavigation:\n  - tab: releases\n    layout: []\n',
      'whats-new/2025-03-14.mdx': '---\ntitle: March\n---\n\nUpdate.',
      'whats-new/2025-12-01.mdx': '---\ntitle: December\n---\n\nUpdate.',
    })
    expect(bundle.docsConfig.redirects).toContainEqual({ source: '/whats-new/2025/3/14', destination: '/whats-new/2025-03-14' })
    expect(bundle.docsConfig.redirects).toContainEqual({ source: '/whats-new/2025/12/1', destination: '/whats-new/2025-12-01' })
  })
})

describe('V3: a form label is not page description', () => {
  it('skips form controls when taking the first paragraph', () => {
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - page: Subscribe\n    path: subscribe.mdx\n  - page: Other\n    path: other.mdx\n',
      'subscribe.mdx': '<Card title="Subscribe">\n  <form method="POST" action="https://example.com/submit">\n    <label htmlFor="email" style={{ display: \'none\' }}>E-mail address</label>\n    <input id="email" type="email" />\n  </form>\n</Card>\n',
      'other.mdx': '<form>\n  <label htmlFor="x">Name</label>\n</form>\n\nReal intro text.\n',
    })
    expect(bundle.pages.find((page) => page.title === 'Subscribe')?.description).not.toContain('E-mail')
    expect(bundle.pages.find((page) => page.title === 'Other')?.description).toBe('Real intro text.')
  })
})

describe('V5: Fern Download and Button', () => {
  const bundle = migrateFern({
    'docs.yml': 'navigation:\n  - page: Links\n    path: links.mdx\n',
    'links.mdx': '---\ntitle: Links\n---\n\n<Download src="/files/guide.pdf">Get the guide</Download>\n\n<Button href="https://example.com/start" intent="primary" rounded={true}>Start now</Button>\n\n<EndpointRequestSnippet endpoint="POST /x" />\n',
  })
  const body = bundle.pages[0].body

  it('turns them into links that keep target and label', () => {
    expect(body).toContain('<a download href="/files/guide.pdf">Get the guide</a>')
    expect(body).toContain('<a href="https://example.com/start">Start now</a>')
  })

  it('still warns about components with no equivalent', () => {
    const messages = bundle.warnings.map((warning) => warning.message).join('\n')
    expect(messages).toContain('EndpointRequestSnippet')
    expect(messages).not.toMatch(/"?(Download|Button)"?[^\n]*(not|no)/)
  })
})

describe('V11: Fern subtitle', () => {
  const bundle = migrateFern({
    'docs.yml': 'navigation:\n  - page: Plain\n    path: plain.mdx\n  - page: Both\n    path: both.mdx\n',
    'plain.mdx': '---\ntitle: Plain\nsubtitle: Lead line\n---\n\nBody.',
    'both.mdx': '---\ntitle: Both\ndescription: Meta text\nsubtitle: A {lead} <line>\n---\n\nBody.',
  })

  it('becomes the visible description when the page has none', () => {
    const page = bundle.pages.find((entry) => entry.title === 'Plain')!
    expect(page.description).toBe('Lead line')
    expect(page.descriptionPlacement).toBeUndefined()
  })

  it('opens the body and keeps an existing description', () => {
    const page = bundle.pages.find((entry) => entry.title === 'Both')!
    expect(page.description).toBe('Meta text')
    expect(page.descriptionPlacement).toBe('body')
    expect(page.body).toBe('A \\{lead\\} \\<line\\>\n\nBody.')
  })
})

describe('V15: Fern availability', () => {
  it('becomes the page badge from frontmatter or docs.yml, never over an authored badge', () => {
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - page: A\n    path: a.mdx\n  - page: B\n    path: b.mdx\n    availability: alpha\n  - page: C\n    path: c.mdx\n  - page: D\n    path: d.mdx\n    availability: generally-available\n',
      'a.mdx': '---\ntitle: A\navailability: beta\n---\n\nA.',
      'b.mdx': '---\ntitle: B\n---\n\nB.',
      'c.mdx': '---\ntitle: C\navailability: deprecated\nbadge: Custom\n---\n\nC.',
      'd.mdx': '---\ntitle: D\n---\n\nD.',
    })
    const badge = (title: string) => bundle.pages.find((page) => page.title === title)?.badge
    expect(badge('A')).toBe('Beta')
    expect(badge('B')).toBe('Alpha')
    expect(badge('C')).toBe('Custom')
    expect(badge('D')).toBeUndefined()
  })
})

describe('V19: Fern custom heading anchors', () => {
  it('strips the [#id] suffix and keeps the id on the heading, outside code only', () => {
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - page: Anchors\n    path: anchors.mdx\n',
      'anchors.mdx': '---\ntitle: Anchors\n---\n\n## Batch Calling [#batch-calling]\n\nSee [link](#batch-calling).\n\n```md\n## Keep [#in-code]\n```\n\n## Not an id [see docs]\n',
    })
    const body = bundle.pages[0].body
    expect(body).toContain('## Batch Calling {/* #batch-calling */}')
    expect(body).toContain('## Keep [#in-code]')
    expect(body).toContain('## Not an id [see docs]')
    expect(body).not.toContain('Batch Calling [#')
  })
})

describe('V20: block components right after a text line', () => {
  it('get a blank line before them, never inside code', () => {
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - page: Notes\n    path: notes.mdx\n',
      'notes.mdx': '---\ntitle: Notes\n---\n\nRun the server first.\n<Note>Use port 3000.</Note>\n\nSecond line.\n<Warning>Careful\nhere</Warning>\n\n```mdx\nText line\n<Warning>\nkept\n</Warning>\n```\n\n<Tabs>\n<Tab title="A">\nA text\n</Tab>\n</Tabs>\n',
    })
    const body = bundle.pages[0].body
    expect(body).toContain('Run the server first.\n\n<Note>')
    expect(body).toContain('Second line.\n\n<Warning>')
    expect(body).toContain('Text line\n<Warning>')
    expect(body).toContain('<Tabs>\n<Tab title="A">')
  })
})

describe('V22: scheme-less links in OpenAPI descriptions', () => {
  it('warns once, listing the hosts, and leaves the spec untouched', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'T', version: '1', description: 'Open the [Dashboard](dashboard.vapi.ai) or [docs](https://docs.vapi.ai) or [guide](setup.md) or [x](dashboard.vapi.ai/keys).' },
      paths: { '/a': { get: { operationId: 'a', responses: { 200: { description: 'ok' } } } } },
    })
    const bundle = migrateFern({
      'docs.yml': 'navigation:\n  - page: Home\n    path: index.mdx\n  - api: API Reference\n',
      'generators.yml': 'api:\n  specs:\n    - openapi: openapi.json\n',
      'openapi.json': spec,
      'index.mdx': 'Hi.',
    })
    const warnings = bundle.warnings.map((warning) => warning.message).filter((message) => message.includes('without https://'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('2 link(s)')
    expect(warnings[0]).toContain('dashboard.vapi.ai, dashboard.vapi.ai/keys')
    expect(warnings[0]).not.toContain('docs.vapi.ai')
    expect(Buffer.from(bundle.assets.find((asset) => asset.path.endsWith('openapi.json'))!.content).toString()).toContain('(dashboard.vapi.ai)')
  })
})

describe('links to pages the site answers itself stay internal', () => {
  it('does not send operation pages or redirect sources to the live site', () => {
    const bundle = migrateFern({
      'docs.yml': 'instances:\n  - url: acme.docs.buildwithfern.com\n    custom-domain: docs.example.com\nredirects:\n  - source: /old\n    destination: /guide/home\nnavigation:\n  - tab: guide\n    layout:\n      - page: Home\n        path: index.mdx\n  - tab: ref\n    layout:\n      - api: API Reference\n        skip-slug: true\ntabs:\n  guide:\n    display-name: Guide\n    slug: guide\n  ref:\n    display-name: API Reference\n    slug: api-reference\n',
      'generators.yml': 'api:\n  specs:\n    - openapi: openapi.json\n',
      'openapi.json': sdkSpec,
      'index.mdx': '---\ntitle: Home\n---\n\n## Real Heading\n\n[create](/api-reference/assistants/create) [old](/old) [oldhead](/old#real-heading) [oldbad](/old#missing) [landing](/api-reference) [gone](/nowhere)',
    })
    const body = bundle.pages.find((page) => page.title === 'Home')!.body
    expect(body).not.toContain('(/api-reference/assistants/create)')
    expect(body).not.toMatch(/\]\(https:\/\/docs\.example\.com\/api/)
    expect(body).toContain('(/old)')
    expect(body).toContain('(/old#real-heading)')
    expect(body).toContain('(https://docs.example.com/old#missing)')
    expect(body).toContain('(https://docs.example.com/nowhere)')
  })
})

describe('V3: changelog index description', () => {
  it('falls back to a plain summary when the overview has only a subscribe form', () => {
    const bundle = migrateFern({
      'docs.yml': 'tabs:\n  releases:\n    display-name: What is new\n    slug: whats-new\n    changelog: changelog\nnavigation:\n  - tab: releases\n    layout: []\n',
      'changelog/overview.mdx': '---\nslug: whats-new\n---\n<Card title="Subscribe">\n  <form action="https://example.com/s"><label htmlFor="e">E-mail address</label></form>\n</Card>\n',
      'changelog/2025-03-14.mdx': '---\ntitle: March\n---\n\nUpdate.',
    })
    expect(bundle.pages.find((page) => page.id === 'whats-new')?.description).toBe('Latest release notes and product updates.')
  })
})
