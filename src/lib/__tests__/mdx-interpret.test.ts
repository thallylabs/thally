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

  it('evaluates expression-free template literals in component children', async () => {
    const Probe: ComponentType<Record<string, unknown>> = ({ children }) =>
      createElement('div', { 'data-definition': children as string })
    const { content } = await interpretMDX({
      source: '<Probe>{`flowchart LR\nA --> B`}</Probe>',
      components: { Probe },
    })

    expect(render(content)).toContain('data-definition="flowchart LR\nA --&gt; B"')
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

  it('renders unsupported code fences as plaintext without failing the page', async () => {
    const { content } = await interpretMDX({
      source: '```brainfuck\n++[>++<-]\n```',
      components: {},
    })
    expect(render(content)).toContain('++[&gt;++&lt;-]')
  })

  it.each(['java', 'graphql', 'ruby', 'php', 'csharp', 'vue'])(
    'highlights the supported %s grammar',
    async (language) => {
      const { content } = await interpretMDX({
        source: `\`\`\`${language}\nconst greeting = "hello"\n\`\`\``,
        components: {},
      })
      expect(render(content)).toContain('--shiki')
    },
  )

  it('ignores leftover export statements without throwing', async () => {
    const { content } = await interpretMDX({
      source: 'export const meta = { a: 1 }\n\nStill renders.',
      components: {},
    })
    expect(render(content)).toContain('Still renders.')
  })

  it('renders MDX comments as nothing', async () => {
    // Regression: an expression-free `{/* … */}` parses to an empty estree
    // Program, and hast-util-to-jsx-runtime reads body[0].type unguarded.
    const { content } = await interpretMDX({
      source: '{/* a note to editors */}\n\nVisible text.\n\nInline {/* here */} too.',
      components: {},
    })
    const html = render(content)
    expect(html).toContain('Visible text.')
    expect(html).toContain('too.')
    expect(html).not.toContain('note to editors')
  })

  it('refuses inherited property lookups on components', async () => {
    // `<Note.constructor/>` would otherwise resolve to Function, which React
    // calls with an attacker-influenced string — code generation by proxy.
    const { content } = await interpretMDX({
      source: '<Note.constructor />\n\nAfter.',
      components: { Note },
    })
    const html = render(content)
    expect(html).toContain('After.')
    expect(html).not.toContain('function')
  })

  it('refuses inherited identifier lookups', async () => {
    const { content } = await interpretMDX({
      source: 'Value {constructor} here.',
      components: {},
    })
    expect(render(content)).toContain('Value')
  })

  it('does not execute javascript frontmatter', async () => {
    const marker = '__interpreter_frontmatter_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]
    const { frontmatter } = await interpretMDX({
      source: `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
      components: {},
      parseFrontmatter: true,
    })
    expect(globals[marker]).toBeUndefined()
    expect(frontmatter.title).not.toBe('Hi')
  })

  it('returns a fresh frontmatter object per call', async () => {
    const source = '---\ntitle: Shared\n---\n\nBody.'
    const first = await interpretMDX({ source, components: {}, parseFrontmatter: true })
    first.frontmatter.title = 'Mutated'
    const second = await interpretMDX({ source, components: {}, parseFrontmatter: true })
    expect(second.frontmatter.title).toBe('Shared')
  })

  it('degrades computed object keys instead of fabricating props', async () => {
    const Probe: ComponentType<Record<string, unknown>> = (props) =>
      createElement('div', { 'data-value': JSON.stringify(props.data ?? null) })
    const { content } = await interpretMDX({
      source: '<Probe data={{[someName]: 1}} />',
      components: { Probe },
    })
    expect(render(content)).not.toContain('someName')
  })

  it('renders object expressions in child position as nothing', async () => {
    const { content } = await interpretMDX({
      source: 'Before {{ a: 1 }} after.',
      components: {},
    })
    const html = render(content)
    expect(html).toContain('Before')
    expect(html).toContain('after.')
  })

  it('renders unknown components as their children instead of failing', async () => {
    const { content } = await interpretMDX({
      source: '<Nope>inner text</Nope>',
      components: {},
    })
    expect(render(content)).toContain('inner text')
  })

  it('drops HTML-style string style attributes', async () => {
    const { content } = await interpretMDX({
      source: '<div style="color:red">styled</div>',
      components: {},
    })
    expect(render(content)).toContain('styled')
  })
})
