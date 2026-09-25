/** Generated page descriptions contain readable prose, never component syntax. */

import { compileSync } from '@mdx-js/mdx'
import { describe, expect, it } from 'vitest'

import { escapeFernLiteralBraces, functionDeclaredNames, hasClientBoundaryFunctionProp, normalizeHtmlComments, normalizeMdx, parseMarkdownPage, protectMathBlocks, replaceLinkWithAnchor, replaceUnknownComponents } from '../mdx.js'

describe('maskCode placeholder safety (via normalizeMdx)', () => {
  it('strips a literal NUL from the source so it cannot collide with a placeholder marker', () => {
    const withNul = 'before\u0000 <!-- comment --> after'
    expect(normalizeMdx(withNul)).toBe('before {/* comment */} after')
  })

  it('still converts a 4-space-indented `<!-- -->` comment, since MDX disables CommonMark indented code blocks', () => {
    // mdx-js disables CommonMark indented code blocks, so this 4-space
    // indented text is ordinary prose to @mdx-js/mdx, not a code block, and
    // must still be rewritten (consistent with how @mdx-js/mdx parses it).
    expect(normalizeMdx('    <!-- a\n    b -->')).toBe('    {/* a\n    b */}')
  })
})

function description(raw: string): string | undefined {
  return parseMarkdownPage({ id: 'faq', raw, source: 'https://example.com/faq' })?.description
}

describe('migration description fallback', () => {
  it('extracts the first paragraph inside an accordion without its JSX wrappers', () => {
    expect(description(`---\ntitle: Questions\n---\n\n<Accordion title="Where can I learn more?">\n  See the [API documentation](/api) for details.\n</Accordion>`))
      .toBe('See the API documentation for details.')
  })

  it('skips code examples and expressions while preserving inline prose formatting', () => {
    expect(description(`import Widget from './widget.jsx'\n\n# Questions\n\n<Accordion title="How?">\n\n\`\`\`http\nGET /example\n\`\`\`\n\nUse **settings** with <code>enabled</code> and <a href="/help">the guide</a>.\n</Accordion>`))
      .toBe('Use settings with enabled and the guide.')
  })

  it('preserves authored descriptions exactly', () => {
    expect(description('---\ntitle: Questions\ndescription: "Authored description."\n---\n\nDifferent paragraph.'))
      .toBe('Authored description.')
  })

  it('does not invent description text for code-only pages', () => {
    expect(description('```jsx\n<Widget />\n```')).toBe('')
  })
})

