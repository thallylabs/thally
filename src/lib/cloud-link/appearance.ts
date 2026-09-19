/** Resolve reader appearance against the immutable managed release, without remote requests. */
import 'server-only'

import { getDocsJsonConfig } from '@/lib/docs-json-config'
import { resolveSiteAppearance, resolveSiteBackground, type SiteAppearance, type SiteBackground } from '@/lib/site-appearance'
import { getManagedSiteConfigSnapshot } from './client'

/** Managed branding wins over matching docs.json fields; absent settings preserve old sites. */
export function getBuildSiteAppearance() {
  const repository = getDocsJsonConfig<{ appearance?: SiteAppearance; background?: SiteBackground }>()
  const managed = getManagedSiteConfigSnapshot()?.siteConfig.portable.branding
  return {
    appearance: resolveSiteAppearance(repository.appearance, managed?.appearance),
    background: resolveSiteBackground(repository.background, managed?.background),
  }
}
