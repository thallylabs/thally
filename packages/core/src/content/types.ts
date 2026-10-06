export interface ContentHeading {
  depth: number
  text: string
  id: string
}

export interface ContentTocItem {
  depth: number
  text: string
  id: string
  children?: Array<ContentTocItem>
}

export interface ContentCodeBlock {
  language: string
  source: string
  title?: string
  index: number
}

export interface ContentLink {
  url: string
  text: string
}

/**
 * A heading-bounded slice of a document. Sections are the unit of chunking for
 * embeddings and retrieval — each one is anchored to a heading id.
 */
export interface ContentSection {
  /** Heading id (anchor) this section starts at; '' for the page preamble. */
  id: string
  title: string
  /** Heading depth (2 for `##`); 0 for the preamble before the first heading. */
  depth: number
  /** Ancestor heading texts including this section's own heading. */
  headingPath: Array<string>
  text: string
  code: Array<ContentCodeBlock>
}

/**
 * One `<Update>` changelog entry, extracted from the same parse as the rest
 * of the content graph. Feeds (RSS, JSON Feed) and MCP `list_changes` are
 * projections of this record; there is no second changelog parser.
 */
export interface ContentUpdate {
  /** Anchor id the rendered entry carries (see `updateAnchorId`); '' when the entry has none. */
  id: string
  /** The `label` prop (often a version or release name). */
  label: string
  /** The `title` prop when authored as a plain string. */
  title?: string
  /** The `date` prop exactly as authored (not necessarily ISO). */
  date?: string
  description?: string
  tags: Array<string>
  /** Entry body as clean Markdown (audience-projected, JSX stripped). */
  markdown: string
  /** Entry body as plain prose. */
  text: string
}

/**
 * The typed content graph for a single document, derived from a single MDX
 * parse. Every downstream representation (rendered HTML, structured JSON,
 * JSON-LD, Markdown, embedding chunks) is a projection of this object.
 */
export interface ParsedContent {
  headings: Array<ContentHeading>
  toc: Array<ContentTocItem>
  codeBlocks: Array<ContentCodeBlock>
  sections: Array<ContentSection>
  links: Array<ContentLink>
  /** Prose text with code blocks and JSX wrappers removed — for search/embeddings. */
  text: string
  /** Cleaned markdown body (frontmatter and known JSX wrappers stripped). */
  markdown: string
  /**
   * `<Update>` changelog entries in source order. Optional so hosts that build
   * a `ParsedContent` by hand keep compiling; the parser always sets it.
   */
  updates?: Array<ContentUpdate>
}
