/**
 * Validates `seo.metatags` before it reaches the page head. Each entry becomes
 * `<meta name=key content=value>`, so only a plain string name and a string
 * content are accepted. Names that browsers treat as `http-equiv` directives
 * (refresh, set-cookie, a CSP, ...) are dropped: a docs.json is not a place to
 * redirect readers or set policy, and Mintlify's metatags take plain key-value
 * pairs only.
 */

const NAME_PATTERN = /^[\w:.-]+$/
const MAX_CONTENT_LENGTH = 1000
const HTTP_EQUIV_NAMES = new Set([
  'refresh',
  'set-cookie',
  'location',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-type',
  'default-style',
  'x-ua-compatible',
])

export function isSafeMetatag(name: unknown, content: unknown): content is string {
  if (typeof name !== 'string' || typeof content !== 'string') return false
  const lower = name.toLowerCase()
  if (!NAME_PATTERN.test(name) || lower.startsWith('http-equiv') || HTTP_EQUIV_NAMES.has(lower)) return false
  return content.length <= MAX_CONTENT_LENGTH && ![...content].some((character) => character.charCodeAt(0) < 32)
}

/** The valid entries of a hand-edited `seo.metatags` value; anything else is dropped. */
export function validMetatags(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => isSafeMetatag(entry[0], entry[1]))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
