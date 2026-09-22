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

import { Code, Pre } from './code-blocks'

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
