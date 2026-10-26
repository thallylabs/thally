// @vitest-environment happy-dom
/** Missing artwork never becomes an image request; configured artwork follows reader mode. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteNameProvider } from './use-site-name'
import { Logo } from './logo'

const theme = vi.hoisted(() => ({ resolvedTheme: 'light' }))
vi.mock('@/components/theme/reader-theme', () => ({ useReaderTheme: () => theme }))

let container: HTMLDivElement
let root: Root
const view = () => <SiteNameProvider initialName="Example"><Logo /></SiteNameProvider>

beforeEach(() => {
  theme.resolvedTheme = 'light'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('logo availability', () => {
  it('emits no custom URL on the server or after a no-logo config refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ name: 'Example', logoAvailability: { light: false, dark: false } })))
    expect(renderToStaticMarkup(view())).not.toContain('/api/brand/logo')
    await act(async () => root.render(view()))
    expect(container.querySelector('[data-custom-logo]')).toBeNull()
    expect(container.textContent).toBe('Example')
  })

  it('preserves uploaded artwork, dark mode, and the fallback after an image error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ logoAvailability: { light: true, dark: true } })))
    await act(async () => root.render(view()))
    const image = container.querySelector('[data-custom-logo]')!
    expect(image.getAttribute('src')).toBe('/api/brand/logo')
    await act(async () => image.dispatchEvent(new Event('load')))
    expect(container.textContent).toBe('')
    theme.resolvedTheme = 'dark'
    await act(async () => root.render(view()))
    const dark = container.querySelector('[data-custom-logo]')!
    expect(dark.getAttribute('src')).toBe('/api/brand/logo?mode=dark')
    await act(async () => dark.dispatchEvent(new Event('error')))
    expect(container.textContent).toBe('Example')
    expect(container.querySelector('img[src="/brand/default-logo-light.svg"]')).not.toBeNull()
  })

  it('keeps the default mark when config is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')))
    await act(async () => root.render(view()))
    expect(container.querySelector('[data-custom-logo]')).toBeNull()
    expect(container.textContent).toBe('Example')
  })

  it('requests dark-only artwork only after the reader switches to dark mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ logoAvailability: { light: false, dark: true } })))
    await act(async () => root.render(view()))
    expect(container.querySelector('[data-custom-logo]')).toBeNull()
    theme.resolvedTheme = 'dark'
    await act(async () => root.render(view()))
    expect(container.querySelector('[data-custom-logo]')?.getAttribute('src')).toBe('/api/brand/logo?mode=dark')
  })

  it('recognizes already loaded cached artwork when configuration arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ logoAvailability: { light: true, dark: true } })))
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(28)
    await act(async () => root.render(view()))
    expect(container.textContent).toBe('')
    expect((container.querySelector('[data-custom-logo]') as HTMLImageElement).style.display).toBe('block')
  })
})
