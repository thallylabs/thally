/** Regression coverage for validating authored OpenAPI migration navigation. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { runCheck } from '../check.js'

describe('thally check OpenAPI migrations', () => {
  it('accepts authored API groups and operation-only MDX pages', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-openapi-'))
    mkdirSync(join(projectDir, 'src/content/api-reference/status'), { recursive: true })
    mkdirSync(join(projectDir, 'public'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{
        tab: 'API Reference',
        href: '/api-reference/status/get-status',
        api: { source: '/openapi.yaml', navigation: false },
        groups: [{ group: 'Status', pages: ['api-reference/status/get-status'] }],
      }],
    }))
    writeFileSync(join(projectDir, 'src/content/api-reference/status/get-status.mdx'), [
      '---',
      'title: Get status',
      'description: Returns the service status.',
      'openapi: GET /status',
      '---',
      '',
    ].join('\n'))
    writeFileSync(join(projectDir, 'public/openapi.yaml'), [
      'openapi: 3.0.0',
      'info:',
      '  title: Service API',
      '  version: 1.0.0',
      'paths:',
      '  /status:',
      '    get:',
      '      responses:',
      "        '200':",
      '          description: Available',
    ].join('\n'))
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))

    try {
      await expect(runCheck(projectDir, { fix: false, ci: true })).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }
    expect(output.join('\n')).not.toContain('orphan')
    expect(output.join('\n')).not.toContain('Very short body')
  })

  it('validates interleaved root pages and groups as authored navigation', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-root-pages-'))
    mkdirSync(join(projectDir, 'src/content/guides'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{
        tab: 'Documentation',
        pages: [
          'introduction',
          { group: 'Guides', pages: ['guides/install'] },
        ],
      }],
    }))
    writeFileSync(join(projectDir, 'src/content/introduction.mdx'), [
      '---',
      'title: Introduction',
      'description: Product documentation introduction.',
      '---',
      '',
      'Welcome to the product documentation and its complete setup guide.',
    ].join('\n'))
    writeFileSync(join(projectDir, 'src/content/guides/install.mdx'), [
      '---',
      'title: Install',
      'description: Install the product.',
      '---',
      '',
      'Install the product and verify that the generated project works.',
    ].join('\n'))
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))

    try {
      await expect(runCheck(projectDir, { fix: false, ci: true })).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }
    expect(output.join('\n')).not.toContain('has no groups')
    expect(output.join('\n')).not.toContain('orphan')
  })

  it('includes authored pages in API tabs while preserving real orphan warnings', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-mixed-api-'))
    mkdirSync(join(projectDir, 'src/content/api'), { recursive: true })
    mkdirSync(join(projectDir, 'public'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [
        { tab: 'Documentation', pages: ['introduction'] },
        {
          tab: 'API Reference',
          api: { source: '/openapi.yaml' },
          pages: ['api/introduction'],
          groups: [{
            group: 'API guides',
            pages: [
              'api/authentication',
              { group: 'Advanced', pages: ['api/tokens'] },
            ],
          }],
        },
      ],
    }))
    const page = (title: string) => [
      '---',
      `title: ${title}`,
      `description: Complete documentation for ${title}.`,
      '---',
      '',
      'This page contains enough authored documentation to satisfy body checks.',
    ].join('\n')
    writeFileSync(join(projectDir, 'src/content/introduction.mdx'), page('Introduction'))
    writeFileSync(join(projectDir, 'src/content/api/introduction.mdx'), page('API introduction'))
    writeFileSync(join(projectDir, 'src/content/api/authentication.mdx'), page('API authentication'))
    writeFileSync(join(projectDir, 'src/content/api/tokens.mdx'), page('API tokens'))
    writeFileSync(join(projectDir, 'src/content/api/unreferenced.mdx'), page('Unreferenced API guide'))
    writeFileSync(join(projectDir, 'public/openapi.yaml'), [
      'openapi: 3.0.0',
      'info:',
      '  title: Service API',
      '  version: 1.0.0',
      'paths: {}',
    ].join('\n'))
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))

    try {
      await expect(runCheck(projectDir, { fix: false, ci: true })).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }
    expect(output.join('\n')).not.toContain('"api/introduction" is not in docs.json nav')
    expect(output.join('\n')).not.toContain('"api/authentication" is not in docs.json nav')
    expect(output.join('\n')).not.toContain('"api/tokens" is not in docs.json nav')
    expect(output.join('\n')).toContain('"api/unreferenced" is not in docs.json nav (orphan)')
  })
})

describe('thally check hidden operations under public/', () => {
  const spec = (flag: string) => [
    'openapi: 3.0.0',
    'info:',
    '  title: T',
    '  version: 1.0.0',
    'paths:',
    '  /a:',
    '    get:',
    ...(flag ? [`      ${flag}`] : []),
    '      responses:',
    "        '200':",
    '          description: ok',
  ].join('\n')

  async function run(source: string, file: string, body: string, overrides?: unknown) {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-hidden-'))
    mkdirSync(join(projectDir, file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'API', api: { source, overrides } }] }))
    writeFileSync(join(projectDir, file), body)
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
    try {
      await runCheck(projectDir, { fix: false, ci: true })
    } finally {
      log.mockRestore()
    }
    return output.join('\n')
  }

  it('warns for a public/ spec with x-excluded, or an override-hidden op', async () => {
    expect(await run('/openapi.yaml', 'public/openapi.yaml', spec('x-excluded: true'))).toContain('lives under public/')
    expect(await run('/openapi.yaml', 'public/openapi.yaml', spec(''), { 'GET /a': { hidden: true } })).toContain('lives under public/')
  })

  it('stays quiet for a clean public/ spec or a project-root spec', async () => {
    expect(await run('/openapi.yaml', 'public/openapi.yaml', spec(''))).not.toContain('lives under public/')
    expect(await run('openapi/api.yaml', 'openapi/api.yaml', spec('x-excluded: true'))).not.toContain('lives under public/')
  })
})

describe('thally check stale specs under public/', () => {
  const doc = (paths: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ openapi: '3.1.0', info: { title: 'T', version: '1' }, paths, ...extra })
  const ok = { get: { responses: { 200: { description: 'ok' } } } }

  async function run(files: Record<string, string>, source = 'openapi/api.json') {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-stale-'))
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'API', api: { source } }] }))
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(join(projectDir, file.slice(0, file.lastIndexOf('/'))), { recursive: true })
      writeFileSync(join(projectDir, file), body)
    }
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
    try {
      await runCheck(projectDir, { fix: false, ci: true })
    } finally {
      log.mockRestore()
    }
    return output.join('\n')
  }

  it('warns about a leftover public/ spec even though docs.json points at the new file', async () => {
    const output = await run({
      'openapi/api.json': doc({ '/a': ok }),
      'public/openapi.json': doc({ '/a': { ...ok, get: { 'x-hidden': true, responses: {} } } }),
    })
    expect(output).toContain('public/openapi.json')
    expect(output).toContain('x-excluded/x-hidden')
    expect(output).toContain('does not remove old copies from public/')
  })

  it('says a leftover public/openapi.json answers /openapi.json instead of the filtered spec; other names do not', async () => {
    const flagged = doc({ '/a': { get: { 'x-hidden': true, responses: {} } } })
    const shadowed = await run({ 'openapi/api.json': doc({ '/a': ok }), 'public/openapi.json': flagged })
    expect(shadowed).toContain('in place of the filtered specification')
    const other = await run({ 'openapi/api.json': doc({ '/a': ok }), 'public/old.json': flagged })
    expect(other).toContain('public/old.json')
    expect(other).not.toContain('in place of the filtered specification')
    // Configured at /openapi.json itself: the validateOpenApi warning carries the same consequence.
    const configured = await run({ 'public/openapi.json': flagged }, '/openapi.json')
    expect(configured).toContain('in place of the filtered specification')
  })

  it('detects flags on a $ref sibling, a path item, a webhook and nested directories', async () => {
    for (const spec of [
      doc({ '/a': { $ref: '#/components/pathItems/X', 'x-hidden': true } }),
      doc({ '/a': { 'x-excluded': true, ...ok } }),
      doc({}, { webhooks: { h: { post: { 'x-excluded': 'true' } } } }),
    ]) {
      expect(await run({ 'openapi/api.json': doc({ '/a': ok }), 'public/deep/nested/spec.yaml': spec })).toContain('public/deep/nested/spec.yaml')
    }
  })

  it('warns about an unflagged leftover only when the configured spec lives elsewhere; ignores non-specs', async () => {
    const files = { 'openapi/api.json': doc({ '/a': ok }), 'public/old.json': doc({ '/a': ok }), 'public/manifest.json': '{"name":"x"}', 'public/data.yaml': 'a: 1' }
    const output = await run(files)
    expect(output).toContain('public/old.json')
    expect(output).toContain('an old copy')
    expect(output).not.toContain('manifest.json')
    expect(output).not.toContain('data.yaml')
    // No configured spec elsewhere and nothing hidden: a plain public spec is left alone.
    expect(await run({ 'public/old.json': doc({ '/a': ok }) }, 'https://example.com/spec.json')).not.toContain('public/old.json')
  })

  it('does not double-report the configured public/ spec and never errors', async () => {
    const output = await run({ 'public/openapi.json': doc({ '/a': { 'x-excluded': true, ...ok } }) }, '/openapi.json')
    expect(output.match(/public\/openapi\.json|lives under public\//g)?.length).toBe(1)
    expect(output).toContain('0 error(s)')
  })
})

describe('thally check image references', () => {
  it('warns about a local image with no file under public/, and accepts one that exists', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-images-'))
    mkdirSync(join(projectDir, 'src/content'), { recursive: true })
    mkdirSync(join(projectDir, 'public/images'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{ tab: 'Guides', groups: [{ group: 'Start', pages: ['introduction'] }] }],
    }))
    writeFileSync(join(projectDir, 'public/images/present.png'), 'image')
    writeFileSync(join(projectDir, 'src/content/introduction.mdx'), [
      '---',
      'title: Introduction',
      'description: Overview page.',
      '---',
      '',
      '![Present](/images/present.png)',
      '',
      '![Missing](/images/missing.png)',
      '',
      '<img src="/images/also-missing.png" />',
    ].join('\n'))
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))

    try {
      // A missing local image is a warning, not an error: next build still
      // succeeds with a broken <img>, unlike a broken internal link (404).
      await expect(runCheck(projectDir, { fix: false, ci: true })).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }
    const text = output.join('\n')
    expect(text).not.toContain('/images/present.png')
    expect(text).toContain('Image not found: "/images/missing.png"')
    expect(text).toContain('Image not found: "/images/also-missing.png"')
  })
})

describe('thally check pages bound to unpublished operations', () => {
  const ok = { responses: { 200: { description: 'ok' } } }
  async function run(pages: Record<string, string>, overrides?: Record<string, unknown>, source = 'openapi/api.json') {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-unpublished-'))
    mkdirSync(join(projectDir, 'openapi'), { recursive: true })
    mkdirSync(join(projectDir, 'src/content'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'API', groups: [{ group: 'G', pages: Object.keys(pages) }], api: { source, ...(overrides ? { overrides } : {}) } }] }))
    writeFileSync(join(projectDir, 'openapi/api.json'), JSON.stringify({
      openapi: '3.1.0', info: { title: 'T', version: '1' },
      paths: {
        '/hidden': { get: { 'x-hidden': true, ...ok } },
        '/excluded': { $ref: '#/components/pathItems/E' },
        '/visible': { get: ok },
      },
      components: { pathItems: { E: { 'x-excluded': true, get: ok } } },
    }))
    for (const [id, operation] of Object.entries(pages)) {
      writeFileSync(join(projectDir, `src/content/${id}.mdx`), `---\ntitle: ${id}\ndescription: d\nopenapi: "${operation}"\n---\n`)
    }
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
    try {
      await runCheck(projectDir, { fix: false, ci: true })
    } finally {
      log.mockRestore()
    }
    return output.join('\n')
  }

  it('warns for each page whose operation is hidden or excluded, naming the page and operation', async () => {
    const output = await run({ 'hidden-endpoint': 'GET /hidden', 'excluded-endpoint': 'GET /excluded', 'visible-endpoint': 'GET /visible', 'typo-endpoint': 'GET /typo' })
    expect(output).toContain('page src/content/hidden-endpoint.mdx points at hidden operation GET /hidden and is not published')
    expect(output).toContain('page src/content/excluded-endpoint.mdx points at excluded operation GET /excluded and is not published')
    expect(output).not.toContain('visible-endpoint.mdx points')
    expect(output).not.toContain('typo-endpoint.mdx points')
    expect(output).toContain('0 error(s)')
  })

  it('honours docs.json overrides and does not judge a remote spec', async () => {
    expect(await run({ 'hidden-endpoint': 'GET /hidden' }, { 'GET /hidden': { hidden: false } })).not.toContain('is not published')
    expect(await run({ 'hidden-endpoint': 'GET /hidden' }, undefined, 'https://example.com/spec.json')).not.toContain('is not published')
  })
})
