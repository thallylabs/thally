/** Partial Markdown must remain inert until its destination is grounded. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatResponse } from './docs-chat-response'
import { aiAnswerLink } from '@/lib/ai-answer-links'

const sources = [{ title: 'Guide', url: '/guide?mode=one#start' }]
function render(text: string) {
  return renderToStaticMarkup(<ChatResponse text={text} sources={sources} status="streaming" onRetry={() => {}} isRetryDisabled={false} />)
}

describe('progressive answer rendering', () => {
  it('keeps valid evidence links and strips invented destinations, scripts and images', () => {
    const html = render('[Guide](/guide?mode=one#another) [Wrong query](/guide?mode=two) [Invented](https://fake.example/guide) [Script](javascript:alert%281%29) ![Screenshot](https://tracker.example/pixel) <img src=x onerror=alert(1)>')
    expect(html).toContain('href="/guide?mode=one#another"')
    expect(html).not.toContain('href="/guide?mode=two"')
    expect(html).not.toMatch(/fake\.example|javascript:|<img|tracker\.example|onerror/)
    expect(html).toContain('Screenshot')
  })

  it('renders incomplete Markdown and later corrected snapshots without unsafe links', () => {
    expect(render('Use **the guide** and [read](/gu')).not.toContain('href=')
    expect(render('Use **the guide** and [read](/guide?mode=one)')).toContain('<strong>the guide</strong>')
    expect(render('[read](/guide?mode=one)')).toContain('href="/guide?mode=one"')
    expect(render('```ts\nconst count = 1')).toContain('<code class="language-ts">')
  })

  it('renders GFM tables and preserves provider text without fabricated delays', () => {
    const html = render('| Name | Value |\n| --- | --- |\n| First | 1 |')
    expect(html).toContain('<table>')
    expect(html).toContain('First')
    expect(html).toContain('aria-busy="true"')
  })

  it('accepts only exact same-origin evidence pages and queries', () => {
    expect(aiAnswerLink('https://docs.example/guide?mode=one#section', sources, 'https://docs.example')).toBe('/guide?mode=one#section')
    for (const value of ['//evil.example/guide', '/\\evil.example/guide', 'https://docs.example@evil.example/guide', 'mailto:me@example.com', '/guide?mode=two']) {
      expect(aiAnswerLink(value, sources, 'https://docs.example')).toBeUndefined()
    }
  })

  it('never returns a protocol-relative path after URL normalization', () => {
    const malformedSources = [{ title: 'Guide', url: '/.//evil.example/path' }]
    expect(aiAnswerLink('/.//evil.example/path', malformedSources, 'https://docs.example')).toBeUndefined()
    expect(aiAnswerLink('https://docs.example/.//evil.example/path', malformedSources, 'https://docs.example')).toBeUndefined()
  })
})
