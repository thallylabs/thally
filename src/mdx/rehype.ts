import type { Element, Root } from 'hast'
import {
  createHighlighter,
  type Highlighter,
  type ThemedToken,
  type ThemeRegistration,
} from 'shiki'
import { visit } from 'unist-util-visit'

/**
 * A theme whose colors are CSS variables, so code blocks stay theme-aware via
 * the `--shiki-*` variables defined in globals.css. This replaces Shiki's old
 * built-in `css-variables` theme (removed in Shiki 1.0+) while keeping the exact
 * same variable contract, so no CSS changes are needed.
 */
const cssVariablesTheme: ThemeRegistration = {
  name: 'css-variables',
  type: 'dark',
  colors: {
    'editor.foreground': 'var(--shiki-color-text)',
    'editor.background': 'var(--shiki-color-background, transparent)',
  },
  fg: 'var(--shiki-color-text)',
  bg: 'var(--shiki-color-background, transparent)',
  settings: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--shiki-token-comment)' } },
    { scope: ['string', 'constant.other.symbol'], settings: { foreground: 'var(--shiki-token-string)' } },
    { scope: ['constant.numeric', 'constant.language', 'constant', 'support.constant'], settings: { foreground: 'var(--shiki-token-constant)' } },
    { scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'], settings: { foreground: 'var(--shiki-token-keyword)' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: 'var(--shiki-token-function)' } },
    { scope: ['variable.parameter', 'variable', 'meta.definition.variable'], settings: { foreground: 'var(--shiki-token-parameter)' } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: 'var(--shiki-token-punctuation)' } },
    { scope: ['meta.template.expression', 'string.template meta.embedded'], settings: { foreground: 'var(--shiki-token-string-expression)' } },
  ],
}

const FALLBACK_LANGUAGE = 'txt'

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [cssVariablesTheme],
      langs: [FALLBACK_LANGUAGE],
    })
  }
  return highlighterPromise
}

const languageAliases: Record<string, string> = {
  curl: 'bash',
  shell: 'bash',
}

function normalizeLanguage(language?: string) {
  if (!language) {
    return undefined
  }
  const normalized = language.toLowerCase()
  return languageAliases[normalized] ?? normalized
}

/**
 * Ensure a language grammar is loaded; fall back to plaintext for unknown or
 * unsupported languages so an exotic code fence never breaks the page.
 */