describe('normalizeMdx', () => {
  it('leaves a bare Mintlify <Callout>...</Callout> closing tag untouched', () => {
    // Fern's `<Callout intent="...">` closing tags are rewritten to the tag
    // its matching opener chose. A generic Mintlify `<Callout>` (no `intent`)
    // never opens one of those tags, so its own closing tag must survive —
    // rewriting it to a mismatched tag breaks MDX compilation.
    const body = '<Callout icon="key" color="#FFC107">Custom callout</Callout>'
    expect(normalizeMdx(body)).toBe(body)
  })

  it('rewrites <FileTree> to Thally\'s <Tree> built-in', () => {
    expect(normalizeMdx('<FileTree>\n- docs/\n</FileTree>', 'mintlify')).toBe('<Tree>\n- docs/\n</Tree>')
  })

  it('rewrites <Column> to a plain <div> so Columns lays it out without a registry entry', () => {
    expect(normalizeMdx('<Columns cols={2}>\n  <Column>Text</Column>\n</Columns>', 'mintlify'))
      .toBe('<Columns cols={2}>\n  <div>Text</div>\n</Columns>')
  })

  it("unwraps Fern's per-tab <CodeBlock> inside a <CodeBlocks> group, but preserves Mintlify's standalone <CodeBlock> component", () => {
    expect(normalizeMdx('<CodeBlocks>\n<CodeBlock title="npm">\n```bash\nnpm install acme\n```\n</CodeBlock>\n</CodeBlocks>', 'fern'))
      .toBe('<CodeGroup>\n\n```bash\nnpm install acme\n```\n\n</CodeGroup>')

    const standalone = 'export const Custom = ({ children, ...props }) => (\n  <CodeBlock {...props}>{children}</CodeBlock>\n);'
    expect(normalizeMdx(standalone)).toContain(standalone)
  })

  it('defines a standalone <CodeBlock> shim so a page-authored component referencing it does not throw ReferenceError at render', () => {
    const body = 'export const Custom = ({ children, ...props }) => (\n  <CodeBlock {...props}>{children}</CodeBlock>\n);'
    const result = normalizeMdx(body)
    expect(result).toMatch(/^export const CodeBlock = /)
    // Never double-declare when the page (or an earlier pass) already defines it.
    expect(normalizeMdx(result).match(/export const CodeBlock =/g)).toHaveLength(1)
  })

  it('imports Icon for a page-authored component that references it bare, but not for ordinary prose usage', () => {
    const body = 'export const Download = () => (\n  <a href="/x.pdf"><Icon icon="download" /></a>\n);\n\n<Download />'
    expect(normalizeMdx(body)).toContain("import { Icon } from '@/components/mdx/content-icon';")

    const prose = 'Click <Icon icon="rocket" /> to launch.'
    expect(normalizeMdx(prose)).toBe(prose)
  })

  it('rewrites <GitHub.Repo> to the registered <GitHub> repository card', () => {
    expect(normalizeMdx('<GitHub.Repo repo="mintlify/docs" variant="inset" />', 'mintlify'))
      .toBe('<GitHub repo="mintlify/docs" variant="inset" />')
  })

  it("maps a Docusaurus <TabItem>'s value to its <Tabs> values[] label, preferring the item's own label, and strips Docusaurus-only Tabs props", () => {
    const body = '<Tabs\n  defaultValue="native"\n  values={[\n    { label: \'Native\', value: \'native\' },\n    { label: \'React\', value: \'react\' },\n  ]}\n  groupId="framework">\n<TabItem value="native">Native body</TabItem>\n<TabItem value="react" label="Custom">React body</TabItem>\n</Tabs>'
    const result = normalizeMdx(body, 'docusaurus')
    expect(result).toContain('<Tab title="Native">')
    // The TabItem's own `label` wins over the Tabs `values[]` entry.
    expect(result).toContain('<Tab title="Custom">')
    expect(result).not.toContain('defaultValue')
    expect(result).not.toContain('values=')
    expect(result).not.toContain('groupId')
    expect(result).toMatch(/^<Tabs>/)
  })

  it('never rewrites a tag name mentioned inside an inline code span or fenced code block', () => {
    // Regression: a naive whole-body string replace corrupted prose like
    // "`<Tree>` and `<FileTree>` are aliases" into "`<Tree>` and `<Tree>`".
    const prose = '`<Tree>` and `<FileTree>` are aliases.'
    expect(normalizeMdx(prose)).toBe(prose)
    const fenced = '```mdx\n<FileTree>\n- docs/\n</FileTree>\n```'
    expect(normalizeMdx(fenced)).toBe(fenced)
  })

  it('wraps consecutive docusaurus-remark-plugin-tab-blocks fences in a <CodeGroup> and drops the tab keyword', () => {
    const body = '```bash tab title="npm"\nnpm install acme\n```\n```bash tab title="yarn"\nyarn add acme\n```'
    const result = normalizeMdx(body, 'docusaurus')
    expect(result).toBe('<CodeGroup>\n\n```bash title="npm"\nnpm install acme\n```\n\n```bash title="yarn"\nyarn add acme\n```\n</CodeGroup>')
  })

  it('leaves a single tab-marked fence unwrapped, only stripping the tab keyword', () => {
    const body = '```bash tab title="npm"\nnpm install acme\n```'
    expect(normalizeMdx(body, 'docusaurus')).toBe('```bash title="npm"\nnpm install acme\n```')
  })

  it('preserves the blank line after a tab-marked fence that is not followed by another tab fence', () => {
    const body = '```bash tab title="npm"\nnpm install acme\n```\n\nNext paragraph.'
    expect(normalizeMdx(body, 'docusaurus')).toBe('```bash title="npm"\nnpm install acme\n```\n\nNext paragraph.')
  })

  it('only applies a platform\'s own renames when a platform is given', () => {
    // <Success> is a Fern-only alias for <Tip>; it must not fire against a
    // Docusaurus or Mintlify source's own, unrelated <Success> component.
    const body = '<Success>Done</Success>'
    expect(normalizeMdx(body, 'docusaurus')).toBe(body)
    expect(normalizeMdx(body, 'mintlify')).toBe(body)
    expect(normalizeMdx(body, 'fern')).toBe('<Tip>Done</Tip>')
    // Omitting the platform applies no platform-specific renames at all — a
    // caller of unknown origin (the URL crawler when it can't detect one)
    // must not have another platform's renames corrupt its own components.
    expect(normalizeMdx(body)).toBe(body)
  })
})

