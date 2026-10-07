/**
 * `<Update>` changelog entries are extracted by the same parse that builds the
 * rest of the content graph, and the Markdown projection keeps their labels.
 */

import { describe, expect, it } from 'vitest'
import { parseMdxContent } from '../parse'
import { mdxToMarkdown } from '../to-markdown'
import { updateAnchorId } from '../../slugify'

const changelog = `Intro prose.

<Update label="Live branding" date="2026-06-20" description="Recolor without a redeploy." tags={["branding", "admin"]}>
  - **Accent picker** — recolor the live site.
  - Per-mode logos.

  See [Branding](/guides/branding).
</Update>

<Update label="v0.1.0" date="2025-01-01" tags="release, initial">

Initial release.

<Visibility for="humans">Human-only teaser.</Visibility>
<Agent>Agent-only detail.</Agent>

</Update>

<Update label="リリース" date="2026-02-01" id="custom-id">
本文
</Update>

<Update label="日本語" date="2026-03-01" tags={[someVariable, "kept"]}>
x
</Update>
`

describe('Update extraction', () => {
  const { updates = [] } = parseMdxContent(changelog, 'agents')

  it('extracts every entry in source order with props', () => {
    expect(updates.map((update) => update.label)).toEqual(['Live branding', 'v0.1.0', 'リリース', '日本語'])
    expect(updates[0]).toMatchObject({
      id: 'live-branding',
      date: '2026-06-20',
      description: 'Recolor without a redeploy.',
      tags: ['branding', 'admin'],
    })
    expect(updates[1].tags).toEqual(['release', 'initial'])
  })

  it('dedents the body so indented lists stay top-level Markdown', () => {
    expect(updates[0].markdown).toContain('- **Accent picker** — recolor the live site.\n- Per-mode logos.')
    expect(updates[0].markdown).toContain('[Branding](/guides/branding)')
  })

  it('applies the agent audience projection to entry bodies', () => {
    expect(updates[1].markdown).toContain('Agent-only detail.')
    expect(updates[1].markdown).not.toContain('Human-only teaser')
    expect(updates[1].text).not.toContain('Human-only teaser')
  })

  it('uses explicit ids, then label, then date for anchors', () => {
    expect(updates[2].id).toBe('custom-id')
    expect(updates[3].id).toBe('2026-03-01')
  })

  it('reads only literal strings from tag expressions, never evaluating them', () => {
    expect(updates[3].tags).toEqual(['kept'])
  })

  it('keeps entry prose in page text for search', () => {
    expect(parseMdxContent(changelog, 'agents').text).toContain('Accent picker')
  })
})

describe('updateAnchorId', () => {
  it('keeps the historical ASCII normalization of labels', () => {
    expect(updateAnchorId({ label: 'Component parity!' })).toBe('component-parity')
    expect(updateAnchorId({ label: 'v0.1.0' })).toBe('v0-1-0')
  })

  it('is undefined when nothing usable remains', () => {
    expect(updateAnchorId({ label: '日本語' })).toBeUndefined()
  })
})

describe('Update Markdown projection', () => {
  it('promotes label and date to a heading', () => {
    const markdown = mdxToMarkdown('<Update label="v2" date="2026-01-01" description="Big one.">\n\n- Item\n\n</Update>')
    expect(markdown).toBe('### v2 — 2026-01-01\n\nBig one.\n\n- Item')
  })
})
