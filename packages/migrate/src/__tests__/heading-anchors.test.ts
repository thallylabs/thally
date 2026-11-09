/** `pageAnchors` reads a page's ids and headings in one pass per line, whatever a line holds. */

import { describe, expect, it } from 'vitest'

import { pageAnchors } from '../repository.js'

describe('pageAnchors', () => {
  it('serves heading slugs and explicit ids outside code, and finds the heading a source fragment names', () => {
    const anchors = pageAnchors('## Batch {/* #batch-calling */}\n\n### The `set_primary` Method ##\n\n```md\n## Not A Heading\n```\n\n| Name | Type |\n| --- | --- |\n| `max_retries` | int |\n')
    expect(anchors.existing.has('batch-calling')).toBe(true)
    expect(anchors.existing.has('the-set-primary-method')).toBe(true)
    expect(anchors.existing.has('not-a-heading')).toBe(false)
    expect(anchors.target('the-set_primary-method', false)).toEqual({ index: 2, kind: 'heading' })
    expect(anchors.target('max_retries', false)).toEqual({ index: 10, kind: 'table' })
    expect(anchors.target('not-a-heading', false)).toBeUndefined()
  })

  it('reads ATX headings as the Markdown parser does, and no id inside a comment', () => {
    const anchors = pageAnchors('## Crlf Line\r\n#NoSpace\n####### Seven\n## C#\n## Closed ##\n{/* <div id="commented"></div> */}\n<div id="real"></div>\n')
    expect([...anchors.existing].sort()).toEqual(['c', 'closed', 'crlf-line', 'real'])
  })

  it.each([
    ['a long run of blanks or closing hashes', `# a${' '.repeat(20000)}b\n# c${' '.repeat(20000)}\n# d${'#'.repeat(20000)}x`],
    ['repeated id comment openers', `# ${'{/*#'.repeat(20000)}`],
    ['a table cell with a long run of blanks', `| a${' '.repeat(20000)}b`],
  ])('finishes quickly on %s', (_name, body) => {
    const started = performance.now()
    pageAnchors(body)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
