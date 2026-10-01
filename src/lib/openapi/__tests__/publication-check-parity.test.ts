import { describe, expect, it } from 'vitest'
// Monorepo-only: `thally check` ships in packages/create-thally-docs, which the
// standalone starter does not have (see SOURCE_ONLY_PATHS in
// .github/scripts/starter-runtime-contract.mjs).
import { operationState, pageState, parseDocReference } from '../../../../packages/create-thally-docs/src/openapi-publication'
import { parseOpenApiFrontmatter } from '../page-frontmatter'
import { operationPublicationState, pageReferenceState, type RoutedSpec } from '../publication'

const ok = { responses: { 200: { description: 'ok' } } }
const doc = (paths: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  openapi: '3.1.0', info: { title: 't', version: '1' }, paths, ...extra,
})

describe('thally check publication parity', () => {
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
})

describe('thally check page-reference parity', () => {
  const docA = doc({ '/h': { get: { 'x-hidden': true, ...ok } }, '/moved': { get: { 'x-hidden': true, ...ok } }, '/v': { get: ok } })
  const docB = doc({ '/moved': { get: ok }, '/secret': { get: { 'x-excluded': true, ...ok } }, '/o': { get: ok } })
  const setups: Array<Array<{ source: string; document?: unknown; overrides?: Record<string, { hidden: boolean }> }>> = [
    [{ source: 'openapi/a.json', document: docA }, { source: 'openapi/b.yaml', document: docB, overrides: { 'GET /o': { hidden: true } } }],
    [{ source: '/specs/a.json', document: docA }, { source: 'https://example.com/b.yaml' }],
    [{ source: 'openapi/a.json' }, { source: 'openapi/b.yaml', document: docB }],
    [{ source: 'openapi/Orders.yaml', document: docA }, { source: 'openapi/orders.yaml', document: docB }],
    [{ source: 'https://example.com/V1/api.yaml', document: docB }],
    [],
  ]
  const references = [
    'GET /h', 'GET /moved', 'GET /v', 'GET /secret', 'GET /o', 'GET /typo', 'get   /h', 'FETCH /h', 'GET h', '',
    'openapi/a.json GET /h', 'a.json GET /h', '/openapi/a.json GET /v', './openapi/b.yaml GET /secret', "'b.yaml' GET /o",
    '"OpenAPI/B.YAML" GET /moved', 'specs/a.json GET /h', 'https://example.com/b.yaml GET /secret', 'other.yaml GET /h',
    'openapi/Orders.yaml GET /h', 'openapi/orders.yaml GET /secret', 'OPENAPI/ORDERS.YAML GET /h', 'orders.yaml GET /secret',
    'HTTPS://Example.COM/V1/api.yaml GET /secret', 'https://example.com/v1/API.yaml GET /secret',
    'webhook orderUpdated', 'b.yaml webhook orderUpdated', 'my spec.json GET /v',
    '__proto__ GET /v', 'constructor GET /v', 'openapi/../../b.yaml GET /o', '..\\b.yaml GET /o', '%2e%2e%2fb.yaml GET /o',
    'https://user@EXAMPLE.com./b.yaml GET /o', 'b.yaml?x#y GET /o', 'ORDERS.YAML GET /h', 'orders.yaml GET /v',
  ]

  it('parses `openapi:` frontmatter the same way', () => {
    for (const raw of [...references, 42, null, '   ', '"GET /h"']) {
      const site = parseOpenApiFrontmatter(raw)
      const check = parseDocReference(raw)
      expect(check, String(raw)).toEqual(site ? { ...(site.specRef ? { specRef: site.specRef } : {}), method: site.method, path: site.path, ...(site.webhook ? { webhook: true } : {}) } : null)
    }
  })

  it('withholds the same pages as the build', () => {
    for (const setup of setups) {
      const routed: Array<RoutedSpec> = setup.map((spec, index) => ({
        config: {
          id: index === 0 ? 'default' : `s${index}`,
          label: '',
          source: /^https?:/.test(spec.source) ? { type: 'url', url: spec.source } : { type: 'file', path: spec.source },
          operationOverrides: spec.overrides,
        },
        document: spec.document,
      }))
      for (const raw of references) {
        const site = parseOpenApiFrontmatter(raw)
        const check = parseDocReference(raw)
        if (!site || !check) continue
        expect(pageState(check, setup), `${raw} with ${setup.map((spec) => spec.source).join(', ')}`).toBe(pageReferenceState(site, routed))
      }
    }
  })

  it('judges a pin against its own case-distinct source in both implementations', () => {
    const setup = setups[3]
    const routed: Array<RoutedSpec> = setup.map((spec, index) => ({
      config: { id: `s${index}`, label: '', source: { type: 'file', path: spec.source } },
      document: spec.document,
    }))
    for (const [raw, expected] of [
      ['openapi/orders.yaml GET /secret', 'excluded'],
      ['openapi/Orders.yaml GET /h', 'hidden'],
      ['openapi/orders.yaml GET /h', 'unknown'],
    ] as const) {
      expect(pageState(parseDocReference(raw)!, setup), raw).toBe(expected)
      expect(pageReferenceState(parseOpenApiFrontmatter(raw)!, routed), raw).toBe(expected)
    }
  })
})
