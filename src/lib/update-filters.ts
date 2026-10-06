/** Changelog tag filtering, following Mintlify: multi-select, an entry matches any selected tag. */

/** True when nothing is selected or the entry carries at least one selected tag. */
export function matchesSelectedTags(entryTags: readonly string[], selected: readonly string[]): boolean {
  return selected.length === 0 || entryTags.some((tag) => selected.includes(tag))
}

/** Keep only selected tags that some registered entry carries, so a stale URL tag cannot hide everything. */
export function validSelectedTags(selected: readonly string[], counts: Readonly<Record<string, number>>): string[] {
  return selected.filter((tag) => (counts[tag] ?? 0) > 0)
}

/** The tags an `<Update tags>` prop registers: a comma string or an array, each trimmed, so they match what `parseTagsParam` restores. */
export function normalizeTags(tags: readonly string[] | string | undefined): string[] {
  const list = typeof tags === 'string' ? tags.split(',') : tags ?? []
  return list.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
}

/** Tags ordered by how many entries use them (most first); ties keep first-seen order. */
export function tagsByCount(counts: Readonly<Record<string, number>>): string[] {
  return Object.keys(counts).filter((tag) => counts[tag] > 0).sort((a, b) => counts[b] - counts[a])
}

/**
 * Parse `?tags=`: repeated params, plus the legacy comma-joined `?tags=A,B` form. With `counts`, a value
 * that is itself a registered tag is kept whole and never split; without, both readings are returned.
 */
export function parseTagsParam(search: string, counts?: Readonly<Record<string, number>>): string[] {
  const out: string[] = []
  for (const value of new URLSearchParams(search).getAll('tags')) {
    const exact = counts ? (counts[value] ?? 0) > 0 : false
    const split = value.includes(',') && !exact ? value.split(',') : []
    for (const tag of counts ? (split.length ? split : [value]) : [value, ...split]) {
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

/** True when the URL hash targets this entry while a filter hides it, so the filter should be cleared. */
export function shouldRevealForHash(hash: string, id: string | undefined, hidden: boolean): boolean {
  if (!id || !hidden || !hash) return false
  const raw = hash.replace(/^#/, '')
  try { return decodeURIComponent(raw) === id } catch { return raw === id }
}
