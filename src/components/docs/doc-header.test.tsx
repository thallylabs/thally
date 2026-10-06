/** The page title wraps instead of overflowing on a long unbroken word. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/guide' }))

import { DocHeader } from './doc-header'

describe('DocHeader', () => {
  it('lets a long title break', () => {
    const html = renderToStaticMarkup(<DocHeader doc={{ title: 'Supercalifragilisticexpialidocious'.repeat(3) } as never} showCopyPage={false} />)
    expect(html).toMatch(/<h1 class="[^"]*break-words/)
  })
})
