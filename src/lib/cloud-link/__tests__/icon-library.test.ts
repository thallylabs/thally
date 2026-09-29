/** Regression coverage for the Cloud icon library override. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { resolveSiteIconLibrary } from '../icon-library'

describe('site icon library', () => {
  it('keeps the repository choice when Cloud has not chosen a library', () => {
    expect(resolveSiteIconLibrary(undefined, 'fontawesome')).toBe('fontawesome')
    expect(resolveSiteIconLibrary({}, 'lucide')).toBe('lucide')
  })

  it('lets a Thally Cloud branding setting override the repository value', () => {
    expect(resolveSiteIconLibrary({ iconLibrary: 'tabler' }, 'fontawesome')).toBe('tabler')
  })

  it('ignores an unknown dashboard value instead of breaking rendering', () => {
    expect(resolveSiteIconLibrary({ iconLibrary: 'noto' }, 'fontawesome')).toBe('fontawesome')
  })
})
