/** Adversarial inputs for the Fern and Docusaurus migrators. */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readDocusaurusRedirects, readDocusaurusSidebars, readDocusaurusSiteSettings } from '../docusaurus.js'
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

describe('Docusaurus Link component', () => {
  it('turns Link tags with an expression or href into matching anchors', () => {
    const bundle = migrateDocusaurus({
      'docs/a.mdx': "export const base = '/docs/y'\n\nSee <Link to={base}>one</Link>, <Link href=\"/z\">two</Link> and <Link to=\"/w\">three</Link>.\n",
    })
    const body = bundle.pages[0].body
    expect(body).toContain('<a href={base}>one</a>')
    expect(body).toContain('<a href="/z">two</a>')
    expect(body).toContain('<a href="/w">three</a>')
    expect(body).not.toMatch(/&lt;|<Link/)
  })
})

describe('Docusaurus autogenerated sidebar', () => {
  it('keeps a number-prefixed directory as a category with its metadata', () => {
    const bundle = migrateDocusaurus({
      'docs/01-intro.md': '# Intro\n',
      'docs/02-guide/01-setup.md': '# Setup\n',
      'docs/02-guide/02-deep/01-leaf.md': '# Leaf\n',
      'docs/02-guide/_category_.json': '{"label":"The Guide"}',
      'sidebars.ts': "export default { docs: [{ type: 'autogenerated', dirName: '.' }] }",
    })
    expect(bundle.docsConfig.tabs[0].pages).toEqual([
      'intro',
      { group: 'The Guide', pages: ['guide/setup', { group: 'Deep', pages: ['guide/deep/leaf'] }] },
    ])
  })

  it('resolves an explicit dirName that names the on-disk prefixed directory', () => {
    const bundle = migrateDocusaurus({
      'docs/02-guide/01-setup.md': '# Setup\n',
      'sidebars.ts': "export default { docs: [{ type: 'autogenerated', dirName: '02-guide' }] }",
    })
    expect(bundle.docsConfig.tabs[0].pages).toEqual(['guide/setup'])
  })
})

describe('Fern files reached through a symlink', () => {
  it('does not copy a generators.yml spec that a symlinked directory points outside the repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'thally-harden-outside-'))
    writeFileSync(join(outside, 'openapi.yaml'), 'openapi: 3.0.0\ninfo:\n  title: OUTSIDE-SPEC\n  version: "1"\npaths: {}\n')
    const root = mkdtempSync(join(tmpdir(), 'thally-harden-fern-'))
    mkdirSync(join(root, 'fern'))
    writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
    writeFileSync(join(root, 'fern', 'docs.yml'), 'navigation:\n  - page: In\n    path: in.mdx\n  - api: API Reference\n')
    writeFileSync(join(root, 'fern', 'in.mdx'), '# In\n')
    writeFileSync(join(root, 'fern', 'generators.yml'), 'api:\n  specs:\n    - openapi: ext/openapi.yaml\n')
    symlinkSync(outside, join(root, 'fern', 'ext'))
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' })
    expect(bundle.assets.some((asset) => Buffer.from(asset.content).toString().includes('OUTSIDE-SPEC'))).toBe(false)
    expect(bundle.warnings.some((warning) => warning.message.includes('ext/openapi.yaml'))).toBe(true)
  })
})

