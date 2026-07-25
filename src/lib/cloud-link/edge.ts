/** Edge-safe Thally Cloud grant exchange used by request gating. */

const DEFAULT_CLOUD_URL = 'https://app.thally.io'
const CACHE_TTL_MS = 30_000
const REQUEST_TIMEOUT_MS = 8_000

interface EdgeCloudConfig {
  access?: { mode?: 'public' | 'password' }
}

interface EdgeGrantPayload {
  siteConfig?: EdgeCloudConfig
  exp?: number
}

let cached: { value: EdgeCloudConfig; expiresAt: number } | null = null

function managedSiteConfig(): EdgeCloudConfig | null {
  const serialized =
    process.env.THALLY_CLOUD_SITE_CONFIG?.trim() ||
    process.env.DOX_CLOUD_SITE_CONFIG?.trim()
  if (!serialized) return null

  try {
    const payload = JSON.parse(serialized) as EdgeGrantPayload
    return payload?.siteConfig && typeof payload.siteConfig === 'object'
      ? payload.siteConfig
      : null
  } catch {
    return null
  }
}

/**
 * Site id from the injected managed-runtime snapshot; null on self-host.
 * Read directly from the env (not via the grant exchange) because callers —
 * cache tagging in middleware — must never add a network round-trip. The
 * charset check keeps the value safe to embed in a response header even if
 * the snapshot is ever attacker-influenced.
 */
export function getManagedSiteIdEdge(): string | null {
  const serialized =
    process.env.THALLY_CLOUD_SITE_CONFIG?.trim() ||
    process.env.DOX_CLOUD_SITE_CONFIG?.trim()
  if (!serialized) return null

  try {
    const payload = JSON.parse(serialized) as { siteId?: unknown }
    return typeof payload.siteId === 'string' && /^[A-Za-z0-9_-]+$/.test(payload.siteId)
      ? payload.siteId
      : null
  } catch {
    return null
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return atob(padded)
}

function decodeGrant(grant: string): EdgeGrantPayload | null {
  const payload = grant.split('.')[1]
  if (!payload) return null
  try {
    return JSON.parse(decodeBase64Url(payload)) as EdgeGrantPayload
  } catch {
    return null
  }
}

export async function getCloudAccessConfigEdge(siteUrl: string): Promise<EdgeCloudConfig | null> {
  const managed = managedSiteConfig()
  if (managed) return managed
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const token =
    process.env.THALLY_CLOUD_SITE_TOKEN?.trim() ||
    process.env.DOX_CLOUD_SITE_TOKEN?.trim()
  if (!token) return null

  const cloud =
    process.env.THALLY_CLOUD_URL?.trim() ||
    process.env.DOX_CLOUD_URL?.trim() ||
    DEFAULT_CLOUD_URL
  try {
    const response = await fetch(new URL('/api/cloud/grant', cloud), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ siteUrl }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { grant?: unknown }
    if (typeof body.grant !== 'string') return null
    const payload = decodeGrant(body.grant)
    if (!payload?.siteConfig || (payload.exp && payload.exp * 1000 <= Date.now())) return null
    cached = { value: payload.siteConfig, expiresAt: Date.now() + CACHE_TTL_MS }
    return payload.siteConfig
  } catch {
    return null
  }
}
