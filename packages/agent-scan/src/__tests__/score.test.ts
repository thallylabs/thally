import { describe, expect, it } from 'vitest'

import { methodology } from '../methodology/methodology.js'
import { scoreChecks } from '../score.js'
import type { CheckResult } from '../types.js'

function checks(values: Record<string, number | null>, fallback: number | null = 1): CheckResult[] {
  return methodology.checks.map((spec) => {
    const value = spec.id in values ? values[spec.id] : fallback
    return {
      id: spec.id,
      category: spec.category,
      scored: spec.scored,
      status: value === null ? 'not_applicable' : value === 1 ? 'pass' : 'fail',
      value,
      evidence: [],
      detail: '',
    }
  })
}

describe('scoring (AC2)', () => {
  it('scores 100 when every check passes', () => {
    expect(scoreChecks(checks({}))).toMatchObject({ score: 100, grade: 'A' })
  })

  it('averages checks within a category and weights categories 20/15/15/30/10/10', () => {
    // Retrieval mean 0 (weight 30) and everything else 1: 70.
    const result = scoreChecks(checks({ 'retrieval.server_rendered': 0, 'retrieval.alternate': 0, 'retrieval.status_health': 0 }))
    expect(result.score).toBe(70)
    expect(result.grade).toBe('C')
    expect(result.categories.find((c) => c.id === 'retrieval')).toEqual({ id: 'retrieval', weight: 30, applicable: true, score: 0 })
  })

  it('uses page-rate values, not statuses', () => {
    // Identity: (0.5 + 1 + 1 + 1) / 4 = 0.875 -> 15 * 0.875 = 13.125; total 98.125 -> 98.
    const result = scoreChecks(checks({ 'identity.canonical': 0.5 }))
    expect(result.categories.find((c) => c.id === 'identity')?.score).toBe(87.5)
    expect(result.score).toBe(98)
  })

  it('drops not-applicable checks from the category mean (level 1)', () => {
    const result = scoreChecks(checks({ 'parity.title': null, 'parity.description': 0 }))
    expect(result.categories.find((c) => c.id === 'parity')).toEqual({ id: 'parity', weight: 10, applicable: true, score: 0 })
    expect(result.score).toBe(90)
  })

  it('renormalizes weights when a whole category is not applicable (level 2)', () => {
    // Parity N/A; retrieval 0. Remaining weight 90, earned 60 -> 66.67 -> 67.
    const result = scoreChecks(checks({
      'parity.title': null, 'parity.description': null,
      'retrieval.server_rendered': 0, 'retrieval.alternate': 0, 'retrieval.status_health': 0,
    }))
    expect(result.categories.find((c) => c.id === 'parity')).toEqual({ id: 'parity', weight: 10, applicable: false, score: null })
    expect(result.score).toBe(67)
    expect(result.grade).toBe('D')
  })

  it('never lets the unscored robots check move the score', () => {
    expect(scoreChecks(checks({ 'discovery.robots_ai_agents': 0 })).score).toBe(100)
    // Discovery mean covers the 4 scored checks: one failure = 0.75.
    expect(scoreChecks(checks({ 'discovery.llms_txt': 0 })).categories[0].score).toBe(75)
  })

  it('returns a null score and grade when nothing applies', () => {
    expect(scoreChecks(checks({}, null))).toMatchObject({ score: null, grade: null })
  })

  it('grades 59/60, 69/70, 79/80 and 89/90 on the product bands', () => {
    // Retrieval value v gives score 70 + 30v. Discovery alone varies: 80 + 20v.
    const at = (v: number) => scoreChecks(checks({ 'retrieval.server_rendered': v, 'retrieval.alternate': v, 'retrieval.status_health': v }))
    expect(at(19 / 30)).toMatchObject({ score: 89, grade: 'B' })
    expect(at(20 / 30)).toMatchObject({ score: 90, grade: 'A' })
    expect(at(9 / 30)).toMatchObject({ score: 79, grade: 'C' })
    expect(at(10 / 30)).toMatchObject({ score: 80, grade: 'B' })
    const lower = (v: number) => scoreChecks(checks({
      'retrieval.server_rendered': 0, 'retrieval.alternate': 0, 'retrieval.status_health': 0,
      'trust.ownership': v, 'trust.correction_path': v,
    }))
    expect(lower(0)).toMatchObject({ score: 60, grade: 'D' })
    expect(lower(0.9)).toMatchObject({ score: 69, grade: 'D' })
    expect(lower(1)).toMatchObject({ score: 70, grade: 'C' })
    const lowest = scoreChecks(checks({
      'retrieval.server_rendered': 0, 'retrieval.alternate': 0, 'retrieval.status_health': 0,
      'trust.ownership': 0, 'trust.correction_path': 0, 'parity.title': 0.9, 'parity.description': 0.9,
    }))
    expect(lowest).toMatchObject({ score: 59, grade: 'F' })
  })
})
