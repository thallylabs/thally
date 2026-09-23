/** Generated page descriptions contain readable prose, never component syntax. */

import { describe, expect, it } from 'vitest'

import { normalizeMdx, parseMarkdownPage } from '../mdx.js'

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
    expect(normalizeMdx('<FileTree>\n- docs/\n</FileTree>')).toBe('<Tree>\n- docs/\n</Tree>')
  })

  it('rewrites <Column> to a plain <div> so Columns lays it out without a registry entry', () => {
    expect(normalizeMdx('<Columns cols={2}>\n  <Column>Text</Column>\n</Columns>'))
      .toBe('<Columns cols={2}>\n  <div>Text</div>\n</Columns>')
  })

  it("unwraps Fern's per-tab <CodeBlock> inside a <CodeBlocks> group, but preserves Mintlify's standalone <CodeBlock> component", () => {
    expect(normalizeMdx('<CodeBlocks>\n<CodeBlock title="npm">\n```bash\nnpm install acme\n```\n</CodeBlock>\n</CodeBlocks>'))
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
    expect(normalizeMdx('<GitHub.Repo repo="mintlify/docs" variant="inset" />'))
      .toBe('<GitHub repo="mintlify/docs" variant="inset" />')
  })

  it("maps a Docusaurus <TabItem>'s value to its <Tabs> values[] label, preferring the item's own label, and strips Docusaurus-only Tabs props", () => {
    const body = '<Tabs\n  defaultValue="native"\n  values={[\n    { label: \'Native\', value: \'native\' },\n    { label: \'React\', value: \'react\' },\n  ]}\n  groupId="framework">\n<TabItem value="native">Native body</TabItem>\n<TabItem value="react" label="Custom">React body</TabItem>\n</Tabs>'
    const result = normalizeMdx(body)
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
    // Omitting the platform (used by direct unit tests) keeps every rename available.
    expect(normalizeMdx(body)).toBe('<Tip>Done</Tip>')
  })
})
