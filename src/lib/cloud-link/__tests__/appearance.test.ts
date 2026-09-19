/** Published managed settings override only the matching repository appearance fields. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/docs-json-config', () => ({ getDocsJsonConfig: () => ({ appearance: { default: 'dark', contentIcons: 'accent' }, background: { image: 'public/brand/shared.png', decoration: 'grid' } }) }))
vi.mock('../client', () => ({ getManagedSiteConfigSnapshot: () => ({ siteConfig: { portable: { branding: { appearance: { showToggle: false }, background: { imageDark: '/brand/dark.webp' } } } } }) }))

import { getBuildSiteAppearance } from '../appearance'

describe('managed reader appearance', () => {
  it('keeps repository defaults for unmanaged fields and normalizes release images', () => {
    expect(getBuildSiteAppearance()).toEqual({
      appearance: { default: 'dark', showToggle: false },
      background: { image: '/brand/shared.png', imageDark: '/brand/dark.webp', decoration: 'grid' },
    })
  })
})
