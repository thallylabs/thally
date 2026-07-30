/**
 * Request-bound site identity regression tests.
 *
 * A managed creation fork deliberately reuses another site's compiled bundle,
 * so every identity field and repository fallback must come from the runtime
 * snapshot before that bundle is safe to expose.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  getCloudSiteConfig: vi.fn(),
  getRequestOrigin: vi.fn(),
}))

vi.mock('@/data/site', () => ({
  siteConfig: {
    name: 'Baseline Sentinel',
    description: 'Baseline description',
    repoUrl: 'https://github.com/thallylabs/baseline-sentinel',
    links: [
      { label: 'Get started', href: '/quickstart' },
      {
        label: 'Support',
        href: 'https://github.com/thallylabs/baseline-sentinel/issues/new',
      },
      {
        label: 'GitHub',
        href: 'https://github.com/thallylabs/baseline-sentinel',
      },
      { label: 'Changelog', href: '/changelog' },
    ],
    brand: {},
    brandPreset: 'primary',
    brandPresets: {},
  },
}))

vi.mock('@/lib/admin/settings', () => ({
  getAdminSettings: mocks.getAdminSettings,
}))

vi.mock('@/lib/cloud-link/client', () => ({
  getCloudSiteConfig: mocks.getCloudSiteConfig,
}))

vi.mock('@/lib/cloud-link/request', () => ({
  getRequestOrigin: mocks.getRequestOrigin,
}))

import {
  resolveRequestSiteConfig,
  resolveSiteConfig,
  siteIdentity,
} from '@/lib/site-config'

function adminSettings() {
  return {
    siteName: 'Local admin name',
    siteDescription: 'Local admin description',
    siteRepoUrl: 'https://github.com/local/admin',
  }
}

function cloudDetails(details: {
  name?: string
  description?: string
  repoUrl?: string
}) {
  return {
    siteConfig: {
      portable: { details },
      access: { mode: 'public', passwordHash: null },
    },
  }
}

describe('resolveSiteConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.THALLY_BASELINE_FORK_IDENTITY_REQUIRED
    mocks.getAdminSettings.mockResolvedValue(adminSettings())
    mocks.getRequestOrigin.mockResolvedValue('https://customer.thally.app')
  })

  it('replaces every baseline identity and repository fallback for a fork', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue(
      cloudDetails({
        name: 'Customer Docs',
        description: 'Customer description',
        repoUrl: 'https://github.com/acme/customer-docs',
      }),
    )

    const resolved = await resolveSiteConfig('https://customer.thally.app')

    expect(siteIdentity(resolved)).toEqual({
      name: 'Customer Docs',
      description: 'Customer description',
      repoUrl: 'https://github.com/acme/customer-docs',
      links: [
        { label: 'Get started', href: '/quickstart' },
        {
          label: 'Support',
          href: 'https://github.com/acme/customer-docs/issues/new',
        },
        { label: 'GitHub', href: 'https://github.com/acme/customer-docs' },
        { label: 'Changelog', href: '/changelog' },
      ],
    })
    expect(JSON.stringify(resolved)).not.toContain('baseline-sentinel')
  })

  it('preserves repository-authored links when the runtime repo matches', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue(
      cloudDetails({
        name: 'Full Build',
        repoUrl: 'https://github.com/thallylabs/baseline-sentinel',
      }),
    )

    const resolved = await resolveSiteConfig('https://full-build.thally.app')

    expect(resolved.links).toEqual(
      expect.arrayContaining([
        {
          label: 'Support',
          href: 'https://github.com/thallylabs/baseline-sentinel/issues/new',
        },
      ]),
    )
  })

  it('keeps the build config when runtime resolution fails', async () => {
    mocks.getCloudSiteConfig.mockRejectedValue(new Error('binding unavailable'))

    const resolved = await resolveSiteConfig('https://self-hosted.example')

    expect(resolved.name).toBe('Baseline Sentinel')
    expect(resolved.repoUrl).toBe(
      'https://github.com/thallylabs/baseline-sentinel',
    )
  })

  it('fails closed without exposing baseline identity for a managed fork', async () => {
    process.env.THALLY_BASELINE_FORK_IDENTITY_REQUIRED = 'true'
    mocks.getCloudSiteConfig.mockRejectedValue(new Error('binding unavailable'))

    const resolved = await resolveSiteConfig('https://fork.thally.app')

    expect(resolved).toEqual(
      expect.objectContaining({
        name: 'Documentation',
        description: 'Site identity is temporarily unavailable.',
        repoUrl: '',
      }),
    )
    expect(JSON.stringify(resolved)).not.toContain('Baseline Sentinel')
    expect(JSON.stringify(resolved)).not.toContain('baseline-sentinel')
  })

  it('uses the canonical request origin for the shared resolver', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue(
      cloudDetails({ name: 'Request-bound customer' }),
    )

    await expect(resolveRequestSiteConfig()).resolves.toEqual(
      expect.objectContaining({ name: 'Request-bound customer' }),
    )
    expect(mocks.getCloudSiteConfig).toHaveBeenCalledWith(
      'https://customer.thally.app',
    )
  })
})
