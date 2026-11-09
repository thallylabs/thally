/** `headingAnchors` reads ATX headings without backtracking on a long run of blanks. */

import { describe, expect, it } from 'vitest'

import { headingAnchors } from '../repository.js'

describe('headingAnchors', () => {
  it('reads ATX headings, with and without closing hashes', () => {
    const anchors = headingAnchors('# One\n\n## Two ##\n\n### Three #  \n\n#### Four#\n\n####### Not\n\n#NoSpace\n\n## ##\n')
    expect([...anchors].sort()).toEqual(['four', 'one', 'three', 'two'])
  })

  it('keeps an explicit id', () => {
    expect(headingAnchors('## Batch {/* #batch-calling */}\n').has('batch-calling')).toBe(true)
  })

  it('finishes quickly on a heading followed by a long run of blanks', () => {
    const started = performance.now()
    headingAnchors(`# a${' '.repeat(20000)}b\n# c${' '.repeat(20000)}\n# d${'#'.repeat(20000)}x`)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
