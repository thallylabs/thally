/**
 * The one frontmatter parser for authored content in this package.
 *
 * Only YAML is supported. Parsing delimiters locally keeps legacy JavaScript
 * engines out of migration processes and treats language-tagged blocks as
 * opaque metadata rather than executable third-party input.
 *
 * Internal module — deliberately not part of the package's public API. The
 * app-side original is `src/lib/frontmatter.ts`; the packages keep their own
 * copies because they cannot import from the app.
 */

import { parse as parseYaml } from 'yaml'

interface ParsedFrontmatter {
  content: string
  data: Record<string, unknown>
  /** Set when the frontmatter block was invalid YAML; `data` is a best-effort salvage. */
  error?: string
}

/**
 * Best-effort recovery for frontmatter that failed to parse as a whole block:
 * try each top-level `key: value` line on its own. A line that is itself
 * invalid YAML (e.g. an unescaped reserved character) is skipped rather than
 * aborting the whole page.
 */
function salvageFrontmatterLines(matter: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const line of matter.split(/\r?\n/)) {
    if (!/^[A-Za-z_][\w-]*:\s?/.test(line)) continue
    try {
      const parsedLine = parseYaml(line)
      if (parsedLine && typeof parsedLine === 'object' && !Array.isArray(parsedLine)) {
        Object.assign(data, parsedLine)
      }
    } catch {
      // Line is unrecoverable on its own; drop just that field.
    }
  }
  return data
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
  try {
    const parsed = parseYaml(matter)
    return {
      content,
      data: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {},
    }
  } catch (err) {
    return {
      content,
      data: salvageFrontmatterLines(matter),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
