/** The sidebar opens at the current page instead of always starting at its top. */

import { describe, expect, it, vi } from 'vitest'
import { revealActiveLink } from './reveal-active-link'

function navWith(link: { top: number; bottom: number } | null) {
  const scrollIntoView = vi.fn()
  const nav = {
    scrollTop: 50,
    getBoundingClientRect: () => ({ top: 100, bottom: 500, height: 400 }),
    querySelector: vi.fn(() => link && { getBoundingClientRect: () => ({ ...link, height: link.bottom - link.top }), scrollIntoView }),
  }
  return { nav, scrollIntoView, querySelector: nav.querySelector }
}

describe('revealActiveLink', () => {
  it('centres an off-screen active link by scrolling only the sidebar', () => {
    const { nav, scrollIntoView, querySelector } = navWith({ top: 900, bottom: 930 })
    revealActiveLink(nav as unknown as HTMLElement)
    expect(querySelector).toHaveBeenCalledWith('a[aria-current="page"]')
    // link centre 915 -> area centre 300: move by (900 - 100) - (400 - 30) / 2 = 615
    expect(nav.scrollTop).toBe(50 + 615)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls back up to a link above the visible area', () => {
    const { nav } = navWith({ top: 0, bottom: 30 })
    revealActiveLink(nav as unknown as HTMLElement)
    expect(nav.scrollTop).toBe(50 + (0 - 100) - 185)
  })

  it('leaves the scroll position alone when the active link is already visible', () => {
    const { nav, scrollIntoView } = navWith({ top: 200, bottom: 230 })
    revealActiveLink(nav as unknown as HTMLElement)
    expect(nav.scrollTop).toBe(50)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing without an active link or container', () => {
    const { nav, scrollIntoView } = navWith(null)
    revealActiveLink(nav as unknown as HTMLElement)
    revealActiveLink(null)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
