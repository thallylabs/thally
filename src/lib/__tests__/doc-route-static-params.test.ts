/**
 * Prerender guard parity across document and localized API routes.
 *
 * Assets builds visit only each optional catch-all root. That lets the shared
 * shell establish its live-policy request boundary without enumerating the
 * repository's own pages. An empty list incorrectly chooses on-demand SSG and
 * rejects the shell's headers() call when a managed page is requested.
 *
 * The routes are asserted together, by import, precisely because the failure
 * mode is drift: the guard was added to one route while the API reference
 * silently kept prerendering. Each row is load-bearing against this repo's
 * docs.json — removing any single route's guard fails that row alone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resetContentSourceForTests } from '@/lib/content-source'
import { generateStaticParams as rootParams } from '../../app/(docs)/[[...slug]]/page'
import { generateStaticParams as localizedApiParams } from '../../app/(docs)/[locale]/api/[[...slug]]/page'
import { generateStaticParams as apiParams } from '../../app/(docs)/api/[[...slug]]/page'

const savedEnv = process.env.THALLY_CONTENT_SOURCE

const routes = [
  { name: '[[...slug]]', generateStaticParams: rootParams },
  { name: 'api/[[...slug]]', generateStaticParams: apiParams },
]

beforeEach(() => {
  delete process.env.THALLY_CONTENT_SOURCE
  resetContentSourceForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (savedEnv === undefined) delete process.env.THALLY_CONTENT_SOURCE
  else process.env.THALLY_CONTENT_SOURCE = savedEnv
  resetContentSourceForTests()
})

describe('doc route generateStaticParams', () => {
  it('has no locale catch-all that overlaps ordinary document paths', () => {
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'src/app/(docs)/[locale]/[[...slug]]/page.tsx',
        ),
      ),
    ).toBe(false)
  })

  it.each(routes)('$name visits only its root to establish live policy under the assets source', async ({ generateStaticParams }) => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    resetContentSourceForTests()

    await expect(generateStaticParams()).resolves.toEqual([{ slug: [] }])
  })

  it('establishes the localized API request boundary before any secondary locale exists', async () => {
    process.env.THALLY_CONTENT_SOURCE = 'assets'
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({
      tabs: [],
      i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] },
    }))
    resetContentSourceForTests()

    await expect(localizedApiParams()).resolves.toEqual([{ locale: 'en', slug: [] }])
  })

  // Self-hosted builds must still enumerate real content paths rather than
  // taking the managed shell probe unconditionally.
  it.each(routes)('$name still prerenders under the default filesystem source', async ({ generateStaticParams }) => {
    const params = await generateStaticParams()
    expect(params.some((entry) => entry.slug.length > 0)).toBe(true)
  })
})