describe('HTML style="..." attribute normalization (all platforms, including unspecified)', () => {
  it('converts a simple string style attribute into a JSX style object', () => {
    // A raw HTML `style="..."` string (common in Markdown pasted from a
    // rendered table, e.g. a pandas DataFrame) is invalid JSX — React's
    // `style` prop must be a mapping, and this throws at render rather than
    // silently doing nothing. This has no platform-specific semantics, so it
    // must run even when `platform` is omitted (unlike platform-gated renames).
    expect(normalizeMdx('<tr style="text-align: right;">')).toBe('<tr style={{textAlign: "right"}}>')
  })

  it('camelCases a kebab-case property and capitalizes vendor prefixes, with -ms- lowercase', () => {
    const body = '<div style="-webkit-transform: rotate(3deg); -ms-transform: scale(1); font-size: 12px;">x</div>'
    expect(normalizeMdx(body, 'fern')).toBe(
      '<div style={{WebkitTransform: "rotate(3deg)", msTransform: "scale(1)", fontSize: "12px"}}>x</div>',
    )
  })

  it('keeps a CSS custom property as a literal string key', () => {
    expect(normalizeMdx('<div style="--brand-color: #ff0000;">x</div>', 'fern'))
      .toBe('<div style={{"--brand-color": "#ff0000"}}>x</div>')
  })

  it('does not split a url() value containing a semicolon (a data URI)', () => {
    const body = '<div style="background: url(data:image/png;base64,AAAA==);">x</div>'
    expect(normalizeMdx(body, 'fern')).toBe('<div style={{background: "url(data:image/png;base64,AAAA==)"}}>x</div>')
  })

  it('drops !important, which a React style object cannot express', () => {
    expect(normalizeMdx('<p style="color: red !important;">x</p>', 'fern')).toBe('<p style={{color: "red"}}>x</p>')
  })

  it('converts an empty style attribute to an empty object', () => {
    expect(normalizeMdx('<span style="">x</span>', 'fern')).toBe('<span style={{}}>x</span>')
  })

  it('preserves other attributes and self-closing tags', () => {
    expect(normalizeMdx('<div className="x" style="color:red" id="y">x</div>', 'fern'))
      .toBe('<div className="x" style={{color: "red"}} id="y">x</div>')
    expect(normalizeMdx('<br style="color:red"/>', 'fern')).toBe('<br style={{color: "red"}} />')
  })

  it('converts a style attribute on its own line inside a multi-line tag', () => {
    // A copied HTML snippet often spreads each attribute onto its own
    // indented line (e.g. an <iframe>). The separator right before `style=`
    // is then a newline plus indentation — more than one whitespace
    // character — not the single space a same-line tag has. The original
    // layout is not preserved (attributes are reflowed onto one line, same
    // as the single-line case), but the string style attribute — which
    // would otherwise throw at render — is still converted to a valid JSX
    // style object.
    const body = [
      '<iframe',
      '    src="https://example.com/embed"',
      '    style="width: 100%; height: 500px; border: none; border-radius: 8px;"',
      '  ></iframe>',
    ].join('\n')
    const result = normalizeMdx(body, 'fern')
    expect(result).toBe(
      '<iframe\n    src="https://example.com/embed" style={{width: "100%", height: "500px", border: "none", borderRadius: "8px"}}></iframe>',
    )
    expect(result).not.toContain('style="')
  })

  it('converts a multi-line tag whose style attribute comes first, with no attribute before it', () => {
    const body = '<div\n  style="color: red;"\n  id="y"\n>x</div>'
    expect(normalizeMdx(body, 'fern')).toBe('<div style={{color: "red"}}\n  id="y">x</div>')
  })

  it('leaves an already-correct style expression and a component tag alone', () => {
    expect(normalizeMdx('<div style={{color: "red"}}>x</div>', 'fern')).toBe('<div style={{color: "red"}}>x</div>')
    // Uppercase-first is a component, never an intrinsic HTML element — its
    // own `style` prop (if it has one) may have entirely different semantics.
    expect(normalizeMdx('<Custom style="color:red" />', 'fern')).toBe('<Custom style="color:red" />')
  })

  it('never touches a style="..." string inside fenced or inline code', () => {
    const fenced = '```html\n<div style="color:red">code</div>\n```'
    expect(normalizeMdx(fenced, 'fern')).toBe(fenced)
    const inline = 'Use `<div style="color:red">` in HTML.'
    expect(normalizeMdx(inline, 'fern')).toBe(inline)
  })
})

describe('Docusaurus import normalization', () => {
  it('removes injected global component imports', () => {
    expect(normalizeMdx("import Tabs from '@theme/Tabs';\n\n<Tabs />", 'docusaurus'))
      .toBe('\n<Tabs />')
  })

  it('handles adversarial whitespace in linear time', () => {
    const source = `import${' '.repeat(100_000)}Widget from '@theme/Widget'`
    const startedAt = performance.now()

    expect(normalizeMdx(source, 'docusaurus')).toBe(source)
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })
})

