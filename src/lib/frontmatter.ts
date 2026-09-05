/**
 * The one frontmatter parser for customer-authored content.
 *
 * Only YAML is supported. Parsing the delimiters here keeps legacy JavaScript
 * frontmatter engines out of both the request Worker and build process; a
 * language-tagged block is treated as opaque metadata and is never executed.
 *
 * Sibling copies exist in the workspace packages that cannot import from
 * `src/` (packages/core, packages/mcp, packages/create-thally-docs,
 * packages/migrate). Parity tests keep those copies on the same safe contract.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface ParsedFrontmatter {
  content: string
  data: Record<string, unknown>
}

/** Parse frontmatter without any path that can execute the content. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const opening = /^---([^\r\n]*)\r?\n/.exec(source)
  if (!opening || opening[1].startsWith('-')) {
    return { content: source, data: {} }
  }

  const language = opening[1].trim().toLowerCase()
  const remainder = source.slice(opening[0].length)
  const closing = /^---[ \t]*\r?$/m.exec(remainder)
  const matter = closing ? remainder.slice(0, closing.index) : remainder
  let content = closing ? remainder.slice(closing.index + closing[0].length) : ''
  if (content.startsWith('\r\n')) content = content.slice(2)
  else if (content.startsWith('\n')) content = content.slice(1)

  let data: Record<string, unknown> = {}
  if (matter.trim() !== '' && (language === '' || language === 'yaml' || language === 'yml')) {
    const parsed = parseYaml(matter)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  }

  return { content, data }
}

/** Re-emit a document with the given frontmatter, always as YAML. */
export function stringifyFrontmatter(body: string, data: Record<string, unknown>): string {
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`
  const serialized = stringifyYaml(data, { lineWidth: 0 }).trimEnd()
  return serialized === '{}'
    ? normalizedBody
    : `---\n${serialized}\n---\n${normalizedBody}`
}
