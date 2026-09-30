/** Access gating, site-wide CSS/JS/font assets, and legacy config mapping for Mintlify sources. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository, renderMigrationFiles } from '../index.js'
import type { MigrationBundle } from '../index.js'

function site(files: Record<string, string | Buffer>): MigrationBundle {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-extras-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
}

const page = (title: string, extra = ''): string => `---\ntitle: ${title}\n${extra}---\n\nBody of ${title}.\n`
const codes = (bundle: MigrationBundle, code: string) => bundle.warnings.filter((warning) => warning.code === code)
function navPages(bundle: MigrationBundle): Array<string> {
  const out: Array<string> = []
  const visit = (nodes: Array<unknown> = []): void => {
    for (const node of nodes) {
      if (typeof node === 'string') out.push(node)
      else visit((node as { pages: Array<unknown> }).pages)
    }
  }
  for (const tab of bundle.docsConfig.tabs) { visit(tab.pages); visit(tab.groups) }
  return out
}
function emptyGroups(bundle: MigrationBundle): number {
  let empty = 0
  const visit = (nodes: Array<unknown> = []): void => {
    for (const node of nodes) {
      if (typeof node === 'string') continue
      const group = node as { pages: Array<unknown> }
      if (group.pages.length === 0) empty++
      visit(group.pages)
    }
  }
  for (const tab of bundle.docsConfig.tabs) { visit(tab.pages); visit(tab.groups) }
  return empty
}

describe('gated pages', () => {
  const base = {
    'docs.json': JSON.stringify({ navigation: { groups: [
      { group: 'Public', pages: ['intro', 'secret-list', 'secret-string', 'hidden-false', 'string-false'] },
      { group: 'Outer', pages: [{ group: 'Inner', pages: ['only-secret'] }, 'open'] },
    ] } }),
    'intro.mdx': page('Intro'),
    'secret-list.mdx': page('Secret list', 'groups: [admin, staff]\n'),
    'secret-string.mdx': page('Secret string', 'groups: admin\n'),
    'hidden-false.mdx': page('Hidden false', 'public: false\n'),
    'string-false.mdx': page('String false', 'public: "false"\n'),
    'only-secret.mdx': page('Only secret', 'groups: [x]\n'),
    'open.mdx': page('Open'),
  }

  it('withholds gated pages from content and navigation and quarantines the original', () => {
    const bundle = site(base)
    expect(bundle.pages.map((entry) => entry.id).sort()).toEqual(['intro', 'open'])
    expect(navPages(bundle).sort()).toEqual(['intro', 'open'])
    expect(emptyGroups(bundle)).toBe(0)
    const quarantined = bundle.quarantinedFiles ?? []
    expect(quarantined.map((file) => file.path).sort()).toEqual([
      'migration-quarantine/hidden-false.mdx',
      'migration-quarantine/only-secret.mdx',
      'migration-quarantine/secret-list.mdx',
      'migration-quarantine/secret-string.mdx',
      'migration-quarantine/string-false.mdx',
    ])
    expect(Buffer.from(quarantined.find((file) => file.path.endsWith('secret-list.mdx'))!.content as Uint8Array).toString()).toBe(page('Secret list', 'groups: [admin, staff]\n'))
    const rendered = renderMigrationFiles(bundle).map((file) => file.path)
    expect(rendered).toContain('migration-quarantine/secret-list.mdx')
    expect(rendered.filter((path) => path.startsWith('src/content/')).sort()).toEqual(['src/content/intro.mdx', 'src/content/open.mdx'])
    expect(rendered.some((path) => path.startsWith('public/') && path.includes('secret'))).toBe(false)
  })

  it('emits one gated-page warning per page plus a summary, mentioning broken links', () => {
    const bundle = site(base)
    const warnings = codes(bundle, 'gated-page')
    const perPage = warnings.filter((warning) => warning.source)
    expect(perPage).toHaveLength(5)
    expect(perPage.find((warning) => warning.source === 'secret-list.mdx')!.message).toMatch(/groups.*NOT published.*migration-quarantine\/secret-list\.mdx.*links.*break/s)
    expect(warnings.filter((warning) => !warning.source && /5 access-restricted/.test(warning.message))).toHaveLength(1)
  })

  it('treats empty or missing groups and public: true as non-gating', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['a', 'b', 'c', 'd'] } }),
      'a.mdx': page('A', 'groups: []\n'),
      'b.mdx': page('B', 'groups: ""\n'),
      'c.mdx': page('C', 'public: true\n'),
      'd.mdx': page('D'),
    })
    expect(bundle.pages).toHaveLength(4)
    expect(bundle.quarantinedFiles).toBeUndefined()
    expect(bundle.docsConfig.tabs.length).toBeGreaterThan(0)
  })

  it('gates every page under a navigation container with groups or public: false', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { tabs: [
        { tab: 'Docs', groups: [
          { group: 'Members', groups: ['member'], pages: ['m1', 'm2'] },
          { group: 'Off', public: false, pages: ['off1'] },
          { group: 'Open', public: true, pages: ['open'] },
        ] },
        { tab: 'Staff', groups: ['staff'], pages: ['s1'] },
      ] } }),
      'm1.mdx': page('M1'), 'm2.mdx': page('M2'), 'off1.mdx': page('Off1'), 'open.mdx': page('Open'), 's1.mdx': page('S1'),
    })
    expect(bundle.pages.map((entry) => entry.id)).toEqual(['open'])
    expect(navPages(bundle)).toEqual(['open'])
    expect(bundle.docsConfig.tabs.map((tab) => tab.tab)).toEqual(['Docs'])
    expect((bundle.quarantinedFiles ?? []).map((file) => file.path).sort()).toEqual([
      'migration-quarantine/m1.mdx', 'migration-quarantine/m2.mdx', 'migration-quarantine/off1.mdx', 'migration-quarantine/s1.mdx',
    ])
    expect(codes(bundle, 'gated-page').find((warning) => warning.source === 'm1.mdx')!.message).toMatch(/navigation container/)
  })

  it('keeps a nested quarantined path and leaves ordinary pages untouched', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['guides/a', 'guides/b'] } }),
      'guides/a.mdx': page('A', 'groups: [x]\n'),
      'guides/b.mdx': page('B'),
    })
    expect(bundle.quarantinedFiles!.map((file) => file.path)).toEqual(['migration-quarantine/guides/a.mdx'])
    expect(bundle.pages.map((entry) => entry.body.trim())).toEqual(['Body of B.'])
  })

  it('warns once when public: true implies a site that may have been private', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['a', 'b'] } }),
      'a.mdx': page('A', 'public: true\n'),
      'b.mdx': page('B', 'public: true\n'),
    })
    const siteWide = codes(bundle, 'gated-page')
    expect(siteWide).toHaveLength(1)
    expect(siteWide[0].message).toMatch(/authentication.*ALL imported pages publicly/s)
    expect(bundle.pages).toHaveLength(2)
    expect(codes(site({ 'docs.json': '{"navigation":{"pages":["a"]}}', 'a.mdx': page('A') }), 'gated-page')).toHaveLength(0)
  })
})

describe('site-wide scripts, styles and fonts', () => {
  const files = {
    'docs.json': JSON.stringify({
      navigation: { pages: ['intro'] },
      fonts: { heading: { family: 'Mine', source: '/fonts/mine.woff2', format: 'woff2' }, body: { family: 'Remote', source: 'https://cdn.example/r.woff2', format: 'woff2' } },
    }),
    'intro.mdx': page('Intro'),
    'style.css': 'body{}',
    'assets/custom.js': 'console.log(1)',
    'fonts/mine.woff2': 'font',
    'fonts/unused.woff2': 'font',
    'tailwind.config.js': 'module.exports={}',
    'scripts/postcss.config.js': 'x',
    'next.config.js': 'x',
    '.eslintrc.js': 'x',
    'dist/bundle.js': 'x',
    'node_modules/pkg/index.js': 'x',
    '.hidden/x.js': 'x',
  }

  it('copies css, js and referenced fonts only, and wires scripts', () => {
    const bundle = site(files)
    const paths = bundle.assets.map((asset) => asset.path).sort()
    expect(paths).toEqual(['assets/custom.js', 'fonts/mine.woff2', 'style.css'])
    expect(bundle.docsConfig.customScripts).toEqual([{ src: '/assets/custom.js', strategy: 'afterInteractive' }])
  })

  it('warns that the stylesheet is preserved but not applied, and about fonts', () => {
    const bundle = site(files)
    const messages = bundle.warnings.map((warning) => warning.message)
    expect(messages.some((message) => /Stylesheet preserved at public\/style\.css but NOT applied/.test(message))).toBe(true)
    expect(messages.some((message) => /"Mine".*copied to public\/fonts\/mine\.woff2/.test(message))).toBe(true)
    expect(messages.some((message) => /"Remote".*remote URL and was not downloaded/.test(message))).toBe(true)
    expect(messages.some((message) => /customScripts/.test(message))).toBe(true)
  })

  it('rejects font paths that traverse, are absolute, or are missing', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['intro'] }, fonts: { heading: { family: 'A', source: '../../etc/x.woff2' }, body: { family: 'B', source: '/etc/passwd.woff2' } }, }),
      'intro.mdx': page('Intro'),
    })
    expect(bundle.assets).toEqual([])
    const messages = bundle.warnings.map((warning) => warning.message)
    expect(messages.some((message) => /"A".*not a safe local/.test(message))).toBe(true)
    expect(messages.some((message) => /"B".*was not found/.test(message))).toBe(true)
  })

  it('applies the asset size cap to scripts', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['intro'] } }),
      'intro.mdx': page('Intro'),
      'huge.js': Buffer.alloc(25_000_001),
    })
    expect(bundle.assets).toEqual([])
    expect(bundle.docsConfig.customScripts).toBeUndefined()
    expect(bundle.warnings.some((warning) => warning.code === 'limit-reached' && warning.source === 'huge.js')).toBe(true)
  })
})

describe('config mapping', () => {
  const nav = { navigation: { pages: ['intro'] } }
  const intro = { 'intro.mdx': page('Intro') }

  it('maps legacy topbarLinks and topbarCtaButton', () => {
    const bundle = site({ 'mint.json': JSON.stringify({ ...nav, topbarLinks: [{ name: 'Blog', url: 'https://blog.example' }, { name: 'bad' }], topbarCtaButton: { name: 'Start', url: 'https://app.example' } }), ...intro })
    expect(bundle.docsConfig.navbar).toEqual({ links: [{ label: 'Blog', href: 'https://blog.example' }], primary: { label: 'Start', href: 'https://app.example' } })
    expect(bundle.warnings.some((warning) => /topbarLinks entry without a valid name and url/.test(warning.message))).toBe(true)
  })

  it('rejects script-bearing and control-character urls in legacy topbar entries', () => {
    const bundle = site({ 'mint.json': JSON.stringify({ ...nav,
      topbarLinks: [{ name: 'X', url: 'javascript:alert(1)' }, { name: 'Y', url: ' JaVaScRiPt:alert(1)' }, { name: 'Z', url: 'java\tscript:alert(1)' }, { name: 'D', url: 'data:text/html,x' }, { name: 'Ok', url: '/relative' }],
      topbarCtaButton: { name: 'Go', url: 'javascript:alert(1)' } }), ...intro })
    expect(bundle.docsConfig.navbar).toEqual({ links: [{ label: 'Ok', href: '/relative' }] })
    expect(bundle.warnings.some((warning) => /topbarCtaButton has no valid url/.test(warning.message))).toBe(true)
  })

  it('maps a github topbarCtaButton like the docs.json github primary', () => {
    const legacy = site({ 'mint.json': JSON.stringify({ ...nav, topbarCtaButton: { type: 'github', url: 'https://github.com/a/b' } }), ...intro })
    const current = site({ 'docs.json': JSON.stringify({ ...nav, navbar: { primary: { type: 'github', href: 'https://github.com/a/b' } } }), ...intro })
    expect(legacy.docsConfig.navbar).toEqual({ primary: { label: 'GitHub', href: 'https://github.com/a/b' } })
    expect(legacy.docsConfig.navbar).toEqual(current.docsConfig.navbar)
  })

  it('lets docs.json navbar win over legacy keys and warns', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ ...nav, navbar: { links: [{ label: 'Docs', href: 'https://d.example' }], primary: { type: 'button', label: 'Go', href: 'https://go.example' } }, topbarLinks: [{ name: 'Old', url: 'https://old.example' }], topbarCtaButton: { name: 'Old', url: 'https://old.example' } }),
      ...intro,
    })
    expect(bundle.docsConfig.navbar).toEqual({ links: [{ label: 'Docs', href: 'https://d.example' }], primary: { label: 'Go', href: 'https://go.example' } })
    expect(bundle.warnings.filter((warning) => /topbarLinks ignored|topbarCtaButton ignored/.test(warning.message))).toHaveLength(2)
  })

  it('leaves the docs.json navbar mapping unchanged (regression)', () => {
    const bundle = site({ 'docs.json': JSON.stringify({ ...nav, navbar: { links: [{ label: 'Gh', href: 'https://github.com/a/b', type: 'github' }], primary: { type: 'button', label: 'Go', href: 'https://go.example' } } }), ...intro })
    expect(bundle.docsConfig.navbar).toEqual({ links: [{ label: 'Gh', href: 'https://github.com/a/b', type: 'github' }], primary: { label: 'Go', href: 'https://go.example' } })
  })

  it('maps appearance default and strict', () => {
    const bundle = site({ 'docs.json': JSON.stringify({ ...nav, appearance: { default: 'dark', strict: true } }), ...intro })
    expect(bundle.docsConfig.appearance).toEqual({ default: 'dark', showToggle: false })
    const open = site({ 'docs.json': JSON.stringify({ ...nav, appearance: { default: 'system', strict: false } }), ...intro })
    expect(open.docsConfig.appearance).toEqual({ default: 'system' })
  })

  it('maps legacy modeToggle and prefers docs.json appearance', () => {
    const legacy = site({ 'mint.json': JSON.stringify({ ...nav, modeToggle: { default: 'light', isHidden: true } }), ...intro })
    expect(legacy.docsConfig.appearance).toEqual({ default: 'light', showToggle: false })
    const both = site({ 'docs.json': JSON.stringify({ ...nav, appearance: { default: 'dark' }, modeToggle: { default: 'light', isHidden: true } }), ...intro })
    expect(both.docsConfig.appearance).toEqual({ default: 'dark', showToggle: false })
  })

  it('skips invalid appearance values with a warning', () => {
    const bundle = site({ 'docs.json': JSON.stringify({ ...nav, appearance: { default: 'sepia', strict: 'yes' }, modeToggle: { isHidden: 1 } }), ...intro })
    expect(bundle.docsConfig.appearance).toBeUndefined()
    expect(bundle.warnings.filter((warning) => /Ignored invalid/.test(warning.message))).toHaveLength(2)
  })

  it('enables Markdown mirrors for Mintlify sources', () => {
    const bundle = site({ 'docs.json': JSON.stringify(nav), ...intro })
    expect(bundle.docsConfig.markdown).toEqual({ enabled: true })
    expect(JSON.parse(String(renderMigrationFiles(bundle).find((file) => file.path === 'docs.json')!.content)).markdown).toEqual({ enabled: true })
  })
})

describe('gating bypass hardening', () => {
  it('treats public: no / off / 0 as private, like false', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['a', 'b', 'c', 'd', 'e'] } }),
      'a.mdx': page('A', 'public: no\n'),
      'b.mdx': page('B', 'public: off\n'),
      'c.mdx': page('C', 'public: 0\n'),
      'd.mdx': page('D', 'public: False\n'),
      'e.mdx': page('E', 'public: yes\n'),
    })
    expect(bundle.pages.map((entry) => entry.id)).toEqual(['e'])
    expect(bundle.quarantinedFiles).toHaveLength(4)
  })

  it('quarantines gated pages that are orphans or extension variants, and gates a page listed in a restricted and an open group', () => {
    for (const groups of [
      [{ group: 'Open', pages: ['intro', 'shared'] }, { group: 'Priv', groups: ['staff'], pages: ['shared'] }],
      [{ group: 'Priv', groups: ['staff'], pages: ['shared'] }, { group: 'Open', pages: ['intro', 'shared'] }],
    ]) {
      const bundle = site({
        'docs.json': JSON.stringify({ navigation: { groups } }),
        'intro.mdx': page('Intro'),
        'shared.mdx': page('Shared'),
        'orphan.md': page('Orphan', 'groups: [x]\n'),
        'orphan2.mdx': page('Orphan2', 'public: false\n'),
      })
      expect(bundle.pages.map((entry) => entry.id)).toEqual(['intro'])
      expect(navPages(bundle)).toEqual(['intro'])
      expect((bundle.quarantinedFiles ?? []).map((file) => file.path).sort()).toEqual([
        'migration-quarantine/orphan.md', 'migration-quarantine/orphan2.mdx', 'migration-quarantine/shared.mdx',
      ])
    }
  })

  it('gates pages under a restricted node inside a container the projection does not walk (tab menu items)', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { tabs: [
        { tab: 'T', menu: [{ item: 'Priv', public: false, pages: ['m1'] }, { item: 'Staff', groups: ['staff'], pages: [{ group: 'G', pages: ['m2'] }] }] },
        { tab: 'U', pages: ['open'] },
      ] } }),
      'm1.mdx': page('M1'), 'm2.mdx': page('M2'), 'open.mdx': page('Open'),
    })
    expect(bundle.pages.map((entry) => entry.id)).toEqual(['open'])
    expect((bundle.quarantinedFiles ?? []).map((file) => file.path).sort()).toEqual(['migration-quarantine/m1.mdx', 'migration-quarantine/m2.mdx'])
  })

  it('gates pages under restricted versions, dropdowns and anchors, and inside languages', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { languages: [
        { language: 'en', versions: [
          { version: 'v1', dropdowns: [{ dropdown: 'D', groups: ['staff'], pages: ['d1'] }, { dropdown: 'E', pages: ['open'] }] },
          { version: 'v2', public: false, anchors: [{ anchor: 'A', pages: ['v2'] }] },
        ] },
        { language: 'fr', groups: [{ group: 'F', public: false, pages: ['fr/p'] }, { group: 'G', pages: ['fr/open'] }] },
      ] } }),
      'd1.mdx': page('D1'), 'open.mdx': page('Open'), 'v2.mdx': page('V2'), 'fr/p.mdx': page('P'), 'fr/open.mdx': page('FrOpen'),
    })
    expect((bundle.quarantinedFiles ?? []).map((file) => file.path).sort()).toEqual([
      'migration-quarantine/d1.mdx', 'migration-quarantine/fr/p.mdx', 'migration-quarantine/v2.mdx',
    ])
    expect(JSON.stringify(bundle.docsConfig)).not.toMatch(/"d1"|"v2"|fr\/p"/)
  })

  it('never inlines an access-restricted page imported as a component into a public page', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['host'] } }),
      'host.mdx': '---\ntitle: Host\n---\n\nimport Secret from "/private.mdx"\n\nPublic text.\n\n<Secret />\n',
      'private.mdx': page('Private', 'groups: [x]\n').replace('Body of Private.', 'TOPSECRET'),
    })
    expect(JSON.stringify(bundle.pages)).not.toContain('TOPSECRET')
    expect(bundle.pages[0].body).toContain('Public text.')
    expect((bundle.quarantinedFiles ?? []).map((file) => file.path)).toEqual(['migration-quarantine/private.mdx'])
    expect(codes(bundle, 'gated-page').some((warning) => warning.source === 'host.mdx' && /NOT inlined/.test(warning.message))).toBe(true)
  })

  it('withholds a page whose invalid frontmatter declares groups or public instead of salvaging it', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['bad', 'badpublic', 'badopen'] } }),
      'bad.mdx': '---\ntitle: Bad: colon: here\ngroups: [admin\n---\n\nTOPSECRET\n',
      'badpublic.mdx': '---\ntitle: Bad: colon: here\npublic: [false\n---\n\nTOPSECRET\n',
      'badopen.mdx': '---\ntitle: Open: colon: here\n---\n\nOpen body\n',
    })
    expect(bundle.pages.map((entry) => entry.id)).toEqual(['badopen'])
    expect((bundle.quarantinedFiles ?? []).map((file) => file.path).sort()).toEqual([
      'migration-quarantine/bad.mdx',
      'migration-quarantine/badpublic.mdx',
    ])
    const published = renderMigrationFiles(bundle).filter((file) => !file.path.startsWith('migration-quarantine/'))
    expect(published.some((file) => String(Buffer.from(file.content as Uint8Array)).includes('TOPSECRET'))).toBe(false)
  })

  it('says in the summary that the quarantine folder is local only and git-ignored', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['a', 'b'] } }),
      'a.mdx': page('A', 'groups: [x]\n'),
      'b.mdx': page('B'),
    })
    const summary = codes(bundle, 'gated-page').find((warning) => !warning.source && /1 access-restricted/.test(warning.message))!
    expect(summary.message).toMatch(/local only: git-ignored, never served or deployed/)
  })
})

describe('script hardening', () => {
  it('does not register a module imported by pages as a site-wide script', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['intro'] } }),
      'intro.mdx': '---\ntitle: Intro\n---\n\nimport { Widget } from "/snippets/widget.js"\n\n<Widget />\n',
      'snippets/widget.js': 'export const Widget = () => <div>hi</div>\n',
      'site.js': 'console.log(1)',
    })
    expect((bundle.componentFiles ?? []).some((file) => file.path.endsWith('snippets/widget.js'))).toBe(true)
    expect(bundle.docsConfig.customScripts).toEqual([{ src: '/site.js', strategy: 'afterInteractive' }])
    expect(bundle.assets.map((asset) => asset.path)).toEqual(['site.js'])
  })

  it('URL-encodes script paths with spaces and special characters', () => {
    const bundle = site({
      'docs.json': JSON.stringify({ navigation: { pages: ['intro'] } }),
      'intro.mdx': page('Intro'),
      'my scripts/a b#c.js': 'console.log(1)',
    })
    expect(bundle.docsConfig.customScripts).toEqual([{ src: '/my%20scripts/a%20b%23c.js', strategy: 'afterInteractive' }])
  })
})
