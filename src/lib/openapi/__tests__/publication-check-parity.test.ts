import { describe, expect, it } from 'vitest'
// Monorepo-only: `thally check` ships in packages/create-thally-docs, which the
// standalone starter does not have (see SOURCE_ONLY_PATHS in
// .github/scripts/starter-runtime-contract.mjs).
import { operationState } from '../../../../packages/create-thally-docs/src/openapi-publication'
import { operationPublicationState } from '../publication'

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
