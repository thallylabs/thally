/**
 * Rendering-side enforcement helpers for reader auth (server-only).
 *
 * A page the reader may not see is answered exactly like a page that does
 * not exist, so a response never confirms that a restricted page is there:
 * - anonymous reader on a private-by-default site → same-origin login hop,
 *   for missing and restricted paths alike;
 * - everyone else → the ordinary 404.
 * The login hop is always same-origin (`/api/reader/login`); only that route
 * handler sends the browser to the customer's login page or identity provider,
 * so App Router payload requests never follow a cross-origin redirect.
 */

import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { resolveSafeReturnPath } from '@/lib/safe-return-path'
import { getReaderAuthConfig } from './config'
import { canReaderAccessUnmarkedContent, type ReaderContext } from './access'

/** Same-origin route that starts the configured sign-in flow. */
export const READER_LOGIN_ROUTE = '/api/reader/login'

/** Login URL for a return path; the path is validated again by the login route. */
export function readerLoginPath(returnPath: string): string {
  const safe = resolveSafeReturnPath(returnPath, '/')
  return `${READER_LOGIN_ROUTE}?redirect=${encodeURIComponent(safe)}`
}

/** Whether signing in could reveal more than an anonymous reader sees. */
export function shouldOfferReaderSignIn(reader: ReaderContext): boolean {
  const config = getReaderAuthConfig()
  return config.isEnabled && !reader.isAuthenticated
}

/** Deny a document request without revealing whether the path exists. */
export function denyDocumentAccess(reader: ReaderContext, requestedPath: string): never {
  const config = getReaderAuthConfig()
  if (config.isEnabled && !reader.isAuthenticated && config.defaultVisibility === 'private') {
    redirect(readerLoginPath(requestedPath))
  }
  notFound()
}

/**
 * Whether the reader may see content without page frontmatter (generated
 * API-reference operations, the served OpenAPI document, API navigation).
 */
export function canReaderSeeUnmarkedContent(reader: ReaderContext): boolean {
  return canReaderAccessUnmarkedContent(reader, getReaderAuthConfig())
}
