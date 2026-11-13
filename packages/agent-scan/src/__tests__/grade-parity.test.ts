import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { methodology } from '../methodology/methodology.js'

// The scan grades must read the same as the in-product scorer's gradeFor.
// This parses the engine source rather than importing it, so the package
// keeps no runtime dependency on the application.
describe('grade thresholds match the product scorer (AC2)', () => {
  it('parses the same bands from the engine gradeFor', () => {
    const path = fileURLToPath(new URL('../../../../src/lib/agent-readiness/score.ts', import.meta.url))
    const source = readFileSync(path, 'utf8')
    const body = /function gradeFor\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1]
    expect(body, 'gradeFor not found in the engine scorer').toBeTruthy()
    const pairs = [...body!.matchAll(/if \(score >= (\d+)\) return '([A-F])'/g)].map((m) => ({ grade: m[2], min: Number(m[1]) }))
    expect(pairs.length).toBeGreaterThanOrEqual(4)
    expect(/return 'F'/.test(body!)).toBe(true)
    expect(pairs).toEqual(methodology.grades.filter((g) => g.grade !== 'F'))
    expect(methodology.grades.at(-1)).toEqual({ grade: 'F', min: 0 })
  })
})
