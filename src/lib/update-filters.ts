/** Changelog tag filtering, following Mintlify: multi-select, an entry matches any selected tag. */

/** True when nothing is selected or the entry carries at least one selected tag. */
export function matchesSelectedTags(entryTags: readonly string[], selected: readonly string[]): boolean {
  return selected.length === 0 || entryTags.some((tag) => selected.includes(tag))
}

/** Tags ordered by how many entries use them (most first); ties keep first-seen order. */
export function tagsByCount(counts: Readonly<Record<string, number>>): string[] {
  return Object.keys(counts).filter((tag) => counts[tag] > 0).sort((a, b) => counts[b] - counts[a])
}

/** Parse the `?tags=A,B` URL parameter. */
export function parseTagsParam(search: string): string[] {
  const value = new URLSearchParams(search).get('tags')
  return value ? value.split(',').map((tag) => tag.trim()).filter(Boolean) : []
}

/** Only a changelog route swaps its table of contents for the filters; other pages keep both. */
export function isChangelogPath(pathname: string | null): boolean {
  return /(^|\/)changelog\/?$/i.test(pathname ?? '')
}
