/** End-to-end repository fixtures for platform-specific navigation and assets. */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository, projectFernNavigation, readMintlifyConfig, renderMigrationFiles } from '../index.js'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-repository-'))
  mkdirSync(join(root, 'en', 'guides'), { recursive: true })
  mkdirSync(join(root, 'es', 'guides'), { recursive: true })
  mkdirSync(join(root, 'images'), { recursive: true })
  mkdirSync(join(root, 'snippets'), { recursive: true })
  writeFileSync(join(root, 'navigation.json'), JSON.stringify({
    languages: [
      {
        language: 'en',
        tabs: [{ tab: 'Guides', groups: [{ group: 'Start', pages: ['en/introduction', 'en/guides/install'] }] }],
      },
      {
        language: 'es',
        tabs: [{ tab: 'Guides', groups: [{ group: 'Start', pages: ['es/introduction', 'es/guides/install'] }] }],
      },
    ],
  }))
  writeFileSync(join(root, 'docs.json'), JSON.stringify({
    $schema: 'https://mintlify.com/docs.json',
    navigation: { $ref: './navigation.json' },
  }))
  writeFileSync(join(root, 'README.md'), '# Repository readme\n\nThis must not become a docs page.')
  writeFileSync(join(root, 'en', 'introduction.mdx'), '---\ntitle: Welcome\n---\n\n# Welcome\n\nEnglish docs.')
  writeFileSync(join(root, 'en', 'guides', 'install.mdx'), '---\ntitle: Install\n---\n\nimport Prerequisite from \'/snippets/prerequisite.mdx\'\n\n<Prerequisite />\n\n<Danger>Back up first.</Danger>\n\n<Warn>Review the result.</Warn>')
  writeFileSync(join(root, 'es', 'introduction.mdx'), '---\ntitle: Bienvenido\n---\n\nDocumentación española.')
  writeFileSync(join(root, 'es', 'guides', 'install.mdx'), '---\ntitle: Instalar\n---\n\nPasos de instalación.')
  writeFileSync(join(root, 'images', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(root, 'snippets', 'prerequisite.mdx'), 'Install Node.js before continuing.')
  return root
}

