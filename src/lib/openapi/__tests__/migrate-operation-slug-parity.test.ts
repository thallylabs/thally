/**
 * Monorepo-only contract test: the migration link rewrite must name the same
 * API routes as the runtime renderer. This stays out of standalone starters,
 * which do not contain the migration package source.
 */
import { describe, expect, it } from 'vitest'
import { thallyOperationSlugSegments } from '../../../../packages/migrate/src/repository'
import { normalizeSpec } from '@/lib/openapi/normalize'
import type { ApiSpecConfig, ResolvedSpec } from '@/lib/openapi/types'

describe('migrate operation slug parity', () => {
  it('builds the same route segments as the migration package for a link rewrite', () => {
    const paths = ['/', '/plants', '/plants/{id}/water', '/v1/Élan_x.y/{a}-{b}']
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Slugs', version: '1.0.0' },
      paths: Object.fromEntries(paths.map((path) => [path, { post: { responses: { '200': { description: 'ok' } } } }])),
    }
    const config: ApiSpecConfig = {
      id: 'test',
      label: 'Test API',
      source: { type: 'inline', document: doc },
    }
    const normalized = normalizeSpec({ config, document: doc } as ResolvedSpec)
    for (const path of paths) {
      const operation = normalized.operations.find((entry) => entry.path === path)
      expect(operation?.slug).toEqual(thallyOperationSlugSegments(path, 'post'))
    }
  })
})