describe('Fern Markdown snippets', () => {
  it('inlines <Markdown src> and applies the size cap', () => {
    const nav = 'navigation:\n  - page: In\n    path: in.mdx\n'
    const bundle = fernSite(nav, {
      'in.mdx': '# In\n\n<Markdown src="/snippets/note.mdx" />\n\n<Markdown src="/snippets/huge.mdx" />\n',
      'snippets/note.mdx': 'SNIPPET-BODY\n',
      'snippets/huge.mdx': 'Lorem ipsum dolor sit amet. '.repeat(80_000),
    })
    expect(bundle.pages).toHaveLength(1)
    expect(bundle.pages[0].body).toContain('SNIPPET-BODY')
    expect(bundle.pages[0].body.length).toBeLessThan(100_000)
    expect(bundle.warnings.map((warning) => warning.message).join(' ')).toContain('too large to inline')
  })
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

function bundlePaths(bundle: ReturnType<typeof migrateRepository>): { assets: Array<string>; quarantined: Array<string> } {
  return {
    assets: bundle.assets.map((asset) => asset.path),
    quarantined: (bundle.quarantinedFiles ?? []).map((file) => file.path),
  }
}

type RefStyle = 'markdown' | 'img' | 'import' | 'require' | 'partial'

/** The body of a page (and a partial, when needed) that references `/img/<name>.png` in one style. */
function referencing(style: RefStyle, name: string, platform: 'docusaurus' | 'fern'): { body: string; partial?: string } {
  const url = platform === 'docusaurus' ? `/img/${name}.png` : `/assets/${name}.png`
  const site = platform === 'docusaurus' ? `@site/static/img/${name}.png` : `../assets/${name}.png`
  switch (style) {
    case 'markdown': return { body: `![alt](${url})\n` }
    case 'img': return { body: `<img src="${url}" alt="alt" />\n` }
    case 'import': return { body: `import pic from '${site}'\n\n<img src={pic} alt="alt" />\n` }
    case 'require': return { body: `<img src={require('${site}').default} alt="alt" />\n` }
    case 'partial': return { body: "import Part from './_part.mdx'\n\n<Part />\n", partial: `![alt](${url})\n` }
  }
}

const STYLES: Array<RefStyle> = ['markdown', 'img', 'import', 'require', 'partial']
const SHARING = ['gated-only', 'shared'] as const

describe('assets used by quarantined pages', () => {
  const docusaurusKinds: Array<[string, string]> = [['draft', 'draft: true'], ['draft-string', 'draft: "yes"']]
  for (const [kind, frontmatter] of docusaurusKinds) {
    for (const style of STYLES) {
      for (const sharing of SHARING) {
        it(`docusaurus ${kind} / ${style} / ${sharing}`, () => {
          const gated = referencing(style, 'secret', 'docusaurus')
          const publicPage = sharing === 'shared' ? referencing('markdown', 'secret', 'docusaurus') : referencing('markdown', 'open', 'docusaurus')
          const files: Record<string, string> = {
            'docs/gated.mdx': `---\n${frontmatter}\n---\n${gated.body}`,
            'docs/public.mdx': `# Public\n\n${publicPage.body}`,
          }
          if (gated.partial) files['docs/_part.mdx'] = gated.partial
          const root = docusaurusSite(files)
          mkdirSync(join(root, 'static', 'img'), { recursive: true })
          for (const name of ['secret', 'open', 'unused']) writeFileSync(join(root, 'static', 'img', `${name}.png`), PNG)
          const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'docusaurus' })
          const { assets, quarantined } = bundlePaths(bundle)
          expect(bundle.pages.map((page) => page.navigationId)).toEqual(['public'])
          expect(assets.includes('img/secret.png')).toBe(sharing === 'shared')
          if (sharing === 'gated-only') {
            expect(assets).toContain('img/open.png')
            expect(quarantined).toContain('migration-quarantine/assets/img/secret.png')
          }
          // Ambiguity quarantines: an asset no published page names is not public on a site with withheld pages.
          expect(assets).not.toContain('img/unused.png')
        })
      }
    }
  }

  const fernKinds: Array<[string, string]> = [['viewers', 'viewers: [admin]'], ['authed', 'authed: true']]
  for (const [kind, frontmatter] of fernKinds) {
    for (const style of STYLES) {
      for (const sharing of SHARING) {
        it(`fern ${kind} / ${style} / ${sharing}`, () => {
          const gated = referencing(style, 'secret', 'fern')
          const publicPage = sharing === 'shared' ? referencing('markdown', 'secret', 'fern') : referencing('markdown', 'open', 'fern')
          const nav = 'navigation:\n  - page: Gated\n    path: gated.mdx\n  - page: Public\n    path: public.mdx\n'
          const pages: Record<string, string> = {
            'gated.mdx': `---\n${frontmatter}\n---\n${gated.body}`,
            'public.mdx': `# Public\n\n${publicPage.body}`,
          }
          if (gated.partial) pages['_part.mdx'] = gated.partial
          const root = mkdtempSync(join(tmpdir(), 'thally-harden-fern-assets-'))
          mkdirSync(join(root, 'fern', 'assets'), { recursive: true })
          writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
          writeFileSync(join(root, 'fern', 'docs.yml'), nav)
          for (const [path, content] of Object.entries(pages)) writeFileSync(join(root, 'fern', path), content)
          for (const name of ['secret', 'open', 'unused']) writeFileSync(join(root, 'fern', 'assets', `${name}.png`), PNG)
          const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' })
          const { assets, quarantined } = bundlePaths(bundle)
          expect(bundle.pages.map((page) => page.title)).toEqual(['Public'])
          expect(assets.some((path) => path.endsWith('secret.png'))).toBe(sharing === 'shared')
          if (sharing === 'gated-only') {
            expect(assets.some((path) => path.endsWith('open.png'))).toBe(true)
            expect(quarantined.some((path) => path.endsWith('assets/secret.png'))).toBe(true)
          }
        })
      }
    }
  }
})

