/** Changelog tag filtering, following Mintlify: multi-select, an entry matches any selected tag. */

/** True when nothing is selected or the entry carries at least one selected tag. */
export function matchesSelectedTags(entryTags: readonly string[], selected: readonly string[]): boolean {
  return selected.length === 0 || entryTags.some((tag) => selected.includes(tag))
}

/** Keep only selected tags that some registered entry carries, so a stale URL tag cannot hide everything. */
export function validSelectedTags(selected: readonly string[], counts: Readonly<Record<string, number>>): string[] {
  return selected.filter((tag) => (counts[tag] ?? 0) > 0)
}

/** Tags ordered by how many entries use them (most first); ties keep first-seen order. */
export function tagsByCount(counts: Readonly<Record<string, number>>): string[] {
  return Object.keys(counts).filter((tag) => counts[tag] > 0).sort((a, b) => counts[b] - counts[a])
}

/** Parse `?tags=`: repeated params, plus the legacy comma-joined `?tags=A,B` form (each value is kept whole as well as split). */
export function parseTagsParam(search: string): string[] {
  const out: string[] = []
  for (const value of new URLSearchParams(search).getAll('tags')) {
    for (const tag of [value, ...(value.includes(',') ? value.split(',') : [])]) {
      const trimmed = tag.trim()
      if (trimmed && !out.includes(trimmed)) out.push(trimmed)
    }
  }
  return out
}

/** Only a changelog route swaps its table of contents for the filters; other pages keep both. */
export function isChangelogPath(pathname: string | null): boolean {
  return /(^|\/)changelog\/?$/i.test(pathname ?? '')
}
