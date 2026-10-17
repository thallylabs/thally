/**
 * Monorepo-only contract test: an operation only an access-restricted page
 * documents must be gone from the spec the renderer publishes, however the
 * restricted page spelled the spec's name. This stays out of standalone
 * starters, which do not contain the migration package source.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateRepository } from '../../../../packages/migrate/src/repository'
import { parseOpenApiFrontmatter } from '@/lib/openapi/page-frontmatter'
import { pageReferenceState, type OperationPublicationState } from '@/lib/openapi/publication'
import { sanitizeSpecForPublication } from '@/lib/openapi/sanitize'
import type { OpenAPIDocument } from '@/lib/openapi/types'

const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'T', version: '1' },
  paths: { '/x': { get: { summary: 'PUBLIC' } }, '/internal': { get: { summary: 'SECRET' } } },
})
const page = (extra = ''): string => `---\ntitle: P\n${extra}---\n\nBody.\n`

/** Migrates a Mintlify repository written to a temporary folder. */
function migrate(files: Record<string, string>): ReturnType<typeof migrateRepository> {
  const root = mkdtempSync(join(tmpdir(), 'thally-withheld-parity-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
}

/** The paths each published spec still lists after the renderer's sanitiser ran. */
function publishedPathsOf(bundle: ReturnType<typeof migrate>): Record<string, Array<string>> {
  return Object.fromEntries(bundle.assets.filter((asset) => asset.path.startsWith('openapi/')).map((asset) => {
    const published = sanitizeSpecForPublication(JSON.parse(Buffer.from(asset.content).toString('utf8')) as OpenAPIDocument)
    return [asset.path, Object.keys(published.paths ?? {}).sort()]
  }))
}

/** Migrates a Mintlify repository and returns the paths each published spec still lists after the renderer's sanitiser ran. */
function publishedPaths(files: Record<string, string>): Record<string, Array<string>> {
  return publishedPathsOf(migrate(files))
}

/** What the renderer's page-reference state says about a migrated page: `excluded` is a page that 404s. */
function renderedPageState(bundle: ReturnType<typeof migrate>, id: string): OperationPublicationState {
  const openapi = bundle.pages.find((page) => page.id === id)?.openapi
  const sources = [...new Set(bundle.docsConfig.tabs.flatMap((tab) => tab.api ? [tab.api.source] : []))]
  return pageReferenceState(parseOpenApiFrontmatter(openapi)!, sources.map((path) => ({
    config: { id: path, label: '', source: { type: 'file' as const, path } },
    document: JSON.parse(Buffer.from(bundle.assets.find((asset) => asset.path === path)!.content).toString('utf8')) as unknown,
  })))
}

describe('migrate withheld operations parity', () => {
  it('drops a restricted operation from the published spec when the restricted ref is written as ./spec, spec#frag or spec?v=3', () => {
    for (const config of ['docs.json', 'mint.json']) {
      for (const spelling of ['./spec', 'spec#section', 'spec?version=3']) {
        expect(publishedPaths({
          [config]: JSON.stringify(config === 'docs.json' ? { navigation: { pages: ['pub', 's'] } } : { navigation: [{ group: 'G', pages: ['pub', 's'] }] }),
          'spec.json': spec,
          'pub.mdx': page('openapi: "spec GET /x"\n'),
          's.mdx': page(`groups: [admin]\nopenapi: "${spelling} GET /internal"\n`),
        })).toEqual({ 'openapi/spec.json': ['/x'] })
      }
    }
  })

  it('drops a restricted operation from a spec renamed to avoid a file name collision', () => {
    expect(publishedPaths({
      'docs.json': JSON.stringify({ navigation: { tabs: [
        { tab: 'Guides', pages: ['pub', 's'] },
        { tab: 'A', openapi: 'a/spec.json' },
        { tab: 'B', openapi: 'b/spec.json' },
      ] } }),
      'a/spec.json': spec,
      'b/spec.json': spec,
      'pub.mdx': page('openapi: "spec GET /internal"\n'),
      's.mdx': page('groups: [admin]\nopenapi: "b/spec.json GET /internal"\n'),
    })).toEqual({ 'openapi/spec.json': ['/internal', '/x'], 'openapi/b-spec.json': ['/x'] })
  })

  describe('bare operation references keep an operation public only in the spec they belong to', () => {
    const specWith = (...paths: Array<string>): string => JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: Object.fromEntries(paths.map((path) => [path, { get: { summary: path } }])),
    })
    const specs = {
      'first.json': specWith('/ping'),
      'second.json': specWith('/health', '/x'),
      'public.json': specWith('/x'),
    }
    const withSpecs = (files: Record<string, string>): Record<string, Array<string>> => publishedPaths({ ...specs, ...files })
    /** Two top-level specs, plus another API area bound to `public.json` whose navigation lists a bare `GET /x`. */
    const twoDefaults = (config: string, pages: Array<string>): string => JSON.stringify(
      config === 'docs.json'
        ? { api: { openapi: ['first.json', 'second.json'] }, navigation: { tabs: [{ tab: 'Guides', pages }, { tab: 'Public API', openapi: 'public.json', pages: ['GET /x'] }] } }
        : { api: { openapi: ['first.json', 'second.json'] }, tabs: [{ name: 'Public API', url: 'public', openapi: 'public.json' }], navigation: [{ group: 'Guides', pages }, { group: 'Public API', pages: ['GET /x'] }] },
    )

    for (const config of ['docs.json', 'mint.json']) {
      it(`does not let a bare navigation entry of another API area keep a restricted operation public (${config})`, () => {
        const result = withSpecs({
          [config]: twoDefaults(config, ['pub', 's']),
          'pub.mdx': page('openapi: "second.json GET /health"\n'),
          's.mdx': page('groups: [admin]\nopenapi: "second.json GET /x"\n'),
        })
        expect(result['openapi/second.json']).toEqual(['/health'])
        expect(result['openapi/first.json']).toEqual(['/ping'])
      })

      it(`does not let a bare page reference that belongs to no single spec keep a restricted operation public (${config})`, () => {
        expect(withSpecs({
          [config]: twoDefaults(config, ['pub', 's', 'bare']),
          'pub.mdx': page('openapi: "second.json GET /health"\n'),
          'bare.mdx': page('openapi: "GET /x"\n'),
          's.mdx': page('groups: [admin]\nopenapi: "second.json GET /x"\n'),
        })['openapi/second.json']).toEqual(['/health'])
      })

      it(`keeps an operation public in the site's default spec when a bare navigation entry names it (${config})`, () => {
        expect(withSpecs({
          [config]: JSON.stringify(config === 'docs.json'
            ? { api: { openapi: 'public.json' }, navigation: { pages: ['pub', 's', 'GET /x'] } }
            : { api: { openapi: 'public.json' }, navigation: [{ group: 'G', pages: ['pub', 's', 'GET /x'] }] }),
          'pub.mdx': page(),
          's.mdx': page('groups: [admin]\nopenapi: "public.json GET /x"\n'),
        })['openapi/public.json']).toEqual(['/x'])
      })
    }

    it('keeps an operation public in the spec the tab of a bare navigation entry binds', () => {
      const result = withSpecs({
        'docs.json': twoDefaults('docs.json', ['pub', 's']),
        'pub.mdx': page(),
        's.mdx': page('groups: [admin]\nopenapi: "public.json GET /x"\n'),
      })
      expect(result['openapi/public.json']).toEqual(['/x'])
    })

    it('keeps an operation public in the spec the tab listing a bare page reference binds', () => {
      expect(withSpecs({
        'docs.json': JSON.stringify({ navigation: { tabs: [
          { tab: 'Guides', pages: ['s'] },
          { tab: 'Public API', openapi: 'public.json', pages: ['bare'] },
        ] } }),
        'bare.mdx': page('openapi: "GET /x"\n'),
        's.mdx': page('groups: [admin]\nopenapi: "public.json GET /x"\n'),
      })['openapi/public.json']).toEqual(['/x'])
    })
  })

  describe('a bare public reference keeps its operation public wherever its page is listed', () => {
    const secret = page('groups: [admin]\nopenapi: "b.json GET /internal"\n')
    const tabs = (...entries: Array<Record<string, unknown>>): string => JSON.stringify({ navigation: { tabs: entries } })

    for (const [listed, file] of [['reference', 'reference/index.mdx'], ['reference/index', 'reference.mdx'], ['/reference.md', 'reference/index.mdx']]) {
      it(`resolves a page listed as ${listed} to its file ${file}`, () => {
        const bundle = migrate({
          'docs.json': tabs({ tab: 'B', openapi: 'b.json', pages: [listed, 'secret'] }),
          'b.json': spec,
          [file]: page('openapi: "GET /internal"\n'),
          'secret.mdx': secret,
        })
        expect(publishedPathsOf(bundle)['openapi/b.json']).toEqual(['/internal', '/x'])
        expect(renderedPageState(bundle, 'reference')).toBe('published')
      })
    }

    for (const spelling of ['/b.json', './b.json']) {
      it(`counts ${spelling} and b.json as one owner when two tabs list the page`, () => {
        const bundle = migrate({
          'docs.json': tabs({ tab: 'A', openapi: 'b.json', pages: ['pub', 'secret'] }, { tab: 'C', openapi: spelling, pages: ['pub'] }),
          'b.json': spec,
          'pub.mdx': page('openapi: "GET /internal"\n'),
          'secret.mdx': secret,
        })
        expect(publishedPathsOf(bundle)['openapi/b.json']).toEqual(['/internal', '/x'])
        expect(renderedPageState(bundle, 'pub')).toBe('published')
      })
    }

    it('counts a spec named by its folder path and by its file name as one owner', () => {
      const bundle = migrate({
        'docs.json': tabs({ tab: 'A', openapi: 'specs/b.json', pages: ['pub', 'secret'] }, { tab: 'C', openapi: 'b.json', pages: ['pub'] }),
        'specs/b.json': spec,
        'pub.mdx': page('openapi: "GET /internal"\n'),
        'secret.mdx': secret,
      })
      expect(Object.values(publishedPathsOf(bundle))).toEqual([['/internal', '/x']])
      expect(renderedPageState(bundle, 'pub')).toBe('published')
    })

    it('still withholds the operation from a spec the page is not listed under', () => {
      const bundle = migrate({
        'docs.json': tabs({ tab: 'B', openapi: 'b.json', pages: ['reference'] }, { tab: 'C', openapi: 'c.json', pages: ['secret'] }),
        'b.json': spec,
        'c.json': spec,
        'reference/index.mdx': page('openapi: "GET /internal"\n'),
        'secret.mdx': page('groups: [admin]\nopenapi: "c.json GET /internal"\n'),
      })
      expect(publishedPathsOf(bundle)).toEqual({ 'openapi/b.json': ['/internal', '/x'], 'openapi/c.json': ['/x'] })
    })

    it('still withholds the operation when the page is listed under tabs bound to different specs', () => {
      const bundle = migrate({
        'docs.json': tabs({ tab: 'A', openapi: 'a.json', pages: ['pub', 'secret'] }, { tab: 'B', openapi: 'b.json', pages: ['pub'] }),
        'a.json': spec,
        'b.json': spec,
        'pub.mdx': page('openapi: "GET /internal"\n'),
        'secret.mdx': secret,
      })
      expect(publishedPathsOf(bundle)['openapi/b.json']).toEqual(['/x'])
    })
  })
})
