/** Request-bound Cloud branding precedence coverage. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  getCloudSiteConfig: vi.fn(),
}))

vi.mock('@/lib/admin/settings', () => ({ getAdminSettings: mocks.getAdminSettings }))
vi.mock('@/lib/cloud-link/client', () => ({ getCloudSiteConfig: mocks.getCloudSiteConfig }))

import { GET } from './route'

describe('GET /api/brand.css', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminSettings.mockResolvedValue({ brandTheme: null, brandAccent: null })
    mocks.getCloudSiteConfig.mockResolvedValue(null)
  })

  it('renders managed color and font settings into a validated stylesheet', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue({
      siteConfig: {
        portable: {
          branding: {
            themePreset: 'sharp',
            colors: { light: { primary: '#111827', accent: '#0f766e' } },
            fonts: { body: { source: 'google', family: 'IBM Plex Sans' } },
          },
        },
      },
    })

    const response = await GET(new NextRequest('https://docs.example.com/api/brand.css'))
    const css = await response.text()

    expect(css).toContain('family=IBM+Plex+Sans')
    expect(css).toContain('--brand-light-primary:221 39% 11%')
    expect(css).toContain('--theme-radius-sm:0.125rem')
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8')
  })

  it('keeps the single-site admin accent as the fallback for unlinked sites', async () => {
    mocks.getAdminSettings.mockResolvedValue({
      brandTheme: null,
      brandAccent: { light: '#0f766e', dark: '#5eead4' },
    })

    const response = await GET(new NextRequest('https://docs.example.com/api/brand.css'))
    const css = await response.text()

    expect(css).toContain('--brand-light-accent:175 77% 26%')
    expect(css).toContain('--brand-dark-accent:171 77% 64%')
  })
})
