import { z } from 'zod'

export const semanticSearchSchema = z.object({
  siteUrl: z
    .string()
    .describe('Base URL of the deployed Dox site (e.g. https://docs.example.com)'),
  query: z.string().describe('Natural-language search query'),
  limit: z.number().optional().default(8).describe('Max results to return (default 8)'),
  mode: z
    .enum(['hybrid', 'fulltext'])
    .optional()
    .default('hybrid')
    .describe('Search mode: hybrid (full-text + vector) or fulltext'),
})

export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>

interface SearchApiResult {
  page_id: string
  title: string
  description: string
  url: string
  api_url: string
  score: number
  snippet: string
}

interface SearchApiResponse {
  query: string
  mode: string
  total: number
  results: Array<SearchApiResult>
}

/**
 * Query the deployed site's hybrid search index — the same Orama index that
 * powers the in-app command palette and the `/api/search` endpoint.
 */
export async function handleSemanticSearch(input: SemanticSearchInput): Promise<string> {
  const { siteUrl, query, limit = 8, mode = 'hybrid' } = input
  const base = siteUrl.replace(/\/$/, '')
  const url = `${base}/api/search?q=${encodeURIComponent(query)}&limit=${limit}&mode=${mode}`

  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (err) {
    throw new Error(`Failed to reach ${url}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as SearchApiResponse
  if (!data.results || data.results.length === 0) {
    return `No results found for "${query}".`
  }

  const lines = [`Found ${data.total} result${data.total === 1 ? '' : 's'} for "${query}" (${data.mode}):\n`]
  data.results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title} — ${result.url}`)
    if (result.snippet) lines.push(`   ${result.snippet}`)
    lines.push(`   API: ${result.api_url}`)
    lines.push('')
  })

  return lines.join('\n').trimEnd()
}