describe('Mintlify repository migration', () => {
  it('resolves JSON pointers into arrays without allowing refs through symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-mintlify-refs-'))
    writeFileSync(join(root, 'navigation.json'), JSON.stringify({
      fragments: [{ groups: [{ group: 'Start', pages: ['introduction'] }] }],
    }))
    writeFileSync(join(root, 'docs.json'), JSON.stringify({
      $schema: 'https://mintlify.com/docs.json',
      navigation: { $ref: './navigation.json#/fragments/0' },
    }))
    expect(readMintlifyConfig(root)).toMatchObject({
      navigation: { groups: [{ group: 'Start', pages: ['introduction'] }] },
    })

    const outside = mkdtempSync(join(tmpdir(), 'thally-migrate-mintlify-outside-'))
    writeFileSync(join(outside, 'navigation.json'), JSON.stringify({ pages: ['private'] }))
    symlinkSync(join(outside, 'navigation.json'), join(root, 'outside.json'))
    writeFileSync(join(root, 'docs.json'), JSON.stringify({
      $schema: 'https://mintlify.com/docs.json',
      navigation: { $ref: './outside.json' },
    }))
    expect(() => readMintlifyConfig(root)).toThrow('not a regular file')
  })

  it('resolves navigation refs, preserves locales, excludes repo metadata, and renders assets', () => {
    const bundle = migrateRepository({
      repositoryDir: fixture(),
      sourceUrl: 'https://github.com/acme/docs',
    })

    expect(bundle.platform).toBe('mintlify')
    expect(bundle.pages.map((page) => page.id)).toEqual([
      'introduction',
      'guides/install',
      'es/introduction',
      'es/guides/install',
    ])
    expect(bundle.pages[1].body).toContain('<Error>Back up first.</Error>')
    expect(bundle.pages[1].body).toContain('<Warning>Review the result.</Warning>')
    expect(bundle.pages[1].body).toContain('Install Node.js before continuing.')
    expect(bundle.pages.map((page) => page.id)).not.toContain('snippets/prerequisite')
    expect(bundle.docsConfig.i18n).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', label: 'English' },
        { code: 'es', label: 'Spanish' },
      ],
    })
    expect(bundle.docsConfig.tabs[0]).toMatchObject({
      tab: 'Guides',
      groups: [{ group: 'Start', pages: ['introduction', 'guides/install'] }],
    })
    const files = renderMigrationFiles(bundle)
    expect(files.map((file) => file.path)).toContain('public/images/logo.svg')
    expect(files.map((file) => file.path)).not.toContain('src/content/readme.mdx')
  })

  it('uses a nested Mintlify project as the config, content, snippet, and asset root', () => {
    const repositoryDir = mkdtempSync(join(tmpdir(), 'thally-migrate-mintlify-monorepo-'))
    const docsRoot = join(repositoryDir, 'apps', 'docs')
    mkdirSync(join(docsRoot, 'management'), { recursive: true })
    mkdirSync(join(docsRoot, 'guides'), { recursive: true })
    mkdirSync(join(docsRoot, 'images'), { recursive: true })
    mkdirSync(join(docsRoot, 'snippets'), { recursive: true })
    writeFileSync(join(docsRoot, 'navigation.json'), JSON.stringify({
      dropdowns: [{ dropdown: 'Discarded navigation', pages: ['discarded'] }],
    }))
    writeFileSync(join(docsRoot, 'docs.json'), JSON.stringify({
      $schema: 'https://mintlify.com/docs.json',
      theme: 'maple',
      navigation: {
        $ref: './navigation.json',
        global: { anchors: [{ anchor: 'Community', href: 'https://community.example.com' }] },
        dropdowns: [
          {
            dropdown: 'Documentation',
            description: 'Resources for Acme developers',
            icon: 'book-open',
            groups: [{
              group: 'Getting started',
              icon: { name: 'play' },
              pages: ['introduction', { group: 'CLI', pages: ['manualSetup'] }],
            }],
          },
          {
            dropdown: 'API reference',
            groups: [{ group: 'Runs API', pages: ['management/runs'] }],
          },
          {
            dropdown: 'Guides & examples',
            groups: [{ group: 'Guides', pages: ['guides/introduction'] }],
          },
        ],
      },
      api: { openapi: 'service.openapi.yml' },
      redirects: [{ source: '/unsafe', destination: 'javascript:alert(1)' }],
      navbar: {
        links: [
          { label: 'Status', href: 'https://status.example.com' },
          { label: 'Unsafe', href: 'javascript:alert(1)' },
        ],
        primary: { type: 'github', href: 'https://github.com/acme/product' },
      },
      footer: {
        socials: {
          github: 'https://github.com/acme/product',
          unsafe: 'data:text/html,bad',
        },
        links: [{ header: 'Developers', items: [{ label: 'Changelog', href: '/changelog' }] }],
      },
    }))
    writeFileSync(join(docsRoot, 'introduction.mdx'), [
      '---',
      'title: Product docs',
      'sidebarTitle: Introduction',
      'tag: NEW',
      'mode: center',
      'noindex: true',
      '---',
      '',
      "import Shared from '/snippets/shared.mdx'",
      '',
      '<Shared tool={"CLI"} />',
    ].join('\n'))
    writeFileSync(join(docsRoot, 'manualSetup.mdx'), '---\ntitle: Manual setup\n---\n\n<Shared tool={"Setup"} />\n\n<SoftLimit />\n\n![Diagram](./images/setup.png?raw=1#preview)')
    writeFileSync(join(docsRoot, 'management', 'runs.mdx'), '---\ntitle: Runs\n---\n\nRuns API.')
    writeFileSync(join(docsRoot, 'guides', 'introduction.mdx'), '---\ntitle: Guides\n---\n\nGuides.')
    writeFileSync(join(docsRoot, 'snippets', 'shared.mdx'), 'Shared {tool} prerequisite.\n\n```tsx\nconst literal = {tool}\n```')
    writeFileSync(join(docsRoot, 'snippets', 'soft-limit.mdx'), 'This limit can be raised.')
    writeFileSync(join(docsRoot, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(docsRoot, 'images', 'setup.png'), 'image')
    writeFileSync(join(docsRoot, 'service.openapi.yml'), 'openapi: 3.1.0\ninfo: { title: Service, version: 1.0.0 }\npaths: {}')

    const bundle = migrateRepository({
      repositoryDir,
      sourceUrl: 'https://github.com/acme/monorepo/tree/main/apps/docs',
      docsDir: 'apps/docs',
    })

    expect(bundle.platform).toBe('mintlify')
    expect(bundle.docsConfig.tabs.map((tab) => tab.tab)).toEqual([
      'Documentation',
      'API reference',
      'Guides & examples',
    ])
    expect(bundle.docsConfig.tabs[0].groups).toEqual([{
      group: 'Getting started',
      icon: 'play',
      pages: ['introduction', { group: 'CLI', pages: ['manualSetup'] }],
    }])
    expect(bundle.docsConfig.navigation).toEqual({ display: 'dropdown' })
    expect(bundle.docsConfig.tabs[0]).toMatchObject({
      tab: 'Documentation',
      description: 'Resources for Acme developers',
      icon: 'book-open',
    })
    expect(bundle.docsConfig.tabs[1]).toMatchObject({
      tab: 'API reference',
      groups: [{ group: 'Runs API', pages: ['management/runs'] }],
      api: { source: '/service.openapi.yml', navigation: false },
    })
    expect(bundle.docsConfig).toMatchObject({
      theme: 'maple',
      navbar: {
        links: [
          { label: 'Status', href: 'https://status.example.com' },
          { label: 'Community', href: 'https://community.example.com' },
        ],
        primary: { label: 'GitHub', href: 'https://github.com/acme/product' },
      },
      footer: {
        socials: { github: 'https://github.com/acme/product' },
        links: [{ heading: 'Developers', items: [{ label: 'Changelog', href: '/changelog' }] }],
      },
      redirects: [
        { source: '/guides', destination: '/guides/introduction', permanent: false },
      ],
    })
    expect(bundle.pages.map((page) => page.id)).toEqual([
      'introduction',
      'manualSetup',
      'management/runs',
      'guides/introduction',
    ])
    expect(bundle.pages[0]).toMatchObject({
      navTitle: 'Introduction',
      badge: 'NEW',
      mode: 'center',
      noindex: true,
    })
    expect(bundle.pages[0].body).toContain('Shared CLI prerequisite.')
    expect(bundle.pages[0].body).toContain('const literal = {tool}')
    expect(bundle.pages[1].body).toContain('![Diagram](/images/setup.png?raw=1#preview)')
    expect(bundle.pages[1].body).toContain('Shared Setup prerequisite.')
    expect(bundle.pages[1].body).toContain('This limit can be raised.')
    expect(bundle.assets.map((asset) => asset.path)).toEqual(expect.arrayContaining([
      'logo.svg',
      'images/setup.png',
      'service.openapi.yml',
    ]))
    expect(bundle.warnings).toEqual([])

    const introduction = renderMigrationFiles(bundle)
      .find((file) => file.path === 'src/content/introduction.mdx')
    expect(introduction?.content).toContain('navTitle: "Introduction"')
    expect(introduction?.content).toContain('badge: "NEW"')
    expect(introduction?.content).toContain('mode: "center"')
    expect(introduction?.content).toContain('noindex: true')
  })

  it('skips dotfile directories and .mintignore paths, and excludes pages that fail to compile as MDX', () => {
    const root = fixture()
    // Dotfile directory: never a docs page, even without a .mintignore entry.
    mkdirSync(join(root, 'en', '.tooling', 'skills'), { recursive: true })
    writeFileSync(join(root, 'en', '.tooling', 'skills', 'skill.mdx'), '# Not a page')
    // Non-dotfile directory excluded only via .mintignore, like Mintlify's own
    // agent-context/ convention.
    mkdirSync(join(root, 'agent-context'), { recursive: true })
    writeFileSync(join(root, 'agent-context', 'notes.mdx'), '# Internal notes')
    writeFileSync(join(root, '.mintignore'), 'agent-context/\n')
    // Invalid MDX (an unmatched closing tag) must not abort the whole import.
    writeFileSync(join(root, 'en', 'broken.mdx'), '---\ntitle: Broken\n---\n\n</NoOpenTag>')

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    expect(bundle.pages.map((page) => page.id)).not.toContain('en/.tooling/skills/skill')
    expect(bundle.pages.map((page) => page.id)).not.toContain('agent-context/notes')
    expect(bundle.pages.map((page) => page.id)).not.toContain('broken')
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      code: 'skipped-file',
      source: 'en/broken.mdx',
      message: expect.stringContaining('does not compile as MDX'),
    }))
  })

  it('keeps a page-local component declaration instead of forcing in a same-named global snippet', () => {
    const root = fixture()
    // Mintlify treats every /snippets/ file as an implicitly available global
    // component keyed by its filename ("Counter" here), regardless of whether
    // any page imports it.
    writeFileSync(join(root, 'snippets', 'counter.mdx'), 'export const Counter = () => <div>Global counter</div>\n')
    writeFileSync(join(root, 'en', 'widgets.mdx'), [
      '---',
      'title: Widgets',
      '---',
      '',
      'export const Counter = () => <div>Local counter</div>',
      '',
      '<Counter />',
    ].join('\n'))

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    const page = bundle.pages.find((candidate) => candidate.id === 'widgets')
    expect(page?.body.match(/export const Counter/g)).toHaveLength(1)
    expect(page?.body).toContain('Local counter')
    expect(page?.body).not.toContain('Global counter')
  })

  it('strips a named-import snippet declaration so its inlined component is not duplicated', () => {
    const root = fixture()
    // Mintlify snippets can export a named binding (not just a default),
    // e.g. `import { Generator } from "/snippets/generator.mdx"`. The import
    // line itself must be removed once the snippet body is inlined, or the
    // inlined `export const Generator` collides with the surviving import.
    writeFileSync(join(root, 'snippets', 'generator.mdx'), 'export const Generator = () => <div>Generated</div>\n')
    writeFileSync(join(root, 'en', 'generator.mdx'), [
      '---',
      'title: Generator',
      '---',
      '',
      'import { Generator } from "/snippets/generator.mdx";',
      '',
      '<Generator />',
    ].join('\n'))

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    const page = bundle.pages.find((candidate) => candidate.id === 'generator')
    expect(page?.body).not.toContain('import { Generator }')
    expect(page?.body.match(/export const Generator/g)).toHaveLength(1)
  })

  it('excludes a page that passes a page-authored function as a prop into a component this migration extracted as a client module', () => {
    const root = fixture()
    // Next renders an MDX page as a Server Component by default. A component
    // this migration copies (see components.ts's `copyGraph`) is always
    // marked `'use client'`; passing a plain function into it as a prop
    // throws "Functions cannot be passed directly to Client Components" at
    // render, even though the MDX compiles fine — Mintlify's own renderer
    // has no such server/client split.
    writeFileSync(join(root, 'en', 'panel.jsx'), 'export const Panel = ({ children }) => <div>{children}</div>;\n')
    writeFileSync(join(root, 'en', 'widget.mdx'), [
      '---',
      'title: Widget',
      '---',
      '',
      "import { Panel } from './panel.jsx'",
      '',
      'export const CustomBlock = ({ children }) => <div>{children}</div>;',
      '',
      '<Panel title="x" RenderComponent={CustomBlock}>Body</Panel>',
    ].join('\n'))

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    expect(bundle.pages.map((page) => page.id)).not.toContain('widget')
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      code: 'skipped-file',
      source: 'en/widget.mdx',
      message: expect.stringContaining("passes a function to an interactive component, which can't be rendered on the server"),
    }))
  })

  it('keeps (but warns on) a page that passes a function to a component this migration never extracted', () => {
    const root = fixture()
    // `Accordion` is a Thally runtime built-in, not something this migration
    // copied or extracted — `propsTargetExtractedClientComponent` cannot
    // confirm it crosses the server/client boundary, so exclusion (a last
    // resort) does not apply; the page is kept and flagged for manual review
    // instead of being dropped on an unconfirmed heuristic.
    writeFileSync(join(root, 'en', 'builtin-target.mdx'), [
      '---',
      'title: Builtin Target',
      '---',
      '',
      'export const CustomBlock = ({ children }) => <div>{children}</div>;',
      '',
      '<Accordion title="x" RenderComponent={CustomBlock}>Body</Accordion>',
    ].join('\n'))

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    expect(bundle.pages.map((page) => page.id)).toContain('builtin-target')
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      code: 'unsupported-config',
      source: 'en/builtin-target.mdx',
      message: expect.stringContaining('might pass a function'),
    }))
  })

  it('does not flag a fenced-code example of this exact shape', () => {
    const root = fixture()
    writeFileSync(join(root, 'en', 'fenced-example.mdx'), [
      '---',
      'title: Fenced Example',
      '---',
      '',
      '```jsx',
      'export const CustomBlock = () => <div />;',
      '<Accordion RenderComponent={CustomBlock} />',
      '```',
    ].join('\n'))

    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })

    expect(bundle.pages.map((page) => page.id)).toContain('fenced-example')
    expect(bundle.warnings.some((warning) => warning.message.includes('function'))).toBe(false)
  })

  it('does not flag a plain value prop whose initializer merely contains =>', () => {
    const root = fixture()
    writeFileSync(join(root, 'en', 'value-prop.mdx'), [
      '---',
      'title: Value Prop',
      '---',
      '',
      'export const items = [1, 2, 3].map((x) => x);',
      '',
      '<Table rows={items} />',
    ].join('\n'))

    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })

    expect(bundle.pages.map((page) => page.id)).toContain('value-prop')
    expect(bundle.warnings.some((warning) => warning.message.includes('function'))).toBe(false)
  })

  it('drops an excluded page from navigation instead of leaving a dangling reference', () => {
    const root = fixture()
    // The source `docs.json`/`navigation.json` still lists this page even
    // though it gets excluded above (same shape, different platform) — the
    // nav is projected from the raw config independently of which files
    // actually made it into `bundle.pages`.
    writeFileSync(join(root, 'navigation.json'), JSON.stringify({
      languages: [
        {
          language: 'en',
          tabs: [{
            tab: 'Guides',
            groups: [
              { group: 'Start', pages: ['en/introduction', 'en/guides/install'] },
              { group: 'Assistant', pages: ['en/widget'] },
            ],
          }],
        },
        {
          language: 'es',
          tabs: [{ tab: 'Guides', groups: [{ group: 'Start', pages: ['es/introduction', 'es/guides/install'] }] }],
        },
      ],
    }))
    writeFileSync(join(root, 'en', 'panel.jsx'), 'export const Panel = ({ children }) => <div>{children}</div>;\n')
    writeFileSync(join(root, 'en', 'widget.mdx'), [
      '---',
      'title: Widget',
      '---',
      '',
      "import { Panel } from './panel.jsx'",
      '',
      'export const CustomBlock = ({ children }) => <div>{children}</div>;',
      '',
      '<Panel title="x" RenderComponent={CustomBlock}>Body</Panel>',
    ].join('\n'))

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    const guidesTab = bundle.docsConfig.tabs.find((tab) => tab.tab === 'Guides')
    const groupNames = guidesTab?.groups?.map((group) => group.group)
    expect(groupNames).not.toContain('Assistant')
    expect(JSON.stringify(bundle.docsConfig)).not.toContain('en/widget')
  })

  it('carries Mintlify theme colors into the migrated site branding', () => {
    const root = fixture()
    writeFileSync(join(root, 'docs.json'), JSON.stringify({
      $schema: 'https://mintlify.com/docs.json',
      navigation: { $ref: './navigation.json' },
      colors: { primary: '#16A34A', light: '#07C983', dark: '#15803D', invalid: 'not-a-color' },
    }))

    const bundle = migrateRepository({
      repositoryDir: root,
      sourceUrl: 'https://github.com/acme/docs',
    })

    expect(bundle.site?.colors).toEqual({ primary: '#16A34A', light: '#07C983', dark: '#15803D' })
  })
})

