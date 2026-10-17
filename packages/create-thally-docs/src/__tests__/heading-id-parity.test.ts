/** `thally check` must resolve exactly the heading ids the migrator keeps, and the ids the renderer and the content parser give a step title. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeMdx } from '@thallylabs/migrate'
import { describe, expect, it, vi } from 'vitest'

import { slugify } from '../../../core/src/slugify'
import { parseMdxContent } from '../../../core/src/content/parse'
import { rehypePlugins } from '../../../../src/mdx/rehype'
import { runCheck } from '../check.js'

async function brokenAnchorOutput(body: string, link: string): Promise<string> {
  const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-heading-ids-'))
  mkdirSync(join(projectDir, 'src/content'), { recursive: true })
  writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs', pages: ['introduction'] }] }))
  writeFileSync(
    join(projectDir, 'src/content/introduction.mdx'),
    `---\ntitle: Intro\ndescription: Introduction page.\n---\n\n${body}\n\nThis page has enough prose to avoid the short body notice. [Jump](#${link})`,
  )
  const output: Array<string> = []
  const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
  try {
    await runCheck(projectDir, { fix: false, ci: true })
  } finally {
    log.mockRestore()
  }
  return output.join('\n')
}

describe('heading id parity between the migrator and thally check', () => {
  it.each(['1-add-firecrawl', '123', '429-responses', 'v1.2', 'a:b', 'café', '入门', '_x'])('resolves a link to the kept id %s', async (id) => {
    const body = normalizeMdx(`## Section {#${id}}\n\nContent.`, 'mintlify')
    expect(body).toContain(`{/* #${id} */}`)
    expect(await brokenAnchorOutput(body, id)).not.toContain('Broken anchor')
  })

  it.each(['a b', 'a*/b'])('drops the rejected id %j so neither side resolves it', async (id) => {
    const body = normalizeMdx(`## Section {#${id}}\n\nContent.`, 'mintlify')
    expect(body).not.toContain('#a')
    expect(await brokenAnchorOutput(body, 'nope')).toContain('Broken anchor')
  })
})

describe('step title ids with character references', () => {
  /** Every `id` the renderer gives the compiled page, in document order. */
  async function renderedIds(source: string): Promise<Array<string>> {
    const { compile } = await import('@mdx-js/mdx')
    const compiled = String(await compile(source, { rehypePlugins: [rehypePlugins[2]] }))
    return [...compiled.matchAll(/\bid: "([^"]+)"/g)].map((match) => match[1])
  }

  it.each(['A &amp; B', 'A &#x26; B', 'A &#38; B', '&lt;tag&gt;', 'Caf&eacute;'])('gives the title %s one id in thally check, the renderer and the content parser', async (title) => {
    const source = `<Steps titleSize="h3">\n<Step title="${title}">\nBody.\n</Step>\n</Steps>`
    const [id] = await renderedIds(source)
    expect(parseMdxContent(source).headings.map((heading) => heading.id)).toEqual([id])
    expect(await brokenAnchorOutput(source, id)).not.toContain('Broken anchor')
    // The id the title would get from its source text, character references undecoded, is not an anchor.
    expect(await brokenAnchorOutput(source, slugify(title))).toContain('Broken anchor')
  })

  it('reads a titleSize written with a character reference as the renderer does', async () => {
    const source = '<Steps titleSize="h&#51;">\n<Step title="Deploy">\nBody.\n</Step>\n</Steps>'
    expect(await renderedIds(source)).toEqual(['deploy'])
    expect(await brokenAnchorOutput(source, 'deploy')).not.toContain('Broken anchor')
  })
})
