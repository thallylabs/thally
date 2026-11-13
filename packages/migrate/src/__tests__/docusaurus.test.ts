/** Focused contracts for Docusaurus navigation, links, and localized fragments. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  addDocusaurusTranslatedHeadingAliases,
  projectDocusaurusNavigation,
  readDocusaurusSiteSettings,
  readDocusaurusSidebars,
  rewriteDocusaurusLinks,
  type DocusaurusPageDescriptor,
} from '../docusaurus.js'
import type { MigrationPage } from '../types.js'

const roots: Array<string> = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-docusaurus-focused-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Docusaurus projection', () => {
  it.each(["/'/", '/"/', '/`/', '/[{}]/', String.raw`/[/\\"']/`, '8 / 2'])('reads static exports after %s without evaluating source', (expression) => {
    const root = fixture()
    const preamble = `const pattern = ${expression};\nthrow new Error('Source must never run');\n`
    writeFileSync(join(root, 'sidebars.ts'), `${preamble}export default { docs: ['guide'] };`)
    writeFileSync(join(root, 'docusaurus.config.ts'), `${preamble}export default {
      themeConfig: { navbar: { title: 'Docs' }, colorMode: { defaultMode: 'dark' } },
    };`)
    expect(readDocusaurusSidebars(root)?.config).toEqual({ docs: ['guide'] })
    expect(readDocusaurusSiteSettings(root)).toMatchObject({ navbarTitle: 'Docs', defaultColorMode: 'dark' })
  })

  it('reads static exports after template interpolation and a regex in a function', () => {
    const root = fixture()
    writeFileSync(join(root, 'sidebars.ts'), [
      'const template = `prefix ${`nested ${/"/.source}`} suffix`;',
      "function unused(value) { return /'/g.test(value) }",
      "export default { docs: ['guide'] };",
    ].join('\n'))
    expect(readDocusaurusSidebars(root)?.config).toEqual({ docs: ['guide'] })
  })

  describe('sidebars that import generated files', () => {
    const rest = "  { type: 'category', label: 'Guides', items: ['guide'] },"
    it.each([
      ['an ES import', "import apiSidebar from './docs/management-api/sidebar';\nexport default { docs: [\n  'intro',\n  { type: 'category', label: 'API', items: apiSidebar },\n  ...apiSidebar,\n" + rest + "\n] };"],
      ['a require with .js', "const apiSidebar = require('./docs/management-api/sidebar.js');\nmodule.exports = { docs: [\n  'intro',\n  { type: 'category', label: 'API', items: apiSidebar },\n  ...apiSidebar,\n" + rest + "\n] };"],
      ['a typed const with a default export', "import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';\nimport apiSidebar from './docs/management-api/sidebar';\nconst sidebars: SidebarsConfig = { docs: [\n  'intro',\n  { type: 'category', label: 'API', items: apiSidebar },\n  ...apiSidebar,\n" + rest + "\n] };\nexport default sidebars;"],
    ])('reads the rest of the sidebar with %s', (_name, source) => {
      const root = fixture()
      writeFileSync(join(root, 'sidebars.ts'), source)
      const result = readDocusaurusSidebars(root)
      expect(result?.config).toEqual({ docs: ['intro', { type: 'category', label: 'API', items: [] }, { type: 'category', label: 'Guides', items: ['guide'] }] })
      expect(result?.unresolvedModules).toEqual([expect.stringMatching(/^\.\/docs\/management-api\/sidebar(?:\.js)?$/)])
    })

    it('treats a call of a helper declared in the sidebar file on a generated sidebar as an empty list', () => {
      const root = fixture()
      writeFileSync(join(root, 'sidebars.js'), [
        "import { default as apiSidebar } from './docs/api/sidebar';",
        'function apiItems(sidebar) { return sidebar.slice(1) }',
        "module.exports = { docs: ['intro', { type: 'category', label: 'API', items: apiItems(apiSidebar) }] };",
      ].join('\n'))
      const result = readDocusaurusSidebars(root)
      expect(result?.config).toEqual({ docs: ['intro', { type: 'category', label: 'API', items: [] }] })
      expect(result?.unresolvedModules).toEqual(['./docs/api/sidebar'])
    })

    it('does not call an existing module generated: a sidebar that imports data from the source is rejected as before', () => {
      const root = fixture()
      writeFileSync(join(root, 'items.json'), '["guide"]')
      writeFileSync(join(root, 'sidebars.js'), "const data = require('./items.json');\nmodule.exports = { docs: ['intro', { type: 'category', label: 'More', items: data }] };")
      expect(() => readDocusaurusSidebars(root)).toThrow(/executable/)
    })

    it('reports the failure of the author\'s text, not of the rewritten text', () => {
      const root = fixture()
      writeFileSync(join(root, 'sidebars.js'), "import gen from './gen';\nexport default { docs: ['intro', ...gen.filter(Boolean)] };")
      expect(() => readDocusaurusSidebars(root)).toThrow(/gen\.filter/)
    })

    it('still rejects a sidebar that computes its items', () => {
      const root = fixture()
      writeFileSync(join(root, 'sidebars.ts'), "import apiSidebar from './docs/api/sidebar';\nexport default { docs: [...apiSidebar, makeItems()] };")
      expect(() => readDocusaurusSidebars(root)).toThrow(/executable/)
    })
  })

  it('resolves a category metadata link to a local document id', () => {
    const root = fixture()
    mkdirSync(join(root, 'api/themes'), { recursive: true })
    writeFileSync(join(root, 'api/themes/_category_.yml'), 'label: Themes\nlink:\n  type: doc\n  id: themes-overview\n')
    const descriptors: Array<DocusaurusPageDescriptor> = [
      { sourcePath: 'api/themes/overview.mdx', docId: 'api/themes/themes-overview', navigationId: 'api/themes', title: 'Themes', sidebarPosition: 0 },
      { sourcePath: 'api/themes/classic.mdx', docId: 'api/themes/classic', navigationId: 'api/themes/classic', title: 'Classic' },
    ]
    const result = projectDocusaurusNavigation({ sidebars: null, descriptors, contentRoot: root, sourceUrl: 'https://example.com' })
    expect(result.docsConfig.tabs[0].pages).toEqual([{ group: 'API', pages: [{ group: 'Themes', pages: ['api/themes', 'api/themes/classic'] }] }])
    expect(result.warnings.filter((warning) => warning.code === 'missing-page')).toEqual([])
  })

  it('interleaves autogenerated categories and pages by authored position', () => {
    const root = fixture()
    mkdirSync(join(root, 'middle'))
    writeFileSync(join(root, 'middle', '_category_.json'), '{"label":"Middle","position":2}')
    const descriptors: Array<DocusaurusPageDescriptor> = [
      { sourcePath: '03-last.md', docId: 'last', navigationId: 'last', title: 'Last', sidebarPosition: 3 },
      { sourcePath: '01-first.md', docId: 'first', navigationId: 'first', title: 'First', sidebarPosition: 1 },
      { sourcePath: 'middle/intro.md', docId: 'middle/intro', navigationId: 'middle/intro', title: 'Middle intro' },
    ]
    const result = projectDocusaurusNavigation({ sidebars: null, descriptors, contentRoot: root, sourceUrl: 'https://example.com' })
    expect(result.docsConfig.tabs[0].pages).toEqual([
      'first', { group: 'Middle', pages: ['middle/intro'] }, 'last',
    ])
  })

  it('uses the text navbar title when the logo stanza is commented out', () => {
    const root = fixture()
    writeFileSync(join(root, 'docusaurus.config.ts'), `export default {
      title: 'Docs', themeConfig: { navbar: { title: 'Docmost',
        // logo: { src: 'img/logo.svg' },
      } },
    }`)
    expect(readDocusaurusSiteSettings(root)).toMatchObject({
      name: 'Docs', navbarTitle: 'Docmost', defaultColorMode: 'light',
    })
    expect(readDocusaurusSiteSettings(root).logo).toBeUndefined()
  })

  it('reads a theme config written as a parenthesised, type-annotated object', () => {
    const root = fixture()
    writeFileSync(join(root, 'docusaurus.config.ts'), `const config = {
      title: 'Docs',
      themeConfig:
        /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
        ({
          navbar: {
            title: 'Acme',
            logo: { alt: 'Acme', src: 'img/logo.svg' },
            items: [
              { type: 'doc', docId: 'intro', position: 'left', label: 'Tutorial' },
              { href: 'https://example.test/repo', label: 'Repo', position: 'right' },
            ],
          },
          footer: { copyright: \`Copyright © \${new Date().getFullYear()} Acme.\` },
        }),
    }
    export default config`)
    const settings = readDocusaurusSiteSettings(root)
    expect(settings).toMatchObject({ navbarTitle: 'Acme', logo: { light: 'img/logo.svg' }, copyright: 'Copyright © {year} Acme.' })
    expect(settings.navbarLinks).toEqual([
      { label: 'Tutorial', docId: 'intro' },
      { label: 'Repo', href: 'https://example.test/repo' },
    ])
    expect(settings.unresolvedThemeConfig).toBeUndefined()
  })

  it('reports a theme config that is not an object literal', () => {
    const root = fixture()
    writeFileSync(join(root, 'docusaurus.config.ts'), `import theme from './theme'
    export default { title: 'Docs', themeConfig: buildTheme() }`)
    expect(readDocusaurusSiteSettings(root).unresolvedThemeConfig).toBe(true)
  })

  it('reads a static default color mode from the theme config', () => {
    const root = fixture()
    writeFileSync(join(root, 'docusaurus.config.ts'), `export default {
      themeConfig: { colorMode: { defaultMode: 'dark' } },
    }`)
    expect(readDocusaurusSiteSettings(root).defaultColorMode).toBe('dark')
  })
})

describe('Docusaurus links', () => {
  const current: DocusaurusPageDescriptor = {
    sourcePath: 'intro.md', docId: 'intro', navigationId: 'introduction', title: 'Intro',
  }

  it('normalizes mounted asset references only when the copied asset exists', () => {
    const externalized: Array<string> = []
    const body = [
      '![Logo](/docs/img/logo.svg?raw=1#preview)',
      '<img src="/docs/img/logo.svg" />',
      '[Guide](/docs/guide)',
      '[Missing](/docs/img/missing.svg)',
      '```md',
      '![Example](/docs/img/logo.svg)',
      '```',
    ].join('\n')
    const output = rewriteDocusaurusLinks(body, current, [current, {
      sourcePath: 'guide.md', docId: 'guide', navigationId: 'guide', title: 'Guide',
    }], {
      assetPaths: new Set(['img/logo.svg']),
      sourceOrigin: 'https://docs.example.com',
      onExternalLink: (target) => externalized.push(target),
    })
    expect(output).toContain('![Logo](/img/logo.svg?raw=1#preview)')
    expect(output).toContain('<img src="/img/logo.svg" />')
    expect(output).toContain('[Guide](/guide)')
    expect(output).toContain('[Missing](https://docs.example.com/docs/img/missing.svg)')
    expect(output).toContain('![Example](/docs/img/logo.svg)')
    expect(externalized).toEqual(['/docs/img/missing.svg'])
  })
})

function page(navigationId: string, body: string, sourcePath: string): MigrationPage {
  return {
    id: navigationId,
    navigationId,
    title: navigationId,
    description: '',
    keywords: [],
    body,
    source: `https://github.com/acme/docs#${sourcePath}`,
  }
}

describe('translated Docusaurus headings', () => {
  it('adds fragments for localized cross-page links and keeps explicit IDs', () => {
    const original = page('guide', '## Overview\n\n### Configure', 'docs/guide.md')
    const translated = page('de/guide', '<a id="einstellungen"></a>\n## Überblick\n\n### Einrichten',
      'i18n/de/docusaurus-plugin-content-docs/current/guide.md')
    const linkingPage = page('de/intro', '[Overview](/de/guide#overview)',
      'i18n/de/docusaurus-plugin-content-docs/current/intro.md')
    addDocusaurusTranslatedHeadingAliases([original, translated, linkingPage])
    expect(translated.body).toContain('<a id="overview"></a>\n## Überblick')
    expect(translated.body).toContain('<a id="einstellungen"></a>\n<a id="overview"></a>')
    expect(translated.body).toContain('<a id="configure"></a>\n### Einrichten')
    expect(linkingPage.body).toContain('[Overview](/de/guide#overview)')
  })

  it('leaves edited heading outlines and ambiguous source IDs alone', () => {
    const original = page('guide', '## Overview\n## Overview', 'docs/guide.md')
    const translated = page('de/guide', '## Überblick\n### Details',
      'i18n/de/docusaurus-plugin-content-docs/current/guide.md')
    addDocusaurusTranslatedHeadingAliases([original, translated])
    expect(translated.body).toBe('## Überblick\n### Details')
  })

  it('maps an explicit source ID without replacing a translated explicit ID', () => {
    const original = page('guide', '<a id="stable-en"></a>\n## Overview', 'docs/guide.md')
    const translated = page('de/guide', '<a id="stable-de"></a>\n## Überblick',
      'i18n/de/docusaurus-plugin-content-docs/current/guide.md')
    addDocusaurusTranslatedHeadingAliases([original, translated])
    expect(translated.body).toBe('<a id="stable-de"></a>\n<a id="stable-en"></a>\n## Überblick')
  })

  it('pairs translated root pages with the default introduction route', () => {
    const original = page('introduction', '## Overview', 'docs/intro.md')
    const translated = page('de', '## Überblick',
      'i18n/de/docusaurus-plugin-content-docs/current/intro.md')
    addDocusaurusTranslatedHeadingAliases([original, translated])
    expect(translated.body).toBe('<a id="overview"></a>\n## Überblick')
  })
})
