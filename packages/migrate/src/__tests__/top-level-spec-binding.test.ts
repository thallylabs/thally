/** A spec only page frontmatter names is rendered where those pages put it, not listed as a tab of its own. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'
import { hydrateRemoteApiSpecs } from '../remote-api.js'
import type { MigrationFetcher } from '../types.js'

const REMOTE = 'https://specs.example.com/openapi.json'
const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Example', version: '1' },
  paths: {
    '/v1/users': { get: { summary: 'List users', tags: ['Users'], responses: { 200: { description: 'OK' } } } },
    '/v1/teams': { get: { summary: 'List teams', tags: ['Teams'], responses: { 200: { description: 'OK' } } } },
  },
})
const fetcher: MigrationFetcher = async (url) => ({ finalUrl: url, body: spec, contentType: 'application/json' })

function site(files: Record<string, string>, api: unknown, navigation: unknown = { pages: ['home'] }) {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-spec-binding-'))
  const all = { 'docs.json': JSON.stringify({ $schema: 'https://mintlify.com/docs.json', name: 'Acme', api, navigation }), ...files }
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
}

const page = (openapi?: string) => `---\ntitle: Home\n${openapi ? `openapi: ${JSON.stringify(openapi)}\n` : ''}---\n\nBody.\n`
const apiTabs = (bundle: { docsConfig: { tabs: Array<{ tab: string; hidden?: boolean; api?: unknown }> } }) => bundle.docsConfig.tabs.filter((tab) => tab.api)

describe('a docs.json spec that only pages name', () => {
  it('binds a remote spec to a hidden tab and lists none of its operations', async () => {
    const bundle = await hydrateRemoteApiSpecs(site({ 'home.mdx': page('GET /v1/users') }, { openapi: REMOTE }), fetcher)
    expect(apiTabs(bundle)).toHaveLength(1)
    expect(apiTabs(bundle)[0]).toMatchObject({ hidden: true })
    expect(bundle.docsConfig.tabs.filter((tab) => !tab.hidden).map((tab) => tab.tab)).toEqual(['Documentation'])
  })

  it('binds a local spec to a hidden tab when the pages name it by its path', () => {
    const bundle = site({ 'home.mdx': page('openapi.json GET /v1/users'), 'openapi.json': spec }, { openapi: 'openapi.json' })
    expect(apiTabs(bundle)).toHaveLength(1)
    expect(apiTabs(bundle)[0]).toMatchObject({ hidden: true })
  })

  it('binds a local spec to a hidden tab when the site has no other spec and a page names an operation bare', () => {
    const bundle = site({ 'home.mdx': page('GET /v1/users'), 'openapi.json': spec }, { openapi: 'openapi.json' })
    expect(apiTabs(bundle)).toHaveLength(1)
    expect(apiTabs(bundle)[0]).toMatchObject({ hidden: true })
  })

  it('keeps the API tab when no page names an operation', async () => {
    const bundle = await hydrateRemoteApiSpecs(site({ 'home.mdx': page() }, { openapi: REMOTE }), fetcher)
    expect(apiTabs(bundle)).toHaveLength(1)
    expect(apiTabs(bundle)[0]).toMatchObject({ tab: 'API Reference' })
    expect(apiTabs(bundle)[0]).not.toHaveProperty('hidden')
  })

  it('keeps the API tab when docs.json navigation lists the spec itself', () => {
    const bundle = site(
      { 'home.mdx': page('GET /v1/users'), 'openapi.json': spec },
      { openapi: 'openapi.json' },
      { tabs: [{ tab: 'Guides', pages: ['home'] }, { tab: 'Reference', openapi: 'openapi.json' }] },
    )
    expect(apiTabs(bundle).some((tab) => !tab.hidden)).toBe(true)
  })
})

describe('two remote specs in one docs.json, only one of them named by a page', () => {
  const A = 'https://example.com/a.json'
  const B = 'https://example.com/b.json'
  const specWith = (path: string, tag: string) => JSON.stringify({
    openapi: '3.0.0',
    info: { title: tag, version: '1' },
    paths: { [path]: { get: { summary: `Get ${tag}`, tags: [tag], responses: { 200: { description: 'OK' } } } } },
  })
  const bodies: Record<string, string> = { [A]: specWith('/x', 'Alpha'), [B]: specWith('/users', 'Beta') }
  const twoSpecs: MigrationFetcher = async (url) => ({ finalUrl: url, body: bodies[url.toString()], contentType: 'application/json' })
  const bind = (order: Array<string>) => hydrateRemoteApiSpecs(site({ 'home.mdx': page(`${A} GET /x`) }, { openapi: order }), twoSpecs)

  for (const order of [[A, B], [B, A]]) {
    it(`keeps each spec in its own tab (${order.map((url) => url.slice(-6)).join(', ')})`, async () => {
      const bundle = await bind(order)
      const assetFor = (url: string) => bundle.assets.find((asset) => Buffer.from(asset.content).toString() === bodies[url])?.path
      const hidden = apiTabs(bundle).filter((tab) => tab.hidden)
      const listed = apiTabs(bundle).filter((tab) => !tab.hidden)
      expect(hidden.map((tab) => tab.tab)).toEqual([`OpenAPI: ${A}`])
      expect(hidden[0].api).toMatchObject({ source: assetFor(A) })
      expect(listed).toHaveLength(1)
      expect(listed[0].api).toMatchObject({ source: assetFor(B) })
      expect(listed[0].api).not.toHaveProperty('navigation')
      // Only when B's tab was already taken does A say it gets no endpoint list; B is never dropped or replaced.
      const warned = bundle.warnings.filter((warning) => warning.code === 'unsupported-config').map((warning) => warning.source)
      expect(warned).toEqual(order[0] === A ? [] : [A])
    })
  }

  it('keeps the first of two specs no page names and warns, rather than replacing its binding with the second', async () => {
    const bundle = await hydrateRemoteApiSpecs(site({ 'home.mdx': page() }, { openapi: [A, B] }), twoSpecs)
    const assetFor = (url: string) => bundle.assets.find((asset) => Buffer.from(asset.content).toString() === bodies[url])?.path
    expect(apiTabs(bundle)).toHaveLength(1)
    expect(apiTabs(bundle)[0].api).toMatchObject({ source: assetFor(A) })
    expect(bundle.warnings.some((warning) => warning.code === 'unsupported-config' && warning.source === B && warning.message.includes(`${B} was not added`))).toBe(true)
  })
})

describe('two local specs in one docs.json, only one of them named by a page', () => {
  const specWith = (path: string, tag: string) => JSON.stringify({
    openapi: '3.0.0',
    info: { title: tag, version: '1' },
    paths: { [path]: { get: { summary: `Get ${tag}`, tags: [tag], responses: { 200: { description: 'OK' } } } } },
  })
  for (const order of [['a.json', 'b.json'], ['b.json', 'a.json']]) {
    it(`keeps each spec in its own tab (${order.join(', ')})`, () => {
      const bundle = site(
        { 'home.mdx': page('a.json GET /x'), 'a.json': specWith('/x', 'Alpha'), 'b.json': specWith('/users', 'Beta') },
        { openapi: order },
      )
      expect(apiTabs(bundle).map((tab) => [tab.tab, tab.hidden === true, (tab.api as { source: string }).source])).toEqual(expect.arrayContaining([
        ['OpenAPI: a.json', true, 'openapi/a.json'],
        ['API Reference', false, 'openapi/b.json'],
      ]))
      expect(apiTabs(bundle)).toHaveLength(2)
      expect(bundle.warnings.some((warning) => warning.message.includes('was not added'))).toBe(false)
    })
  }
})
