import 'server-only'

import { headers } from 'next/headers'
import { isRemoteContentSource } from '@/lib/content-source'
import { getCloudSiteConfig } from './client'

/**
 * Resolve the canonical request origin without trusting a browser-supplied URL
 * body.
 *
 * Under a remote content source (managed releases) doc pages render via
 * on-demand static generation, where `headers()` is a dynamic API and throws
 * DYNAMIC_SERVER_USAGE. There the canonical origin is baked into the release
 * as `THALLY_SITE_URL` by the managed builder, so no request inspection is
 * needed — or possible.
 */
export async function getRequestOrigin(): Promise<string> {
  // Managed releases and production self-hosts already know their canonical
  // URL. Prefer it before touching `headers()`: reading request headers opts an
  // otherwise immutable documentation route out of static rendering and the
  // App Router's full-page prefetch cache.
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
