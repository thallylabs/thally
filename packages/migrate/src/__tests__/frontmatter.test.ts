/** The package's frontmatter parser must not be a code-execution sink. */

import { describe, expect, it } from 'vitest'

import { parseFrontmatter } from '../frontmatter.js'
import { parseMarkdownPage } from '../mdx.js'

describe('parseFrontmatter', () => {
  it('does not execute javascript frontmatter', () => {
    const marker = '__migrate_frontmatter_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    const parsed = parseFrontmatter(
      `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
    )

    expect(globals[marker]).toBeUndefined()
    expect(parsed.data.title).toBeUndefined()
  })

  it('still parses the documented yaml frontmatter', () => {
    const parsed = parseFrontmatter('---\ntitle: Hello\n---\n\nBody.')
    expect(parsed.data.title).toBe('Hello')
    expect(parsed.content.trim()).toBe('Body.')
  })

  it('salvages readable fields and reports an error instead of throwing on invalid yaml', () => {
    // A bare backtick is a reserved YAML indicator; this mirrors crewAI's
    // ragtool.mdx frontmatter that previously aborted the whole migration.
    const parsed = parseFrontmatter(
      '---\ntitle: RagTool\ndescription: `RagTool` is great\n---\n\nBody.',
    )
    expect(parsed.error).toBeDefined()
    expect(parsed.data.title).toBe('RagTool')
    expect(parsed.data.description).toBeUndefined()
    expect(parsed.content.trim()).toBe('Body.')
  })
})

describe('parseMarkdownPage', () => {
  it('does not execute javascript frontmatter in scraped pages', () => {
    const marker = '__migrate_page_frontmatter_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    parseMarkdownPage({
      id: 'scraped',
      raw: `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
      source: 'https://example.com/scraped',
    })

    expect(globals[marker]).toBeUndefined()
  })

  it('keeps the page and flags frontmatterError instead of aborting on invalid yaml', () => {
    const page = parseMarkdownPage({
      id: 'ragtool',
      raw: '---\ntitle: RagTool\ndescription: `RagTool` is great\n---\n\nBody text.',
      source: 'docs/ragtool.mdx',
    })

    expect(page).not.toBeNull()
    expect(page?.title).toBe('RagTool')
    expect(page?.frontmatterError).toBeDefined()
    expect(page?.description).toContain('Body text.')
  })
})
