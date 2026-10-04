import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { importSourceRef, migrateRepository, parseSourceRefFlags } from '../index.js'
import { prefixRootLinks, SOURCE_REF_MAX_FILES, SOURCE_REF_MAX_REPOSITORY_KB, sourceRefOversizeReason, withheldNotSaved } from '../source-refs.js'
import type { MigrationFetcher } from '../types.js'

function write(root: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'thally-source-ref-'))
}

/** A referenced SDK repository: docs/ with its own docs.json, an orphan page and an image. */
function sdkRepo(extra: Record<string, string> = {}): string {
  return write(tmp(), {
    'docs/docs.json': JSON.stringify({ navigation: { pages: ['overview', { group: 'Chat', pages: ['sdks/chat/README'] }] } }),
    'docs/overview.mdx': '---\ntitle: Overview\n---\nSee [chat](/sdks/chat/README) and [rel](./sdks/chat/README.md).\n\n![logo](/images/logo.png)\n\n```\n[code](/sdks/keep)\n```\n',
    'docs/sdks/chat/README.md': '# Chat\n\nBack to <a href="/overview">overview</a>.',
    'docs/models/orphan.mdx': '---\ntitle: Orphan\n---\nOrphan page.',
    'docs/images/logo.png': 'png',
    ...extra,
  })
}

function mainRepo(extra: Record<string, string> = {}): string {
  return write(tmp(), {
    'docs.json': JSON.stringify({
      navigation: { tabs: [{ tab: 'SDKs', groups: [{ group: 'TypeScript SDK', icon: 'code', expanded: false, pages: [{ sourceRef: 'Acme/ts-sdk' }] }, { group: 'Intro', pages: ['introduction'] }] }] },
    }),
    'introduction.mdx': '---\ntitle: Home\n---\nHome.',
    ...extra,
  })
}

const MAPPING = { repo: 'Acme/ts-sdk', mountPath: 'client-sdks/typescript' }

describe('parseSourceRefFlags', () => {
  it('accepts a repository and a slug mount path', () => {
    expect(parseSourceRefFlags(['Acme/ts-sdk=client-sdks/typescript'])).toEqual([MAPPING])
  })

  it.each([
    ['Acme/ts-sdk=../x'],
    ['Acme/ts-sdk=/abs'],
    ['Acme/ts-sdk=a/../b'],
    ['Acme/ts-sdk=a//b'],
    ['Acme/ts-sdk=.hidden'],
    ['Acme/ts-sdk=Upper'],
    ['Acme/ts-sdk'],
    ['Acme/ts-sdk='],
    ['../x=docs'],
    ['Acme/..=docs'],
    ['acme=docs'],
    ['a/b/c=docs'],
  ])('rejects %s', (value) => {
    expect(() => parseSourceRefFlags([value])).toThrow(/--source-ref/)
  })

  it('rejects duplicate repositories and overlapping mounts', () => {
    expect(() => parseSourceRefFlags(['A/b=x', 'a/B=y'])).toThrow(/twice/)
    expect(() => parseSourceRefFlags(['A/b=x', 'A/c=x'])).toThrow(/overlap/)
    expect(() => parseSourceRefFlags(['A/b=x', 'A/c=x/y'])).toThrow(/overlap/)
  })
})

describe('prefixRootLinks', () => {
  it('prefixes root-absolute targets outside code and leaves relative, external and protocol-relative ones', () => {
    const body = [
      '[a](/x) [b](x) [c](https://e.com/x) [d](//cdn/x) [e](#h) [f](</sp ace>)',
      '<a href="/y">y</a> <img src=\'/z.png\' /> <Card href="https://e.com" />',
      '[ref]: /w',
      '`[code](/inline)`',
      '```\n[code](/fenced)\n```',
    ].join('\n')
    expect(prefixRootLinks(body, 'm')).toBe([
      '[a](/m/x) [b](x) [c](https://e.com/x) [d](//cdn/x) [e](#h) [f](</m/sp ace>)',
      '<a href="/m/y">y</a> <img src=\'/m/z.png\' /> <Card href="https://e.com" />',
      '[ref]: /m/w',
      '`[code](/inline)`',
      '```\n[code](/fenced)\n```',
    ].join('\n'))
  })
})

