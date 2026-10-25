/** A rule kept from a site's stylesheet applies inside the page content only, so it can never restyle the Thally shell around it. */

import * as cheerio from 'cheerio'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

import { projectAuthoredStyles } from '../source-styles.js'

const SCOPE = ':where(.thally-docs-prose, [data-thally-source-page])'

// A page as the runtime renders it: the shell (top bar, sidebar, breadcrumbs, pagination, table of contents, footer) around one content
// container. Shell and content both carry classes and ids a site may reuse.
const page = `<html class="dark"><body>
<header class="thally-docs-topbar"><svg class="lucide"></svg><nav class="not-prose"><a class="ifx-box"></a></nav></header>
<aside class="thally-docs-sidebar"><nav class="lucide"><a class="ifx-box"><i class="not-prose"></i></a></nav></aside>
<main id="main-content" class="thally-docs-main">
  <div class="not-prose"><nav class="thally-docs-breadcrumbs"><svg class="lucide"></svg></nav></div>
  <article class="thally-docs-article"><div class="thally-docs-prose prose">
    <div class="ifx-box"><svg class="lucide"></svg><p>Text <a href="/">link</a></p><b class="not-prose"></b></div>
  </div></article>
  <div class="not-prose"><nav class="pagination"></nav></div>
  <aside id="table-of-contents-content" class="thally-docs-toc"><nav></nav></aside>
  <div lang="en"><div data-thally-source-page><div class="ifx-box"><svg class="lucide"></svg></div></div></div>
</main>
<footer class="thally-docs-footer"><nav></nav></footer>
</body></html>`

/** How many elements of the page the rules of `css` reach inside the content container, and outside it. */
function reach(css: string): { inside: number; outside: number } {
  const $ = cheerio.load(page)
  const reached = new Set<unknown>()
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    for (const selector of rule.selectors) for (const element of $(selector.replace(/::?[\w-]+$/, '')).toArray()) reached.add(element)
  })
  const outside = [...reached].filter((element) => $(element as never).closest('.thally-docs-prose, [data-thally-source-page]').length === 0).length
  return { inside: reached.size - outside, outside }
}

const project = (css: string, content = '<i className="ifx-a ifx-b x y" />') => projectAuthoredStyles(css, [content])
const text = (css: string) => css.replace(/\s+/g, ' ').trim()

describe('a rule a site wrote for a name Thally uses too', () => {
  const authored = '<div className="ifx-box lucide" id="table-of-contents-content"><i id="main-content" /></div>'
  const rules = [
    '.lucide { display: none !important; }',
    '.ifx-box [class~="not-prose"] { margin: 0; }',
    '.ifx-box [class*="not-prose"] { margin: 0; }',
    '#table-of-contents-content { display: none !important; }',
    '#main-content nav { display: none; }',
    '.ifx-box { color: red; }',
  ]

  it.each(rules)('%s cannot reach anything outside the page content', (rule) => {
    const { css } = project(rule, authored)
    expect(reach(css).outside).toBe(0)
  })

  it('still reaches the same markup inside the page content, and inside a custom-mode page', () => {
    // One in the content container, one in the element a custom-mode page's content is wrapped in.
    expect(reach(project(rules[0], authored).css).inside).toBe(2)
    expect(reach(project(rules[1], authored).css).inside).toBe(1)
    expect(reach(project(rules[5], authored).css).inside).toBe(2)
  })
})

