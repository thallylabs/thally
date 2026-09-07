/** Header measurement follows wrapping, ignores hidden frames, and cleans up its shell. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeHeaderHeight } from './header-height'

afterEach(() => vi.unstubAllGlobals())

describe('header height observation', () => {
  it('updates only the nearest shell after wrapping and restores its prior value', () => {
    let height = 104
    let resize = () => {}
    const values = new Map([['--docs-header-height', '60px']])
    const root = { style: {
      getPropertyValue: (name: string) => values.get(name) ?? '',
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    } }
    const dockValues = new Map<string, string>()
    const layout = { style: {
      getPropertyValue: (name: string) => dockValues.get(name) ?? '',
      setProperty: (name: string, value: string) => dockValues.set(name, value),
      removeProperty: (name: string) => dockValues.delete(name),
    } }
    const header = {
      closest: vi.fn((selector: string) => selector === '.thally-docs-root' ? root : layout),
      getBoundingClientRect: () => ({ height }),
    } as unknown as HTMLElement
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', vi.fn(function (callback: () => void) {
      resize = callback
      return { observe, disconnect }
    }))
    const cleanup = observeHeaderHeight(header)
    expect(header.closest).toHaveBeenCalledWith('.thally-docs-root')
    expect(observe).toHaveBeenCalledWith(header)
    expect(values.get('--docs-header-height')).toBe('104px')
    expect(dockValues.get('--docs-header-height')).toBe('104px')
    height = 148
    resize()
    expect(values.get('--docs-header-height')).toBe('148px')
    expect(dockValues.get('--docs-header-height')).toBe('148px')
    height = 0
    resize()
    expect(values.get('--docs-header-height')).toBe('148px')
    height = 60
    resize()
    expect(values.get('--docs-header-height')).toBe('60px')
    expect(dockValues.get('--docs-header-height')).toBe('60px')
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(values.get('--docs-header-height')).toBe('60px')
    expect(dockValues.has('--docs-header-height')).toBe(false)
  })

  it('leaves an unscoped header alone', () => {
    const header = { closest: () => null, getBoundingClientRect: vi.fn() } as unknown as HTMLElement
    observeHeaderHeight(header)()
    expect(header.getBoundingClientRect).not.toHaveBeenCalled()
  })
})
