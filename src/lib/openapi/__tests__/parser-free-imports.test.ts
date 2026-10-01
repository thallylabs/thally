/**
 * The page index (docs.ts) and the relay's lookups are bundled into Worker
 * routes that never render MDX, so they may read `api:` frontmatter and
 * docs.json `api.mdx` only through modules free of the MDX parser
 * (`manual-operation.ts` pulls in unified, remark-parse and remark-mdx).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../../../..')
const source = (file: string) => readFileSync(path.join(root, file), 'utf8')
const imports = (file: string) => [...source(file).matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1])

describe('modules bundled into index and route code stay free of the MDX parser', () => {
  it.each(['src/data/docs.ts', 'src/lib/openapi/page-api.ts', 'src/lib/openapi/api-frontmatter.ts'])('%s', (file) => {
    for (const specifier of imports(file)) {
      expect(specifier, file).not.toMatch(/manual-operation$/)
      expect(specifier, file).not.toMatch(/^(unified|remark-parse|remark-mdx)$/)
    }
  })
})
