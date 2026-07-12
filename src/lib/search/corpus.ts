/**
 * App-side facade over the `@thallylabs/core` search corpus builders.
 *
 * Registers the app's page source (see `./register-doc-source`) before
 * re-exporting the corpus API, so the corpus is built from this site's pages.
 */
import './register-doc-source'

export { buildSearchCorpus, getClientSearchCorpus } from '@thallylabs/core'
export type { SearchRecord } from '@thallylabs/core'
