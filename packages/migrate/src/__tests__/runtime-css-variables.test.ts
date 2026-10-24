/** The custom properties the migration treats as the runtime's own are the ones the runtime's stylesheets declare or read. */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

import { RUNTIME_CSS_VARIABLES } from '../runtime-css-variables.js'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

describe('RUNTIME_CSS_VARIABLES', () => {
  it('is exactly the custom properties src/styles and the starter globals.css declare or read', () => {
    const files = [...readdirSync(join(repoRoot, 'src/styles')).filter((name) => name.endsWith('.css')).map((name) => join('src/styles', name)), 'src/app/globals.css']
    const names = new Set<string>()
    for (const file of files) {
      const root = postcss.parse(readFileSync(join(repoRoot, file), 'utf8'))
      root.walkDecls((decl) => {
        if (decl.prop.startsWith('--')) names.add(decl.prop)
        for (const match of decl.value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) names.add(match[1])
      })
      root.walkAtRules('property', (rule) => { names.add(rule.params.trim()) })
    }
    expect([...names].filter((name) => !RUNTIME_CSS_VARIABLES.has(name)).sort(), 'in the stylesheets, not in the list').toEqual([])
    expect([...RUNTIME_CSS_VARIABLES].filter((name) => !names.has(name)).sort(), 'in the list, not in the stylesheets').toEqual([])
  })
})
