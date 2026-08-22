/**
 * RFC 9457 problem responses shared by public machine-readable endpoints.
 *
 * Legacy `error` and `message` members remain present so existing Thally
 * clients can adopt Problem Details without a breaking response migration.
 */

export interface ProblemResponseOptions {
  status: number
  code: string
  title: string
  detail: string
  resolution: string
  instance?: string
  extensions?: Record<string, unknown>
  headers?: HeadersInit
}

const PROBLEM_TYPE_BASE = 'https://thally.io/problems/'

/** Return the stable identifier for a Thally problem category. */
function problemType(code: string): string {
  return `${PROBLEM_TYPE_BASE}${encodeURIComponent(code)}`
}

/** Return a machine-actionable HTTP error without exposing internal details. */
export function problemResponse({
  status,
  code,
  title,
  detail,
  resolution,
  instance,
  extensions,
  headers,
}: ProblemResponseOptions): Response {
  return Response.json(
    {
      ...extensions,
      // Custom codes, resolution hints, and titles carry semantics beyond an
      // HTTP status. RFC 9457 therefore requires a dedicated problem type
      // instead of `about:blank`.
      type: problemType(code),
      title,
      status,
      code,
      detail,
      resolution,
      ...(instance ? { instance } : {}),
      // Compatibility aliases for clients built against the original shape.
      error: code,
      message: detail,
    },
    {
      status,
      headers: {
        ...headers,
        'Content-Type': 'application/problem+json; charset=utf-8',
      },
    },
  )
}
