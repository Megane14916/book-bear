import { expect, it } from 'vitest'
import { measureRanking } from '../scripts/seed/metrics'

it('measures ranking and candidate misses against the full set of positive labels', () => {
  const result = measureRanking(['c', 'b', 'd', 'a'], ['a', 'b', 'c', 'd'], new Set(['a', 'b', 'missing']), new Set(['c']))
  expect(result).toMatchObject({ precisionAt1: 0, recallAt3: 1 / 3, mrr: 1 / 2, hardNegativeHitRate: 1, candidateRecall: 2 / 3 })
  expect(result.random.precisionAt1).toBe(0.5)
  expect(result.random.recallAt3).toBe(0.5)
  expect(result.random.mrr).toBeCloseTo(0.5 + 1 / 6 + 1 / 18)
  expect(result.random.hardNegativeHitRate).toBeCloseTo(0.75)
})

it('reports zero quality when the candidate query returns no books', () => {
  expect(measureRanking([], [], new Set(['a']), new Set(['b']))).toEqual({
    precisionAt1: 0, recallAt3: 0, mrr: 0, hardNegativeHitRate: 0, candidateRecall: 0,
    random: { precisionAt1: 0, recallAt3: 0, mrr: 0, hardNegativeHitRate: 0 },
  })
})
