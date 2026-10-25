/**
 * Keep source-authored component styling without importing selectors that
 * reach into a documentation platform's private DOM. The Thally shell owns
 * navigation, footer and card layout; imported CSS may style authored markup.
 */

import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import ts from 'typescript'

import { RUNTIME_CSS_VARIABLES } from './runtime-css-variables.js'

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

/** The least a family's name (`ifx-card` in `ifx-card--`) may be to speak for every class that starts with it. */
const MIN_FAMILY_NAME = 3

/** What a string says about the classes it names: whole names, the starts of names a template or a sum finishes, and the modifiers it adds. */
interface ClassNames { classes: Set<string>; prefixes: Set<string>; suffixes: Set<string> }

/**
 * Read class names off a string's text, where `\0` stands for a value the code fills in. A name that ends in `-` or `_` is the start of
 * a family (`ifx-card--${kind}`); it names the whole family only when it is long enough to be specific, since a short or bare start
 * (`s${size}`) would admit the rules of any class that begins the same way. A name a value follows (`ifx-card${wide ? " wide" : ""}`)
 * is that name when the value is empty, so it is taken as the name itself, and only when it reads as a name (it has a `-` or `_`).
 * A `--` or `__` suffix after a value (`${base}--dim`) is a modifier added to any name. Outside a `className`, a bare word is as likely
 * text as a class, so only a name with a dash or an underscore in it counts (`anyWord` is true for a `className` value, where every
 * word does).
 */
function addClassNames(text: string, into: ClassNames, anyWord: boolean): void {
  for (const token of text.split(/\s+/)) {
    const hole = token.indexOf('\0')
    const head = hole < 0 ? token : token.slice(0, hole)
    const tail = hole < 0 ? '' : token.slice(token.lastIndexOf('\0') + 1)
    if (/^(?:--|__)[\w-]+$/.test(tail)) into.suffixes.add(tail)
    if (!/^[A-Za-z_][\w-]*$/.test(head) || (!anyWord && !/[-_]/.test(head))) continue
    if (/[-_]$/.test(head)) {
      if (head.replace(/[-_]+$/, '').length >= MIN_FAMILY_NAME) into.prefixes.add(head)
    } else if (hole < 0 || /[-_]/.test(head)) into.classes.add(head)
  }
}

/** The text of a string literal, or of a template with `\0` where it has a value; undefined for any other node. */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `\0${span.literal.text}`).join('')
  return undefined
}

/**
 * Find classes and IDs actually authored in migrated pages and components. `modules` are the scripts and component modules: any string
 * they hold may be a class name (the code builds `className` from parts), and a template or a sum names the start of a family
 * (`ifx-card--${kind}`), which `prefixes` carries, or a modifier (`${base}--dim`), which `suffixes` does.
 */
