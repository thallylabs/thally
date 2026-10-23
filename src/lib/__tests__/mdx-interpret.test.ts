/**
 * Interpreter tests: the eval-free MDX renderer must produce the same
 * observable output as the compiled path for documentation-shaped content —
 * component resolution, literal attribute expressions, Shiki-highlighted
 * fences, frontmatter — while degrading dynamic expressions to nothing
 * instead of crashing (Workers forbid code generation, so there is no
 * compiled fallback at request time).
 */

import { Children, cloneElement, createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { interpretMDX } from '@/lib/mdx-interpret'
import { Code, Pre } from '@/components/mdx/code-blocks'

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

  it('keeps string expression attributes used by imported file trees', async () => {
    const Folder: ComponentType<Record<string, unknown>> = ({ name }) =>
      createElement('div', { 'data-name': name as string })
    const { content } = await interpretMDX({
      source: '<Folder name={"my-skill/"} />',
      components: { Folder },
    })
    expect(render(content)).toContain('data-name="my-skill/"')
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

describe('object-valued JSX attributes', () => {
  it('keeps a style object on HTML and SVG elements', async () => {
    const { content } = await interpretMDX({
      source: '<div id="viz" style={{ padding: \'1rem 0.5rem\' }}>\n  <svg viewBox="0 0 10 10" style={{ width: \'100%\', maxWidth: \'620px\' }}>\n    <g id="s1" style={{ transition: \'opacity 0.3s\' }} />\n  </svg>\n</div>',
      components: {},
    })
    const html = render(content)
    expect(html).toContain('<div id="viz" style="padding:1rem 0.5rem">')
    expect(html).toContain('<svg viewBox="0 0 10 10" style="width:100%;max-width:620px">')
    expect(html).toContain('<g id="s1" style="transition:opacity 0.3s"></g>')
  })

  it('passes object and array literals to a component prop', async () => {
    const Probe: ComponentType<Record<string, unknown>> = (props) =>
      createElement('div', { 'data-config': JSON.stringify(props.config), 'data-items': JSON.stringify(props.items) })
    const { content } = await interpretMDX({
      source: '<Probe config={{ cols: 2, nested: { on: true } }} items={[1, \'two\']} />',
      components: { Probe },
    })
    const html = render(content)
    expect(html).toContain('data-config="{&quot;cols&quot;:2,&quot;nested&quot;:{&quot;on&quot;:true}}"')
    expect(html).toContain('data-items="[1,&quot;two&quot;]"')
  })

  it('spreads an object literal into the element props', async () => {
    const { content } = await interpretMDX({
      source: '<div {...{ id: \'spread\', style: { color: \'red\' } }}>x</div>',
      components: {},
    })
    expect(render(content)).toContain('<div id="spread" style="color:red">x</div>')
  })

  it('never lets an authored object inject raw HTML', async () => {
    const { content } = await interpretMDX({
      source: '<div dangerouslySetInnerHTML={{ __html: \'<img src=x onerror=alert(1)>\' }} />',
      components: {},
    })
    expect(render(content)).not.toContain('<img')
  })
})

describe('JSX elements as attribute values', () => {
  const Card: ComponentType<Record<string, unknown>> = ({ title, icon }) =>
    createElement('div', { 'data-card': true }, createElement('span', { 'data-icon': true }, icon as ReactNode), title as string)

  it('renders an inline svg passed as a prop, as the compiled page does', async () => {
    const source = [
      '<Card',
      '  title="Android"',
      '  icon={',
      '    <svg enable-background="new 0 0 24 24" viewBox="0 0 24 24" fill="#1ebca1">',
      '      <path d="m0 0v12" />',
      '      <path d="m1 1" strokeWidth={2} style={{ color: \'red\' }}>',
      '        label',
      '      </path>',
      '    </svg>',
      '  }',
      '/>',
    ].join('\n')
    const { content } = await interpretMDX({ source, components: { Card } })
    expect(render(content)).toBe(
      '<div data-card="true"><span data-icon="true"><svg enable-background="new 0 0 24 24" viewBox="0 0 24 24" fill="#1ebca1"><path d="m0 0v12"></path><path d="m1 1" stroke-width="2" style="color:red">label</path></svg></span>Android</div>',
    )
  })

  it('resolves a capitalized element in the value through the components map', async () => {
    const Badge: ComponentType<Record<string, unknown>> = ({ children }) =>
      createElement('b', null, children as ReactNode)
    const { content } = await interpretMDX({
      source: '<Card title="T" icon={<Badge>new</Badge>} />',
      components: { Card, Badge },
    })
    expect(render(content)).toContain('<span data-icon="true"><b>new</b></span>')
  })

  it('renders an unknown component in the value as its children', async () => {
    const { content } = await interpretMDX({
      source: '<Card title="T" icon={<Nope>inner</Nope>} />',
      components: { Card },
    })
    expect(render(content)).toContain('<span data-icon="true">inner</span>')
  })
})

describe('paragraphs that hold only JSX', () => {
  it('does not wrap a lone inline element in a paragraph', async () => {
    const Badge: ComponentType<Record<string, unknown>> = ({ children }) =>
      createElement('span', { 'data-badge': true }, children as ReactNode)
    const { content } = await interpretMDX({
      source: '<Badge>New</Badge>\n\nText with <Badge>inline</Badge> stays in a paragraph.',
      components: { Badge },
    })
    expect(render(content)).toBe(
      '<span data-badge="true">New</span>\n<p>Text with <span data-badge="true">inline</span> stays in a paragraph.</p>',
    )
  })

  it('keeps a block-level component out of a paragraph', async () => {
    // `<p><aside>` is re-parented by the HTML parser before React hydrates,
    // which fails hydration (React error 418) on every page with such a callout.
    const { content } = await interpretMDX({
      source: '<Note title="One">Careful now.</Note>\n\nBody text.\n\n<Note title="Two">Also careful.</Note>',
      components: { Note },
    })
    const html = render(content)
    expect(html).not.toContain('<p><aside')
    expect(html).toBe(
      '<aside data-note="true" data-title="One">Careful now.</aside>\n<p>Body text.</p>\n<aside data-note="true" data-title="Two">Also careful.</aside>',
    )
  })

  it('keeps SVG children as direct children when lines mix elements, text and comments', async () => {
    // A line such as `<text x="1">label</text>` carries text, so remark-mdx reads
    // it as inline JSX inside a paragraph. Left wrapped, the `<p>` makes the
    // browser close the surrounding <svg>, which then renders blank.
    const source = [
      '<svg viewBox="0 0 10 10">',
      '  {/* State 1 */}',
      '  <g id="s1">',
      '    <text x="1" y="2">label</text>',
      '    {/* Row 1 */}',
      '    <g><rect x="1"/><text x="2">1</text></g>',
      '',
      '    <g><rect x="3"/><text x="4">2</text></g>',
      '  </g>',
      '',
      '  {/* Arrow */}',
      '  <g id="arrow"><line x1="1"/></g>',
      '</svg>',
    ].join('\n')
    const { content } = await interpretMDX({ source, components: {} })
    expect(render(content)).toBe(
      '<svg viewBox="0 0 10 10"><g id="s1"><text x="1" y="2">label</text><g><rect x="1"></rect><text x="2">1</text></g><g><rect x="3"></rect><text x="4">2</text></g></g><g id="arrow"><line x1="1"></line></g></svg>',
    )
  })
})

describe('markup that remote content must not be able to create', () => {
  const Card: ComponentType<Record<string, unknown>> = ({ icon }) =>
    createElement('span', null, icon as ReactNode)
  const run = async (source: string) =>
    render((await interpretMDX({ source, components: { Card } })).content)

  it.each([
    ["<iframe srcDoc={'<script>alert(1)</script>'} />", '<iframe></iframe>'],
    ['<iframe srcdoc="<b>x</b>" />', '<iframe></iframe>'],
    ['<iframe SRCDOC="<b>x</b>" />', '<iframe></iframe>'],
    ["<iframe {...{ srcDoc: '<b>x</b>' }} />", '<iframe></iframe>'],
    ["<Card icon={<iframe srcDoc={'<b>x</b>'} />} />", '<span><iframe></iframe></span>'],
  ])('strips srcDoc from %s', async (source, expected) => {
    expect(await run(source)).toBe(expected)
  })

  it('strips srcDoc from a component prop', async () => {
    const Probe: ComponentType<Record<string, unknown>> = (props) =>
      createElement('div', { 'data-src-doc': String(props.srcDoc), 'data-srcdoc': String(props.srcdoc) })
    const { content } = await interpretMDX({ source: '<Probe srcDoc="<b>x</b>" srcdoc="<b>y</b>" />', components: { Probe } })
    expect(render(content)).toBe('<div data-src-doc="undefined" data-srcdoc="undefined"></div>')
  })

  it('strips raw HTML props from nested elements too', async () => {
    expect(await run("<Card icon={<b dangerouslySetInnerHTML={{ __html: '<img src=x>' }} />} />")).toBe('<span><b></b></span>')
  })

  it('keeps an ordinary embedded iframe', async () => {
    const html = await run('<iframe src="https://www.youtube.com/embed/abc" title="Video" frameBorder="0" allow="autoplay; encrypted-media" allowFullScreen />')
    expect(html).toBe('<iframe src="https://www.youtube.com/embed/abc" title="Video" frameBorder="0" allow="autoplay; encrypted-media" allowFullScreen=""></iframe>')
  })

  it('leaves string event handlers and javascript: URLs to React, which neutralises them', async () => {
    const html = await run(
      [
        '<div onClick="alert(1)" onclick="alert(2)" ONCLICK="alert(3)">x</div>',
        '<img src="x" onError="alert(4)" />',
        '<a href="javascript:alert(5)">a</a>',
        '<a href={\' jav\\tascript:alert(6)\'}>b</a>',
        '<iframe src="javascript:alert(7)" />',
        '<form action="javascript:alert(8)"><button formAction="javascript:alert(9)">b</button></form>',
        '<svg><a xlinkHref="javascript:alert(10)"><text>t</text></a></svg>',
      ].join('\n\n'),
    )
    expect(html).not.toMatch(/\bon(click|error)=/i)
    expect(html).not.toMatch(/(href|src|action|formAction)="javascript:alert/i)
    expect(html).toContain('React has blocked a javascript: URL')
  })

  it.each([
    ['href', '<a href="vbscript:msgbox(1)">a</a>', '<a>a</a>'],
    ['href', '<a href="data:text/html,<script>alert(1)</script>">a</a>', '<a>a</a>'],
    ['href', '<a href=" DaTa:\ntext/html;base64,PHNjcmlwdD4=">a</a>', '<a>a</a>'],
    ['src', '<iframe src="data:text/html,<b>x</b>" />', '<iframe></iframe>'],
    ['data', '<object data="data:text/html,<b>x</b>" type="text/html" />', '<object type="text/html"></object>'],
    ['xlinkHref', '<svg><a xlinkHref="vbscript:x"><text>t</text></a></svg>', '<svg><a><text>t</text></a></svg>'],
    ['action', '<form action="VBScript:x"></form>', '<form></form>'],
    ['formAction', '<button formAction="data:text/html,x">b</button>', '<button>b</button>'],
  ])('drops an unsafe scheme from %s', async (_name, source, expected) => {
    expect(await run(source)).toBe(expected)
  })

  it('keeps data images and ordinary links', async () => {
    const html = await run('<a href="https://example.com/a?b=c">a</a>\n\n<img src="data:image/png;base64,AAAA" alt="" />')
    expect(html).toContain('<a href="https://example.com/a?b=c">a</a>')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
  })

  it.each([
    '<script>alert(1)</script>',
    '<script src="https://evil.test/x.js"></script>',
    '<sCript>alert(1)</sCript>',
    '<svg><script>alert(1)</script></svg>',
    '<base href="https://evil.test/" />',
    '<meta httpEquiv="refresh" content="0;url=https://evil.test" />',
    '<meta http-equiv="refresh" content="0;url=https://evil.test" />',
    '<Card icon={<script>alert(1)</script>} />',
  ])('renders nothing for %s', async (source) => {
    const html = await run(source)
    expect(html).not.toMatch(/<(script|base|meta)/i)
    expect(html).not.toContain('alert(1)')
  })

  it('keeps an ordinary meta element', async () => {
    expect(await run('<meta name="description" content="ok" />')).toContain('name="description"')
  })

  it('stops an SVG animation from retargeting a link or an event attribute', async () => {
    const html = await run(
      '<svg><a><animate attributeName="href" values="javascript:alert(1)" /><text>t</text></a><set attributeName="onmouseover" to="alert(2)" /><animate attributeName="opacity" values="0;1" /></svg>',
    )
    expect(html).not.toMatch(/attributeName="(href|onmouseover)"/)
    expect(html).toContain('attributeName="opacity"')
  })
})

/** Mirrors a site `Template`: rewrites `{{KEY}}` in every string child, recursively. */
function substitute(node: ReactNode, value: string): ReactNode {
  if (typeof node === 'string') return node.replaceAll('{{KEY}}', value)
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  return cloneElement(el, undefined, ...Children.map(el.props.children, (c) => substitute(c, value)) ?? [])
}

function Template({ value, children }: { value: string; children?: ReactNode }) {
  return createElement('div', null, substitute(children, value))
}

const fence = '<Template>\n\n```bash\ncurl -H "Authorization: Bearer {{KEY}}"\n```\n\n</Template>'

async function renderFence(value: string, source = fence): Promise<string> {
  const Tpl = (props: Record<string, unknown>) => createElement(Template, { ...props, value } as never)
  const { content } = await interpretMDX({ source, components: { Template: Tpl, pre: Pre, code: Code } as never })
  return render(content)
}

describe('highlighted code is real elements', () => {
  it('a component substituting <X> into a fence shows it as text, not an element', async () => {
    const html = await renderFence('<OPENROUTER_API_KEY>')
    expect(html).toContain('Bearer &lt;OPENROUTER_API_KEY&gt;')
    expect(html).not.toMatch(/<openrouter_api_key/i)
  })

  it('renders a hostile substituted string as text', async () => {
    const html = await renderFence('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('keeps token spans and line classes for normal code', async () => {
    const { content } = await interpretMDX({
      source: '```ts\nconst a = 1 // [!code ++]\nconst b = 2\n```',
      components: { pre: Pre, code: Code } as never,
    })
    const html = render(content)
    expect(html).toMatch(/<span class="thally-line-add"><span style="color:[^"]+">const<\/span>/)
    expect(html).toMatch(/<\/span>\n<span><span style=/)
  })
})
