/** Dependency-free, so build scripts and the docs runtime read `openapi:` frontmatter identically. */

export interface OpenApiReference {
  specId: string
  method: string
  path: string
}

/** `openapi: "GET /path"` frontmatter as a reference; anything else is not a reference. */
export function parseOpenApiReference(raw?: unknown): OpenApiReference | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) {
    return null
  }

  const method = parts[0]?.toUpperCase()
  const path = parts.slice(1).join(' ')
  if (!method || !path.startsWith('/')) {
    return null
  }

  return {
    specId: 'default',
    method,
    path,
  }
}
