/**
 * Bounded response-header contract for the documentation pages behind an AI
 * answer. Both browser and server code use this module so untrusted metadata
 * cannot turn the source disclosure into an external or executable link.
 */

export const AI_ANSWER_SOURCES_HEADER = 'x-thally-ai-sources'

const MAX_SOURCE_COUNT = 8
const MAX_SOURCE_TITLE_CHARS = 160
const MAX_SOURCE_URL_CHARS = 512

export interface AiAnswerSource {
  title: string
  url: string
}

/** Keep only bounded, same-site documentation links and deduplicate by page. */
export function normalizeAiAnswerSources(value: unknown): Array<AiAnswerSource> {
  if (!Array.isArray(value)) return []

  const sources: Array<AiAnswerSource> = []
  const pageUrls = new Set<string>()

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const { title, url } = item as Record<string, unknown>
    if (typeof title !== 'string' || typeof url !== 'string') continue

    const normalizedTitle = title.trim().slice(0, MAX_SOURCE_TITLE_CHARS)
    const normalizedUrl = url.trim()
    if (
      !normalizedTitle ||
      !normalizedUrl.startsWith('/') ||
      normalizedUrl.startsWith('//') ||
      normalizedUrl.includes('\\') ||
      normalizedUrl.length > MAX_SOURCE_URL_CHARS
    ) {
      continue
    }

    const pageUrl = normalizedUrl.split('#', 1)[0]
    if (pageUrls.has(pageUrl)) continue
    pageUrls.add(pageUrl)
    sources.push({ title: normalizedTitle, url: normalizedUrl })
    if (sources.length === MAX_SOURCE_COUNT) break
  }

  return sources
}

/** Serialize sources into an ASCII-safe value suitable for a response header. */
export function serializeAiAnswerSources(value: unknown): string {
  const sources = normalizeAiAnswerSources(value)
  return sources.length > 0 ? encodeURIComponent(JSON.stringify(sources)) : ''
}

/** Parse the source header defensively at the browser boundary. */
export function parseAiAnswerSources(value: string | null): Array<AiAnswerSource> {
  if (!value) return []
  try {
    return normalizeAiAnswerSources(JSON.parse(decodeURIComponent(value)))
  } catch {
    return []
  }
}
