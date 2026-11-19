import { describe, expect, it } from 'vitest'

import { markdownMirrorCandidates, renderMarkdownMirror } from './markdown-mirror'

const ORIGIN = 'https://docs.example.com'

describe('renderMarkdownMirror', () => {
  it('keeps only title and description in the public frontmatter', () => {
    const raw = `---
title: Quickstart
navTitle: CLI setup
description: Publish your first documentation site.
keywords:
  - deploy
mode: home
url: https://docs.thally.io/quickstart
lastUpdated: 2026-01-01
lastVerified: 2026-01-02
verifiedVersion: 1.0
---
Body text.
`

    const output = renderMarkdownMirror(raw, ORIGIN)

    expect(output).toContain('title: Quickstart')
    expect(output).toContain('description: Publish your first documentation site.')
    expect(output).toContain(
      '> For the full documentation index, see [llms.txt](https://docs.example.com/llms.txt).',
    )
    expect(output.startsWith('---\n')).toBe(true)
    expect(output.indexOf('> For the full documentation index')).toBeGreaterThan(
      output.indexOf('description:'),
    )
    expect(output.indexOf('> For the full documentation index')).toBeLessThan(
      output.indexOf('Body text.'),
    )
    expect(output).toContain('Body text.')
    expect(output).not.toContain('navTitle')
    expect(output).not.toContain('keywords')
    expect(output).not.toContain('mode:')
    expect(output).not.toContain('url:')
    expect(output).not.toContain('lastUpdated')
    expect(output).not.toContain('lastVerified')
    expect(output).not.toContain('verifiedVersion')
  })

  it('quotes a value only when YAML needs it', () => {
    const raw = `---
title: "API: Overview"
description: "Use the API."
---
Body.
`

    const output = renderMarkdownMirror(raw, ORIGIN)

    expect(output).toContain('title: "API: Overview"')
    expect(output).toContain('description: Use the API.')
  })

  it('converts MDX components in the body', () => {
    const raw = `---
title: Card
description: Cards.
---
<Card title="Quickstart" href="/quickstart" />
`

    const output = renderMarkdownMirror(raw, ORIGIN)

    expect(output).toContain('#### [Quickstart](/quickstart)')
  })

  it('falls back to the body when frontmatter is malformed', () => {
    const raw = `---
title: [unclosed
---
Body.
`

    expect(() => renderMarkdownMirror(raw, ORIGIN)).not.toThrow()
    expect(renderMarkdownMirror(raw, ORIGIN)).toContain('Body.')
    expect(renderMarkdownMirror(raw, ORIGIN)).toContain(
      '> For the full documentation index, see [llms.txt](https://docs.example.com/llms.txt).',
    )
  })
})

describe('markdownMirrorCandidates', () => {
  it('returns the same lookup order for a page and its index form', () => {
    expect(markdownMirrorCandidates('quickstart')).toEqual([
      'src/content/quickstart.mdx',
      'src/content/quickstart.md',
      'src/content/quickstart/index.mdx',
    ])
  })

  it('supports a locale prefix', () => {
    expect(markdownMirrorCandidates('fr/quickstart')).toEqual([
      'src/content/fr/quickstart.mdx',
      'src/content/fr/quickstart.md',
      'src/content/fr/quickstart/index.mdx',
    ])
  })

  it('rejects traversal and empty identifiers', () => {
    expect(markdownMirrorCandidates('../secret')).toEqual([])
    expect(markdownMirrorCandidates('guides/../../secret')).toEqual([])
    expect(markdownMirrorCandidates('')).toEqual([])
  })
})
