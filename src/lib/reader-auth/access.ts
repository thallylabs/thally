/**
 * The single page-visibility rule shared by every projection (edge-safe, pure).
 *
 * Every surface that lists or serves a page — HTML, RSC payloads, `.md`
 * mirrors, `/api/docs/*`, indexes, sitemaps, search, MCP, chat retrieval —
 * must answer "may this reader see this page?" through
 * {@link canReaderAccessPage}. Keeping one predicate is what makes the
 * projections agree; a second hand-written check would drift.
 *
 * Semantics (Mintlify-compatible):
 * - `groups: [a, b]` — the reader must be signed in and belong to at least one
 *   listed group. `groups` wins over `public: true`.
 * - `public: true`  — anyone, including anonymous readers and agents.
 * - `public: false` — any signed-in reader.
 * - neither         — the site default (`auth.default`, private unless set
 *   to `public` once reader auth is on).
 * - Without reader auth (no `auth` block, or `password` mode) a page carrying
 *   `groups` or `public: false` is withheld from everyone: nobody can prove
 *   membership, so the restriction is honored by not serving the page.
 * - Malformed access frontmatter fails closed for everyone.
 */

import { READER_AUTH_LIMITS, type ReaderAuthConfig } from './config'

/** Normalized access frontmatter of one served file (or a merge of several). */
export interface PageAccess {
  /**
   * Each inner list is an any-of requirement; every list must be satisfied.
   * A single file yields at most one list; merging a translation with its
   * primary page can yield two.
   */
  groupSets: ReadonlyArray<ReadonlyArray<string>>
  /** `true`/`false` when declared, `undefined` when absent. */
  isPublic?: boolean
  /** A value that could not be understood; such a page is never served. */
  isMalformed: boolean
}

/** Who is reading. Produced only by the verified session/token paths. */
export interface ReaderContext {
  isAuthenticated: boolean
  groups: ReadonlyArray<string>
  /** Stable subject identifier from the verified token, when provided. */
  subject?: string
  source: 'anonymous' | 'session' | 'token'
}

/** The policy slice the predicate needs; a subset of {@link ReaderAuthConfig}. */
export type ReaderAccessPolicy = Pick<ReaderAuthConfig, 'isEnabled' | 'defaultVisibility'>

export const ANONYMOUS_READER: ReaderContext = Object.freeze({
  isAuthenticated: false,
  groups: Object.freeze([]) as ReadonlyArray<string>,
  source: 'anonymous' as const,
})

export const OPEN_PAGE_ACCESS: PageAccess = Object.freeze({ groupSets: [], isMalformed: false })

const PUBLIC_FALSE_STRINGS = new Set(['false', 'no', 'off', '0'])
// Opening a page needs an unambiguous `true`; anything vaguer stays closed.
const PUBLIC_TRUE_STRINGS = new Set(['true'])

function parsePublic(value: unknown): { isPublic?: boolean; isMalformed: boolean } {
  if (value === undefined || value === null) return { isMalformed: false }
  if (value === true) return { isPublic: true, isMalformed: false }
  if (value === false || value === 0) return { isPublic: false, isMalformed: false }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (PUBLIC_TRUE_STRINGS.has(normalized)) return { isPublic: true, isMalformed: false }
    if (PUBLIC_FALSE_STRINGS.has(normalized)) return { isPublic: false, isMalformed: false }
  }
  return { isMalformed: true }
}

function parseGroups(value: unknown): { groups: Array<string>; isMalformed: boolean } {
  if (value === undefined || value === null || value === '' || value === false) return { groups: [], isMalformed: false }
  if (typeof value === 'string') {
    // A comma-separated string is a common hand-authored mistake for a list.
    const groups = value.split(',').map((group) => group.trim()).filter(Boolean)
    return { groups, isMalformed: groups.length === 0 }
  }
  if (Array.isArray(value)) {
    if (value.some((group) => typeof group !== 'string')) return { groups: [], isMalformed: true }
    const groups = value.map((group: string) => group.trim()).filter(Boolean)
    // `groups: [""]` names a group nobody can hold; treat it as malformed
    // rather than silently opening the page.
    return { groups, isMalformed: value.length > 0 && groups.length === 0 }
  }
  return { groups: [], isMalformed: true }
}

