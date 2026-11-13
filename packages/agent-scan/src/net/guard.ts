/**
 * SSRF guard. The URL guard runs on every requested URL and redirect hop for
 * every transport; the address guard runs inside the Node transport's DNS
 * lookup so the checked address is the one that is connected to, which
 * defeats DNS rebinding. Only globally routable unicast addresses pass.
 */

import ipaddr from 'ipaddr.js'

import type { ErrorCode } from '../types.js'

/** Strip IPv6 brackets from a URL hostname. */
export function bareHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/** True when the address is a public unicast address (IPv4-mapped IPv6 is unwrapped). */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false
  return ipaddr.process(address).range() === 'unicast'
}

/**
 * Validate a URL before it is requested. Returns an error code, or null when
 * the URL may be fetched. With `allowPrivateNetwork`, only the protocol and
 * userinfo rules apply; that mode exists for local testing.
 */
export function checkFetchableUrl(input: string, allowPrivateNetwork: boolean): ErrorCode | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return 'invalid_url'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid_url'
  if (url.username || url.password) return 'invalid_url'
  if (allowPrivateNetwork) return null
  const host = bareHostname(url.hostname).toLowerCase()
  if (!host) return 'invalid_url'
  if (ipaddr.isValid(host) && !isPublicAddress(host)) return 'private_address'
  if (host === 'localhost' || host.endsWith('.localhost')) return 'private_address'
  if (!ipaddr.isValid(host) && !host.includes('.')) return 'private_address'
  if (url.port && url.port !== '80' && url.port !== '443') return 'invalid_url'
  return null
}
