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
