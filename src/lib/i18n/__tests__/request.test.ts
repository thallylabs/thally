/** Live locale resolution must honor admin settings without freezing self-hosted pages to build config. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  getRequestCloudSiteConfig: vi.fn(),
}))

vi.mock('@/data/docs', () => ({
  getI18nConfig: () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }],
  }),
}))
vi.mock('@/lib/admin/settings', () => ({ getAdminSettings: mocks.getAdminSettings }))
vi.mock('@/lib/cloud-link/request', () => ({ getRequestCloudSiteConfig: mocks.getRequestCloudSiteConfig }))
vi.mock('@/lib/cloud-link/client', () => ({ getManagedSiteConfigSnapshot: () => null }))

import { getEffectiveI18nConfig, getRepositoryI18nConfig } from '../request'

const frenchSelection = {
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
  ],
}

describe('request locale configuration', () => {
  beforeEach(() => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', '')
    vi.stubEnv('DOX_CLOUD_SITE_TOKEN', '')
    vi.stubEnv('THALLY_CLOUD_SITE_CONFIG', '')
    vi.stubEnv('DOX_CLOUD_SITE_CONFIG', '')
    mocks.getAdminSettings.mockReset()
    mocks.getRequestCloudSiteConfig.mockReset()
    mocks.getAdminSettings.mockResolvedValue({ localization: frenchSelection })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('keeps static enumeration on repository locales while honoring a live admin locale', async () => {
    expect(getRepositoryI18nConfig().locales.map((locale) => locale.code)).toEqual(['en'])
    expect((await getEffectiveI18nConfig()).locales.map((locale) => locale.code)).toEqual(['en', 'fr'])
    expect(mocks.getRequestCloudSiteConfig).not.toHaveBeenCalled()
  })

  it('uses managed localization ahead of admin settings on a linked site', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'site-token')
    mocks.getRequestCloudSiteConfig.mockResolvedValue({
      siteConfig: { portable: { localization: {
        defaultLocale: 'en',
        locales: [{ code: 'en', label: 'English' }, { code: 'de', label: 'Deutsch' }],
      } } },
    })

    expect((await getEffectiveI18nConfig()).locales.map((locale) => locale.code)).toEqual(['en', 'de'])
    expect(mocks.getAdminSettings).not.toHaveBeenCalled()
  })
})
