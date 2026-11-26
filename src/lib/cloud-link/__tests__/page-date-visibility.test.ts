/** External linked grants affect only the all-plan page-date preference. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  origin: vi.fn(),
  cloud: vi.fn(),
  snapshot: vi.fn(),
  local: vi.fn(),
  remote: vi.fn(),
}))
vi.mock('next/server', () => ({ connection: mocks.connection }))
vi.mock('../request', () => ({ getRequestOrigin: mocks.origin }))
vi.mock('../client', () => ({ getCloudSiteConfig: mocks.cloud, getManagedSiteConfigSnapshot: mocks.snapshot }))
vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: mocks.local }))
vi.mock('@/lib/content-source', () => ({ isRemoteContentSource: mocks.remote }))

import { getBuildContentControls } from '../content-controls'
import { getEffectivePageDateVisibility } from '../page-date-visibility'

beforeEach(() => {
  vi.resetAllMocks()
  for (const name of ['THALLY_CLOUD_SITE_CONFIG', 'DOX_CLOUD_SITE_CONFIG', 'THALLY_CLOUD_SITE_TOKEN', 'DOX_CLOUD_SITE_TOKEN']) vi.stubEnv(name, undefined)
  mocks.local.mockReturnValue({})
  mocks.snapshot.mockReturnValue(null)
  mocks.remote.mockReturnValue(false)
  mocks.origin.mockResolvedValue('https://linked.example.com')
  mocks.cloud.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe('page-date visibility authority', () => {
  it('keeps an unlinked OSS site static with the default visible date', async () => {
    await expect(getEffectivePageDateVisibility()).resolves.toBe(true)
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.origin).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('honors local false without a token or request/network work', async () => {
    mocks.local.mockReturnValue({ content: { showLastUpdated: false } })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('uses a managed snapshot without exchanging any external credential', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.snapshot.mockReturnValue({ siteConfig: { portable: { content: { showLastUpdated: false } } } })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each(['THALLY_CLOUD_SITE_CONFIG', 'DOX_CLOUD_SITE_CONFIG'])('keeps malformed managed %s on local fallback', async (name) => {
    vi.stubEnv(name, '{malformed')
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.local.mockReturnValue({ content: { showLastUpdated: false } })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each([
    ['THALLY_CLOUD_SITE_CONFIG', ''],
    ['THALLY_CLOUD_SITE_CONFIG', '  \t '],
    ['DOX_CLOUD_SITE_CONFIG', ''],
    ['DOX_CLOUD_SITE_CONFIG', '  \n '],
  ])('honors an external token when %s is a blank placeholder', async (name, value) => {
    vi.stubEnv(name, value)
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.cloud.mockResolvedValue({ siteConfig: { portable: { content: { showLastUpdated: false } } } })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
    expect(mocks.connection).toHaveBeenCalledOnce()
    expect(mocks.cloud).toHaveBeenCalledWith('https://linked.example.com')
  })

  it('does not exchange an external credential from an assets-mode deployment', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.remote.mockReturnValue(true)
    await expect(getEffectivePageDateVisibility()).resolves.toBe(true)
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each(['THALLY_CLOUD_SITE_TOKEN', 'DOX_CLOUD_SITE_TOKEN'])('honors a free external grant through %s without enabling paid controls', async (name) => {
    vi.stubEnv(name, 'external-token')
    mocks.cloud.mockResolvedValue({
      entitlements: { plan: 'free', features: { settingsSync: false } },
      siteConfig: { portable: { content: { showLastUpdated: false, showBreadcrumbs: false, showCopyPage: false, showTableOfContents: false } } },
    })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
    expect(mocks.connection).toHaveBeenCalledOnce()
    // No fresh:true override: reuse the existing short-lived external grant cache.
    expect(mocks.cloud).toHaveBeenCalledWith('https://linked.example.com')
    expect(getBuildContentControls()).toMatchObject({ showBreadcrumbs: true, showCopyPage: true, showTableOfContents: true })
  })

  it.each([null, new Error('Cloud unreachable')])('retains local false when external settings are unavailable: %s', async (result) => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.local.mockReturnValue({ content: { showLastUpdated: false } })
    if (result instanceof Error) mocks.cloud.mockRejectedValue(result)
    else mocks.cloud.mockResolvedValue(result)
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
  })

  it('falls back to repository policy when an older grant omits the new field', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.local.mockReturnValue({ content: { showLastUpdated: false } })
    mocks.cloud.mockResolvedValue({ siteConfig: { portable: { content: {} } } })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
  })

  it('ignores malformed nonboolean date values from a legacy grant', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.local.mockReturnValue({ content: { showLastUpdated: false } })
    mocks.cloud.mockResolvedValue({ siteConfig: { portable: { content: { showLastUpdated: 'false' } } } })
    await expect(getEffectivePageDateVisibility()).resolves.toBe(false)
  })

  it('lets Next observe connection prerender bailouts', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.connection.mockRejectedValue(new Error('DYNAMIC_SERVER_USAGE'))
    await expect(getEffectivePageDateVisibility()).rejects.toThrow('DYNAMIC_SERVER_USAGE')
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('lets Next observe request-origin prerender bailouts', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'external-token')
    mocks.origin.mockRejectedValue(new Error('DYNAMIC_SERVER_USAGE'))
    await expect(getEffectivePageDateVisibility()).rejects.toThrow('DYNAMIC_SERVER_USAGE')
    expect(mocks.cloud).not.toHaveBeenCalled()
  })
})
