import { describe, expect, it } from 'vitest'
import { operationState } from '../../../../packages/create-thally-docs/src/openapi-publication'
import { listUnpublishedOperations, operationPublicationState } from '../publication'

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

  it('gives `thally check` the same verdicts as the site', () => {
    const document = doc({
      '/a': { get: { 'x-hidden': true, ...ok }, post: { 'x-excluded': 'true', ...ok }, put: ok },
      '/entry': { 'x-excluded': true, get: ok },
      '/ref': { $ref: '#/components/pathItems/Flagged' },
      '/sibling': { $ref: '#/components/pathItems/Plain', 'x-hidden': true },
      '/chain': { $ref: '#/components/pathItems/Alias' },
      '/enc': { $ref: '#/components/pathItems/A%20B' },
      '/external': { $ref: 'other.yaml#/paths/~1x' },
      '/loop': { $ref: '#/paths/~1loop' },
    }, { components: { pathItems: {
      Flagged: { 'x-hidden': true, get: ok },
      Plain: { get: ok },
      Alias: { $ref: '#/components/pathItems/Flagged' },
      'A B': { 'x-excluded': true, get: ok },
    } } })
    const overrides = { 'GET /a': { hidden: false }, 'PUT /a': { hidden: true } }
    for (const path of ['/a', '/entry', '/ref', '/sibling', '/chain', '/enc', '/external', '/loop', '/missing']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        for (const withOverrides of [undefined, overrides]) {
          expect(operationState(document, method, path, withOverrides), `${method} ${path}`)
            .toBe(operationPublicationState(document, method, path, withOverrides))
        }
      }
    }
  })

  it('lists every hidden or excluded operation, as the build records them', () => {
    const document = doc({
      '/a': { get: { 'x-hidden': true, ...ok }, post: ok },
      '/e': { $ref: '#/components/pathItems/E' },
      '/o': { get: ok },
    }, { components: { pathItems: { E: { 'x-excluded': true, put: ok } } } })
    expect(listUnpublishedOperations(document, { 'GET /o': { hidden: true } })).toEqual([
      { method: 'GET', path: '/a', state: 'hidden' },
      { method: 'PUT', path: '/e', state: 'excluded' },
      { method: 'GET', path: '/o', state: 'hidden' },
    ])
  })
})
