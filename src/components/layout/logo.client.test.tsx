// @vitest-environment happy-dom
/** Optional artwork must not emit broken probes and still follows live mode changes. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ resolvedTheme: 'light' }))
vi.mock('@/components/theme/reader-theme', () => ({ useReaderTheme: () => state }))
import { SiteNameProvider } from './use-site-name'
import { Logo } from './logo'
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  state.resolvedTheme = 'light'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
const render = () => root.render(<SiteNameProvider initialName="Example"><Logo /></SiteNameProvider>)
describe('optional site logo', () => {
  it.each([false, true])('requests custom artwork only when availability is %s', async available => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ name: 'Example', logos: { light: available, dark: available } })))
    await act(async () => render())
    const custom = container.querySelector<HTMLImageElement>('[data-custom-logo]')
    expect(Boolean(custom)).toBe(available)
    expect(container.textContent).toContain('Example')
    if (custom) {
      expect(custom.getAttribute('src')).toBe('/api/brand/logo')
      await act(async () => custom.dispatchEvent(new Event('load')))
      expect(container.textContent).not.toContain('Example')
      state.resolvedTheme = 'dark'
      await act(async () => render())
      expect(custom.getAttribute('src')).toBe('/api/brand/logo?mode=dark')
      await act(async () => custom.dispatchEvent(new Event('error')))
      expect(container.textContent).toContain('Example')
    }
  })
  it('retains readable defaults when the identity refresh is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await act(async () => render())
    expect(container.querySelector('[data-custom-logo]')).toBeNull()
    expect(container.textContent).toContain('Example')
  })
})
