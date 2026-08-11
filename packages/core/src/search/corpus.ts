/** Search-record projections over the canonical structured content graph. */

import { getContentDocument, loadContentDocument } from '../content/index.js'
import { resolveDocEntries, resolveDocEntriesAsync } from '../doc-source.js'

export interface SearchRecord {
  id: string
  pageId: string
  title: string
  description: string
  headings: string
  body: string
  keywords: string
  href: string
}

const BODY_LIMIT = 4000
const CLIENT_BODY_LIMIT = 700

function buildRecords(bodyLimit: number): Array<SearchRecord> {
  const records: Array<SearchRecord> = []
  for (const entry of resolveDocEntries()) {
    const document = getContentDocument(entry.id)
    if (!document) continue
    const headings = document.content.headings.map((heading) => heading.text).join(' · ')
    const body = document.content.text.slice(0, bodyLimit)
    records.push({
      id: entry.id,
      pageId: entry.id,
      title: entry.title,
      description: entry.description,
      headings,
      body,
      keywords: entry.keywords.join(' '),
      href: entry.href,
    })
  }
  return records
}

async function buildRecordsAsync(bodyLimit: number): Promise<Array<SearchRecord>> {
  const records = await Promise.all(
    (await resolveDocEntriesAsync()).map(async (entry): Promise<SearchRecord | null> => {
      const document = await loadContentDocument(entry.id)
      if (!document) return null
      return {
        id: entry.id,
        pageId: entry.id,
        title: entry.title,
        description: entry.description,
        headings: document.content.headings.map((heading) => heading.text).join(' · '),
        body: document.content.text.slice(0, bodyLimit),
        keywords: entry.keywords.join(' '),
        href: entry.href,
      }
    }),
  )
  return records.filter((record): record is SearchRecord => record !== null)
}

let serverCorpus: Array<SearchRecord> | null = null

/** Full corpus (long body) used by the server hybrid index. */
export function buildSearchCorpus(): Array<SearchRecord> {
  if (!serverCorpus) serverCorpus = buildRecords(BODY_LIMIT)
  return serverCorpus
}

let asyncServerCorpus: Promise<Array<SearchRecord>> | null = null

/** Full server corpus supporting remote/asset-backed content readers. */
export function buildSearchCorpusAsync(): Promise<Array<SearchRecord>> {
  if (!asyncServerCorpus) asyncServerCorpus = buildRecordsAsync(BODY_LIMIT)
  return asyncServerCorpus
}

let clientCorpus: Array<SearchRecord> | null = null

/** Lighter corpus (truncated body) shipped to the browser for instant search. */
export function getClientSearchCorpus(): Array<SearchRecord> {
  if (!clientCorpus) clientCorpus = buildRecords(CLIENT_BODY_LIMIT)
  return clientCorpus
}
