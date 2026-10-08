/** The page title wraps instead of overflowing on a long unbroken word. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/guide' }))

import { DocHeader } from './doc-header'

describe('DocHeader', () => {
  it('uses the authored display heading while retaining the metadata title', () => {
    const html = renderToStaticMarkup(<DocHeader doc={{ title: 'Long SEO title', headingTitle: 'Display title' } as never} showCopyPage={false} />)
    expect(html).toContain('Display title</h1>')
    expect(html).not.toContain('Long SEO title')
  })
  it('lets a long title break', () => {
    const html = renderToStaticMarkup(<DocHeader doc={{ title: 'Supercalifragilisticexpialidocious'.repeat(3) } as never} showCopyPage={false} />)
    expect(html).toMatch(/<h1 class="[^"]*break-words/)
  })
})
