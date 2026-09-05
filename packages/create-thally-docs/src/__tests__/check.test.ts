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
