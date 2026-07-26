/**
 * Interpreter tests: the eval-free MDX renderer must produce the same
 * observable output as the compiled path for documentation-shaped content —
 * component resolution, literal attribute expressions, Shiki-highlighted
 * fences, frontmatter — while degrading dynamic expressions to nothing
 * instead of crashing (Workers forbid code generation, so there is no
 * compiled fallback at request time).
 */

import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { interpretMDX } from '@/lib/mdx-interpret'

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(function Wrapper() {
    return node
  }))
}

const Note: ComponentType<Record<string, unknown>> = ({ title, children }) =>
  createElement('aside', { 'data-note': true, 'data-title': title as string }, children as ReactNode)

const Steps: ComponentType<Record<string, unknown>> = ({ children }) =>
  createElement('ol', { 'data-steps': true }, children as ReactNode)

describe('interpretMDX', () => {
  it('renders markdown through the standard pipeline', async () => {
    const { content } = await interpretMDX({
      source: '# Hello\n\nSome **bold** text.',
      components: {},
    })
    const html = render(content)
    expect(html).toContain('Hello')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('resolves capitalized JSX tags through the components map', async () => {
    // Regression: hast-util-to-jsx-runtime routes capitalized names through
    // the evaluater as estree Identifiers, never through its `components`
    // option. Without identifier resolution every custom component rendered
    // as `undefined` and the page 500ed.
    const { content } = await interpretMDX({
      source: '<Note title="Heads up">Careful now.</Note>',
      components: { Note },
    })
    const html = render(content)
    expect(html).toContain('data-note')
    expect(html).toContain('data-title="Heads up"')
    expect(html).toContain('Careful now.')
  })

  it('resolves member-expression component names', async () => {
    const Group = Object.assign(Steps, { Item: Note })
    const { content } = await interpretMDX({
      source: '<Group.Item title="nested">inner</Group.Item>',
      components: { Group },
    })
    expect(render(content)).toContain('data-title="nested"')
  })

  it('evaluates literal attribute expressions statically', async () => {
    const Probe: ComponentType<Record<string, unknown>> = (props) =>
      createElement('div', { 'data-cols': String(props.cols), 'data-flag': String(props.flag) })
    const { content } = await interpretMDX({
      source: '<Probe cols={2} flag={!false} />',
      components: { Probe },
    })
    const html = render(content)
    expect(html).toContain('data-cols="2"')
    expect(html).toContain('data-flag="true"')
  })

  it('renders dynamic expressions as nothing instead of failing the page', async () => {
    const { content } = await interpretMDX({
      source: 'Before {process.env.SECRET} after.',
      components: {},
    })
    const html = render(content)
    expect(html).toContain('Before')
    expect(html).toContain('after.')
    expect(html).not.toContain('SECRET')
  })

  it('parses frontmatter when asked and strips it from output', async () => {
    const { content, frontmatter } = await interpretMDX({
      source: '---\ntitle: My Page\n---\n\nBody text.',
      components: {},
      parseFrontmatter: true,
    })
    expect(frontmatter.title).toBe('My Page')
    const html = render(content)
    expect(html).toContain('Body text.')
    expect(html).not.toContain('My Page')
  })

  it('highlights code fences with Shiki css-variable tokens', async () => {
    const { content } = await interpretMDX({
      source: '```ts\nconst x = 1\n```',
      components: {},
    })
    expect(render(content)).toContain('--shiki')
  })

  it('ignores leftover export statements without throwing', async () => {
    const { content } = await interpretMDX({
      source: 'export const meta = { a: 1 }\n\nStill renders.',
      components: {},
    })
    expect(render(content)).toContain('Still renders.')
  })
})