describe('importSourceRef', () => {
  it('mounts all pages (orphans included), assets and navigation under the mount path', () => {
    const imported = importSourceRef(MAPPING, sdkRepo())
    const ids = imported.pages.map((page) => page.id).sort()
    expect(ids).toEqual(['client-sdks/typescript/models/orphan', 'client-sdks/typescript/overview', 'client-sdks/typescript/sdks/chat/README'])
    expect(imported.assets.map((asset) => asset.path)).toContain('client-sdks/typescript/images/logo.png')
    expect(imported.navigation).toEqual(['client-sdks/typescript/overview', { group: 'Chat', pages: ['client-sdks/typescript/sdks/chat/README'] }])
    const overview = imported.pages.find((page) => page.id.endsWith('/overview'))!
    expect(overview.body).toContain('[chat](/client-sdks/typescript/sdks/chat/README)')
    expect(overview.body).toContain('![logo](/client-sdks/typescript/images/logo.png)')
    expect(overview.body).toContain('[code](/sdks/keep)')
    expect(overview.body).toContain('(./sdks/chat/README')
  })

  it('warns and imports nothing when there is no Mintlify docs.json', () => {
    const none = importSourceRef(MAPPING, write(tmp(), { 'docs/readme.md': '# hi' }))
    expect(none.pages).toEqual([])
    expect(none.warnings[0].message).toMatch(/no Mintlify docs\.json/)
    const notMintlify = importSourceRef(MAPPING, write(tmp(), { 'docs/docs.json': '{"name":"x"}', 'docs/a.md': '# a' }))
    expect(notMintlify.pages).toEqual([])
  })

  it('refuses a repository over the file cap instead of importing part of it', () => {
    const files: Record<string, string> = {}
    for (let index = 0; index <= SOURCE_REF_MAX_FILES; index++) files[`docs/p${index}.md`] = '# p'
    const result = importSourceRef(MAPPING, sdkRepo(files))
    expect(result.pages).toEqual([])
    expect(result.warnings[0].message).toMatch(/more than 5000 files.*Nothing was imported/)
  })

  it('ignores symlinks that escape the docs root and dot-directories', () => {
    const secretDir = write(tmp(), { 'secret.md': '# Secret\n\nTOP SECRET' })
    const repo = sdkRepo({ 'docs/.hidden/page.md': '# Hidden' })
    symlinkSync(join(secretDir, 'secret.md'), join(repo, 'docs', 'leak.md'))
    symlinkSync(secretDir, join(repo, 'docs', 'leakdir'))
    const result = importSourceRef(MAPPING, repo)
    const text = JSON.stringify(result.pages)
    expect(text).not.toContain('TOP SECRET')
    expect(result.pages.some((page) => page.id.includes('hidden') || page.id.includes('leak'))).toBe(false)
    expect(result.warnings.some((warning) => /symbolic link/.test(warning.message))).toBe(true)
  })

  it('refuses a docs directory that is a symlink', () => {
    const target = sdkRepo()
    const outer = tmp()
    symlinkSync(join(target, 'docs'), join(outer, 'docs'))
    expect(importSourceRef(MAPPING, outer).pages).toEqual([])
  })
})

