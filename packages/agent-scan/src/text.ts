/**
 * Text normalization and alternate-title extraction used by the parity
 * checks: NFKC, lower-case, whitespace collapsed, Unicode punctuation removed.
 */

/** Normalize text for parity comparison. */
export function normalizeForParity(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\p{P}/gu, '').replace(/\s+/g, ' ').trim()
}

/**
 * Title of a Markdown document: a frontmatter `title:` value, else the first
 * ATX `# ` heading. Null when neither exists.
 */
export function markdownTitle(markdown: string): string | null {
  const body = markdown.replace(/^﻿/, '')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(body)
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = /^title\s*:\s*(.*)$/.exec(line)
      if (match) {
        const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim()
        if (value) return value
      }
    }
  }
  const content = frontmatter ? body.slice(frontmatter[0].length) : body
  for (const line of content.split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) return match[1].trim()
  }
  return null
}

/** Title of a JSON document: top-level `title`, then `headline`, then `name`. */
export function jsonTitle(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of ['title', 'headline', 'name']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}
