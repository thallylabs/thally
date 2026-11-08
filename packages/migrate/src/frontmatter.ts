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

/** A top-level `key:` line: a value that reaches one on its next line is not a continuation of a quoted value. */
const KEY_LINE = /^[A-Za-z_][\w-]*:(?:\s|$)/
const QUOTED_KEY_LINE = /^[A-Za-z_][\w-]*:[ \t]*(["'])/

/** The index of the quote that closes a quoted value, reading `line` from `from` (a double quote escapes with `\`, a single one by doubling); -1 when the line holds none. */
function closingQuote(line: string, from: number, quote: string): number {
  for (let index = from; index < line.length; index++) {
    if (quote === '"' && line[index] === '\\') index++
    else if (line[index] === quote) {
      if (quote === "'" && line[index + 1] === "'") index++
      else return index
    }
  }
  return -1
}

/**
 * Mintlify reads a quoted value that goes on over an unindented line (a closing quote alone on the next line, say) and folds each line
 * break into a space; YAML wants such a line indented, so the block is rejected here. This folds exactly those values and nothing else:
 * the closing quote has to come before any line that starts a field, with nothing but a comment after it, and the lines in between
 * cannot be blank. Anything else leaves the block as it was, so a quote that is never closed stays an error. Undefined when nothing was folded.
 */
function foldQuotedLineBreaks(matter: string): string | undefined {
  const lines = matter.split(/\r?\n/)
  const folded: Array<string> = []
  let changed = false
  for (let start = 0; start < lines.length; start++) {
    const opening = QUOTED_KEY_LINE.exec(lines[start])
    if (!opening || closingQuote(lines[start], opening[0].length, opening[1]) !== -1) {
      folded.push(lines[start])
      continue
    }
    const quote = opening[1]
    let value = lines[start].slice(opening[0].length).trimEnd()
    let end = start + 1
    for (; end < lines.length; end++) {
      const line = lines[end]
      if (line.trim() === '' || KEY_LINE.test(line)) return undefined
      const close = closingQuote(line, 0, quote)
      if (close === -1) {
        value += ` ${line.trim()}`
        continue
      }
      if (!/^\s*(?:#.*)?$/.test(line.slice(close + 1))) return undefined
      value += ` ${line.slice(0, close).trimStart()}`
      break
    }
    if (end === lines.length) return undefined
    folded.push(`${lines[start].slice(0, opening[0].length - 1)}${quote}${value}${quote}`)
    changed = true
    start = end
  }
  return changed ? folded.join('\n') : undefined
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
    const foldedMatter = foldQuotedLineBreaks(matter)
    if (foldedMatter !== undefined) {
      try {
        const parsed = parseYaml(foldedMatter)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { content, data: parsed as Record<string, unknown> }
      } catch {
        // Another part of the block is invalid as well: report the original error below.
      }
    }
    return {
      content,
      data: salvageFrontmatterLines(matter),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
