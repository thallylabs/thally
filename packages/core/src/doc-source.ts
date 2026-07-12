/**
 * Doc-entry source registry — the one seam where the framework-agnostic engine
 * learns which pages a site has.
 *
 * The content pipeline, search corpus, and embedding index all need to
 * enumerate the site's pages, but *how* pages are enumerated is a host concern:
 * the Next.js app derives them from `docs.json` + the `src/content` tree, a
 * different host might read a database. Rather than import that host-specific
 * logic (which would drag `docs.json`, `process.cwd()`, and React types into
 * core), the host registers a resolver once at startup and core calls it
 * lazily.
 *
 * Contract:
 * - The host MUST call {@link registerDocEntriesSource} before the first search
 *   or embedding build. The app wires this in `src/lib/search/register-doc-source`,
 *   imported by every engine entry point, so registration always precedes use.
 * - Resolution is lazy and memoized downstream (the corpus and embedding index
 *   are built once per process), so the resolver is typically invoked a single
 *   time — first call wins.
 */

/**
 * The minimal page descriptor the engine needs. A host's richer page type
 * (e.g. the app's `DocEntry`) is structurally assignable to this.
 */
export interface DocEntrySummary {
  /** Stable page id, also the content lookup key (e.g. `guides/quickstart`). */
  id: string
  title: string
  description: string
  /** Site-relative URL (e.g. `/guides/quickstart`). */
  href: string
  keywords: Array<string>
}

type DocEntriesResolver = () => Array<DocEntrySummary>

let resolver: DocEntriesResolver | null = null

/**
 * Register the host's page enumerator. Idempotent and last-wins, so importing
 * the registration module from several entry points is safe.
 */
export function registerDocEntriesSource(fn: DocEntriesResolver): void {
  resolver = fn
}

/**
 * Enumerate the site's pages via the registered resolver. Throws a clear error
 * if the host forgot to register one — a wiring bug, never an expected runtime
 * state.
 */
export function resolveDocEntries(): Array<DocEntrySummary> {
  if (!resolver) {
    throw new Error(
      '@thallylabs/core: no doc-entries source registered. Call registerDocEntriesSource() ' +
        'at startup (the Next.js app does this in src/lib/search/register-doc-source).',
    )
  }
  return resolver()
}
