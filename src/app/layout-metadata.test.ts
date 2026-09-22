/** Page-title contract for the root layout's metadata template. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('root layout page title', () => {
  it('joins the page title and site name with a pipe', async () => {
    const source = await readFile('src/app/layout.tsx', 'utf8')
    // `next/font/google` blocks importing the layout in Vitest, so assert the
    // template at the source level: "<page> | <site>" reads like other docs
    // hosts and keeps browser tabs and search snippets consistent.
    expect(source).toContain('template: `%s | ${effectiveSite.name}`')
    expect(source).not.toContain('%s •')
  })
})