async function resolveLanguage(highlighter: Highlighter, language: string): Promise<string> {
  if (highlighter.getLoadedLanguages().includes(language)) {
    return language
  }
  try {
    await highlighter.loadLanguage(language as Parameters<Highlighter['loadLanguage']>[0])
    return language
  } catch {
    return FALLBACK_LANGUAGE
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * Render themed tokens to the same inner HTML the old Shiki `renderToHtml`
 * produced for this pipeline: one `<span>` per line wrapping per-token color
 * spans, with no `<pre>`/`<code>` wrapper (those already exist in the tree).
 * Lines listed in `highlightedLines` (1-based) get a class styled in
 * globals.css.
 */
function tokensToHtml(lines: Array<Array<ThemedToken>>, highlightedLines: Set<number>): string {
  return lines
    .map((line, index) => {
      const inner = line
        .map((token) => `<span style="color:${token.color ?? 'inherit'}">${escapeHtml(token.content)}</span>`)
        .join('')
      const highlightClass = highlightedLines.has(index + 1) ? ' class="thally-line-highlight"' : ''
      return `<span${highlightClass}>${inner}</span>`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Fence meta parsing — supports:
//   ```ts api-client.ts          (bare token → title)
//   ```ts title="api-client.ts"  (explicit title/filename attribute)
//   ```ts {2,4-6}                (highlighted lines)
//   ```ts highlight={2,4-6}      (highlighted lines, explicit form)
//   ```bash wrap                 (soft-wrap long lines)
// ---------------------------------------------------------------------------

interface CodeFenceMeta {
  title?: string
  wrap?: boolean
  highlight?: Array<number>
}

function expandLineRanges(spec: string): Array<number> {
  const lines: Array<number> = []
  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const range = trimmed.match(/^(\d+)-(\d+)$/)
    if (range) {
      for (let line = Number(range[1]); line <= Number(range[2]); line += 1) lines.push(line)
    } else if (/^\d+$/.test(trimmed)) {
      lines.push(Number(trimmed))
    }
  }
  return lines
}

function parseCodeFenceMeta(meta: string): CodeFenceMeta {
  const result: CodeFenceMeta = {}
  const tokens = meta.match(/[^\s"{]+="[^"]*"|\{[^}]*\}|\S+/g) ?? []
  for (const token of tokens) {
    if (token === 'wrap') {
      result.wrap = true
      continue
    }
    const highlightMatch = token.match(/^(?:highlight=)?\{([\d,\s-]+)\}$/)
    if (highlightMatch) {
      result.highlight = expandLineRanges(highlightMatch[1])
      continue
    }
    const titleMatch = token.match(/^(?:title|filename)=["']?([^"']+)["']?$/)
    if (titleMatch) {
      result.title = titleMatch[1]
      continue
    }
    if (!result.title) result.title = token
  }
  return result
}

function rehypeParseCodeBlocks() {
  return (tree: Root) => {
    // @ts-expect-error -- unist-util-visit visitor types are stricter than needed
    visit(tree, 'element', (node: Element, _index: number | undefined, parent: Element | undefined) => {
      if (!parent || node.tagName !== 'code') {
        return
      }

      const className = node.properties?.className
      const languageClass =
        Array.isArray(className) && className.length > 0
          ? (className[0] as string)
          : typeof className === 'string'
            ? className
            : ''
      const language = normalizeLanguage(languageClass.replace(/^language-/, '') || 'txt')

      // The fence meta string (everything after the language) survives on the
      // code node's data. Lift it onto the <pre> so the Pre/CodeGroup
      // components receive title/wrap as props and Shiki sees the highlights.
      const meta = (node.data as { meta?: string } | undefined)?.meta ?? ''
      const parsedMeta = meta ? parseCodeFenceMeta(meta) : {}

      parent.properties = {
        ...parent.properties,
        language,
        ...(parsedMeta.title ? { title: parsedMeta.title } : {}),
        ...(parsedMeta.wrap ? { wrap: '' } : {}),
        ...(parsedMeta.highlight?.length
          ? { highlightLines: parsedMeta.highlight.join(',') }
          : {}),
      }
    })
  }
}

function rehypeShiki() {
  return async (tree: Root) => {
    const highlighter = await getHighlighter()

    // Collect <pre> nodes first so we can await per-node language loading.
    const targets: Array<{ node: Element; code: string; language: string; textNode: { value: string } }> = []

    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') {
        return
      }

      const [codeNode] = node.children
      if (!codeNode || (codeNode as Element).tagName !== 'code') {
        return
      }

      const [textNode] = (codeNode as Element).children as Array<{ type: string; value: string }>
      if (!textNode || typeof textNode.value !== 'string') {
        return
      }

      const code = textNode.value
      node.properties = {
        ...node.properties,
        code,
      }

      const language = node.properties?.language as string | undefined
      if (!language) {
        return
      }

      targets.push({ node, code, language, textNode })
    })

    for (const target of targets) {
      const language = await resolveLanguage(highlighter, target.language)
      const lines = highlighter.codeToTokensBase(target.code, {
        lang: language as Parameters<Highlighter['codeToTokensBase']>[1]['lang'],
        theme: cssVariablesTheme,
      })
      const highlightSpec = target.node.properties?.highlightLines as string | undefined
      const highlightedLines = new Set(highlightSpec ? expandLineRanges(highlightSpec) : [])
      target.textNode.value = tokensToHtml(lines, highlightedLines)
    }
  }
}

export const rehypePlugins = [rehypeParseCodeBlocks, rehypeShiki]
