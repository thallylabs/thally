/**
 * Strip a read_page metadata header that a model has echoed back into a page
 * body.
 *
 * read_page presents pages to the model with a metadata preamble (title, page
 * id, description) ahead of the MDX body. Models routinely mirror the exact
 * shape of what they read, so without this guard the preamble gets persisted
 * into src/content and every agent edit accumulates a duplicate H1/description
 * block that the layout already renders from frontmatter.
 *
 * Stripping is evidence-gated: nothing is removed unless the body's opening
 * lines contain an unambiguous echo marker (the italicised page id from the
 * legacy format, or the literal body delimiter from the current format).
 * Legitimate author content is never touched.
 */

const BODY_DELIMITER = '--- MDX body ---'

export function readPageBodyDelimiter(): string {
  return BODY_DELIMITER
}

export function stripEchoedPageHeader(content: string, pageId: string): string {
  const lines = content.split('\n')

  // Current read_page format: metadata lines followed by the literal
  // delimiter. If the delimiter appears near the top, the body is whatever
  // follows it.
  const delimiterIndex = lines.findIndex((line) => line.trim() === BODY_DELIMITER)
  if (delimiterIndex !== -1 && delimiterIndex <= 6) {
    return lines.slice(delimiterIndex + 1).join('\n').replace(/^\n+/, '')
  }

  // Legacy read_page format: `# Title` then `*page/id*`, optionally a
  // `> description` blockquote and a `---` rule. The italicised page id on
  // the second line is the echo evidence — organic MDX never opens that way.
  const first = lines[0]?.trim() ?? ''
  const second = lines[1]?.trim() ?? ''
  if (first.startsWith('# ') && second === `*${pageId}*`) {
    let index = 2
    while (index < lines.length && lines[index].trim() === '') index += 1
    if (lines[index]?.trim().startsWith('> ')) {
      index += 1
      while (index < lines.length && lines[index].trim() === '') index += 1
    }
    if (lines[index]?.trim() === '---') {
      index += 1
    }
    return lines.slice(index).join('\n').replace(/^\n+/, '')
  }

  return content
}