describe('assets: exact path matching and unclassifiable pages', () => {
  function site(publicBody: string, gatedFrontmatter = 'draft: true', gatedBody = '![a](/img/secret.png)\n') {
    const root = docusaurusSite({
      'docs/gated.md': `---\n${gatedFrontmatter}\n---\n${gatedBody}`,
      'docs/public.md': `# Public\n\n${publicBody}`,
    })
    mkdirSync(join(root, 'static', 'img', 'other'), { recursive: true })
    writeFileSync(join(root, 'static', 'img', 'secret.png'), PNG)
    writeFileSync(join(root, 'static', 'img', 'other', 'secret.png'), PNG)
    return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'docusaurus' })
  }

  it('keeps a shared asset public only on an exact path match', () => {
    const bundle = site('![b](/img/other/secret.png)\n')
    expect(bundle.assets.map((asset) => asset.path)).toEqual(['img/other/secret.png'])
    expect(bundlePaths(bundle).quarantined).toContain('migration-quarantine/assets/img/secret.png')
  })

  it('does not treat a bare file name in public text as a reference', () => {
    const bundle = site('The file secret.png is mentioned here.\n')
    expect(bundle.assets.map((asset) => asset.path)).not.toContain('img/secret.png')
  })

  it('quarantines the assets of a page whose frontmatter cannot be read', () => {
    const unreadable = `---\ndraft: true\n${'x: y\n'.repeat(1)}`.padEnd(2_100_000, 'z')
    const bundle = site('![b](/img/other/secret.png)\n', 'draft: true', '')
    expect(bundle.assets.map((asset) => asset.path)).not.toContain('img/secret.png')
    const root = docusaurusSite({ 'docs/gated.md': `${unreadable}\n![a](/img/secret.png)`, 'docs/public.md': '# Public\n' })
    mkdirSync(join(root, 'static', 'img'), { recursive: true })
    writeFileSync(join(root, 'static', 'img', 'secret.png'), PNG)
    const result = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'docusaurus' })
    expect(result.pages.map((page) => page.navigationId)).toEqual(['public'])
    expect(result.assets.map((asset) => asset.path)).not.toContain('img/secret.png')
  })

  it('keeps assets of a gated page dropped by the file budget out of public/', () => {
    const root = docusaurusSite({
      'docs/a-public.md': '# Public\n\n![b](/img/open.png)\n',
      'docs/z-gated.md': '---\ndraft: true\n---\n![a](/img/secret.png)\n',
    })
    mkdirSync(join(root, 'static', 'img'), { recursive: true })
    for (const name of ['open', 'secret']) writeFileSync(join(root, 'static', 'img', `${name}.png`), PNG)
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'docusaurus', maxSourceFiles: 2 })
    expect(bundle.assets.map((asset) => asset.path)).not.toContain('img/secret.png')
  })

  it('fern: <Markdown src> partial used by a restricted page withholds its assets', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-harden-fern-assets-'))
    mkdirSync(join(root, 'fern', 'assets'), { recursive: true })
    mkdirSync(join(root, 'fern', 'snippets'))
    writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
    writeFileSync(join(root, 'fern', 'docs.yml'), 'navigation:\n  - page: Gated\n    path: gated.mdx\n  - page: Public\n    path: public.mdx\n')
    writeFileSync(join(root, 'fern', 'gated.mdx'), '---\nviewers: [admin]\n---\n<Markdown src="/snippets/part.mdx" />\n')
    writeFileSync(join(root, 'fern', 'snippets', 'part.mdx'), '![a](/assets/secret.png)\n')
    writeFileSync(join(root, 'fern', 'public.mdx'), '# Public\n')
    writeFileSync(join(root, 'fern', 'assets', 'secret.png'), PNG)
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' })
    expect(bundle.assets.some((asset) => asset.path.endsWith('secret.png'))).toBe(false)
  })
})

