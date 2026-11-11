/**
 * Category and site scoring. Every weight and grade band comes from the
 * methodology JSON. Not-applicable checks leave their category mean, and a
 * category with no applicable scored checks leaves the weight sum.
 */

import { gradeFor, methodology } from './methodology/methodology.js'
import type { CategoryScore, CheckResult, Grade } from './types.js'

/** Scores derived from a full set of check results. */
export interface ScoreSummary {
  categories: CategoryScore[]
  score: number | null
  grade: Grade | null
}

/**
 * Compute category scores, the 0–100 site score and its grade. The site score
 * uses unrounded category means in methodology order, so the floating-point
 * result is stable; category scores are rounded to one decimal for display.
 */
export function scoreChecks(checks: CheckResult[]): ScoreSummary {
  const byId = new Map(checks.map((check) => [check.id, check]))
  const weightOf = new Map(methodology.checks.map((check) => [check.id, check.weight]))
  let weighted = 0
  let totalWeight = 0
  const categories: CategoryScore[] = methodology.categories.map((category) => {
    let sum = 0
    let weightSum = 0
    for (const spec of methodology.checks) {
      if (spec.category !== category.id || !spec.scored) continue
      const result = byId.get(spec.id)
      if (!result || result.value === null) continue
      const weight = weightOf.get(spec.id) ?? 0
      sum += weight * result.value
      weightSum += weight
    }
    if (weightSum === 0) return { id: category.id, weight: category.weight, applicable: false, score: null }
    const mean = sum / weightSum
    weighted += category.weight * mean
    totalWeight += category.weight
    return { id: category.id, weight: category.weight, applicable: true, score: Math.round(mean * 1000) / 10 }
  })
  if (totalWeight === 0) return { categories, score: null, grade: null }
  const score = Math.round((100 * weighted) / totalWeight)
  return { categories, score, grade: gradeFor(score) }
}
