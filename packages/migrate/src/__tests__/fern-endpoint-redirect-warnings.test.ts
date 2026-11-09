/** Fern operation redirects that are capped or shared by two operations are reported, as the Mintlify ones are. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'

function migrateSpec(paths: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'thally-fern-redirect-warnings-'))
  const fernRoot = join(root, 'fern')
  mkdirSync(join(fernRoot, 'apis', 'api'), { recursive: true })
  writeFileSync(join(fernRoot, 'fern.config.json'), JSON.stringify({ organization: 'acme' }))
  writeFileSync(join(fernRoot, 'docs.yml'), 'navigation:\n  - tab: documentation\n    layout:\n      - page: Guide\n        path: guide.mdx\n  - tab: api-reference\n    layout:\n      - api: API reference\n        api-name: api\n        skip-slug: true\n')
  writeFileSync(join(fernRoot, 'guide.mdx'), '---\ntitle: Guide\n---\n\nBody.')
  writeFileSync(join(fernRoot, 'apis', 'api', 'generators.yml'), 'api:\n  specs:\n    - openapi: openapi.json\n')
  writeFileSync(join(fernRoot, 'apis', 'api', 'openapi.json'), JSON.stringify({ openapi: '3.0.0', info: { title: 'API', version: '1.0' }, paths }))
  const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
  return { bundle, messages: bundle.warnings.map((warning) => warning.message) }
}

const operation = (summary: string, tag = 'Things') => ({ get: { summary, tags: [tag], responses: { 200: { description: 'ok' } } } })

describe('Fern operation redirect warnings', () => {
  it('warns with the count and the URLs when the cap cuts operation redirects', () => {
    const paths = Object.fromEntries(Array.from({ length: 2_050 }, (_, index) => [`/op${index}`, operation(`Op ${index}`)]))
    const { bundle, messages } = migrateSpec(paths)
    const redirects = bundle.docsConfig.redirects?.filter((redirect) => redirect.source.startsWith('/api-reference/things/')) ?? []
    expect(redirects.length).toBeLessThanOrEqual(2_000)
    const warning = messages.find((message) => /Fern operation redirects/.test(message))
    expect(warning).toMatch(/^Created 2000 of 2050 Fern operation redirects; skipped 50 because a site is limited to 2000 generated endpoint redirects\./)
    expect(warning).toMatch(/\/api-reference\/things\/op-\d+/)
    expect(warning!.length).toBeLessThan(900)
  })

  it('warns when two operations share one Fern URL', () => {
    const { messages } = migrateSpec({ '/a': operation('Same'), '/b': operation('Same') })
    expect(messages.find((message) => /Fern operation URL/.test(message)))
      .toMatch(/^1 Fern operation URL is shared by more than one operation \(same tag and name\), so only the first operation is redirected from it: \/api-reference\/things\/same\.$/)
  })

  it('stays silent for distinct operations', () => {
    expect(migrateSpec({ '/a': operation('One'), '/b': operation('Two') }).messages.join('\n')).not.toMatch(/Fern operation/)
  })
})
