/**
 * Keep source-authored component styling without importing selectors that
 * reach into a documentation platform's private DOM. The Thally shell owns
 * navigation, footer and card layout; imported CSS may style authored markup.
 */

import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import ts from 'typescript'

const PLATFORM_CLASSES = new Set(['navbar-link'])
const PLATFORM_IDS = new Set(['footer', 'navbar', 'sidebar'])
const PLATFORM_CLASS_PREFIX = /^(?:mintlify[-_]|fern[-_]|docusaurus[-_]|theme-doc-|theme-code-block|DocSearch|pagination-nav|menu__)/i
const SHARED_THEME_CLASSES = new Set(['dark', 'light'])
// Framework utility selectors are unsafe global targets even when the same
// utility happens to occur in an authored example elsewhere in the site.
const UTILITY_CLASS = /^(?:[mp][trblxy]?|w|h|min-w|max-w|min-h|max-h|text|bg|border|rounded|flex|grid|gap|space-[xy]|items|justify|overflow|truncate|hidden|block|inline|relative|absolute|sticky|z|opacity)-/

function withoutFencedCode(content: string): string {
  let fence: { marker: string; length: number } | undefined
  return content.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    if (fence) {
      if (marker?.[0] === fence.marker && marker.length >= fence.length) fence = undefined
      return ''
    }
    if (marker) {
      fence = { marker: marker[0], length: marker.length }
      return ''
    }
    return line
  }).join('\n')
}

/**
 * Mintlify sites make a navbar link look like a button with a rule such as
 * `li.navbar-link a[href*="/signin"] { background-color: ... }`. Thally keeps
 * that intent as a link setting instead of importing the platform selector.
 */
export function navbarLinkButtons(css: string): Array<{ href: string; exact: boolean; background: string; color?: string }> {
  const buttons: Array<{ href: string; exact: boolean; background: string; color?: string }> = []
  postcss.parse(css).walkRules((rule) => {
    const match = /^(?:li)?\.navbar-link\s+a\[href(\*)?=["']([^"']+)["']\]$/.exec(rule.selector.trim())
    if (!match) return
    let background: string | undefined
    let color: string | undefined
    rule.walkDecls((decl) => {
      if (decl.prop === 'background-color' || decl.prop === 'background') background = decl.value
      else if (decl.prop === 'color') color = decl.value
    })
    if (background) buttons.push({ href: match[2], exact: !match[1], background, ...(color ? { color } : {}) })
  })
  return buttons
}

/** Find classes and IDs actually authored in migrated pages and components. */
export function authoredStyleNames(contents: ReadonlyArray<string>): { classes: Set<string>; ids: Set<string> } {
  const classes = new Set<string>()
  const ids = new Set<string>()
  for (const original of contents) {
    const content = withoutFencedCode(original)
    // MDX pages can contain ordinary Markdown, so use attribute spans rather
    // than interpreting a fenced example as a source of shell selectors.
    for (const match of content.matchAll(/\b(?:className|class)\s*=\s*["']([^"']+)["']/g)) {
      for (const name of match[1].split(/\s+/)) if (name) classes.add(name)
    }
    for (const match of content.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(match[1])

    if (!content.includes('className={')) continue
    const source = ts.createSourceFile('component.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'className' && node.initializer) {
        const collect = (value: ts.Node): void => {
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            for (const name of value.text.split(/\s+/)) if (name) classes.add(name)
          } else ts.forEachChild(value, collect)
        }
        collect(node.initializer)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { classes, ids }
}

/** Remove platform DOM selectors while preserving CSS for authored widgets. */
export function projectAuthoredStyles(css: string, contents: ReadonlyArray<string>): { css: string; omittedSelectors: number } {
  const names = authoredStyleNames(contents)
  const root = postcss.parse(css)
  let omittedSelectors = 0
  let rewrittenSelectors = 0
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    const retained: Array<string> = []
    try {
      selectorParser((selectors) => {
        selectors.each((selector) => {
          let hasAuthoredAnchor = false
          let hasPlatformAnchor = false
          selector.walk((node) => {
            // A class inside :not() or :has() does not constrain the element
            // being styled. Treating it as the only authored anchor could
            // retain a body-wide platform override.
            let ancestor = node.parent
            let isNestedInPseudo = false
            while (ancestor && ancestor !== selector) {
              if (ancestor.type === 'pseudo') isNestedInPseudo = true
              ancestor = ancestor.parent
            }
            if (node.type === 'class') {
              if (SHARED_THEME_CLASSES.has(node.value)) return
              if (PLATFORM_CLASSES.has(node.value) || PLATFORM_CLASS_PREFIX.test(node.value) || UTILITY_CLASS.test(node.value) || !names.classes.has(node.value)) hasPlatformAnchor = true
              else if (!isNestedInPseudo) hasAuthoredAnchor = true
            } else if (node.type === 'id') {
              if (PLATFORM_IDS.has(node.value) || !names.ids.has(node.value)) hasPlatformAnchor = true
              else if (!isNestedInPseudo) hasAuthoredAnchor = true
            } else if (node.type === 'attribute' && node.attribute === 'data-as') {
              // Mintlify adds this implementation detail to transformed MDX
              // paragraphs. Thally renders the native element and class.
              node.remove()
              rewrittenSelectors += 1
            }
          })
          if (hasAuthoredAnchor && !hasPlatformAnchor) retained.push(selector.toString())
          else omittedSelectors += 1
        })
      }).processSync(rule.selector)
    } catch {
      omittedSelectors += 1
    }
    if (retained.length) rule.selector = retained.join(', ')
    else rule.remove()
  })
  const hasStyleRule = (nodes: postcss.ChildNode[] | undefined): boolean => Boolean(nodes?.some((node) =>
    node.type === 'rule' || (node.type === 'atrule' && hasStyleRule(node.nodes))))
  root.walkAtRules((rule) => {
    if (rule.name === 'font-face' || rule.name === 'property') return
    if (!hasStyleRule(rule.nodes)) rule.remove()
  })
  if (omittedSelectors === 0 && rewrittenSelectors === 0) return { css, omittedSelectors }
  root.walkComments((comment) => { comment.remove() })
  return { css: root.toString(), omittedSelectors }
}
