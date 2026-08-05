/**
 * Shared MDX presentation transforms for authored and release-backed content.
 *
 * Syntax grammars stay explicitly enumerated because a bundled Shiki registry
 * is duplicated across Next's server graphs and can exceed managed hosting's
 * bounded Worker upload contract. Unsupported fences remain readable text.
 */

import type { Element, Root } from 'hast'
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from 'shiki/engine/javascript'
import { createHighlighterCore } from 'shiki/core'
import type { HighlighterCore, ThemedToken, ThemeRegistration } from 'shiki'
import langBash from '@shikijs/langs/bash'
import langC from '@shikijs/langs/c'
import langCpp from '@shikijs/langs/cpp'
import langCsharp from '@shikijs/langs/csharp'
import langCss from '@shikijs/langs/css'
import langDiff from '@shikijs/langs/diff'
import langDocker from '@shikijs/langs/docker'
import langGo from '@shikijs/langs/go'
import langGraphql from '@shikijs/langs/graphql'
import langHcl from '@shikijs/langs/hcl'
import langHtml from '@shikijs/langs/html'
import langJavascript from '@shikijs/langs/javascript'
import langJava from '@shikijs/langs/java'
import langJson from '@shikijs/langs/json'
import langJsonc from '@shikijs/langs/jsonc'
import langJsx from '@shikijs/langs/jsx'
import langKotlin from '@shikijs/langs/kotlin'
import langMarkdown from '@shikijs/langs/markdown'
import langMdx from '@shikijs/langs/mdx'
import langPhp from '@shikijs/langs/php'
import langPython from '@shikijs/langs/python'
import langRuby from '@shikijs/langs/ruby'
import langRust from '@shikijs/langs/rust'
import langSql from '@shikijs/langs/sql'
import langSvelte from '@shikijs/langs/svelte'
import langSwift from '@shikijs/langs/swift'
import langToml from '@shikijs/langs/toml'
import langTsx from '@shikijs/langs/tsx'
import langTypescript from '@shikijs/langs/typescript'
import langVue from '@shikijs/langs/vue'
import langYaml from '@shikijs/langs/yaml'
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
    { scope: ['support.type.property-name.json', 'support.type.property-name.json.comments', 'meta.mapping.key'], settings: { foreground: 'var(--shiki-token-property)' } },
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

let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      // Workers disallow runtime WebAssembly code generation. Shiki's
      // JavaScript regex engine preserves highlighting without Oniguruma WASM.
      engine: createJavaScriptRegexEngine({
        // The default lazily compiles long patterns with `new Function`, which
        // workerd forbids. Eager native RegExp construction is CSP-safe.
        regexConstructor: (pattern) =>
          defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Infinity }),
      }),
      themes: [cssVariablesTheme],
      // Explicit imports keep the request Worker bounded. Unknown fences still
      // render as plaintext, while the common documentation languages retain
      // full grammar-aware highlighting.
      langs: [
        langBash,
        langC,
        langCpp,
        langCsharp,
        langCss,
        langDiff,
        langDocker,
        langGo,
        langGraphql,
        langHcl,
        langHtml,
        langJava,
        langJavascript,
        langJson,
        langJsonc,
        langJsx,
        langKotlin,
        langMarkdown,
        langMdx,
        langPhp,
        langPython,
        langRuby,
        langRust,
        langSql,
        langSvelte,
        langSwift,
        langToml,
        langTsx,
        langTypescript,
        langVue,
        langYaml,
      ],
    })
  }
  return highlighterPromise
}

const languageAliases: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  curl: 'bash',
  gql: 'graphql',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  md: 'markdown',
  yml: 'yaml',
}

// Fence metadata is authored input and may arrive through an untrusted pull
// request. Bound expansion before allocation so a range such as {1-4e9}
// cannot exhaust a build or Worker request.
const MAX_HIGHLIGHTED_LINES = 1_000
const MAX_HIGHLIGHTED_LINE_NUMBER = 100_000

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
function resolveLanguage(highlighter: HighlighterCore, language: string): string {
  return highlighter.getLoadedLanguages().includes(language)
    ? language
    : FALLBACK_LANGUAGE
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

export interface CodeFenceMeta {
  title?: string
  wrap?: boolean
  highlight?: Array<number>
}

function expandLineRanges(spec: string): Array<number> {
  const lines: Array<number> = []
  for (const part of spec.split(',')) {
    if (lines.length >= MAX_HIGHLIGHTED_LINES) break
    const trimmed = part.trim()
    if (!trimmed) continue
    const range = trimmed.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), MAX_HIGHLIGHTED_LINE_NUMBER)
      if (start > MAX_HIGHLIGHTED_LINE_NUMBER || start > end) continue
      for (
        let line = start;
        line <= end && lines.length < MAX_HIGHLIGHTED_LINES;
        line += 1
      ) {
        lines.push(line)
      }
    } else if (/^\d+$/.test(trimmed)) {
      const line = Number(trimmed)
      if (line <= MAX_HIGHLIGHTED_LINE_NUMBER) lines.push(line)
    }
  }
  return lines
}

/** Parse portable code-fence metadata without exposing framework-only props. */
export function parseCodeFenceMeta(meta: string): CodeFenceMeta {
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
    // Mintlify emits presentation props such as `theme={"system"}` in the
    // fence metadata. They configure its renderer and are not human-facing
    // filenames, so carrying them into Thally's title bar is misleading.
    if (/^[A-Za-z][\w-]*=/.test(token)) continue
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
    // Scan before initializing Shiki. Most prose pages contain no fenced code,
    // so they should not pay the cold-start cost of constructing every grammar.
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

    if (targets.length === 0) return

    const highlighter = await getHighlighter()

    for (const target of targets) {
      const language = resolveLanguage(highlighter, target.language)
      const lines = highlighter.codeToTokensBase(target.code, {
        lang: language as Parameters<HighlighterCore['codeToTokensBase']>[1]['lang'],
        theme: cssVariablesTheme,
      })
      const highlightSpec = target.node.properties?.highlightLines as string | undefined
      const highlightedLines = new Set(highlightSpec ? expandLineRanges(highlightSpec) : [])
      target.textNode.value = tokensToHtml(lines, highlightedLines)
    }
  }
}

export const rehypePlugins = [rehypeParseCodeBlocks, rehypeShiki]
