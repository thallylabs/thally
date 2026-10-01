/**
 * `spec_url` in the `/api/docs` JSON must name a URL that serves the spec the
 * page's operation actually resolves to. Only the default spec is published
 * (`/openapi.yaml`); other specs have no public route, so they get no URL.
 */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { parse as parseYaml } from 'yaml'

const { doc } = vi.hoisted(() => ({ doc: (title: string, paths: Array<string>) => ({
  openapi: '3.1.0',
  info: { title, version: '1' },
  paths: Object.fromEntries(paths.map((p) => [p, { get: { ...(p === '/hid' ? { 'x-hidden': true } : {}), responses: { 200: { description: 'ok' } } } }])),
  webhooks: title === 'Admin' ? { orderUpdated: { post: { responses: { 200: { description: 'ok' } } } } } : {},
}) }))

vi.mock('@/config/api-reference', () => ({
  apiReferenceConfig: {
    defaultSpecId: 'default',
    specs: [
      { id: 'default', label: 'API', source: { type: 'inline', document: doc('Default', ['/x', '/only-default', '/hid']) } },
      { id: 'admin', label: 'Admin', source: { type: 'inline', document: doc('Admin', ['/x', '/only-admin']) } },
      { id: 'remote', label: 'Remote', source: { type: 'inline', document: doc('Remote', ['/only-remote']) } },
    ],
  },
}))
vi.mock('@/lib/openapi/documentation-access', () => ({ resolveDocumentationAccessMode: async () => 'public' }))
vi.mock('@/lib/site-config', () => ({ resolveSiteConfig: async () => ({ name: 'Docs' }) }))

import { servedSpecPathForFrontmatter } from '@/data/api-reference'
import { parseOpenApiFrontmatter } from '@/lib/openapi/page-frontmatter'
import { docApiJson } from '@/lib/openapi/page-api'
import { GET as getYaml } from '@/app/openapi.yaml/route'

const pathFor = (value: string) => servedSpecPathForFrontmatter(parseOpenApiFrontmatter(value)!)

describe('spec_url names the spec the page resolves to', () => {
  it('a page on the default spec points at /openapi.yaml, which serves the default spec', async () => {
    const ref = parseOpenApiFrontmatter('GET /only-default')!
    const specUrl = await servedSpecPathForFrontmatter(ref)
    expect(docApiJson({ openapi: ref }, specUrl)).toEqual({ spec_url: '/openapi.yaml', operations: ['GET /only-default'] })
    const served = parseYaml(await (await getYaml(new NextRequest(`https://docs.example.com${specUrl}`))).text())
    expect(served.info.title).toBe('Default')
  })

  it('a bare ref present in both specs resolves to the default spec', async () => {
    expect(await pathFor('GET /x')).toBe('/openapi.yaml')
  })

  it('a page pinned to a non-default spec gets no spec_url rather than the default spec', async () => {
    const ref = parseOpenApiFrontmatter('admin GET /x')!
    expect(ref.specRef).toBeTruthy()
    expect(docApiJson({ openapi: ref }, await servedSpecPathForFrontmatter(ref))).toEqual({ operations: ['GET /x'] })
  })

  it('a bare ref that falls back to a later spec gets no spec_url', async () => {
    expect(await pathFor('GET /only-admin')).toBeUndefined()
    expect(await pathFor('GET /only-remote')).toBeUndefined()
  })

  it('webhook pages follow the same rule', async () => {
    expect(await pathFor('admin webhook orderUpdated')).toBeUndefined()
  })

  it('an operation no spec publishes gets no spec_url', async () => {
    expect(await pathFor('GET /missing')).toBeUndefined()
    expect(await pathFor('GET /hid')).toBeUndefined()
  })

  it('manual api pages never get one', () => {
    expect(docApiJson({ manualTarget: { method: 'GET', path: '/s' } })).toEqual({ operations: ['GET /s'] })
  })
})