export function authoredStyleNames(contents: ReadonlyArray<string>, modules: ReadonlyArray<string> = []): { classes: Set<string>; ids: Set<string>; prefixes: Set<string>; suffixes: Set<string> } {
  const names: ClassNames = { classes: new Set(), prefixes: new Set(), suffixes: new Set() }
  const ids = new Set<string>()
  for (const { original, isModule } of [...contents.map((original) => ({ original, isModule: false })), ...modules.map((original) => ({ original, isModule: true }))]) {
    const content = withoutFencedCode(original)
    // MDX pages can contain ordinary Markdown, so use attribute spans rather
    // than interpreting a fenced example as a source of shell selectors.
    for (const match of content.matchAll(/\b(?:className|class)\s*=\s*["']([^"']+)["']/g)) {
      for (const name of match[1].split(/\s+/)) if (name) names.classes.add(name)
    }
    for (const match of content.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(match[1])

    if (!isModule && !content.includes('className={')) continue
    const source = ts.createSourceFile('component.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node, inClassName: boolean): void => {
      const text = literalText(node)
      if (text !== undefined && (inClassName || isModule)) addClassNames(text, names, inClassName)
      const inside = inClassName || (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'className' && node.initializer !== undefined)
      ts.forEachChild(node, (child) => { visit(child, inside) })
    }
    visit(source, false)
  }
  return { ...names, ids }
}

/** The selector of a block that holds a theme's design tokens: `:root` and `html` for light, and `.dark` (or `html.dark`) for dark. */
const THEME_SELECTOR = /^(?::root|html)(?:\.(?:dark|light))?$|^\.(?:dark|light)$/

export interface StyleProjection {
  css: string
  omittedSelectors: number
  /** Custom properties left out of a theme block: names the Thally runtime defines itself, and names no imported rule reads. */
  skippedVariables: { runtime: Array<string>; unused: Array<string> }
  /** Declarations left out of a theme block that are not custom properties (`:root { background: ... }`): they would restyle the page. */
  skippedThemeDeclarations: number
}

/**
 * Remove platform DOM selectors while preserving CSS for authored widgets. `modules` are the component modules and scripts, whose
 * strings count as class names. A theme block (`:root`, `.dark`) keeps only the custom properties that an imported rule reads, directly
 * or through another kept property, and that the Thally runtime does not define itself: nothing else in it is taken.
 */
export function projectAuthoredStyles(css: string, contents: ReadonlyArray<string>, modules: ReadonlyArray<string> = []): StyleProjection {
  const names = authoredStyleNames(contents, modules)
  const isAuthoredClass = (name: string): boolean => names.classes.has(name)
    || [...names.prefixes].some((prefix) => name.startsWith(prefix)) || [...names.suffixes].some((suffix) => name.endsWith(suffix))
  const root = postcss.parse(css)
  let omittedSelectors = 0
  let rewrittenSelectors = 0
  const themeRules: Array<postcss.Rule> = []
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    if (rule.selectors.every((part) => THEME_SELECTOR.test(part.trim()))) { themeRules.push(rule); return }
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
              if (PLATFORM_CLASSES.has(node.value) || PLATFORM_CLASS_PREFIX.test(node.value) || UTILITY_CLASS.test(node.value) || !isAuthoredClass(node.value)) hasPlatformAnchor = true
              else if (!isNestedInPseudo) hasAuthoredAnchor = true
            } else if (node.type === 'id') {
              if (PLATFORM_IDS.has(node.value) || !names.ids.has(node.value)) hasPlatformAnchor = true
              else if (!isNestedInPseudo) hasAuthoredAnchor = true
            } else if (node.type === 'attribute' && node.attribute === 'data-as') {
              // Mintlify adds this implementation detail to transformed MDX
              // paragraphs. Thally renders the native element and class. On
              // its own in a compound (`.x [data-as="p"]`) it stands for the
              // element, which is named instead; beside a class or tag it is
              // simply dropped. One that names no element has no stand-in, and
              // dropping it would style the whole ancestor, so the selector goes.
              const alone = (!node.prev() || node.prev()?.type === 'combinator') && (!node.next() || node.next()?.type === 'combinator')
              const element = node.operator === '=' ? node.value : undefined
              if (!alone) node.remove()
              else if (element && /^[a-z][a-z0-9]*$/.test(element)) node.replaceWith(selectorParser.tag({ value: element }))
              else hasPlatformAnchor = true
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
  // The variables a kept rule reads, and those they read in turn through the properties kept for them.
  const themes = new Set(themeRules)
  const read = new Set<string>()
  const readIn = (value: string): void => { for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) read.add(match[1]) }
  root.walkDecls((decl) => { if (!decl.parent || !themes.has(decl.parent as postcss.Rule)) readIn(decl.value) })
  const isKept = (decl: postcss.Declaration): boolean => decl.prop.startsWith('--') && !RUNTIME_CSS_VARIABLES.has(decl.prop) && read.has(decl.prop)
  for (let grew = true; grew;) {
    const before = read.size
    for (const rule of themeRules) rule.each((node) => { if (node.type === 'decl' && isKept(node)) readIn(node.value) })
    grew = read.size > before
  }
  const skippedVariables = { runtime: new Set<string>(), unused: new Set<string>() }
  let skippedThemeDeclarations = 0
  for (const rule of themeRules) {
    const dropped = rule.nodes.filter((node): node is postcss.Declaration => node.type === 'decl' && !isKept(node))
    for (const decl of dropped) {
      if (!decl.prop.startsWith('--')) skippedThemeDeclarations += 1
      else skippedVariables[RUNTIME_CSS_VARIABLES.has(decl.prop) ? 'runtime' : 'unused'].add(decl.prop)
      decl.remove()
    }
    if (!rule.nodes.some((node) => node.type === 'decl')) {
      omittedSelectors += rule.selectors.length
      rule.remove()
    }
  }
  const changedTheme = skippedThemeDeclarations > 0 || skippedVariables.runtime.size > 0 || skippedVariables.unused.size > 0
  const hasStyleRule = (nodes: postcss.ChildNode[] | undefined): boolean => Boolean(nodes?.some((node) =>
    node.type === 'rule' || (node.type === 'atrule' && hasStyleRule(node.nodes))))
  root.walkAtRules((rule) => {
    if (rule.name === 'font-face' || rule.name === 'property') return
    if (!hasStyleRule(rule.nodes)) rule.remove()
  })
  const skipped = { skippedVariables: { runtime: [...skippedVariables.runtime], unused: [...skippedVariables.unused] }, skippedThemeDeclarations }
  if (omittedSelectors === 0 && rewrittenSelectors === 0 && !changedTheme) return { css, omittedSelectors, ...skipped }
  root.walkComments((comment) => { comment.remove() })
  return { css: root.toString(), omittedSelectors, ...skipped }
}
