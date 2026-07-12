/**
 * App-side facade over the `@thallylabs/core` search engine.
 *
 * Importing this module registers the app's page source (see
 * `./register-doc-source`) before re-exporting the framework-agnostic search
 * API, so any consumer of `@/lib/search/engine` gets a fully wired engine.
 */
import './register-doc-source'

export { searchDocs, getSearchEngine, resetSearchEngine } from '@thallylabs/core'
export type { SearchMode, SearchHit } from '@thallylabs/core'
