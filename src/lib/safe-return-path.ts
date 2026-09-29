/** Same-origin return-path validation for authentication and handoff flows. */

const RETURN_ORIGIN = 'https://return-path.invalid'

/**
 * Accept a root-relative application path and reject scheme-relative,
 * backslash-normalized, control-character, and absolute destinations.
 */
export function resolveSafeReturnPath(value: string | null, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const target = new URL(value, RETURN_ORIGIN)
    if (target.origin !== RETURN_ORIGIN) return fallback
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return fallback
  }
}
