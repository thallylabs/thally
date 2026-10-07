/** Same-origin return-path validation for authentication and handoff flows. */

const RETURN_ORIGIN = 'https://return-path.invalid'

/** A root-relative path that a browser or `new URL` could read as another origin. */
function isAmbiguousPath(path: string): boolean {
  return !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')
}

/**
 * Accept a root-relative application path and reject scheme-relative,
 * backslash-normalized, control-character, and absolute destinations.
 *
 * The check runs on the NORMALIZED result as well as the input: dot segments
 * such as `/.//evil.example` normalize to `//evil.example`, which a later
 * `new URL(path, origin)` or a browser treats as another host. The result is
 * idempotent: resolving it again returns it unchanged.
 */
export function resolveSafeReturnPath(value: string | null, fallback: string): string {
  if (!value || isAmbiguousPath(value)) return fallback
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const target = new URL(value, RETURN_ORIGIN)
    if (target.origin !== RETURN_ORIGIN) return fallback
    const normalized = `${target.pathname}${target.search}${target.hash}`
    if (isAmbiguousPath(normalized)) return fallback
    // Normalization must be a fixed point, or a second pass could change origin.
    const again = new URL(normalized, RETURN_ORIGIN)
    if (again.origin !== RETURN_ORIGIN || `${again.pathname}${again.search}${again.hash}` !== normalized) return fallback
    return normalized
  } catch {
    return fallback
  }
}
