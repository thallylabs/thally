import 'server-only'

import { headers } from 'next/headers'
import { getCloudSiteConfig } from './client'

/** Resolve the canonical request origin without trusting a browser-supplied URL body. */
export async function getRequestOrigin(): Promise<string> {
  const incoming = await headers()
  const host = incoming.get('x-forwarded-host') ?? incoming.get('host')
  const proto = incoming.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  if (host) return `${proto}://${host}`
  return process.env.THALLY_SITE_URL?.trim() || 'http://localhost:3000'
}

export async function getRequestCloudSiteConfig() {
  return getCloudSiteConfig(await getRequestOrigin())
}

