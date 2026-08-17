/**
 * Privacy-preserving identity and acquisition helpers for docs analytics.
 *
 * Raw network identifiers never leave the request boundary. The daily HMAC
 * cannot be linked across sites or UTC days, matching the deliberately
 * short-lived visitor model used by privacy-first analytics products.
 */

const VISITOR_KEY_BYTES = 16
const MAX_FINGERPRINT_PART_LENGTH = 512

function boundedHeader(value: string | null): string | null {
  const candidate = value?.trim()
  return candidate && candidate.length <= MAX_FINGERPRINT_PART_LENGTH ? candidate : null
}

function clientAddress(headers: Headers): string | null {
  // Provider-authenticated headers take precedence. x-forwarded-for remains a
  // portability fallback for self-hosted deployments and is never persisted.
  const direct =
    boundedHeader(headers.get('cf-connecting-ip')) ??
    boundedHeader(headers.get('x-nf-client-connection-ip')) ??
    boundedHeader(headers.get('x-real-ip'))
  if (direct) return direct

  return boundedHeader(headers.get('x-forwarded-for')?.split(',')[0] ?? null)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Create a site- and day-scoped anonymous visitor key without cookies.
 *
 * Returning readers intentionally receive a different key after UTC midnight.
 * This gives useful daily uniques and visit metrics without reconstructing a
 * persistent browsing identity. Missing network or UA data fails closed so a
 * proxy cannot collapse every unknown reader into one fictional visitor.
 */
export async function createDailyVisitorKey(
  request: Request,
  secret: string,
  now = Date.now(),
): Promise<string | undefined> {
  const address = clientAddress(request.headers)
  const userAgent = boundedHeader(request.headers.get('user-agent'))
  if (!address || !userAgent || !secret) return undefined

  const site = new URL(request.url).hostname.toLowerCase()
  const day = new Date(now).toISOString().slice(0, 10)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${day}\0${site}\0${address}\0${userAgent}`),
  )

  return toBase64Url(new Uint8Array(signature).slice(0, VISITOR_KEY_BYTES))
}

/** Return only an external referring hostname; paths and queries are dropped. */
export function externalReferrerDomain(referer: string | null, currentUrl: string): string | undefined {
  if (!referer) return undefined
  try {
    const source = new URL(referer)
    const current = new URL(currentUrl)
    if (!['http:', 'https:'].includes(source.protocol)) return undefined
    if (source.hostname.toLowerCase() === current.hostname.toLowerCase()) {
      return undefined
    }
    const hostname = source.hostname.toLowerCase().replace(/^www\./, '')
    return hostname.length <= 253 ? hostname : undefined
  } catch {
    return undefined
  }
}
