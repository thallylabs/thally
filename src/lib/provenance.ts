import matter from 'gray-matter'

/**
 * Frontmatter keys that are **internal provenance** — the mechanism `thally check
 * --drift` uses to detect staleness. They must NEVER appear in any public
 * projection (HTML, JSON, JSON-LD, `.md` mirror, llms.txt, docs-index): a
 * consuming agent can't interpret a source path or commit from a repo it can't
 * see, and publishing internal file layout is a leak. Only CI (which already has
 * repo access) reads them, straight from the `.mdx` file.
 *
 * Public freshness is a different thing: `lastVerified` / `verifiedVersion` are
 * dates/labels and ARE surfaced.
 */
export const INTERNAL_FRONTMATTER_KEYS = ['sources', 'verifiedCommit'] as const

/**
 * Return the raw `.mdx` text with any internal provenance keys stripped from its
 * frontmatter. If none are present the input is returned untouched (so existing
 * pages aren't reformatted).
 */
export function stripInternalFrontmatter(raw: string): string {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(raw)
  } catch {
    return raw
  }
  const data = parsed.data as Record<string, unknown>
  const hasInternal = INTERNAL_FRONTMATTER_KEYS.some((key) => key in data)
  if (!hasInternal) return raw

  const clean: Record<string, unknown> = { ...data }
  for (const key of INTERNAL_FRONTMATTER_KEYS) delete clean[key]
  return matter.stringify(parsed.content, clean)
}
