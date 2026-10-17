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
import { sanitizeSpecForPublication } from '@/lib/openapi/sanitize'
import type { OpenAPIDocument } from '@/lib/openapi/types'

const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'T', version: '1' },
  paths: { '/x': { get: { summary: 'PUBLIC' } }, '/internal': { get: { summary: 'SECRET' } } },
})
const page = (extra = ''): string => `---\ntitle: P\n${extra}---\n\nBody.\n`

/** Migrates a Mintlify repository and returns the paths each published spec still lists after the renderer's sanitiser ran. */
function publishedPaths(files: Record<string, string>): Record<string, Array<string>> {
  const root = mkdtempSync(join(tmpdir(), 'thally-withheld-parity-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
  return Object.fromEntries(bundle.assets.filter((asset) => asset.path.startsWith('openapi/')).map((asset) => {
    const published = sanitizeSpecForPublication(JSON.parse(Buffer.from(asset.content).toString('utf8')) as OpenAPIDocument)
    return [asset.path, Object.keys(published.paths ?? {}).sort()]
  }))
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
})