function docusaurusFixture(sidebarSource?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-docusaurus-'))
  mkdirSync(join(root, 'docs', 'guide'), { recursive: true })
  mkdirSync(join(root, 'docs', 'api'), { recursive: true })
  mkdirSync(join(root, 'static', 'img'), { recursive: true })
  writeFileSync(join(root, 'docusaurus.config.ts'), "export default { presets: [['classic', { docs: { sidebarPath: './sidebars.ts' } }]] }")
  writeFileSync(join(root, 'sidebars.ts'), sidebarSource ?? `
    import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'
    const sidebars: SidebarsConfig = {
      docs: [
        'intro',
        {
          type: 'category',
          label: 'Guides',
          link: { type: 'generated-index', slug: '/guides', description: 'Choose a guide.' },
          items: [
            { type: 'doc', id: 'guide/getting-started' },
            { type: 'autogenerated', dirName: 'api' },
          ],
        },
      ],
    }
    export default sidebars
  `)
  writeFileSync(join(root, 'docs', '01-intro.md'), '---\nid: intro\nslug: /\ntitle: Welcome\n---\n\nDocusaurus introduction.')
  writeFileSync(join(root, 'docs', 'guide', '01-start.md'), '---\nid: getting-started\nslug: /start-here\ntitle: Get started\n---\n\n:::tip[Fast path]\nShip it.\n:::\n\n[Call the endpoint](../api/02-endpoint.md#call)')
  writeFileSync(join(root, 'docs', 'api', '02-endpoint.mdx'), `---\ntitle: Endpoint\nsidebar_position: 2\n---\n\nimport Tabs from '@theme/Tabs'\nimport TabItem from '@theme/TabItem'\n\n<Tabs>\n<TabItem value="curl" label="cURL">Run curl.</TabItem>\n</Tabs>`)
  writeFileSync(join(root, 'docs', 'api', '01-auth.md'), '---\ntitle: Authentication\nsidebar_position: 1\n---\n\nAuthenticate first.')
  writeFileSync(join(root, 'static', 'img', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  return root
}

describe('Docusaurus repository migration', () => {
  it('projects static sidebars, routes, generated indexes, syntax, and static assets', () => {
    const bundle = migrateRepository({
      repositoryDir: docusaurusFixture(),
      sourceUrl: 'https://github.com/acme/docusaurus-docs',
      platform: 'docusaurus',
    })

    expect(bundle.platform).toBe('docusaurus')
    expect(bundle.pages.map((page) => page.id)).toEqual([
      'introduction',
      'api/auth',
      'api/endpoint',
      'start-here',
      'guides',
    ])
    expect(bundle.pages.find((page) => page.id === 'start-here')?.body).toContain('<Note>\n**Fast path**')
    expect(bundle.pages.find((page) => page.id === 'start-here')?.body).toContain('[Call the endpoint](/api/endpoint#call)')
    expect(bundle.pages.find((page) => page.id === 'api/endpoint')?.body).toContain('<Tab title="cURL">')
    expect(bundle.pages.find((page) => page.id === 'api/endpoint')?.body).not.toContain('@theme/Tab')
    expect(bundle.docsConfig.tabs[0]).toEqual({
      tab: 'Documentation',
      groups: [
        { group: 'Overview', pages: ['introduction'] },
        { group: 'Guides', pages: ['guides', 'start-here', 'api/auth', 'api/endpoint'] },
      ],
    })
    expect(bundle.assets.map((asset) => asset.path)).toContain('img/logo.svg')
  })

  it('strips an unsupported npm-package MDX import from a Docusaurus page instead of shipping a broken build', () => {
    const root = docusaurusFixture()
    writeFileSync(join(root, 'docs', 'api', '01-auth.md'),
      "---\ntitle: Authentication\nsidebar_position: 1\n---\n\nimport LiteYouTubeEmbed from 'react-lite-youtube-embed';\n\n<LiteYouTubeEmbed id=\"abc123\" />")
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docusaurus-docs', platform: 'docusaurus' })
    const page = bundle.pages.find((page) => page.id === 'api/auth')
    expect(page?.body).not.toContain('react-lite-youtube-embed')
    expect(page?.body).toContain('<iframe')
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      message: expect.stringContaining("'react-lite-youtube-embed'"),
    }))
  })

  it('warns and lists skipped versioned docs and i18n locales instead of silently dropping them', () => {
    const root = docusaurusFixture()
    mkdirSync(join(root, 'versioned_docs', 'version-1.0'), { recursive: true })
    writeFileSync(join(root, 'versioned_docs', 'version-1.0', 'intro.md'), 'Old intro.')
    mkdirSync(join(root, 'versioned_sidebars'), { recursive: true })
    writeFileSync(join(root, 'versioned_sidebars', 'version-1.0-sidebars.json'), '{}')
    mkdirSync(join(root, 'i18n', 'fr', 'docusaurus-plugin-content-docs', 'current'), { recursive: true })
    writeFileSync(join(root, 'i18n', 'fr', 'docusaurus-plugin-content-docs', 'current', 'intro.md'), 'Bonjour.')
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docusaurus-docs', platform: 'docusaurus' })
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      source: 'versioned_docs',
      message: expect.stringContaining('version-1.0'),
    }))
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      source: 'i18n',
      message: expect.stringContaining('fr'),
    }))
    expect(bundle.pages.some((page) => page.body.includes('Bonjour'))).toBe(false)
  })

  it('never executes sidebar modules and falls back when their export is executable', () => {
    const repositoryDir = docusaurusFixture(`
      throw new Error('this source module must never execute')
      module.exports = { docs: buildSidebar() }
    `)
    const bundle = migrateRepository({
      repositoryDir,
      sourceUrl: 'https://github.com/acme/docusaurus-docs',
      platform: 'docusaurus',
    })

    expect(bundle.pages.length).toBeGreaterThan(0)
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      code: 'unsupported-config',
      message: expect.stringContaining('could not be read safely'),
    }))
    expect(bundle.docsConfig.tabs[0].tab).toBe('Documentation')
  })

  it('discovers monorepo projects, static external wrappers, aliases, plugins, and literal index slugs', () => {
    const repositoryDir = mkdtempSync(join(tmpdir(), 'thally-migrate-docusaurus-monorepo-'))
    const siteRoot = join(repositoryDir, 'packages', 'website')
    mkdirSync(join(siteRoot, 'docs', 'API'), { recursive: true })
    mkdirSync(join(siteRoot, 'docs', 'filters'), { recursive: true })
    mkdirSync(join(siteRoot, 'wiki', 'style'), { recursive: true })
    mkdirSync(join(siteRoot, 'static', 'img'), { recursive: true })
    writeFileSync(join(siteRoot, 'docusaurus.config.ts'), `
      export default {
        presets: [['classic', { docs: { path: 'docs', sidebarPath: './sidebars.js' } }]],
        plugins: [[
          '@docusaurus/plugin-content-docs',
          { id: 'wiki', path: 'wiki', routeBasePath: 'wiki' },
        ]],
      }
    `)
    writeFileSync(join(siteRoot, 'sidebars.js'), `
      module.exports = {
        docs: ['index', { 'API Reference': [
          ...fbContent({ internal: ['internal/secret'], external: ['API/Type', 'filters/index'] }),
        ] }],
      }
    `)
    writeFileSync(join(siteRoot, 'docs', '_partial.mdx'), 'Portable imported prerequisite.')
    writeFileSync(join(siteRoot, 'docs', 'index.mdx'), "---\ntitle: Introduction\n---\n\nimport Partial from '@site/docs/_partial.mdx';\n\n<Partial />")
    writeFileSync(join(siteRoot, 'docs', 'API', 'Type.mdx'), '---\ntitle: Type\n---\n\nCase-sensitive API type.')
    writeFileSync(join(siteRoot, 'docs', 'filters', 'index.mdx'), '---\ntitle: Filters\nslug: index\n---\n\nFilter reference.')
    writeFileSync(join(siteRoot, 'wiki', 'index.mdx'), '---\ntitle: Wiki\n---\n\nWiki introduction.')
    writeFileSync(join(siteRoot, 'wiki', 'style', '_category_.json'), JSON.stringify({
      label: 'Style',
      link: { type: 'generated-index', title: 'Style index' },
    }))
    writeFileSync(join(siteRoot, 'wiki', 'style', 'writing.mdx'), '---\ntitle: Writing\n---\n\nWriting guidance.')
    writeFileSync(join(siteRoot, 'static', 'img', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')

    const bundle = migrateRepository({
      repositoryDir,
      sourceUrl: 'https://github.com/acme/monorepo',
    })

    expect(bundle.platform).toBe('docusaurus')
    expect(bundle.pages.map((page) => page.id)).toEqual([
      'API/Type',
      'filters/index/index',
      'introduction',
      'wiki',
      'wiki/style/writing',
      'wiki/category/style',
    ])
    expect(bundle.pages.find((page) => page.id === 'introduction')?.body).toContain('Portable imported prerequisite.')
    expect(bundle.pages.map((page) => page.id)).not.toContain('_partial')
    expect(bundle.docsConfig.tabs.map((tab) => tab.tab)).toEqual(['Documentation', 'Wiki'])
    expect(bundle.docsConfig.tabs[0].groups).toEqual([
      { group: 'Overview', pages: ['introduction'] },
      { group: 'API Reference', pages: ['API/Type', 'filters/index'] },
    ])
    expect(bundle.assets.map((asset) => asset.path)).toContain('img/logo.svg')
  })
})

function fernFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-'))
  const fernRoot = join(root, 'fern')
  mkdirSync(join(fernRoot, 'pages', 'advanced'), { recursive: true })
  mkdirSync(join(fernRoot, 'images'), { recursive: true })
  mkdirSync(join(fernRoot, 'openapi'), { recursive: true })
  writeFileSync(join(fernRoot, 'fern.config.json'), JSON.stringify({ organization: 'acme' }))
  writeFileSync(join(fernRoot, 'docs.yml'), `
title: Acme Docs
colors:
  accent-primary:
    light: "#008700"
    dark: "#70E155"
navbar-links:
  - type: github
    value: https://github.com/acme/acme
tabs:
  home:
    display-name: Home
    skip-slug: true
  guides:
    display-name: Guides
  api:
    display-name: API Reference
navigation:
  - tab: home
    layout:
      - page: Welcome
        path: pages/introduction.mdx
  - tab: guides
    layout:
      - section: Getting Started
        skip-slug: true
        contents:
          - page: Install
            path: pages/install.mdx
          - page: OpenAI
            path: pages/openai.mdx
          - page: Pinned
            path: pages/pinned.mdx
          - section: Reference
            slug: reference
            path: pages/reference-overview.mdx
            contents:
              - page: Detail
                path: pages/reference-detail.mdx
          - section: Advanced
            slug: advanced
            contents:
              - page: Config
                path: pages/advanced/config.mdx
  - tab: api
    layout:
      - api: API Reference
redirects:
  - source: /old-install
    destination: /guides/install
`)
  writeFileSync(join(fernRoot, 'openapi', 'openapi.yml'), 'openapi: 3.0.0\ninfo:\n  title: Acme API\n  version: "1.0"\npaths: {}\n')
  writeFileSync(join(fernRoot, 'pages', 'introduction.mdx'), '---\ntitle: Welcome\n---\n\n<Callout intent="warning">Read this first.</Callout>\n\n![Logo](../images/logo.svg)')
  writeFileSync(join(fernRoot, 'pages', 'install.mdx'), '---\ntitle: Install\n---\n\n<CodeBlocks>\n```bash\nnpm install acme\n```\n</CodeBlocks>\n\n<Success>Done.</Success>\n\nIf setup fails: "connection to {vendor} failed".')
  // Not referenced from docs.yml. Unlike Mintlify, Fern only serves pages
  // reachable from navigation, so this must be excluded, not imported as an orphan.
  writeFileSync(join(fernRoot, 'pages', 'orphan.mdx'), '---\ntitle: Orphan\n---\n\nNot in any navigation.')
  writeFileSync(join(fernRoot, 'pages', 'openai.mdx'), '---\ntitle: OpenAI\n---\n\nUse an OpenAI-compatible key.')
  writeFileSync(join(fernRoot, 'pages', 'pinned.mdx'), '---\ntitle: Pinned\nslug: pinned-page\n---\n\nA page pinned to a short URL.')
  writeFileSync(join(fernRoot, 'pages', 'reference-overview.mdx'), '---\ntitle: Reference overview\n---\n\nReference landing page.')
  writeFileSync(join(fernRoot, 'pages', 'reference-detail.mdx'), '---\ntitle: Reference detail\n---\n\nReference detail page.')
  writeFileSync(join(fernRoot, 'pages', 'advanced', 'config.mdx'), '---\ntitle: Config\n---\n\n<ParameterField name="apiKey" type="string" required>\n  Your API key.\n</ParameterField>\n\n<EndpointRequestSnippet />')
  writeFileSync(join(fernRoot, 'images', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  return root
}

describe('Fern repository migration', () => {
  it('skips a symlinked versions file instead of reading through it', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-versions-'))
    const outside = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-outside-'))
    writeFileSync(join(outside, 'v1.yml'), 'navigation:\n  - page: Secret\n    path: secret.mdx\n')
    symlinkSync(join(outside, 'v1.yml'), join(root, 'v1.yml'))
    const config = {
      versions: [{ version: 'v1', path: 'v1.yml', default: true }],
    }
    const projected = projectFernNavigation({ config, fernRoot: root })
    expect(projected.docsConfig.tabs).toEqual([])
    expect(projected.descriptors).toEqual([])
    expect(projected.warnings.some((warning) => warning.message.includes('not a regular file'))).toBe(true)
    // A failed read is reported through the same warning, not swallowed.
    expect(projected.warnings.some((warning) => warning.message.includes('could not be read'))).toBe(false)
    // Exactly one version exists (and it's the one imported), so nothing was
    // actually skipped — the warning must not fire.
    expect(projected.warnings.some((warning) => warning.message.includes('were skipped'))).toBe(false)
  })

  it('reports which Fern versions were skipped, and only when more than one exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-versions-multi-'))
    writeFileSync(join(root, 'v1.yml'), 'navigation:\n  - page: V1\n    path: v1.mdx\n')
    writeFileSync(join(root, 'v2.yml'), 'navigation:\n  - page: V2\n    path: v2.mdx\n')
    const config = {
      versions: [
        { version: 'v1', path: 'v1.yml' },
        { version: 'v2', path: 'v2.yml', default: true },
        { version: 'v3', path: 'v3.yml' },
      ],
    }
    const projected = projectFernNavigation({ config, fernRoot: root })
    const warning = projected.warnings.find((entry) => entry.message.includes('were skipped'))
    expect(warning?.message).toContain('v1')
    expect(warning?.message).toContain('v3')
    expect(warning?.message).not.toContain('v2')
  })

  it('warns instead of silently skipping when a chosen version file cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-versions-unreadable-'))
    // Oversized rather than malformed: the `yaml` parser is lenient about
    // syntax, but `readBoundedYaml` throws once a file exceeds its 2 MB cap,
    // which previously hit the bare `catch {}` and vanished without a trace.
    writeFileSync(join(root, 'v1.yml'), `navigation:\n${'  # padding\n'.repeat(180_000)}`)
    const config = { versions: [{ version: 'v1', path: 'v1.yml', default: true }] }
    const projected = projectFernNavigation({ config, fernRoot: root })
    expect(projected.warnings.some((warning) => warning.message.includes('could not be read'))).toBe(true)
  })

  it('rejects a protocol-relative redirect destination and translates a trailing wildcard', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-redirects-'))
    const config = {
      navigation: [{ page: 'Welcome', path: 'welcome.mdx' }],
      redirects: [
        { source: '/evil', destination: '//evil.example' },
        { source: '/old/*', destination: '/new/*' },
      ],
    }
    const projected = projectFernNavigation({ config, fernRoot: root })
    expect(projected.docsConfig.redirects).not.toContainEqual(
      expect.objectContaining({ source: '/evil' }),
    )
    expect(projected.docsConfig.redirects).toContainEqual({
      source: '/old/:path*',
      destination: '/new/:path*',
    })
  })

  it('projects tabs, nested sections with skip-slug, navbar links, redirects, OpenAPI, assets, and component renames', () => {
    const bundle = migrateRepository({
      repositoryDir: fernFixture(),
      sourceUrl: 'https://github.com/acme/fern-docs',
    })

    expect(bundle.platform).toBe('fern')
    // Tabs/sections default to their slugified label (confirmed against a live
    // Fern site's sitemap); only `skip-slug: true` (on a tab, section, or page)
    // omits that segment, and `slug` overrides the label.
    expect(bundle.pages.map((page) => page.id).sort()).toEqual([
      'guides/advanced/config',
      'guides/install',
      'guides/open-ai',
      'guides/reference',
      'guides/reference/detail',
      'pinned-page',
      'welcome',
    ])
    // "OpenAI" -> "open-ai": Fern splits camelCase/acronym boundaries when it
    // slugifies a label, unlike the shared Mintlify/Docusaurus slugifier.
    expect(bundle.pages.map((page) => page.id)).toContain('guides/open-ai')
    // A section's own `path` makes it a clickable landing page hosted at the
    // section's own segment, not a further-nested page segment.
    expect(bundle.pages.find((page) => page.id === 'guides/reference')?.title).toBe('Reference overview')
    // A page's frontmatter `slug` replaces its entire section hierarchy.
    expect(bundle.pages.find((page) => page.id === 'pinned-page')?.title).toBe('Pinned')
    expect(bundle.docsConfig.tabs.find((tab) => tab.tab === 'Guides')?.groups).toEqual([
      {
        group: 'Getting Started',
        pages: [
          'guides/install',
          'guides/open-ai',
          'pinned-page',
          { group: 'Reference', pages: ['guides/reference', 'guides/reference/detail'] },
          { group: 'Advanced', pages: ['guides/advanced/config'] },
        ],
      },
    ])
    expect(bundle.docsConfig.navbar?.links).toEqual([
      { label: 'GitHub', href: 'https://github.com/acme/acme', type: 'github' },
    ])
    expect(bundle.docsConfig.redirects).toContainEqual({ source: '/old-install', destination: '/guides/install' })
    const apiTab = bundle.docsConfig.tabs.find((tab) => tab.api)
    expect(apiTab?.api?.source).toBe('/openapi.yml')
    expect(bundle.assets.map((asset) => asset.path)).toContain('images/logo.svg')
    expect(bundle.pages.find((page) => page.id === 'welcome')?.body).toContain('<Warning>Read this first.</Warning>')
    expect(bundle.pages.find((page) => page.id === 'welcome')?.body).toContain('/images/logo.svg')
    expect(bundle.pages.find((page) => page.id === 'guides/install')?.body).toContain('<CodeGroup>')
    expect(bundle.pages.find((page) => page.id === 'guides/install')?.body).toContain('<Tip>Done.</Tip>')
    // Fern renders a bare `{word}` in prose as literal text; Thally's MDX
    // pipeline would otherwise throw evaluating it as an undefined JS ref.
    expect(bundle.pages.find((page) => page.id === 'guides/install')?.body).toContain('connection to \\{vendor\\} failed')
    expect(bundle.pages.find((page) => page.id === 'guides/advanced/config')?.body).toContain('<ParamField name="apiKey" type="string" required>')
    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      code: 'unsupported-config',
      message: expect.stringContaining('EndpointRequestSnippet'),
    }))
    // Fern only serves pages reachable from docs.yml navigation; an
    // unreferenced file must not be imported as an orphan (unlike Mintlify).
    expect(bundle.pages.map((page) => page.id)).not.toContain('orphan')
    // `title`/`colors.accent-primary` map into the same `site` field Mintlify
    // branding already populates. Fern's light/dark are normal (each names
    // the mode it paints); they're swapped here onto Mintlify's inverted
    // `{light, dark}` keys so `updateSiteConfig` has one consistent contract.
    expect(bundle.site).toEqual({ name: 'Acme Docs', colors: { light: '#70E155', dark: '#008700' } })
  })

  it("resolves the first api: node's spec from generators.yml instead of the first OpenAPI file on disk", () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-generators-'))
    const fernRoot = join(root, 'fern')
    mkdirSync(fernRoot, { recursive: true })
    writeFileSync(join(fernRoot, 'fern.config.json'), JSON.stringify({ organization: 'acme' }))
    writeFileSync(join(fernRoot, 'docs.yml'), `
navigation:
  - page: Welcome
    path: welcome.mdx
  - api: API Reference
`)
    writeFileSync(join(fernRoot, 'generators.yml'), `
api:
  specs:
    - openapi: openapi/configured.yml
`)
    // A decoy that `findOpenApi`'s naive on-disk scan would otherwise pick up
    // first, proving generators.yml is now consulted first.
    writeFileSync(join(fernRoot, 'openapi.yml'), 'openapi: 3.0.0\ninfo:\n  title: Decoy\n  version: "0"\npaths: {}\n')
    mkdirSync(join(fernRoot, 'openapi'), { recursive: true })
    writeFileSync(join(fernRoot, 'openapi', 'configured.yml'), 'openapi: 3.0.0\ninfo:\n  title: Acme API\n  version: "1.0"\npaths: {}\n')
    writeFileSync(join(fernRoot, 'welcome.mdx'), '---\ntitle: Welcome\n---\n\nHello.')

    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/fern-docs' })

    const apiTab = bundle.docsConfig.tabs.find((tab) => tab.api)
    expect(apiTab?.api?.source).toBe('/configured.yml')
    expect(bundle.assets.map((asset) => asset.path)).toContain('configured.yml')
  })

  it('warns that a Fern Definition API was not migrated when no OpenAPI document is configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fern-definition-'))
    const fernRoot = join(root, 'fern')
    mkdirSync(join(fernRoot, 'definition'), { recursive: true })
    writeFileSync(join(fernRoot, 'fern.config.json'), JSON.stringify({ organization: 'acme' }))
    writeFileSync(join(fernRoot, 'docs.yml'), `
navigation:
  - page: Welcome
    path: welcome.mdx
  - api: API Reference
`)
    writeFileSync(join(fernRoot, 'definition', 'api.yml'), 'types: {}\n')
    writeFileSync(join(fernRoot, 'welcome.mdx'), '---\ntitle: Welcome\n---\n\nHello.')

    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/fern-docs' })

    expect(bundle.warnings).toContainEqual(expect.objectContaining({
      code: 'unsupported-config',
      message: expect.stringContaining('Fern Definition'),
    }))
    expect(bundle.docsConfig.tabs.some((tab) => tab.api)).toBe(false)
  })
})
