/** Standalone chat fails closed; a disabled open panel uses reader-facing copy. */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
  callbacks: [] as Array<(...args: never[]) => unknown>,
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    // Simulate an already requested panel without relying on a browser DOM.
    if (!(index in hooks.values)) hooks.values[index] = index === 1 ? true : initial
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next
    }]
  },
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useCallback: (callback: (...args: never[]) => unknown) => {
    hooks.callbacks.push(callback)
    return callback
  },
}))

import { DocsChat } from './docs-chat'

function render(enabled = true, skipStatusCheck = false) {
  hooks.cursor = 0
  hooks.effects = []
  hooks.callbacks = []
  return renderToStaticMarkup(<DocsChat enabled={enabled} skipStatusCheck={skipStatusCheck} />)
}

describe('chat availability fallback', () => {
  beforeEach(() => { hooks.values = [] })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps unconfirmed chat out of the page', () => {
    expect(render()).toBe('')
  })

  it('does not reveal a panel when the standalone status request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    render()
    hooks.effects.at(-1)!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(render()).toBe('')
  })

  it('renders a reader-facing disabled fallback, never setup instructions', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const html = render(false, true)
    expect(html).toContain('AI chat is unavailable. Try searching the documentation.')
    expect(html).toContain('placeholder="AI chat is unavailable."')
    expect(html).not.toMatch(/ANTHROPIC|API_KEY|API key/)
    expect(html).toMatch(/disabled="" aria-label="Send"/)
    // The last callback is send. Even a stale suggestion handler cannot submit
    // a question after the component has been disabled.
    const send = hooks.callbacks.at(-1)! as (text: string) => Promise<void>
    await send('How do I get started?')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps the normal question placeholder when enabled', () => {
    expect(render(true, true)).toContain('placeholder="Ask a question…"')
  })
})
