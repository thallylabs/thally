/**
 * App-side facade over the `@thallylabs/core` embedding index.
 *
 * Registers the app's page source (see `../search/register-doc-source`) before
 * re-exporting the index API, so `buildEmbeddingIndex()` enumerates this site's
 * pages. Used by the prebuild embeddings script and by the search engine's
 * hybrid vector index.
 */
import '@/lib/search/register-doc-source'

export { buildEmbeddingIndex, getEmbeddingIndex, resetEmbeddingIndex } from '@thallylabs/core'
export type { PageSource, BuildOptions } from '@thallylabs/core'
