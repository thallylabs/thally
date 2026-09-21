/** Exercise reader policy and streamed metadata updates without a browser runtime. */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeFavicon } from './theme-favicon'

const state = vi.hoisted(() => ({
  theme: {} as { resolvedTheme?: string; forcedTheme?: string; systemTheme?: string },
  effect: undefined as undefined | (() => void | (() => void)),
}))
vi.mock('next-themes', () => ({ useTheme: () => state.theme }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { state.effect = effect },
}))

function icon(href: string, media?: string) {
  const attributes = new Map<string, string>([['href', href], ...(media ? [['media', media] as [string, string]] : [])])
  return {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: vi.fn((name: string, value: string) => { attributes.set(name, value) }),
    removeAttribute: vi.fn((name: string) => { attributes.delete(name) }),
  }
}

describe('ThemeFavicon', () => {
  let links: ReturnType<typeof icon>[]
  let onMutation: () => void
  const disconnect = vi.fn()

  beforeEach(() => {
    state.theme = {}
    links = [icon('/api/brand/favicon', '(prefers-color-scheme: light)'), icon('/api/brand/favicon?mode=dark', '(prefers-color-scheme: dark)'), icon('/api/brand/favicon'), icon('/icon.png')]
    vi.stubGlobal('document', { head: { querySelectorAll: () => links } })
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { onMutation = callback }
      observe = vi.fn()
      disconnect = disconnect
    })
    disconnect.mockClear()
  })

  afterEach(() => vi.unstubAllGlobals())

  function mount() {
    expect(renderToStaticMarkup(<ThemeFavicon />)).toBe('')
    return state.effect?.()
  }

  it('preserves server media fallbacks while the theme is unresolved', () => {
    mount()
    expect(links[0].getAttribute('media')).toBe('(prefers-color-scheme: light)')
    expect(links[1].getAttribute('href')).toBe('/api/brand/favicon?mode=dark')
  })

  it.each(['light', 'dark'])('follows a resolved %s choice even when the OS prefers the opposite', (resolvedTheme) => {
    state.theme = { resolvedTheme, systemTheme: resolvedTheme === 'dark' ? 'light' : 'dark' }
    mount()
    const expected = resolvedTheme === 'dark' ? '/api/brand/favicon?mode=dark' : '/api/brand/favicon'
    for (const link of links.slice(0, 3)) {
      expect(link.getAttribute('href')).toBe(expected)
      expect(link.hasAttribute('media')).toBe(false)
    }
    expect(links[3].getAttribute('href')).toBe('/icon.png')
    expect(links[3].setAttribute).not.toHaveBeenCalled()
  })

  it('uses the locked owner default over a saved reader choice', () => {
    state.theme = { resolvedTheme: 'light', forcedTheme: 'dark' }
    mount()
    expect(links[0].getAttribute('href')).toBe('/api/brand/favicon?mode=dark')
  })

  it('uses the OS for locked system appearance', () => {
    state.theme = { resolvedTheme: 'dark', forcedTheme: 'system', systemTheme: 'light' }
    mount()
    expect(links[1].getAttribute('href')).toBe('/api/brand/favicon')
  })

  it('resynchronizes metadata replacements without repeated attribute writes', () => {
    state.theme = { resolvedTheme: 'dark' }
    const cleanup = mount()
    const streamed = icon('/api/brand/favicon', '(prefers-color-scheme: light)')
    links.push(streamed)
    onMutation()
    expect(streamed.getAttribute('href')).toBe('/api/brand/favicon?mode=dark')
    onMutation()
    expect(streamed.setAttribute).toHaveBeenCalledTimes(1)
    expect(streamed.removeAttribute).toHaveBeenCalledTimes(1)
    if (cleanup) cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('updates existing links when a reader switches from dark to light', () => {
    state.theme = { resolvedTheme: 'dark' }
    const cleanup = mount()
    if (cleanup) cleanup()
    state.theme = { resolvedTheme: 'light' }
    mount()
    expect(links.slice(0, 3).map((link) => link.getAttribute('href'))).toEqual(Array(3).fill('/api/brand/favicon'))
  })
})
