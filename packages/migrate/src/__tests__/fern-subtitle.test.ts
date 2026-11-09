/** Fern `subtitle`: lost link addresses are reported, block markers are escaped, emphasis is handled like a description. */

import { describe, expect, it } from 'vitest'

import { parseMarkdownPage } from '../mdx.js'

function page(subtitle: string, description?: string) {
  const warnings: Array<string> = []
  const front = `title: T\nsubtitle: ${JSON.stringify(subtitle)}\n${description ? `description: ${JSON.stringify(description)}\n` : ''}`
  const result = parseMarkdownPage({ id: 'guide/t', raw: `---\n${front}---\n\nBody.\n`, source: 't.mdx', platform: 'fern', warn: (message) => warnings.push(message) })!
  return { page: result, warnings }
}

describe('Fern subtitle', () => {
  it('warns when link addresses are dropped, in either placement', () => {
    const message = 'Page "guide/t": its subtitle had links, which Thally shows as plain text; only the link text was kept and the link addresses were dropped; add the links to the page body if you need them.'
    const asDescription = page('See [the guide](/guide) now')
    expect(asDescription.page.description).toBe('See the guide now')
    expect(asDescription.warnings).toEqual([message])
    const asBody = page('See [the guide](/guide) now', 'Meta')
    expect(asBody.page.body).toBe('See the guide now\n\nBody.')
    expect(asBody.warnings).toContain(message)
  })

  it('does not warn when there is no link', () => {
    expect(page('Lead line').warnings).toEqual([])
  })

  it('escapes a leading block marker when it opens the body', () => {
    expect(page('1. See the guide', 'Meta').page.body).toBe('1\\. See the guide\n\nBody.')
    expect(page('# Not a heading', 'Meta').page.body).toBe('\\# Not a heading\n\nBody.')
    expect(page('- not a list', 'Meta').page.body).toBe('\\- not a list\n\nBody.')
  })

  it('removes emphasis markers from a description subtitle at word boundaries only', () => {
    expect(page('Read *more* and a*b*c').page.description).toBe('Read more and a*b*c')
  })
})
