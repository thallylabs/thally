/** Framework-agnostic search entry isolated from filesystem document loading. */

export { searchDocs, getSearchEngine, resetSearchEngine } from './engine.js'
export type { SearchMode, SearchHit } from './engine.js'
export {
  buildSearchCorpus,
  buildSearchCorpusAsync,
  getClientSearchCorpus,
} from './corpus.js'
export type { SearchRecord } from './corpus.js'
