/** Page `openapi:` frontmatter helpers: the optional spec prefix and its rewrite. */

export interface OpenApiPageRef {
  /** Spec file/URL as authored, without surrounding quotes. */
  specRef?: string
  /** `METHOD /path` or `webhook name`. */
  operation: string
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  return (quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

/** Split `openapi: "[spec] METHOD /path"` or `openapi: "[spec] webhook name"`. */
export function splitOpenApiRef(raw: string): OpenApiPageRef | null {
  const value = unquote(raw)
  const match = /^(?:(.+?)\s+)?((?:webhook\s+[^\s/]\S*)|(?:[A-Za-z]+\s+\/.*))$/i.exec(value)
  if (!match) return null
  const specRef = match[1] ? unquote(match[1]) : undefined
  return { ...(specRef ? { specRef } : {}), operation: match[2] }
}

/** The name the renderer matches a spec by: the lowercase file name, without directories. */
export function specRefBaseName(specRef: string): string {
  return specRef.trim().replace(/\\/g, '/').split(/[?#]/, 1)[0].split('/').filter(Boolean).pop()?.toLowerCase() ?? ''
}

/** Rewrite a page's spec prefix to the location the migrated spec was written to. */
export function withSpecRef(ref: OpenApiPageRef, specRef: string): string {
  return `${specRef} ${ref.operation}`
}
