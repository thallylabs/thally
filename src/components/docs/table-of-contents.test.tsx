/** Scroll tracking must retain the heading reached below either header layout. */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setActive: vi.fn(),
  items: [{ id: 'first', text: 'First', level: 2 }, { id: 'second', text: 'Second', level: 2 }],
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/guide' }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useState: (initial: unknown) => Array.isArray(initial)
    ? [mocks.items, vi.fn()]
    : [undefined, mocks.setActive],
}))

import { TableOfContents } from './table-of-contents'

describe('table of contents scroll tracking', () => {
  beforeEach(() => {
    mocks.effects = []
    mocks.setActive.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['inline', 96],
    ['stacked', 128],
  ])('keeps the target active after a %s-header anchor scroll', (_layout, margin) => {
    const listeners = new Map<string, () => void>()
    let targetTop = 500
    const headings = new Map([
      ['first', { id: 'first', getBoundingClientRect: () => ({ top: -200 }) }],
      ['second', { id: 'second', getBoundingClientRect: () => ({ top: targetTop }) }],
    ])
    vi.stubGlobal('document', { getElementById: (id: string) => headings.get(id) })
    vi.stubGlobal('window', {
      addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('getComputedStyle', () => ({ scrollMarginTop: `${margin}px` }))
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    renderToStaticMarkup(<TableOfContents />)
    // Run the actual tracking effect against viewport positions. Heading
    // discovery is independent and its already-populated state is supplied above.
    const cleanup = mocks.effects[1]()
    expect(mocks.setActive).toHaveBeenLastCalledWith('first')
    targetTop = margin
    listeners.get('scroll')!()
    expect(mocks.setActive).toHaveBeenLastCalledWith('second')
    targetTop = margin + 200
    listeners.get('scroll')!()
    expect(mocks.setActive).toHaveBeenLastCalledWith('first')
    cleanup?.()
  })
})
