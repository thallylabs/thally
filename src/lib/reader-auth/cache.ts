/**
 * Cache policy for content responses under reader auth (edge-safe).
 *
 * Once reader auth is active, any content response may differ by reader, so
 * no shared cache (CDN, proxy, Next data cache) may keep it. Routes that
 * normally advertise a public cache lifetime pass it through this helper.
 */

import { isReaderAuthActive } from './config'

export const PRIVATE_NO_STORE = 'private, no-store'

/** `publicValue` on public sites; `private, no-store` when reader auth is active. */
export function contentCacheControl(publicValue: string): string {
  return isReaderAuthActive() ? PRIVATE_NO_STORE : publicValue
}
