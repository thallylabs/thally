/**
 * Structured changelog — the `<Update>` entries on the site's changelog page(s).
 *
 * Entries come from the content graph (`ParsedContent.updates`, extracted by
 * the one MDX parser in `@thallylabs/core`), never from a second parser or a
 * hand-maintained list. Every changelog surface projects this model:
 * `/changelog/rss.xml`, `/changelog/feed.json`, MCP `list_changes`, and the
 * discovery links in `llms.txt` / `/api/docs-index`.
 *
 * Rules:
 * - **Which pages.** A published page whose id is `changelog`, starts with
 *   `changelog/`, or ends with `/changelog` (e.g. `product/changelog`).
 *   `noindex` pages are skipped — a feed is an indexing surface — but `hidden`
 *   pages count: changelogs are often linked from the navbar, not the sidebar.
 * - **Reader access.** Only pages the reader may open contribute entries; a
 *   localized changelog also needs the reader to pass the translation's own
 *   rules. Feeds and discovery links are anonymous projections (cacheable and
 *   public); MCP `list_changes` passes the request's reader.
 * - **Audience.** Entry bodies use the agent projection, exactly like the
 *   `.md` mirror and MCP `read_page`: `<Visibility for="humans">` / `<Human>`
 *   content never reaches a feed.
 * - **Dates.** `date` is authored free text. Only ISO-like dates
 *   (`2026-06-20`, optionally with a time) and written-out dates with a day
 *   (`June 20, 2026`, `20 June 2026`) become `published`; anything else
 *   ("Spring 2025") stays undated rather than becoming a wrong date.
 * - **Order.** Dated entries newest first, then undated ones in source order.
 */

import { canReaderViewPage, loadDocEntries, type DocEntry } from '@/data/docs'
import { ANONYMOUS_READER, type ReaderContext } from '@/lib/reader-auth/access'
import { loadContentDocument } from '@/lib/content'
import { localizedPath } from '@/lib/i18n/config'
import { hasDocTranslation } from '@/lib/i18n/translation-source'

export interface ChangelogEntry {
  /** Unique, stable id: the entry's absolute URL with its anchor. */
  id: string
  /** Anchor on the changelog page ('' when the entry has none). */
  anchor: string
  label: string
  /** Display title: the `title` prop, else the label, else the date. */
  title: string
  /** The `date` prop as authored. */
  date?: string
  /** ISO 8601 timestamp when `date` is unambiguous. */
  published?: string
  description?: string
  tags: Array<string>
  /** Entry body as Markdown with site-relative links made absolute. */
  markdown: string
  text: string
  /** Absolute URL of the entry (`page#anchor`). */
  url: string
  page_id: string
}

export interface Changelog {
  /** Absolute URL of the primary changelog page, or null when the site has none. */
  pageUrl: string | null
  /** Title of the primary changelog page. */
  pageTitle: string | null
  entries: Array<ChangelogEntry>
}

/** Whether a page id names a changelog page (see module rules). */
export function isChangelogPageId(pageId: string): boolean {
  return pageId === 'changelog' || pageId.startsWith('changelog/') || pageId.endsWith('/changelog')
}

/** Published, indexable changelog pages `reader` may open (anonymous by default), in navigation order. */
export async function findChangelogPages(reader: ReaderContext = ANONYMOUS_READER): Promise<Array<DocEntry>> {
  return (await loadDocEntries(reader)).filter((entry) => isChangelogPageId(entry.id) && !entry.noindex)
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const WRITTEN_DATE = new RegExp(`^(?:${MONTH} \\d{1,2},? \\d{4}|\\d{1,2} ${MONTH},? \\d{4})$`, 'i')
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** Parse an authored changelog date into ISO 8601, or undefined when ambiguous. */
export function parseChangelogDate(value: string | undefined): string | undefined {
  const date = value?.trim()
  if (!date) return undefined
  if (ISO_DATE.test(date)) {
    // A bare date is a calendar day, not local midnight on the server.
    const parsed = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date)
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
  }
  // Written-out dates with an explicit day: "June 20, 2026", "20 June 2026".
  // `Date.parse` alone is far too lenient ("Spring 2025" becomes January 1st).
  if (!WRITTEN_DATE.test(date)) return undefined
  const parsed = Date.parse(`${date.replace(',', '')} UTC`)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

/**
 * Make site-relative Markdown links and images absolute, so a feed item or an
 * agent reading the entry out of context can follow them.
 */
export function absolutizeMarkdownLinks(markdown: string, origin: string): string {
  return markdown.replace(/(\]\()(\/(?!\/)[^)\s]*)/g, (_match, open: string, path: string) => `${open}${origin}${path}`)
}

