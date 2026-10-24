/** The check reads a redirect source as Next.js does, which it asks of `next.config.ts` at run time. */

import { modifyRouteRegex } from 'next/dist/lib/redirect-status.js'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match.js'
import { describe, expect, it } from 'vitest'

import { compileRedirectSource } from '../check.js'

/** Next's own matcher for a redirect source, built with the options it gives one (filesystem.js `buildCustomRoute`). */
const nextMatch = (source: string) => getPathMatch(source, { strict: true, removeUnnamedParams: true, regexModifier: (regex) => modifyRouteRegex(regex), sensitive: false })

const sources = [
  '/old', '/OLD', '/old/', '/', '/old/:path', '/old/:path*', '/old/:path+', '/old/:path?', '/old/:path(.*)', '/old/:path(a|b)', '/old/:path(\\d+)',
  '/old/:path(.*)/more', '/:lang(en|fr)/docs/:slug*', '/file.:ext', '/old.:ext(html|php)', '/a/(.*)', '/a/(b|c)', '/:a/:b', '/docs/:p*/edit', '/x/:id(\\d+)?',
  '/(.*)', '/guide/:slug/:rest*', '/v:version(\\d+)/docs', '/blog/:year(\\d{4})/:slug',
]
const paths = [
  '/', '/old', '/OLD', '/Old/a', '/old/a', '/old/a/b', '/old/1', '/old/a/more', '/old/a/b/more', '/en/docs', '/fr/docs/a/b', '/de/docs/a', '/file.txt', '/old.html',
  '/old.js', '/oldx', '/other', '/a/b', '/a/c', '/a/d', '/docs/x/y/edit', '/docs/edit', '/x', '/x/12', '/x/ab', '/guide/a', '/guide/a/b/c', '/v2/docs', '/vx/docs',
  '/blog/2024/post', '/blog/24/post',
]

describe('a redirect source as the check reads it', () => {
  it.each(sources)('matches the same addresses as Next.js: %s', (source) => {
    const rule = compileRedirectSource(source, '/to')
    expect(rule.regex, 'a source of this syntax is read').not.toBeNull()
    // The check follows an address without its trailing slash, which Next.js strips before it looks at redirects.
    for (const path of paths) expect(Boolean(rule.regex!.test(path)), `${source} ${path}`).toBe(nextMatch(source.replace(/\/$/, '') || '/')(path) !== false)
  })

  it('takes the named parameters from the same places as Next.js', () => {
    const source = '/:lang(en|fr)/docs/:slug*'
    const ours = compileRedirectSource(source, '/to').regex!.exec('/fr/docs/a/b')!
    const next = nextMatch(source)('/fr/docs/a/b') as Record<string, string | Array<string>>
    expect(ours[1]).toBe(next.lang)
    expect(ours[2]).toBe((next.slug as Array<string>).join('/'))
  })

  it.each(['/legacy/:slug\\-x', '/legacy{/:slug}?', '/old/a*', '/old/(a(b))', '/old/:', '/old/:path(', '/old/:path(?x)'])('does not read %s, so it claims only what begins like it', (source) => {
    const rule = compileRedirectSource(source, '/to')
    expect(rule.regex).toBeNull()
    expect(rule.prefix.startsWith('/')).toBe(true)
  })
})
