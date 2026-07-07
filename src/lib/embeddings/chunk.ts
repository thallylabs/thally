import type { ContentSection } from '@/lib/content/types'
import type { Chunk } from '@/lib/embeddings/types'

// Rough token estimate (~4 chars/token) — good enough for budgeting retrieval.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const MAX_CHUNK_TOKENS = 512

export interface ChunkSource {
  pageId: string
  href: string
  title: string
  sections: Array<ContentSection>
}

function sectionBody(section: ContentSection): string {
  const parts: Array<string> = []
  if (section.text) parts.push(section.text)
  for (const code of section.code) {
    parts.push('```' + code.language + (code.title ? ` ${code.title}` : '') + '\n' + code.source + '\n```')
  }
  return parts.join('\n\n').trim()
}

// Split overly long section bodies into windows on paragraph boundaries so no
// single chunk blows the embedding/context budget.
function splitBody(body: string): Array<string> {
  if (estimateTokens(body) <= MAX_CHUNK_TOKENS) return [body]

  const paragraphs = body.split(/\n{2,}/)
  const windows: Array<string> = []
  let buffer = ''

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph
    if (estimateTokens(candidate) > MAX_CHUNK_TOKENS && buffer) {
      windows.push(buffer)
      buffer = paragraph
    } else {
      buffer = candidate
    }
  }
  if (buffer) windows.push(buffer)
  return windows
}

/**
 * Turn a document's heading-bounded sections into retrieval chunks. Each chunk
 * is prefixed with its heading path so lexical/semantic matching has context,
 * and anchored to a heading id for deep links.
 */
export function chunkDocument(source: ChunkSource): Array<Chunk> {
  const chunks: Array<Chunk> = []

  for (const section of source.sections) {
    const body = sectionBody(section)
    if (!body) continue

    const headingPath = section.headingPath.length ? section.headingPath : [source.title]
    const prefix = headingPath.join(' > ')

    splitBody(body).forEach((window, windowIndex) => {
      const text = `${prefix}\n${window}`.trim()
      chunks.push({
        id: `${source.pageId}#${section.id || 'overview'}::${windowIndex}`,
        pageId: source.pageId,
        href: source.href,
        title: source.title,
        heading: section.title || source.title,
        headingPath,
        anchor: section.id,
        text,
        tokens: estimateTokens(text),
      })
    })
  }

  return chunks
}
