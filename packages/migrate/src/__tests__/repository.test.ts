/** End-to-end repository fixtures for platform-specific navigation and assets. */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository, readMintlifyConfig, renderMigrationFiles } from '../index.js'

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
