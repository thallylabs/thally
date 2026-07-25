# @thallylabs/core

The framework-agnostic content engine behind the
[Thally](https://thally.io) product-knowledge pipeline. It turns one directory
of MDX into structured, queryable, agent-readable customer-facing knowledge
through content parsing, search, embeddings, and brand-token utilities.

It has no dependency on Next.js, React, or any particular host — the host
provides its list of pages through a small resolver seam, and core does the
rest. Thally's own site is one host; you can build another.

## Install

```bash
npm install @thallylabs/core
```

## What's inside

| Export | Purpose |
| --- | --- |
| `@thallylabs/core` | Content parsing (`getContentDocument`, `mdxToMarkdown`), search (`searchDocs`, `buildSearchCorpus`), and embeddings (`buildEmbeddingIndex`, `getRelevantChunks`). |
| `@thallylabs/core/theme` | Pure brand-token utilities (colors, CSS theme variables) — no Node or content dependencies, safe to import from client bundles. |

## The one thing a host must wire up

Search and the embedding index need to enumerate the site's pages, but *how*
pages are enumerated is a host concern. Register a resolver once at startup,
before the first search or embedding build:

```ts
import { registerDocEntriesSource } from '@thallylabs/core'

registerDocEntriesSource(() => myPages) // each page: { id, title, description, href, keywords }
```

Content parsing (`getContentDocument`, `mdxToMarkdown`) is self-contained and
needs no registration.

## License

MIT © Thally
