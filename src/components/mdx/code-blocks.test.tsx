/** Regression tests for code-panel language, framework, and filename labels. */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const assistant = vi.hoisted(() => ({ available: false }))
vi.mock('@/components/docs/code-actions-provider', () => ({
  useDocsCodeActions: () => ({
    hasAssistantEntryPoint: assistant.available,
    assistantLabel: 'Ask docs',
    canReportCode: true,
    reportCode: vi.fn(),
    askAssistant: vi.fn(),
  }),
}))

import { Code, CodeGroup, Pre } from './code-blocks'

function renderPanel({
  language,
  title,
  tag,
}: {
  language: string
  title?: string
  tag?: string
}) {
  return renderToStaticMarkup(
    <Pre
      language={language}
      title={title}
      tag={tag}
      code="const answer = 42"
    >
      <Code className={`language-${language}`}>const answer = 42</Code>
    </Pre>,
  )
}

describe('code-panel labels', () => {
  beforeEach(() => { assistant.available = false })

  it('keeps copy and report actions without advertising an unavailable assistant', () => {
    const html = renderPanel({ language: 'typescript' })
    expect(html).not.toContain('Ask assistant about this code')
    expect(html).toContain('Report incorrect code')
    expect(html).toContain('Copy')
  })

  it('offers the code assistant when available', () => {
    assistant.available = true
    expect(renderPanel({ language: 'typescript' })).toContain('Ask assistant about this code')
  })

  it('shows the normalized language name as the default tag', () => {
    const html = renderPanel({ language: 'typescript' })
    expect(html).toContain('TypeScript')
    expect(html).not.toContain('TYPESCRIPT')
  })

  it('shows a framework tag and keeps the filename beside it', () => {
    const html = renderPanel({
      language: 'tsx',
      title: 'app/page.tsx',
      tag: 'Next.js',
    })
    expect(html).toContain('Next.js')
    expect(html).toContain('app/page.tsx')
  })

  it('labels explicitly plain fences without claiming a syntax grammar', () => {
    expect(renderPanel({ language: 'txt' })).toContain('Plain text')
  })
})

describe('code-panel fence options', () => {
  beforeEach(() => { assistant.available = false })

  const render = (props: Record<string, unknown>, code = 'const answer = 42') =>
    renderToStaticMarkup(
      <Pre language="typescript" code={code} {...props}>
        <Code className="language-typescript">{code}</Code>
      </Pre>,
    )

  it('leaves plain fences without option markup', () => {
    const html = render({})
    expect(html).not.toContain('thally-code-lines')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('data-icon-name')
    expect(html).toContain('Copy code')
  })

  it('marks line-numbered fences', () => {
    expect(render({ lines: '' })).toContain('thally-code-lines')
  })

  it('hides only the copy button for nocopy', () => {
    const html = render({ nocopy: '' })
    expect(html).not.toContain('Copy code')
    expect(html).toContain('Report incorrect code')
  })

  it('renders a header icon', () => {
    expect(render({ icon: 'code', title: 'app.ts' })).toContain('data-icon-name="code"')
  })

  it('renders an accessible toggle only for long expandable fences', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const html = render({ expandable: '' }, long)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Expand')
    expect(render({ expandable: '' })).not.toContain('aria-expanded')
  })

  it('works inside a multi-panel CodeGroup', () => {
    const html = renderToStaticMarkup(
      <CodeGroup>
        <Pre language="typescript" code="a" lines="" icon="code" title="one.ts"><Code className="language-typescript">a</Code></Pre>
        <Pre language="python" code="b" nocopy=""><Code className="language-python">b</Code></Pre>
      </CodeGroup>,
    )
    expect(html).toContain('thally-code-lines')
    expect(html).toContain('data-icon-name="code"')
  })
})
