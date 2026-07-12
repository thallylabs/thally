/**
 * App → engine binding for page enumeration.
 *
 * `@thallylabs/core` is framework-agnostic and does not know how this site
 * lists its pages, so it exposes a resolver seam. This module fills it with the
 * app's `docs.json` + `src/content`-derived page list. It is imported for its
 * side-effect by every engine entry point (search + embeddings), so
 * registration always runs before the first corpus or embedding-index build.
 *
 * Idempotent (last-wins), so multiple entry points importing it is harmless.
 * `DocEntry` is a structural superset of core's `DocEntrySummary`, so the app's
 * richer entries satisfy the resolver contract directly.
 */
import { registerDocEntriesSource } from '@thallylabs/core'
import { getDocEntries } from '@/data/docs'

registerDocEntriesSource(() => getDocEntries())
