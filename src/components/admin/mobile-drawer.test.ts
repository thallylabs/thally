/** Focus-trap, dismissal, inertness, and restoration coverage for the drawer. */

import { describe, expect, it, vi } from 'vitest'
import {
  activateMobileDrawer,
  handleMobileDrawerKeyDown,
} from '@/components/admin/mobile-drawer'

function keyEvent(key: string, shiftKey = false): KeyboardEvent {
  return { key, shiftKey, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

describe('handleMobileDrawerKeyDown', () => {
  it('dismisses on Escape and wraps Tab in both directions', () => {
    const first = { focus: vi.fn(), hasAttribute: () => false, getAttribute: () => null }
    const last = { focus: vi.fn(), hasAttribute: () => false, getAttribute: () => null }
    const document = { activeElement: last }
    const drawer = {
      ownerDocument: document,
      querySelectorAll: () => [first, last],
      contains: (value: unknown) => value === first || value === last,
      focus: vi.fn(),
    } as unknown as HTMLElement
    const dismiss = vi.fn()

    const escape = keyEvent('Escape')
    handleMobileDrawerKeyDown(escape, drawer, dismiss)
    expect(dismiss).toHaveBeenCalledOnce()
    expect(escape.preventDefault).toHaveBeenCalledOnce()

    const forward = keyEvent('Tab')
    handleMobileDrawerKeyDown(forward, drawer, dismiss)
    expect(first.focus).toHaveBeenCalledOnce()
    expect(forward.preventDefault).toHaveBeenCalledOnce()

    document.activeElement = first
    const backward = keyEvent('Tab', true)
    handleMobileDrawerKeyDown(backward, drawer, dismiss)
    expect(last.focus).toHaveBeenCalledOnce()
    expect(backward.preventDefault).toHaveBeenCalledOnce()
  })
})

describe('activateMobileDrawer', () => {
  it('focuses entry, makes the background inert, and restores exact prior state', () => {
    const entry = { focus: vi.fn() }
    const listeners = new Map<string, EventListener>()
    const document = {
      activeElement: null,
      body: { style: { overflow: 'clip' } },
      addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    }
    const drawer = {
      ownerDocument: document,
      querySelector: () => entry,
      querySelectorAll: () => [],
      contains: () => false,
      focus: vi.fn(),
    } as unknown as HTMLElement
    const attributes = new Map<string, string>([['aria-hidden', 'false']])
    const background = {
      inert: false,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLElement
    const opener = { focus: vi.fn() } as unknown as HTMLElement

    const restore = activateMobileDrawer(drawer, background, opener, vi.fn())
    expect(entry.focus).toHaveBeenCalledOnce()
    expect(background.inert).toBe(true)
    expect(attributes.get('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(listeners.has('keydown')).toBe(true)

    restore()
    expect(background.inert).toBe(false)
    expect(attributes.get('aria-hidden')).toBe('false')
    expect(document.body.style.overflow).toBe('clip')
    expect(opener.focus).toHaveBeenCalledOnce()
    expect(listeners.has('keydown')).toBe(false)
  })
})
