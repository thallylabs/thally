/** MCP navigation tools must preserve and inspect Mintlify-style root nodes. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { handleLintProject } from '../tools/lint-project.js'
import { handleListPages } from '../tools/list-pages.js'

describe('MCP root navigation', () => {
  it('lists and lints interleaved root pages and groups', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-mcp-root-pages-'))
    mkdirSync(join(projectDir, 'src/content/guides'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{
        tab: 'Documentation',
        pages: ['introduction', { group: 'Guides', pages: ['guides/install'] }],
      }],
    }))
    writeFileSync(join(projectDir, 'src/content/introduction.mdx'), [
      '---',
      'title: Introduction',
      'description: Product introduction.',
      '---',
      '',
      'Welcome to the complete product documentation.',
    ].join('\n'))
    writeFileSync(join(projectDir, 'src/content/guides/install.mdx'), [
      '---',
      'title: Install',
      'description: Installation guide.',
      '---',
      '',
      'Install the product using this complete guide.',
    ].join('\n'))

    const pages = await handleListPages({ projectDir })
    expect(pages).toContain('introduction')
    expect(pages).toContain('Group: Guides')
    expect(pages).toContain('guides/install')

    const lint = await handleLintProject({ projectDir, fix: false })
    expect(lint).not.toContain('has no groups')
    expect(lint).not.toContain('orphan')
  })
})
