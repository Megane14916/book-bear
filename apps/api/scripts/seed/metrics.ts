export function measureRanking(ranked: string[], candidates: string[], relevant: Set<string>, hardNegatives: Set<string>) {
  const firstRelevant = ranked.findIndex((id) => relevant.has(id))
  const top = ranked.slice(0, 3)
  const availableRelevant = candidates.filter((id) => relevant.has(id)).length
  const availableNegative = candidates.filter((id) => hardNegatives.has(id)).length
  const size = candidates.length
  let randomMrr = 0
  let noRelevant = 1
  let noHardNegative = 1
  for (let index = 0; index < size; index++) {
    const remaining = size - index
    randomMrr += noRelevant * availableRelevant / remaining / (index + 1)
    noRelevant *= Math.max(0, remaining - availableRelevant) / remaining
    if (index < 3) noHardNegative *= Math.max(0, remaining - availableNegative) / remaining
  }
  return {
    precisionAt1: Number(firstRelevant === 0),
    recallAt3: top.filter((id) => relevant.has(id)).length / relevant.size,
    mrr: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    hardNegativeHitRate: Number(top.some((id) => hardNegatives.has(id))),
    candidateRecall: availableRelevant / relevant.size,
    random: {
      precisionAt1: size ? availableRelevant / size : 0,
      recallAt3: size ? Math.min(3, size) / size * availableRelevant / relevant.size : 0,
      mrr: randomMrr,
      hardNegativeHitRate: 1 - noHardNegative,
    },
  }
}
