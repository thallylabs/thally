/** Release-scoped content presentation settings for managed documentation sites. */

import 'server-only'

import { getManagedSiteConfigSnapshot, type CloudPortableConfig } from './client'

export interface ContentControls {
  showSidebarGroupIcons: boolean
  showBreadcrumbs: boolean
  showTableOfContents: boolean
  showCopyPage: boolean
}

export const DEFAULT_CONTENT_CONTROLS: ContentControls = {
  showSidebarGroupIcons: true,
  showBreadcrumbs: true,
  showTableOfContents: true,
  showCopyPage: true,
}

/** Preserve established site chrome unless a setting explicitly disables it. */
export function resolveContentControls(
  content: CloudPortableConfig['content'] | null | undefined,
): ContentControls {
  return {
    showSidebarGroupIcons: content?.showSidebarGroupIcons ?? true,
    showBreadcrumbs: content?.showBreadcrumbs ?? true,
    showTableOfContents: content?.showTableOfContents ?? true,
    showCopyPage: content?.showCopyPage ?? true,
  }
}

/** Read controls from the immutable managed-release snapshot. */
export function getBuildContentControls(): ContentControls {
  return resolveContentControls(
    getManagedSiteConfigSnapshot()?.siteConfig.portable.content,
  )
}
