/**
 * Protect executable examples during CLI translation while exposing only
 * comments and displayed MDX prose. All replacements address source offsets;
 * the model never receives permission to rewrite a code block wholesale.
 */

import { createHash } from 'node:crypto'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { isMap, isScalar, isSeq, parseDocument, type Node as YamlNode } from 'yaml'

interface Node {
  type?: string
  value?: unknown
  lang?: unknown
  name?: unknown
  alt?: unknown
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: Array<Node>
  attributes?: Array<Node>
}

interface Span { start: number; end: number; source: string; kind: 'text' | 'attribute' | 'yaml' | 'comment' }
interface Block { token: string; source: string; spans: Array<Span> }

const DISPLAY_PROPS = new Set(['alt', 'caption', 'description', 'label', 'placeholder', 'primaryLabel', 'secondaryLabel', 'subtitle', 'summary', 'tip', 'title'])
const DISPLAY_YAML = new Set(['badge', 'description', 'keywords', 'navTitle', 'timeEstimate', 'title'])
const MARKDOWN_LANGS = new Set(['md', 'markdown', 'mdx'])
const SLASH_COMMENT_LANGS = new Set(['js', 'javascript', 'ts', 'typescript', 'jsonc'])
const HASH_COMMENT_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'python', 'py'])

