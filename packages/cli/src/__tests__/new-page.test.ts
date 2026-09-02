/** Root navigation registration for pages created by the public CLI. */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { runNewPage } from '../commands/new-page.js'
import { parseArgs } from '../router.js'

describe('thally new root navigation', () => {
  it('registers a new page in a root-pages tab', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-new-root-pages-'))
    mkdirSync(join(projectDir, 'src/content'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{ tab: 'Documentation', pages: ['introduction'] }],
    }))

    expect(runNewPage(parseArgs(['new', 'guides/install']), projectDir)).toBe(0)

    const config = JSON.parse(readFileSync(join(projectDir, 'docs.json'), 'utf8')) as {
      tabs: Array<{ pages: Array<string> }>
    }
    expect(config.tabs[0].pages).toEqual(['introduction', 'guides/install'])
  })
})
