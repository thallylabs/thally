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
})
