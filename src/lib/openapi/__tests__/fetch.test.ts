/** File-backed OpenAPI loading through embedded and managed content sources. */

import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTENT_MANIFEST_PATH,
  resetContentSourceForTests,
  setContentAssetFetcher,
} from '@/lib/content-source'
import { loadSpecDocument } from '@/lib/openapi/fetch'

const originalContentSource = process.env.THALLY_CONTENT_SOURCE
const originalContentBuild = process.env.THALLY_CONTENT_BUILD

beforeEach(() => {
  process.env.THALLY_CONTENT_SOURCE = 'assets'
  delete process.env.THALLY_CONTENT_BUILD
  resetContentSourceForTests()
  setContentAssetFetcher(null)
})

afterEach(() => {
  if (originalContentSource === undefined) delete process.env.THALLY_CONTENT_SOURCE
  else process.env.THALLY_CONTENT_SOURCE = originalContentSource
  if (originalContentBuild === undefined) delete process.env.THALLY_CONTENT_BUILD
  else process.env.THALLY_CONTENT_BUILD = originalContentBuild
  resetContentSourceForTests()
  setContentAssetFetcher(null)
})

describe('file-backed OpenAPI sources', () => {
  it('loads public specs from immutable managed assets', async () => {
    const projectPath = 'public/reference/openapi.yaml'
    const spec = [
      'openapi: 3.1.0',
      'info:',
      '  title: Managed API',
      '  version: "1"',
      'paths: {}',
      '',
    ].join('\n')
    setContentAssetFetcher(async (assetPath) => {
      if (assetPath === CONTENT_MANIFEST_PATH) {
        return Response.json({
          version: 1,
          files: { [projectPath]: { modifiedAtMs: 1 } },
        })
      }
      if (assetPath === '/_thally/content/public/reference/openapi.yaml') {
        return new Response(spec)
      }
      return new Response('not found', { status: 404 })
    })

    const document = await loadSpecDocument({
      id: 'managed-assets-openapi-test',
      label: 'Managed API',
      source: { type: 'file', path: '/reference/openapi.yaml' },
    })

    expect(document.openapi).toBe('3.1.0')
    expect(document.info).toEqual({ title: 'Managed API', version: '1' })
  })

  it('reports the missing authored path instead of an embedded-map failure', async () => {
    setContentAssetFetcher(async (assetPath) =>
      assetPath === CONTENT_MANIFEST_PATH
        ? Response.json({ version: 1, files: {} })
        : new Response('not found', { status: 404 }),
    )

    await expect(
      loadSpecDocument({
        id: 'managed-assets-missing-openapi-test',
        label: 'Missing API',
        source: { type: 'file', path: '/missing.yaml' },
      }),
    ).rejects.toThrow('OpenAPI source file not found: public/missing.yaml')
  })

  it('reads authored specs directly during build before ASSETS exists', async () => {
    process.env.THALLY_CONTENT_BUILD = '1'
    const relativePath = `public/thally-build-openapi-${randomUUID()}.yaml`
    writeFileSync(
      relativePath,
      'openapi: 3.1.0\ninfo:\n  title: Build API\n  version: "1"\npaths: {}\n',
      'utf8',
    )
    try {
      const document = await loadSpecDocument({
        id: 'managed-assets-build-phase-openapi-test',
        label: 'Build API',
        source: { type: 'file', path: relativePath },
      })
      expect(document.info).toEqual({ title: 'Build API', version: '1' })
    } finally {
      rmSync(relativePath, { force: true })
    }
  })
})
