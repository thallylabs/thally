export type EmbeddingVector = Array<number>

/**
 * Pluggable embedding backend. The default is a local, dependency-free,
 * deterministic provider so the out-of-box experience needs no API key.
 */
export interface EmbeddingProvider {
  /** Stable id used to cache-key the persisted index (e.g. `local-hash-v1`). */
  id: string
  dimensions: number
  embed(texts: Array<string>): Promise<Array<EmbeddingVector>>
}

/** A heading-bounded, retrieval-sized unit of content. */
export interface Chunk {
  id: string
  pageId: string
  href: string
  /** Document title. */
  title: string
  /** Section heading text. */
  heading: string
  headingPath: Array<string>
  /** Heading id used to deep-link into the page (`href#anchor`). */
  anchor: string
  text: string
  /** Estimated token count. */
  tokens: number
}

export interface EmbeddedChunk extends Chunk {
  embedding: EmbeddingVector
}

export interface EmbeddingIndex {
  provider: string
  dimensions: number
  createdAt: string
  chunks: Array<EmbeddedChunk>
}

export interface RetrievalResult {
  chunk: Chunk
  score: number
}
