import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getCloudSiteConfig: vi.fn(),
  resolveSiteConfig: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/cloud-link/client', () => ({ getCloudSiteConfig: mocks.getCloudSiteConfig }))
vi.mock('@/lib/site-config', () => ({ resolveSiteConfig: mocks.resolveSiteConfig }))
vi.mock('@/data/docs', () => ({ getFeedbackConfig: () => ({}) }))
vi.mock('@/components/docs/feedback', () => ({ Feedback: () => <i data-feedback /> }))

import { ApiLayout } from '@/components/api/api-layout'

beforeEach(() => {
  vi.resetAllMocks()
  for (const name of ['THALLY_SITE_URL', 'THALLY_CONTENT_SOURCE', 'THALLY_CLOUD_SITE_TOKEN', 'DOX_CLOUD_SITE_TOKEN', 'THALLY_CLOUD_SITE_CONFIG', 'DOX_CLOUD_SITE_CONFIG']) vi.stubEnv(name, undefined)
  // What Next does to a page that reads request headers while it is prerendered.
  mocks.headers.mockRejectedValue(new Error('DYNAMIC_SERVER_USAGE'))
  mocks.getCloudSiteConfig.mockResolvedValue(null)
  mocks.resolveSiteConfig.mockResolvedValue({ repoUrl: 'https://github.com/acme/docs' })
})
afterEach(() => vi.unstubAllEnvs())

describe('the API page shell', () => {
  it('reads no request header on a site that is not linked to Cloud, so its pages can be prerendered', async () => {
    const html = renderToStaticMarkup(await ApiLayout({ children: 'Operation' }))
    expect(html).toContain('Operation')
    expect(html).toContain('data-feedback')
    expect(mocks.headers).not.toHaveBeenCalled()
    expect(mocks.getCloudSiteConfig).not.toHaveBeenCalled()
    expect(mocks.resolveSiteConfig).toHaveBeenCalledWith(undefined)
  })

  it('resolves the request origin and the live Cloud settings on a linked site', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'token')
    mocks.headers.mockResolvedValue(new Headers({ host: 'docs.example.com', 'x-forwarded-proto': 'https' }))
    mocks.getCloudSiteConfig.mockResolvedValue({ siteConfig: { portable: { feedback: { thumbsRating: false, issueReporting: false } } } })
    const html = renderToStaticMarkup(await ApiLayout({ children: 'Operation' }))
    expect(mocks.headers).toHaveBeenCalled()
    expect(mocks.getCloudSiteConfig).toHaveBeenCalledWith('https://docs.example.com')
    expect(mocks.resolveSiteConfig).toHaveBeenCalledWith('https://docs.example.com')
    expect(html).not.toContain('data-feedback')
  })
})
