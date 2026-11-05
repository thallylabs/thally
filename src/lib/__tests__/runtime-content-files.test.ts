/** Regression coverage for authored files embedded into self-hosted runtimes. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  MANAGED_CONTENT_ASSET_DIRECTORY,
  collectRuntimeContentFiles,
  findShadowingPublicSpecs,
  findUnpublishedOpenApiPages,
  writeManagedContentAssets,
} from '../../../scripts/lib/runtime-content-files'
import { sanitizeSpecForPublication } from '@/lib/openapi/sanitize'

const projectRoots: Array<string> = []

function createProject(source: string): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'thally-runtime-content-'))
  projectRoots.push(projectRoot)
  writeFileSync(
    path.join(projectRoot, 'docs.json'),
    JSON.stringify({ tabs: [{ tab: 'API', api: { source } }] }),
  )
  return projectRoot
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(projectRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('collectRuntimeContentFiles', () => {
  it('embeds a nested OpenAPI source configured in docs.json', () => {
    const projectRoot = createProject('openapi/cinderlane.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    writeFileSync(path.join(projectRoot, 'openapi/cinderlane.yaml'), 'openapi: 3.1.0\n')

    expect(collectRuntimeContentFiles(projectRoot)['openapi/cinderlane.yaml']?.content).toBe(
      'openapi: 3.1.0\n',
    )
  })

  it('writes sanitized specs (YAML and JSON) without x-excluded operations', async () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/pub': { get: { responses: {} } },
        '/secret': { get: { 'x-excluded': true, responses: {} } },
        '/override': { get: { responses: {} } },
      },
    }
    writeFileSync(path.join(projectRoot, 'openapi/api.yaml'), stringifyYaml(doc))
    writeFileSync(path.join(projectRoot, 'openapi.json'), JSON.stringify(doc))
    writeFileSync(
      path.join(projectRoot, 'docs.json'),
      JSON.stringify({ tabs: [{ api: { source: 'openapi/api.yaml', overrides: { 'GET /override': { hidden: true } } } }] }),
    )

    const sources = collectRuntimeContentFiles(projectRoot)
    const yamlOut = parseYaml(sources['openapi/api.yaml']!.content)
    expect(Object.keys(yamlOut.paths)).toEqual(['/pub'])
    expect(sources['openapi/api.yaml']!.content).not.toContain('secret')
    expect(Object.keys(JSON.parse(sources['openapi.json']!.content).paths)).toEqual(['/pub', '/override'])
    expect(sources['openapi.json']!.content).not.toContain('secret')

    // Emitted managed asset is what the runtime will fetch; it must stay loadable.
    await writeManagedContentAssets(projectRoot, sources)
    const served = readFileSync(path.join(projectRoot, MANAGED_CONTENT_ASSET_DIRECTORY, 'openapi/api.yaml'), 'utf8')
    expect(served).not.toContain('secret')
    expect(sanitizeSpecForPublication(parseYaml(served))).toEqual(parseYaml(served))
  })

  it('keeps an operation in a shared managed spec unless every tab that binds it hides it', () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    const op = { get: { responses: {} } }
    writeFileSync(
      path.join(projectRoot, 'openapi/api.yaml'),
      stringifyYaml({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/a': op, '/b': op, '/c': op } }),
    )
    writeFileSync(
      path.join(projectRoot, 'docs.json'),
      JSON.stringify({ tabs: [
        { tab: 'One', api: { source: 'openapi/api.yaml', overrides: { 'GET /a': { hidden: true }, 'GET /b': { hidden: true } } } },
        { tab: 'Two', api: { source: 'openapi/api.yaml', overrides: { 'GET /b': { hidden: true } } } },
      ] }),
    )
    const paths = Object.keys(parseYaml(collectRuntimeContentFiles(projectRoot)['openapi/api.yaml']!.content).paths)
    expect(paths).toEqual(['/a', '/c'])
  })

  it('reports a public/openapi.json that would shadow the filtered /openapi.json route', () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'public'), { recursive: true })
    const doc = (flag: Record<string, unknown>) =>
      JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/a': { get: { ...flag, responses: {} } } } })
    writeFileSync(path.join(projectRoot, 'public/openapi.json'), doc({ 'x-hidden': true }))
    writeFileSync(path.join(projectRoot, 'public/openapi.yaml'), stringifyYaml(JSON.parse(doc({ 'x-excluded': true }))))
    expect(findShadowingPublicSpecs(projectRoot)).toEqual(['public/openapi.json', 'public/openapi.yaml'])

    // Nothing to filter: serving the raw file is harmless. Other names do not shadow a route.
    writeFileSync(path.join(projectRoot, 'public/openapi.json'), doc({}))
    writeFileSync(path.join(projectRoot, 'public/openapi.yaml'), 'not: [valid')
    writeFileSync(path.join(projectRoot, 'public/api.json'), doc({ 'x-hidden': true }))
    expect(findShadowingPublicSpecs(projectRoot)).toEqual([])
  })

  it('leaves an unparseable root spec out without failing the build', () => {
    const projectRoot = createProject('openapi/api.yaml')
    mkdirSync(path.join(projectRoot, 'openapi'))
    writeFileSync(path.join(projectRoot, 'openapi/api.yaml'), 'openapi: 3.1.0\n')
    writeFileSync(path.join(projectRoot, 'openapi.yaml'), 'paths: [unclosed')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const sources = collectRuntimeContentFiles(projectRoot)
      expect(sources).not.toHaveProperty('openapi.yaml')
      expect(sources).toHaveProperty('openapi/api.yaml')
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/left out of the build: openapi\.yaml /))
    } finally {
      warn.mockRestore()
    }
  })

  it('never ships an unfilterable spec, even one bound to a hidden API tab', async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'thally-runtime-content-'))
    projectRoots.push(projectRoot)
    writeFileSync(path.join(projectRoot, 'docs.json'), JSON.stringify({
      tabs: [
        { tab: 'API', api: { source: 'openapi/public.json' } },
        { tab: 'Internal', hidden: true, api: { source: 'openapi/internal.json' } },
        { tab: 'Scalar', api: { source: 'openapi/scalar.json' } },
      ],
    }))
    mkdirSync(path.join(projectRoot, 'openapi'))
    writeFileSync(path.join(projectRoot, 'openapi/public.json'), '{"openapi":"3.1.0","paths":{}}')
    // Trailing comma: not valid JSON, and the raw text still names the hidden endpoint.
    writeFileSync(path.join(projectRoot, 'openapi/internal.json'), '{"openapi":"3.1.0","paths":{"/secret":{"get":{"x-hidden":true,"responses":{}}}},}')
    writeFileSync(path.join(projectRoot, 'openapi/scalar.json'), '["/secret"]')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const sources = collectRuntimeContentFiles(projectRoot)
      expect(Object.keys(sources).filter((file) => file.startsWith('openapi/'))).toEqual(['openapi/public.json'])
      expect(Object.values(sources).some((entry) => entry.content.includes('/secret'))).toBe(false)
      const manifest = await writeManagedContentAssets(projectRoot, sources)
      expect(Object.keys(manifest.files)).not.toContain('openapi/internal.json')
      expect(existsSync(path.join(projectRoot, MANAGED_CONTENT_ASSET_DIRECTORY, 'openapi/internal.json'))).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('maps URL-style configured paths to public assets', () => {
    const projectRoot = createProject('/specs/cinderlane.json')
    mkdirSync(path.join(projectRoot, 'public/specs'), { recursive: true })
    writeFileSync(path.join(projectRoot, 'public/specs/cinderlane.json'), '{"openapi":"3.1.0"}')

    expect(collectRuntimeContentFiles(projectRoot)).toHaveProperty('public/specs/cinderlane.json')
  })

  it('rejects a configured path that escapes the project', () => {
    const projectRoot = createProject('../outside.yaml')

    expect(() => collectRuntimeContentFiles(projectRoot)).toThrow(
      'Configured OpenAPI source escapes the project',
    )
  })

  it('rejects symlinked OpenAPI sources', () => {
    const projectRoot = createProject('openapi.yaml')
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'thally-external-openapi-'))
    projectRoots.push(externalRoot)
    const targetPath = path.join(externalRoot, 'openapi.yaml')
    writeFileSync(targetPath, 'openapi: 3.1.0\n')
    symlinkSync(targetPath, path.join(projectRoot, 'openapi.yaml'))

    expect(() => collectRuntimeContentFiles(projectRoot)).toThrow(
      'Configured OpenAPI source is not a regular file',
    )
  })

  it('rejects OpenAPI sources beneath a symlinked directory', () => {
    const projectRoot = createProject('specs/openapi.yaml')
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'thally-external-specs-'))
    projectRoots.push(externalRoot)
    writeFileSync(path.join(externalRoot, 'openapi.yaml'), 'openapi: 3.1.0\n')
    symlinkSync(externalRoot, path.join(projectRoot, 'specs'))

    expect(() => collectRuntimeContentFiles(projectRoot)).toThrow(
      'Configured OpenAPI source resolves outside the project',
    )
  })
})

describe('findUnpublishedOpenApiPages', () => {
  const ok = { responses: {} }
  function project(files: Record<string, string>, api: Record<string, unknown> = { source: 'openapi/api.json' }): string {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'thally-unpublished-'))
    projectRoots.push(projectRoot)
    writeFileSync(path.join(projectRoot, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'API', api }] }))
    const spec = {
      openapi: '3.1.0', info: { title: 'T', version: '1' },
      paths: { '/h': { get: { 'x-hidden': true, ...ok } }, '/e': { get: { 'x-excluded': true, ...ok } }, '/v': { get: ok } },
    }
    for (const [file, body] of Object.entries({ 'openapi/api.json': JSON.stringify(spec), ...files })) {
      mkdirSync(path.dirname(path.join(projectRoot, file)), { recursive: true })
      writeFileSync(path.join(projectRoot, file), body)
    }
    return projectRoot
  }
  const page = (operation: string) => `---\ntitle: T\nopenapi: "${operation}"\n---\nBody`

  it('names each page bound to an excluded operation, and only those: a hidden one is rendered', () => {
    const projectRoot = project({
      'src/content/hidden-endpoint.mdx': page('GET /h'),
      'src/content/sub/excluded.mdx': page('GET /e'),
      'src/content/visible.mdx': page('GET /v'),
      'src/content/typo.mdx': page('GET /nope'),
      'src/content/plain.mdx': '---\ntitle: P\n---\nText',
    })
    expect(findUnpublishedOpenApiPages(projectRoot)).toEqual([
      { file: 'src/content/sub/excluded.mdx', id: 'sub/excluded', operation: 'GET /e', state: 'excluded' },
    ])
  })

  it('judges spec-prefixed references against the spec they name, like the docs route', () => {
    const projectRoot = project({
      'openapi/admin.yaml': 'openapi: 3.1.0\ninfo: { title: A, version: "1" }\npaths:\n  /v:\n    get: { x-excluded: true, responses: {} }\n  /h:\n    get: { responses: {} }\n',
      'src/content/admin/index.mdx': page("'openapi/admin.yaml' GET /v"),
      'src/content/by-name.mdx': page('admin.yaml GET /v'),
      'src/content/main-prefixed.mdx': page('openapi/api.json GET /e'),
      'src/content/admin-visible.mdx': page('admin.yaml GET /h'),
      'src/content/bare-fallback.mdx': page('GET /h'),
      'src/content/unknown-spec.mdx': page('other.yaml GET /h'),
    })
    const docsJson = { tabs: [{ tab: 'API', api: { source: 'openapi/api.json' } }, { tab: 'Admin', api: { source: 'openapi/admin.yaml' } }, { tab: 'Old', hidden: true, api: { source: 'openapi/admin.yaml' } }] }
    writeFileSync(path.join(projectRoot, 'docs.json'), JSON.stringify(docsJson))
    expect(findUnpublishedOpenApiPages(projectRoot)).toEqual([
      { file: 'src/content/admin/index.mdx', id: 'admin', operation: 'openapi/admin.yaml GET /v', state: 'excluded' },
      { file: 'src/content/by-name.mdx', id: 'by-name', operation: 'admin.yaml GET /v', state: 'excluded' },
      { file: 'src/content/main-prefixed.mdx', id: 'main-prefixed', operation: 'openapi/api.json GET /e', state: 'excluded' },
    ])
    expect(JSON.parse(collectRuntimeContentFiles(projectRoot)['thally-unpublished-pages.json'].content)).toEqual(['admin', 'by-name', 'main-prefixed'])
  })

  it('lets no override show an excluded operation, and stays quiet for a remote or missing spec', () => {
    const files = { 'src/content/excluded-endpoint.mdx': page('GET /e') }
    expect(findUnpublishedOpenApiPages(project(files, { source: 'openapi/api.json', overrides: { 'GET /e': { hidden: false } } }))).toHaveLength(1)
    expect(findUnpublishedOpenApiPages(project(files, { source: 'https://example.com/spec.json' }))).toEqual([])
    expect(findUnpublishedOpenApiPages(project(files, { source: 'openapi/missing.json' }))).toEqual([])
  })

  describe('the spec copy a hidden operation is rendered from', () => {
    const copy = (projectRoot: string, file = 'openapi/api.json') => JSON.parse(collectRuntimeContentFiles(projectRoot)[file]!.content) as { paths: Record<string, Record<string, Record<string, unknown>>> }
    const runtimeSees = (document: object, overrides?: Record<string, { hidden: boolean }>) =>
      Object.keys((sanitizeSpecForPublication(document as never, { overrides }).paths ?? {}) as object).sort()

    it('keeps the hidden operations pages name, and no other hidden or excluded one', () => {
      const projectRoot = project({
        'openapi/api.json': JSON.stringify({
          openapi: '3.1.0', info: { title: 'T', version: '1' },
          paths: { '/h': { get: { 'x-hidden': true, ...ok } }, '/h2': { get: { 'x-hidden': true, ...ok } }, '/e': { get: { 'x-excluded': true, ...ok } }, '/v': { get: ok } },
        }),
        'src/content/hidden-endpoint.mdx': page('GET /h'),
        'src/content/excluded-endpoint.mdx': page('GET /e'),
      })
      const embedded = copy(projectRoot)
      expect(Object.keys(embedded.paths)).toEqual(['/h', '/v'])
      // The route reads the copy through the same filter as before, so generated pages still do not have it.
      expect(runtimeSees(embedded)).toEqual(['/v'])
    })

    it('judges a spec prefix and a hidden tab like the route', () => {
      const hiddenOp = (path: string) => ({ [path]: { get: { 'x-hidden': true, ...ok } } })
      const spec = (paths: object) => JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths })
      const projectRoot = project({
        'openapi/api.json': spec({ ...hiddenOp('/shared'), '/main-only': { get: ok } }),
        'openapi/admin.yaml': spec({ ...hiddenOp('/shared'), ...hiddenOp('/admin-only') }),
        'openapi/page-only.json': spec({ ...hiddenOp('/quote'), ...hiddenOp('/not-named') }),
        'src/content/a.mdx': page('admin.yaml GET /shared'),
        'src/content/b.mdx': page('GET /quote'),
      })
      writeFileSync(path.join(projectRoot, 'docs.json'), JSON.stringify({ tabs: [
        { tab: 'API', api: { source: 'openapi/api.json' } },
        { tab: 'Admin', api: { source: 'openapi/admin.yaml' } },
        { tab: 'Quote', hidden: true, api: { source: 'openapi/page-only.json' } },
      ] }))
      const sources = collectRuntimeContentFiles(projectRoot)
      const paths = (file: string) => Object.keys((parseYaml(sources[file]!.content) as { paths: object }).paths)
      expect(paths('openapi/api.json')).toEqual(['/main-only'])
      expect(paths('openapi/admin.yaml')).toEqual(['/shared'])
      expect(paths('openapi/page-only.json')).toEqual(['/quote'])
    })

    it('keeps the operation hidden for the route when its flag sat on a path item shared with others', () => {
      const projectRoot = project({
        'openapi/api.json': JSON.stringify({
          openapi: '3.1.0', info: { title: 'T', version: '1' },
          paths: { '/pair': { 'x-hidden': true, get: ok, post: ok } },
        }),
        'src/content/pair.mdx': page('GET /pair'),
      })
      const embedded = copy(projectRoot)
      expect(Object.keys(embedded.paths['/pair'])).toContain('get')
      expect(Object.keys(embedded.paths['/pair'])).not.toContain('post')
      expect(runtimeSees(embedded)).toEqual([])
    })

    it('keeps a webhook a page names, and the hidden operation no docs.json override shows', () => {
      const projectRoot = project({
        'openapi/api.json': JSON.stringify({
          openapi: '3.1.0', info: { title: 'T', version: '1' },
          paths: { '/o': { get: { 'x-hidden': true, ...ok } } },
          webhooks: { paid: { post: { 'x-hidden': true, ...ok } }, other: { post: { 'x-hidden': true, ...ok } } },
        }),
        'src/content/paid.mdx': '---\ntitle: T\nopenapi: "webhook paid"\n---\nBody',
      })
      const embedded = JSON.parse(collectRuntimeContentFiles(projectRoot)['openapi/api.json']!.content) as { paths: object; webhooks: object }
      expect(Object.keys(embedded.webhooks)).toEqual(['paid'])
      expect(embedded.paths).toEqual({})
    })
  })
})
