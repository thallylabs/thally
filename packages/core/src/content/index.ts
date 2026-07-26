/**
 * `@thallylabs/core/content` — the content pipeline as a standalone entry.
 *
 * Published as its own subpath so consumers that only parse or project content
 * (e.g. `parseMdxContent`, `mdxToMarkdown`) can import it without pulling the
 * search engine and embeddings graph into their bundles. Everything here is
 * also re-exported from the main barrel; the two entries share compiled chunks,
 * so mixing them never duplicates code.
 */
export { parseMdxContent } from './parse.js'
export { getContentDocument, registerContentDocumentSource } from './document.js'
export type { ContentDocument, ContentDocumentResolver } from './document.js'
export { mdxToMarkdown } from './to-markdown.js'
export type {
  ContentHeading,
  ContentTocItem,
  ContentCodeBlock,
  ContentLink,
  ContentSection,
  ParsedContent,
} from './types.js'
