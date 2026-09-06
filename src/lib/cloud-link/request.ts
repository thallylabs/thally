import 'server-only'

import { headers } from 'next/headers'
import { isRemoteContentSource } from '@/lib/content-source'
import { getCloudSiteConfig } from './client'

/**
 * Resolve the canonical request origin without trusting a browser-supplied URL
 * body.
 *
 * Managed releases carry their canonical origin in `THALLY_SITE_URL`. Their
 * documentation shell reads live branding policy separately; canonical URL
 * resolution never needs to depend on visitor-supplied forwarding headers.
 */
export async function getRequestOrigin(): Promise<string> {
  // Managed releases and production self-hosts already know their canonical
  // URL. Prefer it before touching `headers()` so unlinked self-hosted routes
  // retain static rendering, and managed canonical links stay operator-owned.
  const configured = process.env.THALLY_SITE_URL?.trim()
  if (configured) return configured

  if (!isRemoteContentSource()) {
    const incoming = await headers()
    const host = incoming.get('x-forwarded-host') ?? incoming.get('host')
    const proto = incoming.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    if (host) return `${proto}://${host}`
  }
  if (isRemoteContentSource()) {
    // A managed release always carries THALLY_SITE_URL. Without it the
    // localhost fallback below would be baked into every rendered page as the
    // canonical origin instead of surfacing as an error, so say so once.
    console.warn(
      'THALLY_SITE_URL is unset under a remote content source; canonical links will point at localhost.',
    )
  }
  return 'http://localhost:3000'
}

export async function getRequestCloudSiteConfig() {
  return getCloudSiteConfig(await getRequestOrigin())
}
