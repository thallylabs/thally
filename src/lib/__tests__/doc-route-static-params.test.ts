/**
 * Prerender guard parity across the three doc routes.
 *
 * Under `THALLY_CONTENT_SOURCE=assets` every doc route must return an empty
 * param list, so nothing is baked into static HTML at build time. A route that
 * forgets the guard still prerenders the build's own content, and those pages
 * shadow the dynamic route on a managed site — it then serves the build's docs
 * instead of the customer's published ones.
 *
 * The routes are asserted together, by import, precisely because the failure
 * mode is drift: the guard was added to two of the three and the API reference
 * silently kept prerendering. Each row is load-bearing against this repo's
 * docs.json — removing any single route's guard fails that row alone.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetContentSourceForTests } from '@/lib/content-source'
import { generateStaticParams as rootParams } from '../../app/(docs)/[[...slug]]/page'
import { generateStaticParams as localeParams } from '../../app/(docs)/[locale]/[[...slug]]/page'
import { generateStaticParams as apiParams } from '../../app/(docs)/api/[[...slug]]/page'

const savedEnv = process.env.THALLY_CONTENT_SOURCE

const routes = [
  { name: '[[...slug]]', generateStaticParams: rootParams },
  { name: '[locale]/[[...slug]]', generateStaticParams: localeParams },
  { name: 'api/[[...slug]]', generateStaticParams: apiParams },
]

beforeEach(() => {
  delete process.env.THALLY_CONTENT_SOURCE
  resetContentSourceForTests()
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.THALLY_CONTENT_SOURCE
  else process.env.THALLY_CONTENT_SOURCE = savedEnv
  resetContentSourceForTests()
})

describe('doc route generateStaticParams', () => {
  it.each(routes)('$name prerenders nothing under the assets source', async ({ generateStaticParams }) => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    resetContentSourceForTests()

    await expect(generateStaticParams()).resolves.toEqual([])
  })

  // Guards the guard: an unconditional `return []` would satisfy the assertions
  // above while silently dropping SSG for self-hosted and OSS builds. Only the
  // two unconditional routes are asserted here — [locale] legitimately yields an
  // empty list in either mode when docs.json configures no secondary locale.
  it.each([
    { name: '[[...slug]]', generateStaticParams: rootParams },
    { name: 'api/[[...slug]]', generateStaticParams: apiParams },
  ])('$name still prerenders under the default filesystem source', async ({ generateStaticParams }) => {
    await expect(generateStaticParams()).resolves.not.toEqual([])
  })
})
