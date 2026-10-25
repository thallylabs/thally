/** The class names the migration treats as the runtime's own are the ones the runtime's stylesheets select and its components carry. */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { describe, expect, it } from 'vitest'

import { RUNTIME_CLASS_NAMES } from '../runtime-class-names.js'
import { UTILITY_CLASS, authoredStyleNames } from '../source-styles.js'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

describe('RUNTIME_CLASS_NAMES', () => {
  it('is exactly the class names src/styles, the starter globals.css and the components use, bar the utilities the import skips anyway', () => {
    const names = new Set<string>()
    const stylesheets = [...readdirSync(join(repoRoot, 'src/styles')).filter((name) => name.endsWith('.css')).map((name) => join('src/styles', name)), 'src/app/globals.css']
    for (const file of stylesheets) {
      postcss.parse(readFileSync(join(repoRoot, file), 'utf8')).walkRules((rule) => {
        selectorParser((selectors) => { selectors.walk((node) => { if (node.type === 'class') names.add(node.value) }) }).processSync(rule.selector)
      })
    }
    const components = readdirSync(join(repoRoot, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    for (const file of components) for (const name of authoredStyleNames([readFileSync(join(repoRoot, 'src', file), 'utf8')]).classes) names.add(name)
    const expected = [...names].filter((name) => /^[A-Za-z_][\w-]*$/.test(name) && !UTILITY_CLASS.test(name))
    expect(expected.filter((name) => !RUNTIME_CLASS_NAMES.has(name)).sort(), 'in the runtime, not in the list').toEqual([])
    expect([...RUNTIME_CLASS_NAMES].filter((name) => !expected.includes(name)).sort(), 'in the list, not in the runtime').toEqual([])
  })
})
