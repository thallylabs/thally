/**
 * Canonical JSON: object keys sorted recursively by code unit, array order
 * preserved, `JSON.stringify` semantics otherwise. Two equal values always
 * serialize to the same bytes, which is what replay determinism compares.
 */

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalize(item)))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const item = source[key]
      if (item === undefined || typeof item === 'function') continue
      out[key] = canonicalize(item)
    }
    return out
  }
  return value
}

/** Serialize with recursively sorted keys and no whitespace. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}