describe('migrateRepository with sourceRefs', () => {
  it('replaces the sourceRef node with the mounted navigation and merges pages and assets', () => {
    const imported = importSourceRef(MAPPING, sdkRepo())
    const bundle = migrateRepository({ repositoryDir: mainRepo(), sourceUrl: 'https://github.com/example/docs', platform: 'mintlify', sourceRefs: [imported] })
    const group = bundle.docsConfig.tabs[0].groups!.find((candidate) => candidate.group === 'TypeScript SDK')!
    expect(group.icon).toBe('code')
    expect(group.pages).toEqual(['client-sdks/typescript/overview', { group: 'Chat', pages: ['client-sdks/typescript/sdks/chat/README'] }])
    const ids = bundle.pages.map((page) => page.id)
    expect(ids).toContain('introduction')
    expect(ids).toContain('client-sdks/typescript/models/orphan')
    expect(bundle.assets.map((asset) => asset.path)).toContain('client-sdks/typescript/images/logo.png')
    expect(bundle.sourceRefs).toEqual([{ ...MAPPING, pages: 3 }])
    expect(bundle.stats.imported).toBe(bundle.pages.length)
    expect(bundle.warnings.some((warning) => /sourceRef.*not migrated/.test(warning.message))).toBe(false)
    expect(bundle.warnings.some((warning) => /branding, colors and redirects were ignored/.test(warning.message))).toBe(true)
  })

  it('keeps the warning with the flag hint when the repository is not mapped', () => {
    const bundle = migrateRepository({ repositoryDir: mainRepo(), sourceUrl: 'https://github.com/example/docs', platform: 'mintlify' })
    expect(bundle.warnings.some((warning) => warning.message.includes('--source-ref Acme/ts-sdk=<path>'))).toBe(true)
    expect(bundle.sourceRefs).toBeUndefined()
  })

  it('warns about a mapping the navigation never references', () => {
    const other = importSourceRef({ repo: 'Acme/other', mountPath: 'other' }, sdkRepo())
    const bundle = migrateRepository({ repositoryDir: mainRepo(), sourceUrl: 'https://github.com/example/docs', platform: 'mintlify', sourceRefs: [other] })
    expect(bundle.warnings.some((warning) => warning.message.includes('Acme/other=other matched no sourceRef'))).toBe(true)
    expect(bundle.pages.some((page) => page.id.startsWith('other/'))).toBe(false)
  })

  it('rejects a mount path the main site already owns', () => {
    const imported = importSourceRef(MAPPING, sdkRepo())
    const repo = mainRepo({ 'client-sdks/typescript/guide.mdx': '---\ntitle: Guide\n---\nGuide.' })
    const bundle = migrateRepository({ repositoryDir: repo, sourceUrl: 'https://github.com/example/docs', platform: 'mintlify', sourceRefs: [imported] })
    expect(bundle.warnings.some((warning) => warning.code === 'collision' && /already exists/.test(warning.message))).toBe(true)
    expect(bundle.pages.some((page) => page.id === 'client-sdks/typescript/overview')).toBe(false)
    expect(bundle.sourceRefs).toBeUndefined()
  })

  it('does not overwrite a main page that shares an imported page id', () => {
    const imported = importSourceRef(MAPPING, sdkRepo())
    const clash = { ...imported, pages: [...imported.pages, { ...imported.pages[0], id: 'introduction', navigationId: 'introduction' }] }
    const bundle = migrateRepository({ repositoryDir: mainRepo(), sourceUrl: 'https://github.com/example/docs', platform: 'mintlify', sourceRefs: [clash] })
    expect(bundle.pages.filter((page) => page.id === 'introduction')).toHaveLength(1)
    expect(bundle.warnings.some((warning) => warning.code === 'collision' && warning.message.includes('"introduction"'))).toBe(true)
  })
})

describe('sourceRef custom components', () => {
  it('bundles the sub-repository components with the main ones so every Migrated tag is registered', () => {
    const foo = (label: string): string => `export const Foo = () => <button onClick={() => 1}>${label}</button>\n`
    const sub = write(tmp(), {
      'docs.json': JSON.stringify({ navigation: { pages: ['intro'] } }),
      'intro.mdx': 'import { Foo } from "/snippets/Foo.jsx"\n\n<Foo />\n',
      'snippets/Foo.jsx': foo('sub'),
    })
    const main = mainRepo({
      'docs.json': JSON.stringify({ navigation: { pages: ['introduction', { sourceRef: 'Acme/ts-sdk' }] } }),
      'introduction.mdx': 'import { Foo } from "/snippets/Foo.jsx"\n\n<Foo />\n',
      'snippets/Foo.jsx': foo('main'),
    })
    const imported = importSourceRef(MAPPING, sub)
    const bundle = migrateRepository({ repositoryDir: main, sourceUrl: 'https://github.com/example/docs', platform: 'mintlify', sourceRefs: [imported] })
    const files = bundle.componentFiles ?? []
    const registry = String(files.find((file) => file.path === 'src/mdx/custom-components.tsx')?.content)
    const tags = bundle.pages.flatMap((page) => page.body.match(/<Migrated[0-9a-f]+/g) ?? []).map((tag) => tag.slice(1))
    expect(bundle.pages.map((page) => page.id)).toContain('client-sdks/typescript/intro')
    expect(new Set(tags).size).toBe(2)
    for (const tag of tags) expect(registry).toContain(`  ${tag},`)
    for (const [, specifier] of registry.matchAll(/^import \{ \w+ as Migrated[0-9a-f]+ \} from "\.\/([^"]+)"$/gm)) {
      expect(files.some((file) => file.path.replace(/\.tsx?$/, '') === `src/mdx/${specifier}`)).toBe(true)
    }
    expect(bundle.warnings.some((warning) => /Not imported:.*custom components/.test(warning.message))).toBe(false)
  })
})

