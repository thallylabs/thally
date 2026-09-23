/** Validate document lookup keys before either host or filesystem readers see them. */

// Page IDs are repository-relative MDX stems. Restrict each component to
// ordinary filename characters, so absolute paths, dot segments, separators
// from another platform, and control characters cannot become lookup paths.
const PAGE_ID = /^[\p{L}\p{N}_-][\p{L}\p{N}._ -]*(?:\/[\p{L}\p{N}_-][\p{L}\p{N}._ -]*)*$/u
const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/** Reject unsafe content IDs and locale prefixes at the engine boundary. */
export function isSafeContentIdentifier(pageId: string, locale?: string): boolean {
  return pageId.length > 0 && pageId.length <= 1024 && PAGE_ID.test(pageId) &&
    (locale === undefined || (locale.length <= 35 && LOCALE.test(locale)))
}
