/** Admin locale changes invalidate prerendered language metadata and route shells. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  updateAdminSettings: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/rbac', () => ({ requireCapabilityFromRequest: async () => ({ role: 'owner' }) }))
vi.mock('@/lib/admin/settings', () => ({
  updateAdminSettings: mocks.updateAdminSettings,
  hasBrandAsset: async () => false,
  isValidBrandAsset: () => false,
  setBrandAsset: vi.fn(),
}))
vi.mock('@/lib/i18n/request', () => ({
  getRepositoryI18nConfig: () => ({
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }],
  }),
}))

import { PUT } from './route'

describe('admin locale revalidation', () => {
  beforeEach(() => {
    mocks.revalidatePath.mockReset()
    mocks.updateAdminSettings.mockReset()
    mocks.updateAdminSettings.mockImplementation(async (patch) => ({
      chatEnabled: null,
      analyticsEnabled: null,
      mcpEnabled: null,
      brandTheme: null,
      brandAccent: null,
      siteName: null,
      siteDescription: null,
      siteRepoUrl: null,
      aiLabel: null,
      aiDisclaimer: null,
      localization: null,
      allowedDomains: [],
      docsPasswordHash: null,
      chatKeyEnc: null,
      githubApp: null,
      ...patch,
    }))
  })

  it('refreshes root and nested statically rendered pages after a locale selection', async () => {
    const response = await PUT(new NextRequest('https://docs.example.com/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        localization: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }],
        },
      }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.updateAdminSettings.mock.calls[0]?.[0].localization.locales.map((locale: { code: string }) => locale.code)).toEqual(['en', 'fr'])
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('leaves documentation prerenders cached for unrelated settings', async () => {
    const response = await PUT(new NextRequest('https://docs.example.com/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ siteName: 'Updated docs' }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
