/** Safe path normalization used before reading or writing migrated content. */

import { isAbsolute, relative, resolve, sep } from 'node:path'

const SAFE_SEGMENT = /[^a-z0-9._-]+/g

/** Turn a source path segment into a stable URL/file-system slug. */
export function slugifySegment(value: string): string {
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Malformed percent escapes are legal in source filenames. Treat them as
    // literal slug input instead of letting one file abort the whole import.
  }
  return decoded
    .toLowerCase()
    .replace(/\.(?:html?|mdx?)$/i, '')
    .replace(SAFE_SEGMENT, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Normalize a page reference to a Thally content id. Invalid or traversal
 * references return `null` instead of being allowed near the file system.
 */
export function pageIdFromReference(value: string): string | null {
  const withoutQuery = value.split(/[?#]/, 1)[0].replace(/\\/g, '/').replace(/^\/+/, '')
  if (!withoutQuery || withoutQuery.includes('\0')) return null
  const rawSegments = withoutQuery.split('/').filter(Boolean)
  if (rawSegments.some((segment) => segment === '..' || segment === '.')) return null
  const last = rawSegments.at(-1)?.replace(/\.(?:mdx?|rst|txt)$/i, '') ?? ''
  const baseSegments = /^(?:index|readme)$/i.test(last) ? rawSegments.slice(0, -1) : rawSegments
  if (!/^(?:index|readme)$/i.test(last)) {
    baseSegments[baseSegments.length - 1] = last
  }
  const segments = baseSegments.map(slugifySegment).filter(Boolean)
  return segments.join('/') || 'introduction'
}

/** Resolve an untrusted relative path and prove it remains below `root`. */
export function resolveWithin(root: string, candidate: string): string {
  if (isAbsolute(candidate) || candidate.includes('\0')) {
    throw new Error(`Unsafe migration path: ${candidate}`)
  }
  const target = resolve(root, candidate)
  const fromRoot = relative(resolve(root), target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Migration path escapes its root: ${candidate}`)
  }
  return target
}

/** Return a slash-separated, traversal-free asset path. */
export function normalizeAssetPath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) return null
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return segments.join('/')
}
