/** Closed, typed availability failures for readers that must never use embedded content. */

interface PublishedContentUnavailableError extends Error {
  code: 'THALLY_PUBLISHED_CONTENT_UNAVAILABLE'
}

/** Preserve retryable availability as distinct from parser/programming failures. */
export function publishedContentUnavailable(): PublishedContentUnavailableError {
  return Object.assign(new Error('Published documentation is temporarily unavailable.'), { code: 'THALLY_PUBLISHED_CONTENT_UNAVAILABLE' as const })
}

/** Only this closed failure category may become a safe transient chat response. */
export function isPublishedContentUnavailable(error: unknown): error is PublishedContentUnavailableError {
  return error instanceof Error && 'code' in error && error.code === 'THALLY_PUBLISHED_CONTENT_UNAVAILABLE'
}