function mdxSpans(value: string, offset = 0): Array<Span> {
  const spans: Array<Span> = []
  const visit = (node: Node): void => {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (start !== undefined && end !== undefined) {
      if (node.type === 'text' && typeof node.value === 'string' && node.value.trim()) {
        spans.push({ start: offset + start, end: offset + end, source: node.value.trim(), kind: 'text' })
      } else if (node.type === 'image' && typeof node.alt === 'string' && node.alt.trim()) {
        const raw = value.slice(start, end)
        const altEnd = raw.lastIndexOf('](')
        if (raw.startsWith('![') && altEnd > 2) spans.push({ start: offset + start + 2, end: offset + start + altEnd, source: node.alt, kind: 'text' })
      } else if (node.type === 'mdxJsxAttribute' && typeof node.name === 'string' && DISPLAY_PROPS.has(node.name) && typeof node.value === 'string' && node.value.trim()) {
        const raw = value.slice(start, end)
        const quoted = /^[^=\s]+\s*=\s*(["'])([\s\S]*)\1$/.exec(raw)
        if (quoted) {
          const valueStart = raw.indexOf(quoted[1], raw.indexOf('=')) + 1
          spans.push({ start: offset + start + valueStart, end: offset + end - 1, source: node.value, kind: 'attribute' })
        }
      }
    }
    node.children?.forEach(visit)
    node.attributes?.forEach(visit)
  }
  visit(unified().use(remarkParse).use(remarkMdx).parse(value) as Node)
  return spans
}

function yamlSpans(node: YamlNode | null | undefined, offset: number, spans: Array<Span>): void {
  if (!node) return
  if (isScalar(node) && typeof node.value === 'string' && node.value.trim() && node.range) {
    spans.push({ start: offset + node.range[0], end: offset + node.range[1], source: node.value, kind: 'yaml' })
  } else if (isSeq(node)) {
    node.items.forEach((item) => yamlSpans(item as YamlNode, offset, spans))
  } else if (isMap(node)) {
    node.items.forEach((item) => yamlSpans(item.value as YamlNode | null, offset, spans))
  }
}

function exampleSpans(language: string | null | undefined, value: string): Array<Span> {
  const lang = (language ?? '').toLowerCase()
  if (MARKDOWN_LANGS.has(lang)) {
    const spans: Array<Span> = []
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(value)
    if (frontmatter) {
      const yaml = parseDocument(frontmatter[1])
      if (yaml.errors.length === 0 && isMap(yaml.contents)) {
        const offset = frontmatter[0].indexOf(frontmatter[1])
        for (const item of yaml.contents.items) {
          if (!isScalar(item.key) || typeof item.key.value !== 'string' || !DISPLAY_YAML.has(item.key.value)) continue
          yamlSpans(item.value as YamlNode | null, offset, spans)
        }
      }
    }
    const offset = frontmatter?.[0].length ?? 0
    try { spans.push(...mdxSpans(value.slice(offset), offset)) } catch { return [] }
    return spans
  }
  // A line inside a template, triple-quoted string, or heredoc may look like
  // a comment. Keep the entire example untouched when lexing is ambiguous.
  if ((SLASH_COMMENT_LANGS.has(lang) && /`|\/\*|\*\//.test(value)) ||
      ((lang === 'python' || lang === 'py') && /'''|"""/.test(value)) ||
      (HASH_COMMENT_LANGS.has(lang) && /<</.test(value))) return []
  const marker = SLASH_COMMENT_LANGS.has(lang) ? '//' : HASH_COMMENT_LANGS.has(lang) ? '#' : null
  if (!marker) return []
  const spans: Array<Span> = []
  let offset = 0
  for (const line of value.match(/[^\n]*(?:\n|$)/g) ?? []) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith(marker) && !/^(?:#!|#\s*(?:type:|noqa|shellcheck|pragma|region|end\s*region)|\/\/\s*(?:@|eslint|prettier|ts-|istanbul|#|\/))/i.test(trimmed)) {
      const prefix = line.length - trimmed.length + marker.length
      const remainder = line.slice(prefix).replace(/\r?\n$/, '')
      const leading = /^\s*/.exec(remainder)?.[0].length ?? 0
      const comment = remainder.slice(leading)
      if (/[\p{L}]{2,}/u.test(comment) && !/^(?:https?:\/\/|[\w./-]+(?:=|:))/.test(comment)) {
        const start = offset + prefix + leading
        spans.push({ start, end: start + comment.length, source: comment, kind: 'comment' })
      }
    }
    offset += line.length
  }
  return spans
}

function encode(span: Span, value: string, original: string): string {
  if (!value.trim() || value.includes('\0') || /[\r\n]/.test(value)) throw new Error('The example translation contains invalid prose.')
  if (span.kind === 'yaml') return JSON.stringify(value)
  if (span.kind === 'comment') {
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) || /\*\/|<!--|-->/.test(value)) throw new Error('The example translation changed comment syntax.')
    return value.trim()
  }
  if (span.kind === 'attribute') return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const leading = /^\s*/.exec(original)?.[0] ?? ''
  const trailing = /\s*$/.exec(original)?.[0] ?? ''
  const prose = value.replace(/([\\`*_\[\]|!#~])/g, '\\$1').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
  return leading + prose + trailing
}

/** Mask all fences and return only eligible example prose for translation. */
export function prepareFencedExamples(source: string): {
  maskedSource: string
  segments: Array<string>
  restore: (draft: string, values: Array<string>) => string
} {
  const blocks: Array<Block & { start: number; end: number }> = []
  const sourceId = createHash('sha256').update(source).digest('hex').slice(0, 12)
  const visit = (node: Node): void => {
    if (node.type === 'code' && typeof node.value === 'string') {
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset
      if (start === undefined || end === undefined) return
      const raw = source.slice(start, end)
      const firstNewline = raw.indexOf('\n')
      const contentStart = firstNewline < 0 ? -1 : firstNewline + 1
      const spans = contentStart >= 0 && raw.slice(contentStart, contentStart + node.value.length) === node.value
        ? exampleSpans(typeof node.lang === 'string' ? node.lang : null, node.value).map((span) => ({ ...span, start: contentStart + span.start, end: contentStart + span.end }))
        : []
      blocks.push({ token: `THALLY_FENCE_${sourceId}_${blocks.length}_END`, source: raw, spans, start, end })
      return
    }
    node.children?.forEach(visit)
  }
  visit(unified().use(remarkParse).use(remarkMdx).parse(source) as Node)
  let maskedSource = source
  for (const block of [...blocks].reverse()) maskedSource = maskedSource.slice(0, block.start) + block.token + maskedSource.slice(block.end)
  const segments = blocks.flatMap((block) => block.spans.map((span) => span.source))
  const restore = (draft: string, values: Array<string>): string => {
    if (values.length !== segments.length || values.some((value) => typeof value !== 'string')) throw new Error('The example translation changed the segment list.')
    let cursor = 0
    let previous = -1
    const replacements: Array<{ token: string; translated: string }> = []
    for (const block of blocks) {
      const index = draft.indexOf(block.token)
      if (index <= previous || draft.indexOf(block.token, index + block.token.length) !== -1) throw new Error('The translated page changed protected example tokens.')
      previous = index
      let translated = block.source
      const spanValues = block.spans.map((span) => ({ span, value: values[cursor++] }))
      for (const { span, value } of spanValues.reverse()) translated = translated.slice(0, span.start) + encode(span, value, block.source.slice(span.start, span.end)) + translated.slice(span.end)
      replacements.push({ token: block.token, translated })
    }
    let result = draft
    for (const replacement of replacements) result = result.replace(replacement.token, replacement.translated)
    const observed: Array<string> = []
    const visit = (node: Node): void => {
      if (node.type === 'code') {
        const start = node.position?.start?.offset
        const end = node.position?.end?.offset
        if (start !== undefined && end !== undefined) observed.push(result.slice(start, end))
      }
      node.children?.forEach(visit)
    }
    visit(unified().use(remarkParse).use(remarkMdx).parse(result) as Node)
    if (observed.length !== replacements.length || observed.some((block, index) => block !== replacements[index].translated)) {
      throw new Error('The translated page changed example structure.')
    }
    return result
  }
  return { maskedSource, segments, restore }
}
