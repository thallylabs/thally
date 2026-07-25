/**
 * Unit coverage for dynamic social-preview URL and label helpers.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildOgImageUrl, formatOgBreadcrumb, formatOgDisplayUrl } from '@/lib/og'

afterEach(() => {
  delete process.env.THALLY_SITE_URL
  delete process.env.DOX_SITE_URL
  delete process.env.NEXT_PUBLIC_SITE_URL
})

describe('buildOgImageUrl', () => {
  it('encodes every dynamic preview slot', () => {
    const result = buildOgImageUrl({
      title: 'Sending a job',
      description: 'Send a job and wait for the result.',
      crumb: 'SDK / Configuration',
      url: 'docs.example.com/sdk/jobs',
      theme: 'dark',
    })
    const parsed = new URL(result, 'https://docs.example.com')

    expect(parsed.pathname).toBe('/api/og')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      title: 'Sending a job',
      description: 'Send a job and wait for the result.',
      crumb: 'SDK / Configuration',
      url: 'docs.example.com/sdk/jobs',
      theme: 'dark',
    })
  })
})

describe('formatOgDisplayUrl', () => {
  it('keeps the host and page path while removing the protocol', () => {
    process.env.THALLY_SITE_URL = 'https://docs.example.com'
    expect(formatOgDisplayUrl('/sdk/jobs')).toBe('docs.example.com/sdk/jobs')
    expect(formatOgDisplayUrl('/')).toBe('docs.example.com')
  })
})

describe('formatOgBreadcrumb', () => {
  it('removes the current page and keeps the nearest two navigation levels', () => {
    expect(
      formatOgBreadcrumb(
        [{ label: 'Guides' }, { label: 'SDK' }, { label: 'Configuration' }, { label: 'Sending a job' }],
        'Sending a job',
      ),
    ).toBe('SDK / Configuration')
  })

  it('uses the page group when navigation context is unavailable', () => {
    expect(formatOgBreadcrumb([], 'Overview', 'Getting started')).toBe('Getting started')
  })
})
