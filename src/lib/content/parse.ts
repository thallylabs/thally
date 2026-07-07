import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import { toString as mdastToString } from 'mdast-util-to-string'
import type { Root, RootContent } from 'mdast'
import { slugify } from '@/lib/utils'
import type {
  ContentCodeBlock,
  ContentHeading,
  ContentLink,
  ContentSection,
  ContentTocItem,
  ParsedContent,
} from '@/lib/content/types'

// Single shared MDX → mdast parser. This is the one place content is parsed;
// every structured projection below is derived from the same tree.
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx)

function parseToTree(markdown: string): Root {
  try {
    return processor.parse(markdown) as Root
  } catch {
    // Fall back to plain markdown parsing if MDX-specific syntax fails.
    return unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  }
}

function ensureUniqueId(base: string, seen: Map<string, number>): string {
  const slug = base || 'section'
  const count = seen.get(slug) ?? 0
  seen.set(slug, count + 1)
  return count === 0 ? slug : `${slug}-${count}`
}

function cleanText(value: string): string {
  return value
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'listItem',
  'blockquote',
  'tableRow',
  'tableCell',
])

interface WalkState {
  headings: Array<ContentHeading>
  codeBlocks: Array<ContentCodeBlock>
  links: Array<ContentLink>
  sections: Array<ContentSection>
  textParts: Array<string>
  sectionTextParts: Array<string>
  current: ContentSection
  stack: Array<{ depth: number; text: string }>
  seen: Map<string, number>
  codeIndex: number
}

function startSection(state: WalkState, depth: number, text: string) {
  // Flush the previous section's accumulated text.
  state.current.text = cleanText(state.sectionTextParts.join(' '))
  state.sectionTextParts = []

  while (state.stack.length > 0 && state.stack[state.stack.length - 1].depth >= depth) {
    state.stack.pop()
  }
  const headingPath = [...state.stack.map((s) => s.text), text]
  state.stack.push({ depth, text })

  const id = ensureUniqueId(slugify(text), state.seen)
  state.headings.push({ depth, text, id })

  const section: ContentSection = { id, title: text, depth, headingPath, text: '', code: [] }
  state.sections.push(section)
  state.current = section
}

function recordCode(state: WalkState, node: { lang?: string | null; meta?: string | null; value: string }) {
  const block: ContentCodeBlock = {
    language: node.lang || 'text',
    title: node.meta?.trim() || undefined,
    source: node.value.trimEnd(),
    index: state.codeIndex++,
  }
  state.codeBlocks.push(block)
  state.current.code.push(block)
}

function appendText(state: WalkState, value: string) {
  if (!value) return
  state.textParts.push(value)
  state.sectionTextParts.push(value)
}

function walk(state: WalkState, nodes: Array<RootContent>) {
  for (const node of nodes) {
    if (node.type === 'heading') {
      startSection(state, node.depth, mdastToString(node).trim())
      continue
    }
    if (node.type === 'code') {
      recordCode(state, node)
      continue
    }
    if (node.type === 'link') {
      state.links.push({ url: node.url, text: mdastToString(node).trim() })
      // fall through to descend so the link's text joins the prose
    }
    if (node.type === 'text' || node.type === 'inlineCode') {
      if ('value' in node && node.value) appendText(state, node.value)
      continue
    }
    if ('children' in node && Array.isArray(node.children)) {
      walk(state, node.children as Array<RootContent>)
      if (BLOCK_TYPES.has(node.type)) appendText(state, '\n')
    }
  }
}

function buildToc(headings: Array<ContentHeading>): Array<ContentTocItem> {
  const toc: Array<ContentTocItem> = []
  const stack: Array<ContentTocItem> = []

  for (const heading of headings) {
    const item: ContentTocItem = { depth: heading.depth, text: heading.text, id: heading.id }
    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
      stack.pop()
    }
    if (stack.length === 0) {
      toc.push(item)
    } else {
      const parent = stack[stack.length - 1]
      parent.children = parent.children ?? []
      parent.children.push(item)
    }
    stack.push(item)
  }

  return toc
}

const JSX_WRAPPER_PATTERN =
  /<\/?(?:Steps|Step|Tabs|Tab|Note|Callout|CodeGroup|CardGroup|Card|Frame|Accordion|Columns|Tooltip)[^>]*>/g

function cleanMarkdown(markdown: string): string {
  return markdown.replace(JSX_WRAPPER_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Parse an MDX body into the typed content graph. This is the single source of
 * truth for all structured representations of a document. One parse, one walk.
 */
export function parseMdxContent(markdown: string): ParsedContent {
  const tree = parseToTree(markdown)

  const preamble: ContentSection = { id: '', title: '', depth: 0, headingPath: [], text: '', code: [] }
  const state: WalkState = {
    headings: [],
    codeBlocks: [],
    links: [],
    sections: [preamble],
    textParts: [],
    sectionTextParts: [],
    current: preamble,
    stack: [],
    seen: new Map(),
    codeIndex: 0,
  }

  walk(state, tree.children)
  // Flush the final section's text.
  state.current.text = cleanText(state.sectionTextParts.join(' '))

  // Drop the preamble if it carried no prose or code.
  const sections = state.sections.filter(
    (section, index) => index !== 0 || section.text.length > 0 || section.code.length > 0,
  )

  return {
    headings: state.headings,
    toc: buildToc(state.headings),
    codeBlocks: state.codeBlocks,
    sections,
    links: state.links,
    text: cleanText(state.textParts.join(' ')),
    markdown: cleanMarkdown(markdown),
  }
}
