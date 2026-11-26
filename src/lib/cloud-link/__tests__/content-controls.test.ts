/** Regression coverage for release-scoped content presentation defaults. */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  DEFAULT_CONTENT_CONTROLS,
  getBuildContentControls,
  resolveContentControls,
} from '../content-controls'

describe('content controls', () => {
  it('preserves all existing site chrome when settings are absent', () => {
    expect(resolveContentControls(undefined)).toEqual(DEFAULT_CONTENT_CONTROLS)
  })

  it('honors explicit false values independently', () => {
    expect(resolveContentControls({
      showSidebarGroupIcons: false,
      showBreadcrumbs: false,
      showTableOfContents: true,
      showCopyPage: false,
      showLastUpdated: false,
    })).toEqual({
      showSidebarGroupIcons: false,
      showBreadcrumbs: false,
      showTableOfContents: true,
      showCopyPage: false,
      showLastUpdated: false,
    })
  })
})


describe('page-date visibility across plans', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('honors the portable date toggle when settingsSync is unavailable', () => {
    vi.stubEnv('THALLY_CLOUD_SITE_CONFIG', JSON.stringify({
      siteId: 'site-1', orgId: 'org-1', entitlements: { plan: 'free', features: { settingsSync: false } },
      siteConfig: { portable: { content: { showLastUpdated: false } }, access: { mode: 'public', passwordHash: null } },
    }))
    expect(getBuildContentControls()).toMatchObject({ showLastUpdated: false, showBreadcrumbs: true, showCopyPage: true })
  })
})
