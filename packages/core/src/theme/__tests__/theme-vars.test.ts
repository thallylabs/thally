/**
 * Structural-theme regression tests keep navigation state legible when a
 * preset changes the shape and surface of the docs shell.
 */
import { describe, expect, it } from 'vitest'
import { THEME_VARS, themeVarsFor } from '../theme-vars'

describe('themeVarsFor', () => {
  it.each(['maple', 'sharp', 'minimal'])('keeps the active-tab underline visible for %s', (theme) => {
    expect(themeVarsFor(theme)).toContain('--theme-nav-tab-indicator-opacity:1')
  })

  it('does not add an elevated surface to active tabs', () => {
    for (const variables of Object.values(THEME_VARS)) {
      expect(variables).not.toContain('--theme-nav-tab-active-bg')
      expect(variables).not.toContain('--theme-nav-tab-active-shadow')
    }
  })
})
