/** Constrain portable brand asset references to files below the site's public directory. */

/** Reject external, encoded traversal, and query-bearing brand destinations. */
export function publicBrandAssetPath(value?: string): string | null {
  if (!value) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decoded)
    || /[%\\?#\0]/.test(decoded)) return null
  const segments = decoded.replace(/^\/+/, '').replace(/^public\//, '').split('/')
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return `/${segments.join('/')}`
}
