/** CLI and MCP lint must interpret the same authored docs.json routes. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { runCheck, type LintIssue } from '../../../create-thally-docs/src/check.js'
import { handleLintProject } from '../tools/lint-project.js'

const content = (title: string) => [
  '---',
  `title: ${title}`,
  `description: Complete documentation for ${title}.`,
  '---',
  '',
  'This authored page has enough content to satisfy both content checks.',
].join('\n')

describe('CLI and MCP navigation parity', () => {
  it('agrees on API, href, nested, hidden, and orphan MDX pages', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-nav-parity-'))
    const issues: Array<LintIssue> = []
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      mkdirSync(join(projectDir, 'src/content/api'), { recursive: true })
      mkdirSync(join(projectDir, 'src/content/guides'), { recursive: true })
      mkdirSync(join(projectDir, 'public'), { recursive: true })
      writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [
        { tab: 'Guides', pages: ['introduction', { group: 'Nested', pages: [
          'guides/install', { group: 'Hidden', hidden: true, pages: ['guides/private'] },
        ] }] },
        { tab: 'API', api: { source: '/openapi.yaml' }, groups: [{ group: 'Overview', pages: ['api/introduction'] }] },
        { tab: 'Changelog', href: '/changelog' },
        { tab: 'External', href: 'https://example.com/docs' },
      ] }))
      for (const [id, title] of [
        ['introduction', 'Introduction'],
        ['guides/install', 'Install'],
        ['guides/private', 'Private'],
        ['api/introduction', 'API introduction'],
        ['changelog', 'Changelog'],
        ['api/orphan', 'Orphan'],
      ]) {
        writeFileSync(join(projectDir, 'src/content', `${id}.mdx`), content(title))
      }
      writeFileSync(join(projectDir, 'public/openapi.yaml'), [
        'openapi: 3.0.0', 'info:', '  title: Example', '  version: 1.0.0', 'paths: {}',
      ].join('\n'))

      expect(await runCheck(projectDir, { fix: false, ci: true, onIssues: (found) => issues.push(...found) })).toBe(0)
      const mcp = await handleLintProject({ projectDir, fix: false })
      const navigationIssues = issues.filter((issue) => issue.message.includes('orphan') || issue.message.includes('docs.json but has no MDX'))
      expect(navigationIssues.map((issue) => issue.message)).toEqual(['"api/orphan" is not in docs.json nav (orphan)'])
      for (const issue of navigationIssues) expect(mcp).toContain(issue.message)
      for (const id of ['api/introduction', 'guides/install', 'guides/private', 'changelog']) {
        expect(mcp).not.toContain(`"${id}" is not in docs.json nav`)
      }
    } finally {
      log.mockRestore()
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