/**
 * Load every changelog entry for a locale (default locale when omitted).
 * A translated changelog page is used when one exists; otherwise the source
 * page, matching what the localized route renders.
 */
export async function loadChangelog(options: {
  origin: string
  locale?: string
  defaultLocale?: string
  /** Whose view to project; anonymous when omitted (the feeds). */
  reader?: ReaderContext
}): Promise<Changelog> {
  const { origin, locale, defaultLocale, reader = ANONYMOUS_READER } = options
  const isLocalized = Boolean(locale && defaultLocale && locale !== defaultLocale)
  const visible = await findChangelogPages(reader)
  // A translation may restrict its page further than the primary file. Pages
  // without a translation fall back to the (already checked) source page.
  const isAllowedTranslation = async (page: DocEntry) =>
    !(await hasDocTranslation(page.slug, locale!)) || canReaderViewPage(page.id, reader, locale)
  const pages = isLocalized
    ? (await Promise.all(visible.map(async (page) => (await isAllowedTranslation(page)) ? page : null)))
        .filter((page): page is DocEntry => page !== null)
    : visible
  const pageHref = (entry: DocEntry) => isLocalized ? localizedPath(entry.href, locale!, defaultLocale!) : entry.href

  const dated: Array<ChangelogEntry> = []
  const undated: Array<ChangelogEntry> = []
  const seenIds = new Set<string>()
  for (const page of pages) {
    const document = await loadContentDocument(page.id, isLocalized ? locale : undefined)
    const updates = document?.content.updates ?? []
    updates.forEach((update, index) => {
      const pageUrl = `${origin}${pageHref(page)}`
      // Two entries may share a label (and so an anchor); ids must stay unique.
      let id = update.id ? `${pageUrl}#${update.id}` : `${pageUrl}#entry-${index + 1}`
      for (let n = 2; seenIds.has(id); n += 1) id = `${pageUrl}#${update.id || 'entry'}-${n}`
      seenIds.add(id)
      const published = parseChangelogDate(update.date)
      const entry: ChangelogEntry = {
        id,
        anchor: update.id,
        label: update.label,
        title: update.title || update.label || update.date || page.title,
        ...(update.date ? { date: update.date } : {}),
        ...(published ? { published } : {}),
        ...(update.description ? { description: update.description } : {}),
        tags: update.tags,
        markdown: absolutizeMarkdownLinks(update.markdown, origin),
        text: update.text,
        url: update.id ? `${pageUrl}#${update.id}` : pageUrl,
        page_id: page.id,
      }
      if (published) dated.push(entry)
      else undated.push(entry)
    })
  }
  // Array.prototype.sort is stable, so same-day entries keep source order.
  dated.sort((left, right) => right.published!.localeCompare(left.published!))
  const primary = pages[0]
  return {
    pageUrl: primary ? `${origin}${pageHref(primary)}` : null,
    pageTitle: primary?.title ?? null,
    entries: [...dated, ...undated],
  }
}

/** Entries published on or after `since` (ISO date or timestamp). Undated entries never match. */
export function filterChangesSince(entries: Array<ChangelogEntry>, since: string | undefined): Array<ChangelogEntry> {
  if (!since) return entries
  const threshold = parseChangelogDate(since)
  if (!threshold) return entries
  return entries.filter((entry) => entry.published !== undefined && entry.published >= threshold)
}