/** Read `groups` / `public` from a parsed frontmatter object. */
export function parsePageAccess(frontmatter: Record<string, unknown> | null | undefined): PageAccess {
  if (!frontmatter) return OPEN_PAGE_ACCESS
  const groups = parseGroups(frontmatter.groups)
  const visibility = parsePublic(frontmatter.public)
  return {
    groupSets: groups.groups.length ? [groups.groups] : [],
    ...(visibility.isPublic !== undefined ? { isPublic: visibility.isPublic } : {}),
    isMalformed: groups.isMalformed || visibility.isMalformed,
  }
}

/**
 * Combine the access of several files that together produce one response
 * (a translation and its primary page). The result is the most restrictive:
 * every group requirement applies, `public: false` anywhere wins, and
 * `public: true` holds only when every file says so.
 */
export function mergePageAccess(...accesses: Array<PageAccess>): PageAccess {
  if (accesses.length === 0) return OPEN_PAGE_ACCESS
  const declared = accesses.map((access) => access.isPublic)
  const isPublic = declared.includes(false) ? false : declared.every((value) => value === true) ? true : undefined
  return {
    groupSets: accesses.flatMap((access) => access.groupSets),
    ...(isPublic !== undefined ? { isPublic } : {}),
    isMalformed: accesses.some((access) => access.isMalformed),
  }
}

/** Whether a page carries any restriction beyond the site default. */
export function isPageRestricted(access: PageAccess): boolean {
  return access.isMalformed || access.groupSets.length > 0 || access.isPublic === false
}

/** The shared visibility predicate. See the module header for semantics. */
export function canReaderAccessPage(access: PageAccess, reader: ReaderContext, policy: ReaderAccessPolicy): boolean {
  if (access.isMalformed) return false
  // Without reader auth nobody can be verified, whatever the context claims.
  const isAuthenticated = policy.isEnabled && reader.isAuthenticated
  if (access.groupSets.length > 0) {
    return isAuthenticated && access.groupSets.every((set) => set.some((group) => reader.groups.includes(group)))
  }
  if (access.isPublic === true) return true
  if (access.isPublic === false) return isAuthenticated
  return policy.defaultVisibility === 'public' || isAuthenticated
}

/**
 * Whether a reader may see content that has no page frontmatter at all
 * (generated API-reference operations, the OpenAPI document, API navigation).
 */
export function canReaderAccessUnmarkedContent(reader: ReaderContext, policy: ReaderAccessPolicy): boolean {
  return canReaderAccessPage(OPEN_PAGE_ACCESS, reader, policy)
}

/**
 * Normalize a verified token's group claim. Non-string members make the
 * whole claim invalid (returns null) rather than being silently dropped, so a
 * signer bug is visible instead of granting a partial set.
 */
export function normalizeGroupsClaim(value: unknown, delimiter?: string): Array<string> | null {
  if (value === undefined || value === null) return []
  let list: Array<unknown>
  if (typeof value === 'string') list = delimiter ? value.split(delimiter) : value.split(/[\s,]+/)
  else if (Array.isArray(value)) list = value
  else return null
  if (list.some((group) => typeof group !== 'string')) return null
  if (list.length > READER_AUTH_LIMITS.maxClaimGroups) return null
  const groups = Array.from(new Set((list as Array<string>).map((group) => group.trim()).filter(Boolean)))
  if (groups.some((group) => group.length > READER_AUTH_LIMITS.maxClaimGroupLength)) return null
  return groups
}

/**
 * Read a claim by exact key first (namespaced claims such as
 * `https://example.com/groups` contain dots), then by dotted path.
 */
export function readClaim(payload: Record<string, unknown>, claim: string): unknown {
  if (Object.prototype.hasOwnProperty.call(payload, claim)) return payload[claim]
  let current: unknown = payload
  for (const segment of claim.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Every group name that some page's access rules reference. A reader's other
 * groups cannot change what they see, so sessions keep only these.
 */
export function referencedGroups(accesses: Iterable<PageAccess>): Set<string> {
  const groups = new Set<string>()
  for (const access of accesses) for (const set of access.groupSets) for (const group of set) groups.add(group)
  return groups
}

/**
 * A stable cache key for everything a reader's view depends on. Two readers
 * with the same key see exactly the same pages.
 */
export function readerVisibilityKey(reader: ReaderContext, policy: ReaderAccessPolicy): string {
  if (!policy.isEnabled || !reader.isAuthenticated) return 'anonymous'
  return `reader:${[...reader.groups].sort().join('\u0000')}`
}
