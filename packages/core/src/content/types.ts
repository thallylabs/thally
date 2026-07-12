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
}
