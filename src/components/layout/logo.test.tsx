/** Wordmarks keep intrinsic proportions while failed uploads retain the default mark. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Logo } from './logo'

vi.mock('@/components/theme/reader-theme', () => ({ useReaderTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('./use-site-name', () => ({ useSiteName: () => 'Example', displaySiteName: (name: string) => name }))

describe('logo sizing', () => {
  it('renders a height-led custom image with bounded, proportional width', () => {
    const html = renderToStaticMarkup(<Logo showText={false} />)
    const custom = html.match(/<img[^>]*data-custom-logo=""[^>]*>/)?.[0]
    expect(custom).toContain('height:28px;width:auto;max-width:min(160px, 100%)')
    expect(custom).toContain('object-fit:contain;object-position:left')
    expect(custom).toContain('alt="Example"')
    expect(html).toContain('min-w-0 max-w-full')
    expect(html).toContain('src="/brand/default-logo-light.svg"')
    expect(html).not.toContain('<span')
  })

  it('retains the readable site-name fallback when requested', () => {
    const html = renderToStaticMarkup(<Logo />)
    expect(html).toContain('>Example</span>')
    expect(html).toContain('width="28" height="28"')
  })
})
