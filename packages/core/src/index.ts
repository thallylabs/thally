/**
 * `@thallylabs/core` — the framework-agnostic core of the Thally docs engine.
 *
 * This is the server-oriented main entry: the content pipeline (single-parse
 * MDX → typed content graph), the search engine and corpus, and the embedding
 * index. It has no dependency on Next.js, React, or `docs.json`; the host wires
 * in its page list through {@link registerDocEntriesSource} (see `./doc-source`).
 *
 * Pure brand/theme token helpers live at the separate `@thallylabs/core/theme`
 * entry so client bundles never pull in Node/MDX/search code.
 *
 * Boundary note: nothing here may import `src/cloud` — core is engine-side and
 * ships in the OSS distribution. Cloud-tier services reach engine code, never
 * the reverse.
 */

// Doc-entry source registry (host-provided page enumeration).
export {
  registerDocEntriesSource,
  resolveDocEntries,
} from './doc-source.js'
export type { DocEntrySummary } from './doc-source.js'

// Slug helper (shared with the app's src/lib/utils re-export).
export { slugify } from './slugify.js'

// Content pipeline.
export {
  parseMdxContent,
  getContentDocument,
  registerContentDocumentSource,
  mdxToMarkdown,
} from './content/index.js'
export type {
  ContentDocument,
  ContentDocumentResolver,
  ContentHeading,
  ContentTocItem,
  ContentCodeBlock,
  ContentLink,
  ContentSection,
  ParsedContent,
} from './content/index.js'

// Search.
export {
  searchDocs,
  getSearchEngine,
  resetSearchEngine,
} from './search/engine.js'
export type { SearchMode, SearchHit } from './search/engine.js'
export {
  buildSearchCorpus,
  getClientSearchCorpus,
} from './search/corpus.js'
export type { SearchRecord } from './search/corpus.js'

// Embeddings.
export {
  getEmbeddingProvider,
  localHashProvider,
  embedLocal,
  resetEmbeddingProvider,
  chunkDocument,
  estimateTokens,
  buildEmbeddingIndex,
  getEmbeddingIndex,
  resetEmbeddingIndex,
  getRelevantChunks,
  rankChunks,
} from './embeddings/index.js'
export type {
  PageSource,
  BuildOptions,
  Chunk,
  EmbeddedChunk,
  EmbeddingIndex,
  EmbeddingProvider,
  EmbeddingVector,
  RetrievalResult,
} from './embeddings/index.js'