describe('Fern viewers on products and versions', () => {
  it('quarantines every page of a product that sets viewers', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-harden-fern-'))
    mkdirSync(join(root, 'fern', 'products', 'staff'), { recursive: true })
    mkdirSync(join(root, 'fern', 'products', 'open'), { recursive: true })
    writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
    writeFileSync(join(root, 'fern', 'docs.yml'), 'products:\n  - display-name: Open\n    path: ./products/open/open.yml\n  - display-name: Staff\n    path: ./products/staff/staff.yml\n    viewers: [staff]\n')
    writeFileSync(join(root, 'fern', 'products', 'open', 'open.yml'), 'navigation:\n  - page: Open page\n    path: ./open.mdx\n')
    writeFileSync(join(root, 'fern', 'products', 'open', 'open.mdx'), '# Open page\n')
    writeFileSync(join(root, 'fern', 'products', 'staff', 'staff.yml'), 'navigation:\n  - page: Staff page\n    path: ./staff.mdx\n')
    writeFileSync(join(root, 'fern', 'products', 'staff', 'staff.mdx'), '# Staff page\n')
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' })
    expect(bundle.pages.map((page) => page.title)).toEqual(['Open page'])
    expect(quarantinedPaths(bundle)).toEqual(['migration-quarantine/products/staff/staff.mdx'])
  })

  it('quarantines the pages of a default version that sets viewers', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-harden-fern-'))
    mkdirSync(join(root, 'fern', 'versions'), { recursive: true })
    writeFileSync(join(root, 'fern', 'fern.config.json'), '{}')
    writeFileSync(join(root, 'fern', 'docs.yml'), 'versions:\n  - display-name: Beta\n    path: versions/beta.yml\n    slug: beta\n    default: true\n    viewers: [beta-users]\n')
    writeFileSync(join(root, 'fern', 'versions', 'beta.yml'), 'navigation:\n  - page: Beta page\n    path: ../beta.mdx\n')
    writeFileSync(join(root, 'fern', 'beta.mdx'), '# Beta page\n')
    // Its only page is restricted, so nothing is left to publish.
    expect(() => migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'fern' }))
      .toThrow(/migration-quarantine\/beta\.mdx/)
  })
})

describe('Docusaurus config parsing stays linear on repeated openers', () => {
  const hostile: Record<string, string> = {
    'const a:': 'const a: '.repeat(6_000),
    'const a = {': 'const a = {'.repeat(5_000),
    'export default {': 'export default {'.repeat(3_300),
    'docs: {': 'docs: {'.repeat(8_000),
    '...fbContent({': '...fbContent({'.repeat(3_800),
  }
  for (const [name, source] of Object.entries(hostile)) {
    it(`reads 50k characters of "${name}" quickly`, () => {
      const root = docusaurusSite({ 'docusaurus.config.js': source, 'sidebars.js': source })
      const started = Date.now()
      try { readDocusaurusSidebars(root) } catch { /* unparseable is expected */ }
      readDocusaurusSiteSettings(root)
      expect(Date.now() - started).toBeLessThan(400)
    })
  }

  it('rejects a Docusaurus config over 1 MB', () => {
    const root = docusaurusSite({ 'sidebars.js': `module.exports = { docs: [] } // ${'x'.repeat(1_100_000)}` })
    expect(() => readDocusaurusSidebars(root)).toThrow(/1 MB/)
  })
})
