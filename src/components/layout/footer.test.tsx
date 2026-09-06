/** Raw server markup proves attribution removal happens before hydration. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Footer } from './footer'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const variants = [
  { name: 'default', footerConfig: undefined },
  { name: 'configured', footerConfig: { links: [{ heading: 'Docs', items: [{ label: 'Start', href: '/start' }] }], socials: { github: 'https://github.com/example' } } },
]

describe.each(variants)('$name footer', ({ footerConfig }) => {
  it('emits one accessible, quiet mark beside copyright by default', () => {
    const html = renderToStaticMarkup(<Footer siteName="Example" siteLinks={[]} footerConfig={footerConfig} />)
    expect(html.match(/aria-label="Powered by Thally"/g)).toHaveLength(1)
    expect(html).toContain('https://thally.io?utm_source=powered-by&amp;utm_medium=docs-footer')
    expect(html).toContain('rel="noopener"')
    expect(html).toContain('width="12" height="12"')
    expect(html).toContain('<b class="font-semibold">Thally</b>')
    expect(html.indexOf('All rights reserved.')).toBeLessThan(html.indexOf('aria-label="Powered by Thally"'))
    expect(html).toContain('sm:border-l')
    expect(html).toContain('sm:pl-6')
  })

  it('omits the complete mark from server HTML when paid removal is authorized', () => {
    const html = renderToStaticMarkup(<Footer siteName="Example" siteLinks={[]} footerConfig={footerConfig} showPoweredBy={false} />)
    expect(html).not.toContain('Powered by')
    expect(html).not.toContain('utm_source=powered-by')
    expect(html).not.toContain('M30.7 2.3')
    expect(html).toContain('Example. All rights reserved.')
  })
})
