/**
 * Per-client quota for public, anonymous endpoints whose work costs money or
 * CPU (MCP tool calls, hybrid search that embeds the query).
 *
 * The client key comes from `normalizeAuthClientIdentity`, the same
 * normalization the password limiter uses: provider-authenticated headers
 * (`cf-connecting-ip`, `x-nf-client-connection-ip`, `x-real-ip`) first, then
 * the RIGHTMOST `X-Forwarded-For` hop — the one appended by the nearest proxy.
 * The leftmost hop is whatever the client claimed, so keying on it let any
 * caller mint a fresh bucket per request. IPv6 clients share a /64.
 *
 * Counters live in the configured storage adapter (`kvIncrement`, one-minute
 * windows), so they are shared across instances when the adapter is.
 */

import { normalizeAuthClientIdentity } from '@/lib/admin/auth-rate-limit'
import { getStorage } from '@/lib/storage'

export interface PublicQuotaRequest {
  /** Storage namespace, one per protected surface (e.g. `mcp_rate`). */
  bucket: string
  headers: Headers
  /** Units this request consumes (e.g. tool calls in a JSON-RPC batch). */
  amount?: number
  /** Allowed units per client per minute; 0 or less disables the limit. */
  limitPerMinute: number
  /**
   * Decision when storage fails. Fail open where refusing would break a free
   * feature; fail closed where the request has a cheap fallback (hybrid
   * search degrades to full-text).
   */
  failOpen: boolean
}

export interface PublicQuotaDecision {
  allowed: boolean
  /** Normalized client key the counter used ('unknown' when no address was available). */
  client: string
}

/** Consume `amount` units of a client's per-minute quota. */
export async function consumePublicQuota(request: PublicQuotaRequest): Promise<PublicQuotaDecision> {
  const client = normalizeAuthClientIdentity(request.headers)
  if (request.limitPerMinute <= 0) return { allowed: true, client }
  try {
    const { count } = await getStorage().kvIncrement(request.bucket, client, {
      ttlMs: 60_000,
      amount: Math.max(1, request.amount ?? 1),
    })
    return { allowed: count <= request.limitPerMinute, client }
  } catch {
    return { allowed: request.failOpen, client }
  }
}

/** Read a per-minute limit from `THALLY_*` with its legacy `DOX_*` fallback. */
export function readRateLimitEnv(name: string, fallback: number): number {
  const raw = process.env[`THALLY_${name}`] ?? process.env[`DOX_${name}`]
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
