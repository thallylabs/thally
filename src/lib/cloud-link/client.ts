/**
 * Server-only client for the Thally Cloud control plane.
 *
 * The long-lived site token never enters browser JavaScript. This module
 * exchanges it for a short-lived signed grant and keeps that grant in memory
 * until shortly before the control-plane TTL expires.
 */

import 'server-only'

const DEFAULT_CLOUD_URL = 'https://app.thally.io'
const GRANT_CACHE_TTL_MS = 4 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8_000

export type CloudLinkStatus = 'connected' | 'not_configured' | 'cloud_unreachable' | 'credential_rejected'

export interface CloudLinkResult {
  status: CloudLinkStatus
}

interface CachedGrant {
  value: string
  expiresAt: number
}

interface GrantResponse {
  grant?: unknown
}

let cachedGrant: CachedGrant | null = null

function getSiteToken(): string | null {
  return process.env.THALLY_CLOUD_SITE_TOKEN?.trim() || null
}

function getCloudUrl(): URL {
  const configured = process.env.THALLY_CLOUD_URL?.trim() || DEFAULT_CLOUD_URL
  return new URL(configured.endsWith('/') ? configured : `${configured}/`)
}

function readCachedGrant(): string | null {
  if (!cachedGrant || cachedGrant.expiresAt <= Date.now()) {
    cachedGrant = null
    return null
  }
  return cachedGrant.value
}

async function exchangeGrant(siteUrl: string): Promise<CloudLinkResult & { grant?: string }> {
  const token = getSiteToken()
  if (!token) return { status: 'not_configured' }

  let response: Response
  try {
    const grantUrl = new URL('api/cloud/grant', getCloudUrl())
    response = await fetch(grantUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ siteUrl }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { status: 'cloud_unreachable' }
  }

  if (!response.ok) {
    return {
      status: response.status === 401 ? 'credential_rejected' : 'cloud_unreachable',
    }
  }

  const payload = (await response.json().catch(() => null)) as GrantResponse | null
  if (!payload || typeof payload.grant !== 'string' || !payload.grant) {
    return { status: 'cloud_unreachable' }
  }

  cachedGrant = {
    value: payload.grant,
    expiresAt: Date.now() + GRANT_CACHE_TTL_MS,
  }
  return { status: 'connected', grant: payload.grant }
}

/**
 * Phone home to Thally Cloud and refresh the short-lived grant when required.
 * The returned status is deliberately sanitized and never includes a secret.
 */
export async function connectCloudSite(siteUrl: string): Promise<CloudLinkResult> {
  const cached = readCachedGrant()
  if (cached) return { status: 'connected' }
  const result = await exchangeGrant(siteUrl)
  return { status: result.status }
}

/**
 * Return a valid short-lived grant for future server-side Thally Cloud services.
 * Callers must never send this grant to browser code.
 */
export async function getCloudGrant(siteUrl: string): Promise<string | null> {
  const cached = readCachedGrant()
  if (cached) return cached
  const result = await exchangeGrant(siteUrl)
  return result.grant ?? null
}

/** Clear process-local state between tests. */
export function resetCloudGrantCacheForTests(): void {
  cachedGrant = null
}
