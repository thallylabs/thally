/** Regression coverage for release-scoped content presentation defaults. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  DEFAULT_CONTENT_CONTROLS,
  resolveContentControls,
} from '../content-controls'

describe('content controls', () => {
  it('preserves all existing site chrome when settings are absent', () => {
    expect(resolveContentControls(undefined)).toEqual(DEFAULT_CONTENT_CONTROLS)
  })

  it('honors explicit false values independently', () => {
    expect(resolveContentControls({
      showSidebarGroupIcons: false,
      showBreadcrumbs: false,
      showTableOfContents: true,
      showCopyPage: false,
    })).toEqual({
      showSidebarGroupIcons: false,
      showBreadcrumbs: false,
      showTableOfContents: true,
      showCopyPage: false,
    })
  })
})
