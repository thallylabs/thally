/**
 * Release-scoped icon library selection for managed documentation sites.
 *
 * Thally Cloud lets an owner pick the icon library from site branding. That
 * choice travels in the immutable release snapshot and wins over the
 * repository's docs.json value. This module stays server-only; `src/data/docs`
 * must remain importable from plain Node build scripts, so it never reads the
 * snapshot itself.
 */

import 'server-only'

import { getIconLibrary } from '@/data/docs'
import { isIconLibrary, type IconLibrary } from '@/lib/icon-library'
import { getManagedSiteConfigSnapshot, type CloudPortableConfig } from './client'

/** A dashboard choice wins; an unknown value keeps the repository's library. */
export function resolveSiteIconLibrary(
  branding: CloudPortableConfig['branding'] | null | undefined,
  repositoryChoice: IconLibrary,
): IconLibrary {
  const cloudChoice = branding?.iconLibrary
  return isIconLibrary(cloudChoice) ? cloudChoice : repositoryChoice
}

/** Read the effective library from the managed-release snapshot, then docs.json. */
export function getBuildIconLibrary(): IconLibrary {
  return resolveSiteIconLibrary(
    getManagedSiteConfigSnapshot()?.siteConfig.portable.branding,
    getIconLibrary(),
  )
}
