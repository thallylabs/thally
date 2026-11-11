import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { evaluators } from '../checks/index.js'
import { gradeFor, methodology, validateMethodology } from '../methodology/methodology.js'
import spec from '../methodology/methodology-v1.0.json' with { type: 'json' }

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('methodology spec (AC7)', () => {
  it('declares the six categories with the published weights', () => {
    expect(methodology.categories.map((c) => [c.id, c.weight])).toEqual([
      ['discovery', 20], ['identity', 15], ['structure', 15], ['retrieval', 30], ['trust', 10], ['parity', 10],
    ])
    expect(methodology.categories.reduce((sum, c) => sum + c.weight, 0)).toBe(100)
  })

  it('has exactly one evaluator per check id, and no evaluator without a check', () => {
    expect(Object.keys(evaluators).sort()).toEqual(methodology.checks.map((c) => c.id).sort())
  })

  it('exports id, category, weight, scored flag and a pass rule for every check', () => {
    for (const check of methodology.checks) {
      expect(check.rule.length).toBeGreaterThan(20)
      expect(['site', 'page']).toContain(check.scope)
      expect(check.weight).toBeGreaterThan(0)
    }
    expect(methodology.checks.filter((c) => !c.scored).map((c) => c.id)).toEqual(['discovery.robots_ai_agents'])
    expect(methodology.id).toBe('thally-agent-scan')
    expect(methodology.version).toBe('1.0')
    expect(methodology.userAgent).toBe('ThallyAgentScan/1.0 (+https://thally.io/agent-readiness-methodology)')
  })

  it('keeps probe literals and weights out of TypeScript so code and spec cannot drift', () => {
    const literals = [...methodology.probes.wellKnown, ...methodology.probes.aiBotTokens, 'ThallyAgentScan/1.0']
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const literal of literals) expect(source.includes(literal), `${literal} in ${file}`).toBe(false)
    }
  })

  it('rejects invalid specs at load time', () => {
    const clone = () => JSON.parse(JSON.stringify(spec))
    const badWeight = clone()
    badWeight.categories[0].weight = 0
    expect(() => validateMethodology(badWeight)).toThrow(/weight must be positive/)
    const dupe = clone()
    dupe.checks.push(dupe.checks[0])
    expect(() => validateMethodology(dupe)).toThrow(/duplicate check/)
    const unknownCategory = clone()
    unknownCategory.checks[0].category = 'speed'
    expect(() => validateMethodology(unknownCategory)).toThrow(/unknown category/)
    const grades = clone()
    grades.grades = [{ grade: 'A', min: 90 }, { grade: 'B', min: 95 }, { grade: 'F', min: 0 }]
    expect(() => validateMethodology(grades)).toThrow(/descending/)
    const noZero = clone()
    noZero.grades = [{ grade: 'A', min: 90 }, { grade: 'F', min: 10 }]
    expect(() => validateMethodology(noZero)).toThrow(/start at 0/)
  })

  it('grades at the boundaries', () => {
    expect([100, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(gradeFor)).toEqual(['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'F', 'F'])
  })
})