describe('the way a selector is confined', () => {
  const cases: Array<[string, string]> = [
    ['.ifx-a', `${SCOPE} .ifx-a`],
    ['.ifx-a, .ifx-b p', `${SCOPE} .ifx-a, ${SCOPE} .ifx-b p`],
    ['.ifx-a > .ifx-b + p ~ i', `${SCOPE} .ifx-a > .ifx-b + p ~ i`],
    ['.ifx-a:is(.ifx-b, p):not(.x):where(.y)', `${SCOPE} .ifx-a:is(.ifx-b, p):not(.x):where(.y)`],
    ['.ifx-a:has(> p)::before', `${SCOPE} .ifx-a:has(> p)::before`],
    ['*:not(.ifx-a) .ifx-b', `${SCOPE} *:not(.ifx-a) .ifx-b`],
    ['.dark .ifx-a', `.dark ${SCOPE} .ifx-a`],
    ['.light .ifx-a > p', `.light ${SCOPE} .ifx-a > p`],
    ['html.dark .ifx-a', `html.dark ${SCOPE} .ifx-a`],
    [':root .ifx-a', `:root ${SCOPE} .ifx-a`],
    ['body .ifx-a', `body ${SCOPE} .ifx-a`],
    ['html body.dark .ifx-a', `html body.dark ${SCOPE} .ifx-a`],
    [':is(.dark, .light) .ifx-a', `:is(.dark, .light) ${SCOPE} .ifx-a`],
    ['.ifx-a, .dark .ifx-b', `${SCOPE} .ifx-a, .dark ${SCOPE} .ifx-b`],
  ]

  it.each(cases)('%s', (selector, expected) => {
    expect(text(project(`${selector} { color: red; }`).css)).toBe(`${expected} { color: red; }`)
  })

  it('skips a selector that styles the page, or what is next to the content, instead of what is inside it', () => {
    for (const selector of ['html.ifx-a', 'body.dark.ifx-a', 'body > .ifx-a', 'html + .ifx-a', ':root > .ifx-a']) {
      const result = project(`${selector} { color: red; }`)
      expect(result.css, selector).toBe('')
      expect(result.omittedSelectors, selector).toBe(1)
    }
    const mixed = project('.ifx-a, body > .ifx-b { color: red; }')
    expect(text(mixed.css)).toBe(`${SCOPE} .ifx-a { color: red; }`)
    expect(mixed.omittedSelectors).toBe(1)
  })

  it('confines the rules inside @media, @supports, @layer and @container, and leaves keyframes and @font-face as they are', () => {
    const keyframes = '@keyframes spin { from { transform: none; } to { transform: rotate(1turn); } }'
    const fontFace = '@font-face { font-family: Site; src: url(site.woff2); }'
    const css = [
      '@media (min-width: 600px) { .ifx-a { color: red; } @supports (display: grid) { .ifx-a { display: grid; } } }',
      '@layer site { .ifx-a { color: blue; } }',
      '@container (min-width: 10px) { .ifx-a, .dark .ifx-b { color: teal; } }',
      keyframes,
      fontFace,
      '.ifx-a { animation: spin 1s; }',
    ].join('\n')
    const projected = text(project(css).css)
    expect(projected).toContain(keyframes)
    expect(projected).toContain(fontFace)
    expect(projected).toContain(`@media (min-width: 600px) { ${SCOPE} .ifx-a { color: red; } @supports (display: grid) { ${SCOPE} .ifx-a { display: grid; } } }`)
    expect(projected).toContain(`@layer site { ${SCOPE} .ifx-a { color: blue; } }`)
    expect(projected).toContain(`@container (min-width: 10px) { ${SCOPE} .ifx-a, .dark ${SCOPE} .ifx-b { color: teal; } }`)
    expect(projected).toContain(`${SCOPE} .ifx-a { animation: spin 1s; }`)
  })

  it('leaves a rule nested in a kept rule to that rule, which already confines it', () => {
    expect(text(project('.ifx-a { color: red; .ifx-b { color: blue; } }').css)).toBe(`${SCOPE} .ifx-a { color: red; .ifx-b { color: blue; } }`)
  })
})

describe('the theme blocks of a stylesheet', () => {
  const css = ':root { --ifx-a: red; --thally-background: 0 0% 0%; }\n.dark { --ifx-a: blue; }\nhtml.dark { --ifx-b: green; }\n.ifx-a { color: var(--ifx-a); background: hsl(var(--thally-background)); border-color: var(--ifx-b); }'

  it('declare their custom properties on the content container, so they reach the content and nothing else', () => {
    const projected = text(project(css).css)
    expect(projected).toContain(`:root ${SCOPE} { --ifx-a: red; --thally-background: 0 0% 0%; }`)
    expect(projected).toContain(`.dark ${SCOPE} { --ifx-a: blue; }`)
    expect(projected).toContain(`html.dark ${SCOPE} { --ifx-b: green; }`)
    expect(reach(project(css).css).outside).toBe(0)
  })

  it('give the container its dark values under a dark page only', () => {
    const dark = project(css).css.match(/\.dark :where\([^)]*\)/)![0]
    const $ = cheerio.load(page)
    expect($(dark).toArray().map((element) => $(element).attr('class') ?? 'data-thally-source-page')).toEqual(['thally-docs-prose prose', 'data-thally-source-page'])
    expect(cheerio.load(page.replace('<html class="dark">', '<html>'))(dark).length).toBe(0)
  })
})
