/** Regression tests for code-panel language, framework, and filename labels. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

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
