import { describe, expect, it } from 'vitest'
import { operationPublicationState, pageReferenceState, type RoutedSpec } from '../publication'
import { parseOpenApiFrontmatter } from '../page-frontmatter'

const ok = { responses: { 200: { description: 'ok' } } }
const doc = (paths: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  openapi: '3.1.0', info: { title: 't', version: '1' }, paths, ...extra,
})

describe('operationPublicationState', () => {
  it('reads flags on the operation, in both spellings', () => {
    const document = doc({
      '/a': { get: { 'x-hidden': true, ...ok }, post: { 'x-excluded': 'true', ...ok }, put: ok },
    })
    expect(operationPublicationState(document, 'GET', '/a')).toBe('hidden')
    expect(operationPublicationState(document, 'post', '/a')).toBe('excluded')
    expect(operationPublicationState(document, 'PUT', '/a')).toBe('published')
  })

  it('reads flags on the path entry, on a $ref path item and on a flag sibling to the $ref', () => {
    const document = doc(
      {
        '/entry': { 'x-excluded': true, get: ok },
        '/ref': { $ref: '#/components/pathItems/Flagged' },
        '/sibling': { $ref: '#/components/pathItems/Plain', 'x-hidden': true },
        '/plain': { $ref: '#/components/pathItems/Plain' },
      },
      { components: { pathItems: { Flagged: { 'x-hidden': true, get: ok }, Plain: { get: ok } } } },
    )
    expect(operationPublicationState(document, 'GET', '/entry')).toBe('excluded')
    expect(operationPublicationState(document, 'GET', '/ref')).toBe('hidden')
    expect(operationPublicationState(document, 'GET', '/sibling')).toBe('hidden')
    expect(operationPublicationState(document, 'GET', '/plain')).toBe('published')
  })

  it('lets an override un-hide an operation but never un-exclude it', () => {
    const document = doc({ '/h': { get: { 'x-hidden': true, ...ok } }, '/e': { get: { 'x-excluded': true, ...ok } } })
    const overrides = { 'GET /h': { hidden: false }, 'GET /e': { hidden: false } }
    expect(operationPublicationState(document, 'GET', '/h', overrides)).toBe('published')
    expect(operationPublicationState(document, 'GET', '/e', overrides)).toBe('excluded')
    expect(operationPublicationState(doc({ '/p': { get: ok } }), 'GET', '/p', { 'GET /p': { hidden: true } })).toBe('hidden')
  })

  it('does not judge what it cannot see: typos, other methods, unreachable refs', () => {
    const document = doc({
      '/a': { get: { 'x-hidden': true, ...ok } },
      '/external': { $ref: 'other.yaml#/paths/~1x' },
      '/loop': { $ref: '#/paths/~1loop' },
    })
    expect(operationPublicationState(document, 'GET', '/typo')).toBe('unknown')
    expect(operationPublicationState(document, 'POST', '/a')).toBe('unknown')
    expect(operationPublicationState(document, 'FETCH', '/a')).toBe('unknown')
    expect(operationPublicationState(document, 'GET', '/external')).toBe('unknown')
    expect(operationPublicationState(document, 'GET', '/loop')).toBe('unknown')
    expect(operationPublicationState(null, 'GET', '/a')).toBe('unknown')
    expect(operationPublicationState({ openapi: '3.1.0' }, 'GET', '/a')).toBe('unknown')
  })

  it('agrees with the normalizer about which operations a page can resolve to', async () => {
    const { normalizeSpec } = await import('../normalize')
    const document = doc({
      '/v': { get: ok },
      '/h': { get: { 'x-hidden': true, ...ok } },
      '/e': { get: { 'x-excluded': true, ...ok } },
      '/r': { $ref: '#/components/pathItems/R', 'x-hidden': true },
    }, { components: { pathItems: { R: { get: ok } } } })
    const normalized = normalizeSpec({ config: { id: 'default', label: 'a', source: { type: 'inline', document } }, document } as never)
    for (const path of ['/v', '/h', '/e', '/r']) {
      const found = normalized.operations.find((operation) => operation.path === path)
      const state = operationPublicationState(document, 'GET', path)
      // The page route serves an operation only when it exists and is not hidden.
      expect(Boolean(found && !found.hidden)).toBe(state === 'published')
    }
  })

  it('judges a page reference with the docs route lookup, spec prefixes included', () => {
    const spec = (id: string, path: string, document?: unknown, operationOverrides?: Record<string, { hidden: boolean }>): RoutedSpec => ({
      config: { id, label: id, source: path.startsWith('http') ? { type: 'url', url: path } : { type: 'file', path }, operationOverrides },
      document,
    })
    const main = spec('default', 'openapi/main.json', doc({
      '/shared': { get: { 'x-hidden': true, ...ok } },
      '/only-main': { get: { 'x-excluded': true, ...ok } },
      '/public': { get: ok },
    }))
    const admin = spec('admin', 'openapi/admin.yaml', doc({
      '/shared': { get: ok },
      '/secret': { get: { 'x-hidden': true, ...ok } },
      '/by-override': { get: ok },
    }), { 'GET /by-override': { hidden: true } })
    const specs = [main, admin]
    const state = (raw: string, list = specs) => pageReferenceState(parseOpenApiFrontmatter(raw)!, list)

    // A prefix pins one spec, matched by path or file name, like the route.
    expect(state('openapi/admin.yaml GET /secret')).toBe('hidden')
    expect(state('admin.yaml GET /secret')).toBe('hidden')
    expect(state('"./openapi/admin.yaml" GET /secret')).toBe('hidden')
    expect(state('openapi/main.json GET /shared')).toBe('hidden')
    expect(state('openapi/admin.yaml GET /shared')).toBe('published')
    expect(state('admin.yaml GET /by-override')).toBe('hidden')
    // A bare reference renders from any spec that publishes it.
    expect(state('GET /shared')).toBe('published')
    expect(state('GET /secret')).toBe('hidden')
    expect(state('GET /only-main')).toBe('excluded')
    expect(state('GET /public')).toBe('published')
    // Never withheld: typos, unmatched prefixes, webhooks, and anything a remote spec might serve.
    expect(state('GET /typo')).toBe('unknown')
    expect(state('missing.yaml GET /secret')).toBe('unknown')
    expect(state('openapi/admin.yaml webhook secret')).toBe('unknown')
    const remote = spec('remote', 'https://example.com/spec.json')
    expect(state('GET /secret', [main, admin, remote])).toBe('unknown')
    expect(state('openapi/admin.yaml GET /secret', [main, admin, remote])).toBe('hidden')
    expect(state('https://example.com/spec.json GET /secret', [main, admin, remote])).toBe('unknown')
  })
})
