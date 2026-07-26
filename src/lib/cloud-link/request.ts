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
  if (!isRemoteContentSource()) {
    const incoming = await headers()
    const host = incoming.get('x-forwarded-host') ?? incoming.get('host')
    const proto = incoming.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    if (host) return `${proto}://${host}`
  }
  return process.env.THALLY_SITE_URL?.trim() || 'http://localhost:3000'
}

export async function getRequestCloudSiteConfig() {
  return getCloudSiteConfig(await getRequestOrigin())
}