describe('multi-line renames (fenced/inline code masked, whole body rewritten)', () => {
  it('converts a multi-line HTML comment to an MDX comment', () => {
    const body = 'Before.\n\n<!--\n  a note\n  spanning lines\n-->\n\nAfter.'
    expect(normalizeMdx(body)).toBe('Before.\n\n{/*\n  a note\n  spanning lines\n*/}\n\nAfter.')
  })

  it('renames a multi-line Docusaurus <Warn> and its closing tag', () => {
    const body = '<Warn\n  title="Careful">\nBody text.\n</Warn>'
    expect(normalizeMdx(body)).toBe('<Warning\n  title="Careful">\nBody text.\n</Warning>')
  })

  it('renames a multi-line Docusaurus <Link> to an anchor, opening and closing tags together', () => {
    const body = '<Link\n  to="/a">\n  x\n</Link>'
    expect(normalizeMdx(body, 'docusaurus')).toBe('<a\n  href="/a">\n  x\n</a>')
  })

  it('rewrites a multi-line Fern <Callout intent="..."> to the paired Thally tag', () => {
    const body = '<Callout\n  intent="warning">\nBack up first.\n</Callout>'
    expect(normalizeMdx(body, 'fern')).toBe('<Warning>\nBack up first.\n</Warning>')
  })

  it('still never rewrites a tag name mentioned inside an inline code span or fenced code block', () => {
    const prose = '`<Tree>` and `<FileTree>` are aliases.'
    expect(normalizeMdx(prose, 'mintlify')).toBe(prose)
    const fenced = '```mdx\n<FileTree>\n- docs/\n</FileTree>\n```'
    expect(normalizeMdx(fenced, 'mintlify')).toBe(fenced)
    // A comment-like fragment inside a fenced block must not be converted either.
    const fencedComment = '```html\n<!--\n  example comment\n-->\n```'
    expect(normalizeMdx(fencedComment)).toBe(fencedComment)
  })
})