describe('sourceRef quarantine wording', () => {
  it('never claims a withheld sub-repository file was saved', () => {
    const repo = write(tmp(), {
      'docs.json': JSON.stringify({ navigation: { pages: ['intro', 'secret'] } }),
      'intro.mdx': '---\ntitle: I\n---\nhi ![](/images/pub.png)',
      'secret.mdx': '---\ntitle: S\ngroups: [admin]\n---\nSECRET ![](/images/priv.png)',
      'images/pub.png': 'x',
      'images/priv.png': 'y',
      'images/orphan.png': 'z',
    })
    const result = importSourceRef(MAPPING, repo)
    const messages = result.warnings.map((warning) => warning.message)
    expect(messages.some((message) => /access-restricted page\(s\) were withheld from the published site \(not saved\)/.test(message))).toBe(true)
    expect(messages.filter((message) => message.includes('migration-quarantine'))).toEqual([])
    expect(messages.some((message) => /saved under|is saved at/.test(message))).toBe(false)
  })

  it.each([
    ['Access-restricted on the source site (groups), so it was NOT published. The original is saved at migration-quarantine/a.mdx; links will break.', /It is withheld from the site \(not saved\); links will break/],
    ['Access-restricted page (x) was dropped by the file limit, so it was NOT published and was not saved under migration-quarantine/; recover it.', /is not saved; recover it/],
    ['Access-restricted page (x) could not be read, so it was not copied to migration-quarantine/; recover it.', /is not saved; recover it/],
    ['Copy any that published pages need from migration-quarantine/assets/ into public/ by hand.', /not saved/],
    ['2 unreferenced asset(s) were kept out of public/ because x; review migration-quarantine/assets/ and copy any that published pages need. Z', /not saved\)\. Z/],
  ])('rewrites %s', (message, expected) => {
    const rewritten = withheldNotSaved(message)
    expect(rewritten).not.toContain('migration-quarantine')
    expect(rewritten).toMatch(expected)
  })
})

describe('sourceRef repository size limits', () => {
  const sizeFetcher = (body: string): MigrationFetcher => async (url) => ({ finalUrl: url, body, contentType: 'application/json' })

  it('refuses a repository GitHub reports as over the cap, naming the sizes', async () => {
    const reason = await sourceRefOversizeReason('Acme/ts-sdk', sizeFetcher(JSON.stringify({ size: SOURCE_REF_MAX_REPOSITORY_KB + 1 })))
    expect(reason).toMatch(/200 MB limit/)
  })

  it('proceeds when the repository is small, the size is missing, or the API is unavailable', async () => {
    expect(await sourceRefOversizeReason('Acme/ts-sdk', sizeFetcher(JSON.stringify({ size: 1000 })))).toBeNull()
    expect(await sourceRefOversizeReason('Acme/ts-sdk', sizeFetcher('{}'))).toBeNull()
    expect(await sourceRefOversizeReason('Acme/ts-sdk', sizeFetcher('not json'))).toBeNull()
    const failing = vi.fn().mockRejectedValue(new Error('rate limited'))
    expect(await sourceRefOversizeReason('Acme/ts-sdk', failing)).toBeNull()
    expect(String(failing.mock.calls[0][0])).toBe('https://api.github.com/repos/Acme/ts-sdk')
  })

  it('ignores a docs.json over 1 MB instead of parsing it', () => {
    const huge = JSON.stringify({ navigation: { pages: ['overview'] }, padding: 'x'.repeat(1_100_000) })
    const result = importSourceRef(MAPPING, write(tmp(), { 'docs/docs.json': huge, 'docs/overview.mdx': '# hi' }))
    expect(result.pages).toEqual([])
    expect(result.warnings[0].message).toMatch(/no Mintlify docs\.json/)
  })
})
