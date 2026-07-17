/**
 * Server-only client for the Thally Cloud control plane.
 *
 * The long-lived site token never enters browser JavaScript. This module
 * exchanges it for a short-lived signed grant and keeps that grant in memory
 * until shortly before the control-plane TTL expires.
 */

import 'server-only'

import { decodeJwt } from 'jose'

const DEFAULT_CLOUD_URL = 'https://app.thally.io'
const GRANT_CACHE_TTL_MS = 30_000
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

export interface CloudEntitlements {
  features?: {
    settingsSync?: boolean
    passwordProtection?: boolean
    aiAnswers?: boolean
    analytics?: boolean
    [key: string]: boolean | undefined
  }
}

export interface CloudPortableConfig {
  details?: { name?: string; description?: string }
  feedback?: {
    thumbsRating?: boolean
    editSuggestions?: boolean
    issueReporting?: boolean
    pageFeedback?: boolean
    agentFeedback?: boolean
  }
  ai?: { enabled?: boolean }
  branding?: {
    logo?: string
    logoDark?: string
    favicon?: string
    faviconDark?: string
    themePreset?: string
  }
  analytics?: {
    enabled?: boolean
    collectAgentTraffic?: boolean
    retentionDays?: number
  }
}

export interface CloudSiteConfig {
  portable: CloudPortableConfig
  access: {
    mode: 'public' | 'password'
    passwordHash: string | null
  }
}

export interface CloudGrantPayload {
  siteId: string
  orgId: string
  entitlements: CloudEntitlements
  siteConfig: CloudSiteConfig
  exp?: number
}

let cachedGrant: CachedGrant | null = null

function getSiteToken(): string | null {
  return (
    process.env.THALLY_CLOUD_SITE_TOKEN?.trim() ||
    process.env.DOX_CLOUD_SITE_TOKEN?.trim() ||
    null
  )
}

function getCloudUrl(): URL {
  const configured =
    process.env.THALLY_CLOUD_URL?.trim() ||
    process.env.DOX_CLOUD_URL?.trim() ||
    DEFAULT_CLOUD_URL
  return new URL(configured.endsWith('/') ? configured : `${configured}/`)
}

/**
 * Managed hosting injects a release-scoped snapshot instead of the long-lived
 * site credential. Customer-authored Worker code can inspect its own bindings,
 * so handing it the reusable credential would let that code impersonate the
 * deployment after the release has been superseded. The snapshot contains only
 * that release's effective settings and entitlements.
 */
function getManagedSiteConfig(): CloudGrantPayload | null {
  const serialized =
    process.env.THALLY_CLOUD_SITE_CONFIG?.trim() ||
    process.env.DOX_CLOUD_SITE_CONFIG?.trim()
  if (!serialized) return null

  try {
    const payload = JSON.parse(serialized) as Partial<CloudGrantPayload>
    return isCloudGrantPayload(payload) ? payload : null
  } catch {
    return null
  }
}

function isCloudGrantPayload(
  payload: Partial<CloudGrantPayload>,
): payload is CloudGrantPayload {
  return Boolean(
    typeof payload.siteId === 'string' &&
      typeof payload.orgId === 'string' &&
      payload.entitlements &&
      typeof payload.entitlements === 'object' &&
      payload.siteConfig &&
      typeof payload.siteConfig === 'object' &&
      payload.siteConfig.portable &&
      typeof payload.siteConfig.portable === 'object' &&
      payload.siteConfig.access &&
      (payload.siteConfig.access.mode === 'public' ||
        payload.siteConfig.access.mode === 'password') &&
      (payload.siteConfig.access.passwordHash === null ||
        typeof payload.siteConfig.access.passwordHash === 'string') &&
      (!payload.exp || payload.exp * 1000 > Date.now()),
  )
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
  if (getManagedSiteConfig()) return { status: 'connected' }
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

/**
 * Read the server-only runtime configuration carried by the short-lived grant.
 * The grant is obtained directly from Thally Cloud over authenticated TLS and
 * is never exposed to browser code. Invalid or legacy grants safely resolve to
 * null so free/self-hosted sites keep using their repository configuration.
 */
export async function getCloudSiteConfig(siteUrl: string): Promise<CloudGrantPayload | null> {
  const managed = getManagedSiteConfig()
  if (managed) return managed

  const grant = await getCloudGrant(siteUrl)
  if (!grant) return null

  try {
    const payload = decodeJwt(grant) as Partial<CloudGrantPayload>
    return isCloudGrantPayload(payload) ? payload : null
  } catch {
    return null
  }
}

/** Clear process-local state between tests. */
export function resetCloudGrantCacheForTests(): void {
  cachedGrant = null
}