describe('protectMathBlocks', () => {
  it('converts a block $$...$$ (KaTeX align, backslashes and braces) into a fenced ```math block', () => {
    const body = [
      'Some prose before.',
      '',
      '$$',
      '\\begin{align*}',
      '\\small\\text{Account USDC Settlement Balance} = \\\\',
      '\\text{Account USDC Balance}',
      '\\end{align*}',
      '$$',
      '',
      'Some prose after.',
    ].join('\n')
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(true)
    expect(result.body).toContain('```math')
    expect(result.body).toContain('\\begin{align*}')
    expect(result.body).not.toMatch(/\n\$\$\n/)
    // The content actually compiles as MDX now (this exact construct is
    // what crashed the parser before math was protected).
    expect(() => compileSync(result.body, { format: 'mdx' })).not.toThrow()
  })

  it('converts an inline $$...$$ span mid-paragraph into an inline code span, preserving surrounding prose', () => {
    const body = "Therefore the Total Exchange USDC Balance is $$4'000$$ today."
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(true)
    expect(result.body).toBe("Therefore the Total Exchange USDC Balance is `$$4'000$$` today.")
    expect(() => compileSync(result.body, { format: 'mdx' })).not.toThrow()
  })

  it('leaves a real fenced code block containing $$ untouched', () => {
    const body = ['```js', 'const x = $$(selector)', '```'].join('\n')
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('leaves prose with no $$ at all unchanged', () => {
    const body = 'Nothing special here.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('never touches the frontmatter block', () => {
    const body = '---\ntitle: "$$weird$$"\n---\n\nBody with $$x=1$$ math.'
    const result = protectMathBlocks(body)
    expect(result.body).toContain('title: "$$weird$$"')
    expect(result.body).toContain('`$$x=1$$`')
  })

  it('converts single-$...$ inline math (the paradex-docs greeks.mdx repro)', () => {
    const body = 'Under Black-76, the forward is $F = S \\times e^{\\,f\\,T}$, so a move in $S$ matters.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(true)
    expect(result.body).toBe(
      'Under Black-76, the forward is `$F = S \\times e^{\\,f\\,T}$`, so a move in `$S$` matters.',
    )
    expect(() => compileSync(result.body, { format: 'mdx' })).not.toThrow()
  })

  it('does not mistake two dollar amounts in prose for inline math', () => {
    const body = 'It costs $50 and $100 depending on the plan.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('converts a block delimited by a bare $ alone on its own line (the paradex-docs maintenance-mode.mdx repro)', () => {
    const body = [
      'BTC with an External Fair Price of $100,000:',
      '',
      '$',
      '\\text{External Fair Price} = \\text{Spot Oracle Price} \\times (1 + \\text{External Basis Rate})',
      '$',
    ].join('\n')
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(true)
    // A bare dollar amount elsewhere in the prose is left alone.
    expect(result.body).toContain('$100,000:')
    expect(result.body).toContain('```math')
    expect(result.body).toContain('\\text{External Fair Price}')
    expect(() => compileSync(result.body, { format: 'mdx' })).not.toThrow()
  })

  it('does not treat an author-escaped \\$ as a math delimiter', () => {
    const body = 'A 1% move corresponds to \\$600 in this example.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('leaves shell-variable-looking inline code spans untouched, even in pairs on one line', () => {
    const body = 'Compare `$FOO` and `$BAR` values.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('leaves a JSX attribute value and adjacent text content untouched (not real math)', () => {
    const body = '<Badge color="$primary">$5</Badge>'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('leaves an inlined ESM component with template-literal interpolations untouched (mintlify/docs vercel-json-generator.mdx repro)', () => {
    const body = [
      'Some prose before.',
      '',
      'export const VercelJsonGenerator = () => {',
      "  const [subdomain, setSubdomain] = useState('[SUBDOMAIN]')",
      '  const vercelConfig = {',
      '    rewrites: [',
      '      {',
      '        source: `/${cleanSubpath}`,',
      '        destination: `https://${subdomain}.mintlify.site/${cleanSubpath}`',
      '      }',
      '    ]',
      '  }',
      '  return <div>{JSON.stringify(vercelConfig)}</div>',
      '}',
      '',
      '<VercelJsonGenerator />',
    ].join('\n')
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
    expect(() => compileSync(result.body, { format: 'mdx' })).not.toThrow()
  })

  it('leaves an inline code span with GitHub Actions matrix interpolation untouched (playwright.dev test-sharding repro)', () => {
    const body = 'Then run tests with the `--shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}` option.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('never matches a template-literal interpolation (`${...}`) as a math delimiter, even unquoted', () => {
    const body = 'weird unquoted ${foo}+${bar} text'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('leaves a bare JSX expression container untouched, not mistaking its braces for math content', () => {
    const body = 'Price is {price} and the total is {total} today.'
    const result = protectMathBlocks(body)
    expect(result.converted).toBe(false)
    expect(result.body).toBe(body)
  })

  it('requires a TeX signal for single-$ inline math, so a bare non-digit token like $Pro$ is still left alone unless it also looks like TeX', () => {
    // No backslash/^/_/{, but also no digits/whitespace: still accepted,
    // matching the existing `$S$` convention (see the paradex repro test).
    const bareToken = protectMathBlocks('Upgrade to $Pro$ today.')
    expect(bareToken.converted).toBe(true)
    // A stronger prose case that could otherwise look like a pair of dollar
    // amounts (digits, no TeX signal) never converts.
    const dollarAmounts = protectMathBlocks('It costs $5 or $10, your choice.')
    expect(dollarAmounts.converted).toBe(false)
  })

  it('never returns a body that fails to compile when the original page compiled fine (compile guard invariant)', () => {
    for (const body of [
      'A stray $<Foo>$ that a converter could wrap wrong.',
      'See `code` and $x$ and an unterminated ` backtick here.',
      'Mixed content: $$4\'000$$ and a `$FOO` shell var and {jsxExpr} together.',
    ]) {
      const originalCompiles = (() => {
        try {
          compileSync(body, { format: 'mdx' })
          return true
        } catch {
          return false
        }
      })()
      const result = protectMathBlocks(body)
      if (originalCompiles) {
        expect(() => compileSync(result.body, { format: 'mdx' })).not.toThrow()
      }
    }
  })
})

describe('escapeFernLiteralBraces', () => {
  it('leaves an ESM component whose JSX returns a real expression unchanged', () => {
    const body = 'export const Box = ({ children }) => <div>{children}</div>;'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves a destructuring assignment inside real page-authored code unchanged', () => {
    const body = [
      'export const Box = () => {',
      '  const {title} = x',
      '  return <div>{title}</div>;',
      '};',
    ].join('\n')
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('escapes a bare identifier in ordinary prose', () => {
    expect(escapeFernLiteralBraces('Connection to {vendor} failed.'))
      .toBe('Connection to \\{vendor\\} failed.')
  })

  it('escapes a bare dotted-path reference in prose', () => {
    expect(escapeFernLiteralBraces('Configure {http.Server} before starting.'))
      .toBe('Configure \\{http.Server\\} before starting.')
  })

  it('leaves a real component prop expression inside JSX unchanged', () => {
    const body = '<Foo bar={props.x}>Text</Foo>'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves a prose brace referencing an ESM import unchanged', () => {
    const body = "import { vendor } from './vendor.js';\n\nConnection to {vendor} failed."
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves fenced and inline code untouched', () => {
    const body = 'Use `{vendor}` inline, or:\n\n```js\nconst x = {vendor};\n```'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves an unparseable page unchanged instead of throwing', () => {
    const body = '<Unclosed'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('escapes a bare identifier inside a callout', () => {
    expect(escapeFernLiteralBraces('<Note>connection to {vendor} failed</Note>'))
      .toBe('<Note>connection to \\{vendor\\} failed</Note>')
  })

  it('escapes a bare identifier inside nested Tabs/Tab', () => {
    const body = '<Tabs>\n  <Tab title="x">See {vendor} below.</Tab>\n</Tabs>'
    const expected = '<Tabs>\n  <Tab title="x">See \\{vendor\\} below.</Tab>\n</Tabs>'
    expect(escapeFernLiteralBraces(body)).toBe(expected)
  })

  it('leaves props.title inside JSX unchanged', () => {
    const body = '<Note>{props.title}</Note>'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves a map() callback referencing its own parameter unchanged', () => {
    const body = '{items.map((item) => <li>{item}</li>)}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves prose referencing a multi-declarator export const unchanged (export const a = 1, b = 2)', () => {
    const body = 'export const a = 1, b = 2\n\nx {a} {b}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves prose referencing a nested destructured export const unchanged', () => {
    const body = 'export const {\n  a,\n  b: { c }\n} = obj\n\n{c}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves prose referencing a multi-line named import unchanged', () => {
    const body = 'import {\n  vendor,\n} from "./v"\n\n{vendor}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves prose referencing both a default and named import unchanged', () => {
    const body = 'import X, { Y } from "./v"\n\n{X} {Y}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves prose referencing an `export async function` unchanged', () => {
    const body = 'export async function load() {}\n\n{load}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves a dotted path on a pure JS built-in (and the undefined literal) unchanged', () => {
    const body = 'x {Math.PI} {Number.MAX_SAFE_INTEGER} {undefined}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('escapes bare globals and host-only global paths, which crash or vanish at render', () => {
    for (const name of ['window', 'document', 'navigator', 'process', 'console', 'Date', 'Error', 'fetch', 'Math', 'window.location', 'document.title', 'process.env']) {
      expect(escapeFernLiteralBraces(`x {${name}} y`)).toBe(`x \\{${name}\\} y`)
    }
    expect(escapeFernLiteralBraces('<Note>\n{window}\n</Note>')).toBe('<Note>\n\\{window\\}\n</Note>')
  })

  it('reads bindings from ESM that contains JSX', () => {
    const body = 'export const Badge = () => <b>new</b>\nexport const version = "1.2.3"\n\nCurrent version: {version}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('leaves a non-exported local const inside a client component body unchanged', () => {
    const body = 'export const x = 1\nconst inner = 2\n\n{inner}'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })

  it('escapes a Unicode identifier and a $-prefixed identifier the same as an ASCII one', () => {
    expect(escapeFernLiteralBraces('x {café} y')).toBe('x \\{café\\} y')
    expect(escapeFernLiteralBraces('x {$var} y {_x} z')).toBe('x \\{$var\\} y \\{_x\\} z')
  })

  it('does not bind a name from a re-export (`export { x } from "./y"`), since that never declares a local variable', () => {
    const body = 'export { vendor } from "./x"\n\nx {vendor}'
    expect(escapeFernLiteralBraces(body)).toBe('export { vendor } from "./x"\n\nx \\{vendor\\}')
  })

  it('never rewrites a YAML frontmatter block, even when its value contains a brace', () => {
    const body = '---\ntitle: "Style guide"\ndescription: "Use {x} for a placeholder"\n---\n\nConnection to {vendor} failed.'
    expect(escapeFernLiteralBraces(body)).toBe(
      '---\ntitle: "Style guide"\ndescription: "Use {x} for a placeholder"\n---\n\nConnection to \\{vendor\\} failed.',
    )
  })

  it('skips a leading UTF-8 BOM when locating the frontmatter block, matching parseFrontmatter', () => {
    const body = '﻿---\ndescription: "{x}"\n---\n\n{vendor}'
    expect(escapeFernLiteralBraces(body)).toBe('﻿---\ndescription: "{x}"\n---\n\n\\{vendor\\}')
  })

  it('leaves frontmatter alone with CRLF line endings', () => {
    const body = '---\r\ndescription: "{x}"\r\n---\r\n\r\n{vendor}'
    expect(escapeFernLiteralBraces(body)).toBe('---\r\ndescription: "{x}"\r\n---\r\n\r\n\\{vendor\\}')
  })

  it('round-trips a body with no frontmatter and no escapable braces unchanged', () => {
    const body = 'Just prose, no braces here.'
    expect(escapeFernLiteralBraces(body)).toBe(body)
  })
})

describe('hasClientBoundaryFunctionProp', () => {
  it('flags a page-authored function passed as a bare JSX prop', () => {
    const body = 'export const CustomBlock = ({ children }) => <div>{children}</div>;\n\n'
      + '<Accordion title="x" RenderComponent={CustomBlock}>Body</Accordion>'
    expect(hasClientBoundaryFunctionProp(body)).toBe(true)
  })

  it('ignores the same shape when it only appears inside a fenced code sample', () => {
    const body = '```jsx\nexport const handleClick = () => {};\n<button onClick={handleClick} />\n```'
    expect(hasClientBoundaryFunctionProp(body)).toBe(false)
  })

  it('ignores a plain value whose initializer merely contains =>, not a function reference', () => {
    const body = 'export const items = list.map((x) => x);\n\n<Table rows={items} />'
    expect(hasClientBoundaryFunctionProp(body)).toBe(false)
  })

  it('ignores an unrelated export not passed anywhere as a prop', () => {
    const body = 'export const helper = () => 1;\n\nJust prose.'
    expect(hasClientBoundaryFunctionProp(body)).toBe(false)
  })
})

describe('functionDeclaredNames', () => {
  it('excludes a plain-value export const even when a function export exists on the same page', () => {
    // Reviewer's exact input: a string const feeds a client built-in
    // (`Mermaid chart={diagram}`) while a function feeds a different one
    // (`Steps render={Demo}`). Only `Demo` is a function.
    const body = "export const Demo = ({ children }) => <div>{children}</div>;\n"
      + "export const diagram = 'graph TD; A-->B';\n\n"
      + '<Steps render={Demo}>x</Steps>\n\n<Mermaid chart={diagram} />'
    expect(functionDeclaredNames(body)).toEqual(new Set(['Demo']))
  })

  it('includes classes, default and generator functions, and one-level aliases of a function', () => {
    const body = 'export class Box extends React.Component { render() { return null } }\n'
      + 'export default function Layout({ children }) { return children }\n'
      + 'export function* gen() {}\n'
      + 'export const Demo = () => null;\n'
      + 'export const Alias = Demo;\n'
      + 'export const load = async() => 1\n'
      + "export const functionList = ['map']\n"
      + "export const asyncMode = 'on'\n"
      + 'export const Label = functionList\n'
    expect(functionDeclaredNames(body)).toEqual(new Set(['Box', 'Layout', 'gen', 'Demo', 'Alias', 'load']))
  })

  it('includes export function and export async function declarations', () => {
    const body = 'export function Demo() { return null }\n'
      + 'export async function Load() { return 1 }\n'
      + "export const label = 'hi'\n"
    expect(functionDeclaredNames(body)).toEqual(new Set(['Demo', 'Load']))
  })
})

describe('replaceLinkWithAnchor', () => {
  it('renames a self-closing <Link> to <a>, keeping every attribute', () => {
    expect(replaceLinkWithAnchor('<Link href="/docs" target="_blank" />')).toBe('<a href="/docs" target="_blank" />')
  })

  it('renames a paired <Link> to <a>, keeping attributes and children exactly', () => {
    expect(replaceLinkWithAnchor('<Link href="/docs">Read the **docs**</Link>')).toBe('<a href="/docs">Read the **docs**</a>')
  })

  it('leaves a page-declared or imported Link untouched', () => {
    const body = "import Link from './link.jsx'\n\n<Link href=\"/x\">go</Link>"
    expect(replaceLinkWithAnchor(body)).toBe(body)
  })

  it('never touches frontmatter', () => {
    const body = '---\ntitle: "<Link>"\n---\n\n<Link href="/x">go</Link>'
    expect(replaceLinkWithAnchor(body)).toBe('---\ntitle: "<Link>"\n---\n\n<a href="/x">go</a>')
  })
})

describe('replaceUnknownComponents', () => {
  it('drops a self-closing unknown component and warns once', () => {
    const warned: Array<string> = []
    expect(replaceUnknownComponents('before <Snippet file="x.mdx" /> after', (name) => warned.push(name)))
      .toBe('before  after')
    expect(warned).toEqual(['Snippet'])
  })

  it('replaces a paired unknown component with a div, keeping its children', () => {
    const warned: Array<string> = []
    expect(replaceUnknownComponents('<Widget title="x">Hello <b>world</b></Widget>', (name) => warned.push(name)))
      .toBe('<div>Hello <b>world</b></div>')
    expect(warned).toEqual(['Widget'])
  })

  it('warns only once per distinct component name', () => {
    const warned: Array<string> = []
    replaceUnknownComponents('<Foo /> and <Foo /> and <Foo>x</Foo>', (name) => warned.push(name))
    expect(warned).toEqual(['Foo'])
  })

  it('does not touch a Thally builtin component', () => {
    const body = '<Card title="x">content</Card>'
    expect(replaceUnknownComponents(body, () => { throw new Error('should not warn') })).toBe(body)
  })

  it('does not touch a page-declared or imported component', () => {
    const body = "import Foo from './foo.jsx'\n\n<Foo>content</Foo>"
    expect(replaceUnknownComponents(body, () => { throw new Error('should not warn') })).toBe(body)
  })

  it('does not touch a componentMigrator-registered Migrated<hash> tag', () => {
    const body = '<Migrated0123456789ab title="x">content</Migrated0123456789ab>'
    expect(replaceUnknownComponents(body, () => { throw new Error('should not warn') })).toBe(body)
  })

  it('does not touch a lowercase HTML/JSX tag', () => {
    const body = '<iframe src="https://example.com" /> and <div>x</div>'
    expect(replaceUnknownComponents(body, () => { throw new Error('should not warn') })).toBe(body)
  })

  it('fixes a nested unknown component inside a known one', () => {
    const warned: Array<string> = []
    expect(replaceUnknownComponents('<Card><Gizmo>inner</Gizmo></Card>', (name) => warned.push(name)))
      .toBe('<Card><div>inner</div></Card>')
    expect(warned).toEqual(['Gizmo'])
  })

  it('never touches frontmatter, even when its value looks like an unknown tag', () => {
    const body = '---\ndescription: "<Widget />"\n---\n\n<Widget>x</Widget>'
    expect(replaceUnknownComponents(body, () => {})).toBe('---\ndescription: "<Widget />"\n---\n\n<div>x</div>')
  })

  // Regression: on fern-api/docs, a block-level unknown component (e.g.
  // Fern's <Template>) commonly wraps a fenced code block directly, with no
  // blank line before it — a real page's own author never needed one,
  // because the source component isn't rendered through MDX's block rules.
  // The fallback used to glue that content straight onto `<div>`, which
  // reads as inline text and desyncs the parser badly enough that the
  // reported error pointed at an unrelated `<div>` elsewhere on the page.
  it('separates a flow unknown component\'s block-level children (a fenced code block) with blank lines so the result still compiles', () => {
    const warned: Array<string> = []
    const body = [
      '<Template data={{ NAME: "x" }}>',
      '```bash',
      'echo hi',
      '```',
      '</Template>',
    ].join('\n')
    const out = replaceUnknownComponents(body, (name) => warned.push(name))
    expect(warned).toEqual(['Template'])
    expect(out).toContain('<div>\n\n```bash')
    expect(out).toContain('```\n\n</div>')
    expect(() => compileSync(out, { format: 'mdx' })).not.toThrow()
  })

  it('keeps an inline unknown component glued to its text-level children', () => {
    // A component used inline, mid-paragraph, never carries block content —
    // adding blank lines there would break the surrounding sentence instead
    // of fixing anything, so this case is untouched (matches the existing
    // "replaces a paired unknown component with a div" test above).
    const warned: Array<string> = []
    const body = 'See <Gizmo>new</Gizmo> for details.'
    const out = replaceUnknownComponents(body, (name) => warned.push(name))
    expect(warned).toEqual(['Gizmo'])
    expect(out).toBe('See <div>new</div> for details.')
  })

  it('compiles a flow unknown component nested inside another flow unknown component, each wrapping block content', () => {
    const body = [
      '<Steps>',
      '',
      '<Step title="One">',
      '',
      'Do the first thing.',
      '',
      '```bash',
      'echo one',
      '```',
      '',
      '</Step>',
      '',
      '</Steps>',
    ].join('\n')
    const out = replaceUnknownComponents(body, () => {})
    expect(() => compileSync(out, { format: 'mdx' })).not.toThrow()
  })

  it('compiles a self-closing unknown component nested directly inside a flow unknown component with no blank line', () => {
    // Mirrors the real fern-api/docs shape: <Steps><Markdown src="..."/> ...
    const body = '<Steps>\n<Markdown src="/x.mdx"/>\n<Step title="A">Body.</Step>\n</Steps>'
    const out = replaceUnknownComponents(body, () => {})
    expect(() => compileSync(out, { format: 'mdx' })).not.toThrow()
  })
})

describe('normalizeHtmlComments', () => {
  it('converts a single-line HTML comment to MDX comment syntax', () => {
    expect(normalizeHtmlComments('<!-- prettier-ignore -->')).toBe('{/* prettier-ignore */}')
  })

  it('converts a multi-line HTML comment', () => {
    expect(normalizeHtmlComments('<!--\nline one\nline two\n-->')).toBe('{/*\nline one\nline two\n*/}')
  })

  it('leaves an HTML comment inside a fenced code block untouched', () => {
    const body = '```html\n<!-- keep me -->\n```'
    expect(normalizeHtmlComments(body)).toBe(body)
  })

  it('leaves plain text with no comment unchanged', () => {
    const body = 'Just prose, no comments here.'
    expect(normalizeHtmlComments(body)).toBe(body)
  })
})
