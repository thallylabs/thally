import { describe, expect, it } from 'vitest'
import { mdxToMarkdown } from '../to-markdown'

describe('mdxToMarkdown', () => {
  it('strips JSX wrappers but keeps their inner content', () => {
    const out = mdxToMarkdown('<Steps>\n\nFirst paragraph.\n\n</Steps>')
    expect(out).toContain('First paragraph.')
    expect(out).not.toMatch(/<\/?Steps/)
  })

  it('promotes title-bearing components to headings', () => {
    expect(mdxToMarkdown('<Step title="Create your project">\nbody\n</Step>')).toContain('#### Create your project')
    expect(mdxToMarkdown('<Card title="Quickstart" href="/quickstart">x</Card>')).toContain(
      '#### [Quickstart](/quickstart)',
    )
    expect(mdxToMarkdown("<Tab title='Node'>x</Tab>")).toContain('#### Node') // single quotes too
  })

  it('turns callouts into labelled blockquotes and API fields into list items', () => {
    expect(mdxToMarkdown('<Note>Be careful.</Note>')).toContain('> **Note:** Be careful.')
    expect(mdxToMarkdown('<ParamField path="limit" type="integer">Max rows</ParamField>')).toContain(
      '- **limit** (integer): Max rows',
    )
  })

  it('never rewrites JSX inside fenced code (component-doc pages stay intact)', () => {
    const src = 'Use a card:\n\n```mdx\n<Card title="X" href="/y">Body</Card>\n```\n\nDone.'
    const out = mdxToMarkdown(src)
    expect(out).toContain('```mdx\n<Card title="X" href="/y">Body</Card>\n```') // preserved verbatim
    expect(out).toContain('Done.')
  })

  it('never rewrites JSX inside inline code', () => {
    const out = mdxToMarkdown('The `<Note>` component renders a callout.')
    expect(out).toBe('The `<Note>` component renders a callout.')
  })

  it('leaves plain Markdown and lowercase HTML untouched', () => {
    const src = '# Title\n\nA list:\n\n- one\n- two\n\n<https://example.com> and <br/> stay.'
    expect(mdxToMarkdown(src)).toBe(src)
  })

  it('does not corrupt prose containing bare numbers (sentinel safety)', () => {
    const out = mdxToMarkdown('There are `3` steps and step 1 of 3 is easy.')
    expect(out).toContain('step 1 of 3 is easy')
    expect(out).toContain('`3`')
  })
})
