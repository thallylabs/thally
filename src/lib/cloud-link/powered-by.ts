/** Server-only attribution policy: uncertainty always retains the footer mark. */

import 'server-only'

import { headers } from 'next/headers'
import { connection } from 'next/server'
import { isRemoteContentSource } from '@/lib/content-source'
import { getCloudSiteConfig } from './client'
import { getRequestOrigin } from './request'

/**
 * Resolve live authority before rendering the shell. Managed ingress replaces
 * the policy header after tenant resolution; standalone browsers cannot supply
 * removal authority. Snapshot presence, even malformed, selects managed mode
 * because an old release snapshot must never override a later plan downgrade.
 */
export async function shouldShowPoweredBy(): Promise<boolean> {
  const hasManagedConfig = process.env.THALLY_CLOUD_SITE_CONFIG !== undefined ||
    process.env.DOX_CLOUD_SITE_CONFIG !== undefined
  if (hasManagedConfig || isRemoteContentSource()) {
    // Keep this dynamic API outside a catch: Next must observe its static-render
    // bailout so the result cannot be frozen into a managed release's HTML.
    // Assets builds receive the snapshot only at deployment, so establish the
    // request boundary at build time too. Assets mode alone grants no authority.
    const incoming = await headers()
    return !hasManagedConfig || incoming.get('x-thally-powered-by') !== 'off'
  }

  const token = process.env.THALLY_CLOUD_SITE_TOKEN?.trim() ||
    process.env.DOX_CLOUD_SITE_TOKEN?.trim()
  if (!token) return true

  // Even with a configured origin, linked sites need a fresh policy per request.
  // Unlinked OSS sites never reach this boundary and retain static generation.
  await connection()
  const origin = await getRequestOrigin()
  try {
    const cloud = await getCloudSiteConfig(origin, { fresh: true })
    const plan = cloud?.entitlements.plan
    const canRemove = plan === 'cloud' || plan === 'enterprise'
    return !(canRemove && cloud?.siteConfig.portable.branding?.showPoweredBy === false)
  } catch {
    return true
  }
}
