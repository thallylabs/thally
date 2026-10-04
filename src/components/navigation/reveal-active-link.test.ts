/** The sidebar opens at the current page instead of always starting at its top. */

import { describe, expect, it, vi } from 'vitest'
import { revealActiveLink } from './reveal-active-link'

function navWith(link: { top: number; bottom: number } | null) {
  const scrollIntoView = vi.fn()
  const nav = {
    getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
    querySelector: vi.fn(() => link && { getBoundingClientRect: () => link, scrollIntoView }),
  }
  return { nav: nav as unknown as HTMLElement, scrollIntoView, querySelector: nav.querySelector }
}

describe('revealActiveLink', () => {
  it('scrolls an off-screen active link into view without animation', () => {
    const { nav, scrollIntoView, querySelector } = navWith({ top: 900, bottom: 930 })
    revealActiveLink(nav)
    expect(querySelector).toHaveBeenCalledWith('a[aria-current="page"]')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' })
  })

  it('leaves the scroll position alone when the active link is already visible', () => {
    const { nav, scrollIntoView } = navWith({ top: 200, bottom: 230 })
    revealActiveLink(nav)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing without an active link or container', () => {
    const { nav, scrollIntoView } = navWith(null)
    revealActiveLink(nav)
    revealActiveLink(null)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
