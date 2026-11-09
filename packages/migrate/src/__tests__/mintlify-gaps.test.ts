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

describe('a snippet whose attribute is a template literal of constants', () => {
  const card = [
    'export const Card = ({ icon, label }) => (',
    '  <a href={`#${label}`}><img src={`/a/${icon}.svg`} alt={`${icon} icon`} width={`${"4"}${"0"}`} data-k={`k-${icon.length}`} /></a>',
    ')',
    '',
  ].join('\n')
  const home = '---\ntitle: Home\n---\n\nimport { Card } from "/snippets/card.mdx"\n\n<Card icon="b" label="x" />\n'

  it('writes the constant attribute as a plain string and keeps the template that has a variable', () => {
    const bundle = migrate({ 'index.mdx': home, 'snippets/card.mdx': card })
    const body = bundle.pages.find((page) => page.id === 'introduction')!.body
    expect(body).toContain('src="/a/b.svg"')
    expect(body).toContain('alt="b icon"')
    expect(body).toContain('href="#x"')
    expect(body).toContain('width="40"')
    expect(body).toContain('data-k={`k-${"b".length}`}')
  })
})

describe('slug frontmatter', () => {
  const page = '---\ntitle: Landing\nslug: cookbook/landing\n---\n\nText\n'
  const run = (redirects: Array<{ source: string; destination: string }>) => migrate(
    { 'index.mdx': '---\ntitle: Home\n---\n\nHome\n', 'solutions/landing.mdx': page },
    { navigation: { pages: ['index', 'solutions/landing'] }, redirects },
  )

  it('does not warn that slug was omitted when the source already redirects it to the page', () => {
    const bundle = run([{ source: '/cookbook/landing', destination: '/solutions/landing' }])
    expect(messages(bundle).join('\n')).not.toContain('slug')
  })

  it('still warns when no redirect answers the slug, or one goes elsewhere', () => {
    expect(messages(run([])).join('\n')).toContain('fields were omitted: slug')
    expect(messages(run([{ source: '/cookbook/landing', destination: '/index' }])).join('\n')).toContain('fields were omitted: slug')
  })
})

describe('a page with no title', () => {
  it('is titled from its file name the way Mintlify does: separators to spaces, first letter capitalized', () => {
    const bundle = migrate({
      'index.mdx': 'Home\n',
      'features/transaction-management.mdx': 'Body\n',
      'features/export_wallets.mdx': 'Body\n',
      'features/with-title.mdx': '---\ntitle: Keep The Title\n---\n\nBody\n',
    }, { navigation: { pages: ['index', 'features/transaction-management', 'features/export_wallets', 'features/with-title'] } })
    const title = (id: string) => bundle.pages.find((page) => page.id === id)?.title
    expect(title('features/transaction-management')).toBe('Transaction management')
    expect(title('features/export_wallets')).toBe('Export wallets')
    expect(title('features/with-title')).toBe('Keep The Title')
    expect(title('introduction')).toBe('Introduction')
  })
})

describe('heading ids that end in a dash on Mintlify', () => {
  const headings = [
    '## What is Multi-Factor Authentication (MFA)?',
    '',
    '## IndexedDB (web only)?',
    '',
    '## What is Turnkey Verifiable Cloud “TVC”?',
    '',
    '## Plain heading',
    '',
    '```md',
    '## Not a heading?',
    '```',
  ].join('\n')

  it('keeps Thally\'s own heading and adds an invisible anchor with the id Mintlify serves', () => {
    const bundle = migrate({ 'index.mdx': `---\ntitle: Home\n---\n\n${headings}\n` })
    const body = bundle.pages.find((page) => page.id === 'introduction')!.body
    expect(body).toContain('<a id="what-is-multi-factor-authentication-mfa-" />\n\n## What is Multi-Factor Authentication (MFA)?')
    expect(body).toContain('<a id="indexeddb-web-only-" />\n\n## IndexedDB (web only)?')
    expect(body).toContain('<a id="what-is-turnkey-verifiable-cloud-“tvc”-" />\n\n## What is Turnkey Verifiable Cloud “TVC”?')
    expect(body.match(/<a id=/g)).toHaveLength(3)
  })
})

describe('top-level groups of a Mintlify tab', () => {
  const pages = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [`${id}.mdx`, `---\ntitle: ${id}\ndescription: ${id}.\n---\n\nBody of page ${id} here.\n`]))

  it('become section headers of the tab when the tab holds only groups', () => {
    const bundle = migrate(pages, { navigation: { tabs: [{ tab: 'Docs', pages: [{ group: 'One', pages: ['a', 'b'] }, { group: 'Two', pages: ['c', 'd'] }] }] } })
    const tab = bundle.docsConfig.tabs?.[0]
    expect(tab?.groups?.map((group) => group.group)).toEqual(['One', 'Two'])
    expect(tab?.pages).toBeUndefined()
  })

  it('stay open when the tab also lists loose pages, which the runtime keeps in one flat list', () => {
    const bundle = migrate(pages, { navigation: { tabs: [{ tab: 'Docs', pages: ['a', { group: 'Two', pages: ['c', { group: 'Nested', pages: ['d'] }] }, 'b'] }] } })
    const tab = bundle.docsConfig.tabs?.[0]
    const group = tab?.pages?.find((entry): entry is Exclude<typeof entry, string> => typeof entry !== 'string')
    expect(group?.defaultOpen).toBe(true)
    const nested = group?.pages.find((entry): entry is Exclude<typeof entry, string> => typeof entry !== 'string')
    expect(nested?.defaultOpen).toBeUndefined()
  })
})
