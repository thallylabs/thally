export { getEmbeddingProvider, localHashProvider, embedLocal, resetEmbeddingProvider } from '@/lib/embeddings/provider'
export { chunkDocument, estimateTokens } from '@/lib/embeddings/chunk'
export {
  buildEmbeddingIndex,
  getEmbeddingIndex,
  resetEmbeddingIndex,
} from '@/lib/embeddings/index-store'
export { getRelevantChunks, rankChunks } from '@/lib/embeddings/retrieve'
export type {
  Chunk,
  EmbeddedChunk,
  EmbeddingIndex,
  EmbeddingProvider,
  EmbeddingVector,
  RetrievalResult,
} from '@/lib/embeddings/types'
