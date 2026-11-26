/**
 * Canonical page dates shared by reader, machine and publishing surfaces.
 * Observation/checkout mtimes are not provenance. A first publication is
 * explicitly distinguishable from a proven update throughout the contract.
 */

export interface PageUpdateMetadata {
  date: string
  source: 'frontmatter' | 'git' | 'content-change' | 'first-published'
}

const SOURCES = new Set(['frontmatter', 'git', 'content-change', 'first-published'])

/** Accept only real ISO calendar dates or timestamps, never ambiguous prose. */
export function normalizePageUpdateDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const date = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date)) return undefined
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  calendar.setUTCHours(0, 0, 0, 0)
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || !Number.isFinite(Date.parse(date))) return undefined
  return date
}

/** Validate portable publisher metadata at the runtime boundary. */
export function normalizePageUpdateMetadata(value: unknown): PageUpdateMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const date = normalizePageUpdateDate(record.date)
  if (!date || typeof record.source !== 'string' || !SOURCES.has(record.source)) return undefined
  return { date, source: record.source as PageUpdateMetadata['source'] }
}

/** An optional authored override wins; automatic metadata remains the default. */
export function resolvePageUpdate(frontmatter: unknown, automatic?: unknown): PageUpdateMetadata | undefined {
  const data = frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter)
    ? frontmatter as Record<string, unknown>
    : {}
  const date = normalizePageUpdateDate(data.last_updated) ?? normalizePageUpdateDate(data.lastUpdated)
  return date ? { date, source: 'frontmatter' } : normalizePageUpdateMetadata(automatic)
}

/** Format in UTC so a server's timezone cannot move a page date to another day. */
export function formatPageUpdateDate(value: PageUpdateMetadata, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value.date))
  } catch {
    return value.date.slice(0, 10)
  }
}
