import { describe, expect, it } from 'vitest'
import { safeCssColor } from '@/lib/css-color'

describe('safeCssColor', () => {
  it('accepts hex, keywords and colour functions', () => {
    for (const value of ['#fff', '#FF4D00', '#ff4d0080', 'tomato', 'rgb(1, 2, 3)', 'hsl(140 70% 40%)', 'oklch(0.7 0.1 140 / 50%)']) expect(safeCssColor(value)).toBe(value)
  })

  it('rejects anything that could add a declaration or run an expression', () => {
    for (const value of ['red;position:fixed', 'red} body{', 'url(https://x.test/a)', 'var(--x)', 'rgb(1,2,3);x:y', '', 12, null]) expect(safeCssColor(value)).toBeUndefined()
  })
})
