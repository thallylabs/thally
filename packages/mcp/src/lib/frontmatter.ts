/**
 * The one frontmatter parser for customer-authored content in this package.
 *
 * Only YAML is supported. Parsing delimiters locally keeps legacy JavaScript
 * engines out of the MCP process and treats language-tagged blocks as opaque
 * metadata rather than executable authored input.
 *
 * Internal module — deliberately not part of the package's public API. The
 * app-side original is `src/lib/frontmatter.ts`; the packages keep their own
 * copies because they cannot import from the app.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

interface ParsedFrontmatter {
  content: string
  data: Record<string, unknown>
}

/** Parse frontmatter without any path that can execute the content. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const opening = /^---([^\r\n]*)\r?\n/.exec(source)
  if (!opening || opening[1].startsWith('-')) return { content: source, data: {} }

  const language = opening[1].trim().toLowerCase()
  const remainder = source.slice(opening[0].length)
  const closing = /^---[ \t]*\r?$/m.exec(remainder)
  const matter = closing ? remainder.slice(0, closing.index) : remainder
  let content = closing ? remainder.slice(closing.index + closing[0].length) : ''
  if (content.startsWith('\r\n')) content = content.slice(2)
  else if (content.startsWith('\n')) content = content.slice(1)

  if (matter.trim() === '' || !['', 'yaml', 'yml'].includes(language)) {
    return { content, data: {} }
  }
  const parsed = parseYaml(matter)
  return {
    content,
    data: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {},
  }
}

/** Re-emit a document with the given frontmatter, always as YAML. */
export function stringifyFrontmatter(body: string, data: Record<string, unknown>): string {
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`
  const serialized = stringifyYaml(data, { lineWidth: 0 }).trimEnd()
  return serialized === '{}'
    ? normalizedBody
    : `---\n${serialized}\n---\n${normalizedBody}`
}
