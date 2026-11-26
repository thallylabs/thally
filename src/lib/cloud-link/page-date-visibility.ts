/** Date-only request policy for linked sites; other content controls retain their existing scope. */

import 'server-only'

import { connection } from 'next/server'
import { isRemoteContentSource } from '@/lib/content-source'
import { getBuildContentControls } from './content-controls'
import { getCloudSiteConfig, getManagedSiteConfigSnapshot } from './client'
import { getRequestOrigin } from './request'

/**
 * Managed releases use their immutable snapshot and unlinked sites stay static.
 * External linked sites read the existing short-lived grant on each request;
 * this all-plan presentation preference does not require paid settings sync.
 */
export async function getEffectivePageDateVisibility(): Promise<boolean> {
  const fallback = getBuildContentControls().showLastUpdated
  const hasManagedConfig = Boolean(process.env.THALLY_CLOUD_SITE_CONFIG?.trim() ||
    process.env.DOX_CLOUD_SITE_CONFIG?.trim())
  if (hasManagedConfig || isRemoteContentSource() || getManagedSiteConfigSnapshot()) return fallback

  const token = process.env.THALLY_CLOUD_SITE_TOKEN?.trim() ||
    process.env.DOX_CLOUD_SITE_TOKEN?.trim()
  if (!token) return fallback

  // Keep Next's request boundaries outside the fallback catch so a linked
  // site's setting cannot be frozen into prerendered HTML during a build.
  await connection()
  const origin = await getRequestOrigin()
  try {
    const cloud = await getCloudSiteConfig(origin)
    const setting = cloud?.siteConfig.portable.content?.showLastUpdated
    return typeof setting === 'boolean' ? setting : fallback
  } catch {
    return fallback
  }
}
