/** A page made of one component, or a custom-mode page, is not empty just because its source is short. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { handleLintProject } from '../tools/lint-project.js'

async function lint(pages: Record<string, string>): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), 'thally-mcp-short-'))
  mkdirSync(join(projectDir, 'src/content'), { recursive: true })
  writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs', pages: Object.keys(pages) }] }))
  for (const [id, source] of Object.entries(pages)) writeFileSync(join(projectDir, 'src/content', `${id}.mdx`), source)
  const result = await handleLintProject({ projectDir, fix: false })
  return JSON.stringify(result)
}

const front = (extra = '') => `---\ntitle: Page\ndescription: A page.\n${extra}---\n\n`

describe('Very short body', () => {
  it('is not reported for a custom-mode page or a page that is only a component tag', async () => {
    const output = await lint({
      a: `${front('mode: custom\n')}<Landing />\n`,
      b: `${front()}<Landing />\n`,
      c: `${front()}<Landing items={[1, 2]}>\n</Landing>\n`,
    })
    expect(output).not.toContain('Very short body')
  })

  it('is still reported for a short page of plain text', async () => {
    expect(await lint({ a: `${front()}Hi.\n` })).toContain('Very short body')
    expect(await lint({ a: `${front()}Hi <Tag />\n` })).toContain('Very short body')
  })
})
