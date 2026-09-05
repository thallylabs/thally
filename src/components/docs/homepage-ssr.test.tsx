/** No-JavaScript regression coverage for the precompiled documentation home. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { runtimeDocs } from '@/generated/runtime-docs'
import { useMDXComponents } from '@/components/mdx/mdx-components'

// Client navigation helpers need the App Router; static rendering has none.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

describe('documentation homepage SSR', () => {
  it('ships a substantive H1-led heading hierarchy in raw HTML', () => {
    const Introduction = runtimeDocs['src/content/introduction.mdx'].component
    const html = renderToStaticMarkup(
      <Introduction components={useMDXComponents({})} />,
    )
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect((html.match(/<h2\b/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(text.length).toBeGreaterThanOrEqual(500)
    expect(text).toContain(
      'Your product changed. Did your docs, website, and help center?',
    )
  })
})
