import { AiUnavailable, type workersAi } from '../../src/integrations/workers-ai'
import { loadAozoraCatalog, type AozoraWork } from './aozora-catalog'
import { indexArchiveKey, localAozoraArchive, readAozoraFocus, readIndexed, readLegacyIndexed, selectAozoraWorks, type Chunk } from './aozora-index'
import { assessAozora, rerankScore } from './aozora-rerank'
import { elapsed } from './local-state'
import { normalize, titleAuthor, type Identity, type Registered } from './experiment'
import { preferenceText, type ReadingPreference } from './reading-preference'

const shortlistLimit = 24
const searchLimit = 100

export function aggregateChunks(scores: number[]) {
  const best = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score).slice(0, 3)
  return { best, max: best[0].score, mean: best.reduce((sum, { score }) => sum + score, 0) / best.length }
}

export function adjustedMean(scores: number[]) {
  return aggregateChunks(scores).mean - 0.012 * Math.log2(Math.max(1, scores.length / 4))
}

type Dimensions = { genre: number; theme: number; style: number; narrative: number }
type Scored = { work: AozoraWork; identity: Identity; a: number; b: number; max: number; aBasis: number; bBasis: number
  maxBasis: number; dimensions: Dimensions; fitScore: number; evidence: number[]; bodyChars: number; chunkCount: number }

function cosine(left: ArrayLike<number>, right: ArrayLike<number>) {
  let dot = 0
  let l = 0
  let r = 0
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]
    l += left[index] ** 2
    r += right[index] ** 2
  }
  return l && r ? dot / Math.sqrt(l * r) : 0
}

function compareWork(work: AozoraWork, identity: Identity, vectors: ArrayLike<number>[], baselineCount: number, bodyChars: number, query: number[][]): Scored {
  const similarity = query.map((reference) => vectors.map((vector) => cosine(reference, vector)))
  const baseline = aggregateChunks(similarity[0].slice(0, baselineCount))
  const expanded = aggregateChunks(similarity[0])
  const axis = similarity.slice(1).map((scores) => {
    const best = aggregateChunks(scores).best
    const count = Math.min(2, best.length)
    return { fit: best.slice(0, count).reduce((sum, { score }) => sum + score, 0) / count, evidence: best[0].index }
  })
  const [genre, theme, style, narrative] = axis.map(({ fit }) => fit)
  const b = adjustedMean(similarity[0])
  return { work, identity, a: baseline.mean, b, max: expanded.max, aBasis: baseline.best[0].index, bBasis: expanded.best[0].index,
    maxBasis: expanded.best[0].index, dimensions: { genre, theme, style, narrative },
    fitScore: 0.58 * b + 0.16 * genre + 0.12 * theme + 0.08 * style + 0.06 * narrative,
    evidence: [...new Set([expanded.best[0].index, ...axis.map(({ evidence }) => evidence), ...expanded.best.map(({ index }) => index)])],
    bodyChars, chunkCount: vectors.length }
}

function display(work: AozoraWork) {
  const part = work.subtitle.replace(/^\s*\d+\s+/u, '').trim()
  if (part && /(?:作品集|名作集|短編集|短篇集|傑作集|全集|小説集|怪談集|童話集|選集)/u.test(work.title)) {
    return { title: part, collectionTitle: work.title }
  }
  return { title: work.title, collectionTitle: null }
}

export function diverseAozoraTop<T extends { work: AozoraWork }>(sorted: T[]) {
  const authors = new Map<string, number>()
  const collections = new Map<string, number>()
  const seen = new Set<string>()
  const top: T[] = []
  for (const entry of sorted) {
    const { work } = entry
    const authorIds = [...new Set(work.people.filter(({ role }) => role === '著者').map(({ id }) => id).filter(Boolean))].sort()
    const author = normalize(work.author)
    const authorKeys = authorIds.length ? authorIds : author ? [author] : []
    const { title, collectionTitle } = display(work)
    const collection = collectionTitle && normalize(collectionTitle)
    const editionTitle = normalize(work.originalTitle || title.replace(/\s*(?:新装版|改訂版|復刻版|[上下]巻)$/u, ''))
    const key = authorKeys.length ? JSON.stringify([authorKeys, editionTitle]) : work.id
    if (seen.has(key) || authorKeys.some((authorKey) => (authors.get(authorKey) ?? 0) >= 2)
      || (collection && (collections.get(collection) ?? 0) >= 2)) continue
    seen.add(key)
    for (const authorKey of authorKeys) authors.set(authorKey, (authors.get(authorKey) ?? 0) + 1)
    if (collection) collections.set(collection, (collections.get(collection) ?? 0) + 1)
    top.push(entry)
    if (top.length === 10) break
  }
  return top
}

function legacyAozoraTop(sorted: Scored[]) {
  const authors = new Map<string, number>()
  const seen = new Set<string>()
  return sorted.filter(({ identity, work }) => {
    const translators = work.people.filter(({ role }) => role === '翻訳者').map(({ id }) => id).sort().join(',')
    const key = (titleAuthor(identity) ?? work.id) + ':' + translators
    if (seen.has(key)) return false
    seen.add(key)
    const count = authors.get(work.author) ?? 0
    authors.set(work.author, count + 1)
    return count < 2
  }).slice(0, 10)
}

const ordered = (rows: Scored[], field: 'a' | 'b' | 'max' | 'fitScore') =>
  [...rows].sort((left, right) => right[field] - left[field] || left.work.id.localeCompare(right.work.id))
const originalStory = (work: AozoraWork) =>
  !/(?:著者(?:之|の)序|序文|序にかえて|解題|はしがき|あとがき|後記|跋文)$/.test(work.title)
const story = (work: AozoraWork) => originalStory(work) && !/(?:[』」]|の|版)序$/u.test(work.title.trim())
  && !/^(?:\d+\s*)?(?:序|序文|序章|解題|はしがき|あとがき|後記|跋文)$/u.test(work.subtitle.trim())

export async function runAozoraRecommendation(preference: ReadingPreference, ai: ReturnType<typeof workersAi>, registered: Registered) {
  const started = performance.now()
  const catalog = await loadAozoraCatalog()
  if (!catalog) throw new Error('Run recommendations:aozora import first')
  const archive = await localAozoraArchive()
  const works = selectAozoraWorks(catalog)
  const archiveKey = archive?.key ?? await indexArchiveKey(works)
  const keys: Identity[] = works.map(({ title, author }) => ({ title, author, isbn13: null, volumeId: null }))
  const existing = await registered(keys)
  const indexSetupMs = elapsed(started)
  const userEmbeddingStart = performance.now()
  const genres = [...preference.preferredGenres, ...(preference.kind === 'fiction' ? ['小説・物語'] : [])]
  const inputs = [preferenceText(preference), genres.join('。'), preference.preferredThemes.join('。'),
    preference.preferredStyle.join('。'), preference.interests.join('。')]
  const unique = [...new Set(inputs)]
  const query = preference.kind === 'nonfiction' ? [] : await ai.embed(unique)
  const queryByText = new Map(unique.map((text, index) => [text, query[index]]))
  const references = inputs.map((text) => queryByText.get(text)!)
  const userEmbeddingMs = elapsed(userEmbeddingStart)

  const searchStart = performance.now()
  const legacy: Scored[] = []
  const current: Scored[] = []
  let indexed = 0
  let compatible = 0
  let legacyCompatible = 0
  let chunks = 0
  let dimensionMismatch = 0
  let paratextExcluded = 0
  const fileMetrics = { files: 0, peakRssMiB: Math.round(process.memoryUsage.rss() / 2 ** 20) }
  if (query.length) {
    for (let offset = 0; offset < works.length; offset += 32) {
      await Promise.all(works.slice(offset, offset + 32).map(async (work, index) => {
        const identity = keys[offset + index]
        const [record, previous] = await Promise.all([readIndexed(work, archiveKey), readLegacyIndexed(work)])
        if (previous && previous.vectors.every((vector) => vector.length === references[0].length)) {
          legacyCompatible++
          if (originalStory(work) && !existing.has(identity)) {
            legacy.push(compareWork(work, identity, previous.vectors, previous.chunks.length, previous.bodyChars, references))
          }
        }
        if (!record) return
        fileMetrics.files++
        indexed++
        chunks += record.chunks.length
        if (record.dimension !== references[0].length) { dimensionMismatch++; return }
        compatible++
        if (!story(work)) { paratextExcluded++; return }
        if (!existing.has(identity)) current.push(compareWork(work, identity, record.vectors, record.baselineCount, record.bodyChars, references))
      }))
      fileMetrics.peakRssMiB = Math.max(fileMetrics.peakRssMiB, Math.round(process.memoryUsage.rss() / 2 ** 20))
    }
    if (!compatible && !legacyCompatible) throw new Error('No compatible Aozora vectors. Run recommendations:aozora index with the current model.')
  }
  const indexVersion = compatible ? 2 : 1
  const pool = compatible ? current : legacy
  const byA = ordered(pool, 'a')
  const byB = ordered(pool, 'b')
  const byMax = ordered(pool, 'max')
  const firstStage = byB.slice(0, searchLimit)
  const shortlist = ordered(firstStage, 'fitScore').slice(0, shortlistLimit)
  const legacyTop = legacyAozoraTop(ordered(legacy, 'a'))
  const legacyIds = new Set(legacy.map(({ work }) => work.id))
  const a = diverseAozoraTop(byA)
  const b = diverseAozoraTop(byB)
  const max = diverseAozoraTop(byMax)
  const bLegacy = diverseAozoraTop(byB.filter(({ work }) => legacyIds.has(work.id)))
  const searchMs = elapsed(searchStart)

  const detailStart = performance.now()
  const candidateDetails = new Map<string, { chunks: Chunk[]; bodyHash: string; availableChunks: number; source: { url: string; release: string; sourceHash: string } }>()
  const allTop = new Map([...a, ...b, ...max, ...bLegacy, ...shortlist].map(({ work }) => [work.id, work]))
  const focusCandidates = []
  for (const work of allTop.values()) {
    const record = indexVersion === 2 ? await readIndexed(work, archiveKey) : await readLegacyIndexed(work)
    if (!record) continue
    candidateDetails.set(work.id, record)
  }
  for (const row of shortlist) {
    if (indexVersion !== 2 || !archive) break
    const record = await readIndexed(row.work, archive.key)
    if (record) focusCandidates.push({ work: row.work, record, basisChunkId: record.chunks[row.bBasis].id })
  }
  const detailed = new Map<string, { chunks: Chunk[]; score: number }>()
  let detailTexts = 0
  let detailStatus = 'skipped'
  try {
    const focus = await readAozoraFocus(focusCandidates, archive)
    const texts = [...new Set([...focus.values()].flatMap((parts) => parts.map(({ text }) => text)))]
    detailTexts = texts.length
    if (texts.length) {
      const vectors = await ai.embed(texts)
      if (vectors.some((vector) => vector.length !== references[0].length)) throw new AiUnavailable('Focus vector dimension mismatch')
      const scores = new Map(texts.map((text, index) => [text, cosine(references[0], vectors[index])]))
      for (const [id, parts] of focus) {
        const sorted = [...parts].sort((left, right) => scores.get(right.text)! - scores.get(left.text)!)
        detailed.set(id, { chunks: sorted, score: sorted.reduce((sum, { text }) => sum + scores.get(text)!, 0) / sorted.length })
      }
      detailStatus = 'ok'
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    detailStatus = 'unavailable'
  }
  const detailMs = elapsed(detailStart)
  const shortlistRows = shortlist.flatMap((row) => {
    const details = candidateDetails.get(row.work.id)
    if (!details) return []
    const additional = detailed.get(row.work.id)
    const preRerank = row.fitScore + (additional ? 0.18 * (additional.score - row.b) : 0)
    const excerpts = [details.chunks[row.evidence[0]], ...additional?.chunks.slice(0, 1) ?? [], ...row.evidence.slice(1, 3).map((index) => details.chunks[index])]
    return [{ ...row, preRerank, excerpts: excerpts.slice(0, 3) }]
  })
  const deepTop = diverseAozoraTop([...shortlistRows].sort((left, right) => right.preRerank - left.preRerank))
  const rerankStart = performance.now()
  const evaluation = await assessAozora(preference, shortlistRows.map(({ work, preRerank, dimensions, excerpts }) => ({
    id: work.id, ...display(work), author: work.author, ndc: work.ndc, semantic: preRerank, dimensions, evidence: excerpts,
  })), ai)
  const rerankMs = elapsed(rerankStart)
  const reranked = [...shortlistRows].sort((left, right) =>
    rerankScore(right.preRerank, evaluation.assessed.get(right.work.id)) - rerankScore(left.preRerank, evaluation.assessed.get(left.work.id)))
  const shortlisted = new Set(shortlistRows.map(({ work }) => work.id))
  const c = evaluation.assessed.size ? diverseAozoraTop([...reranked, ...byB.filter(({ work }) => !shortlisted.has(work.id))]) : b
  const topLegacyData = new Map(await Promise.all(legacyTop.map(async ({ work }) => [work.id, await readLegacyIndexed(work)] as const)))
  const format = (row: Scored, method: 'A' | 'B' | 'C' | 'maximum' | 'legacy' | 'detail') => {
    const { work } = row
    const details = method === 'legacy' ? topLegacyData.get(work.id) : candidateDetails.get(work.id)
    const basis = details?.chunks[method === 'maximum' ? row.maxBasis : method === 'A' || method === 'legacy' ? row.aBasis : row.bBasis]
    const fit = method === 'C' ? evaluation.assessed.get(work.id) : undefined
    const preliminary = shortlistRows.find((entry) => entry.work.id === work.id)?.preRerank ?? row.b
    return { workId: work.id, ...display(work), catalogTitle: work.title, subtitle: work.subtitle, author: work.author,
      cardUrl: work.cardUrl, ndc: work.ndc, kind: work.kind, bodyChars: row.bodyChars, chunkCount: row.chunkCount,
      bodyHash: details?.bodyHash, availableChunks: details?.availableChunks, source: details?.source,
      semanticScore: method === 'A' || method === 'legacy' ? row.a : method === 'maximum' ? row.max : row.b,
      embeddingMethod: method === 'A' || method === 'legacy' ? 'four-window-top-three-mean' : method === 'maximum' ? 'chunk-max' : 'expanded-top-three-mean',
      finalScore: method === 'C' && evaluation.assessed.size ? rerankScore(preliminary, fit) : method === 'detail' ? preliminary : null,
      dimensionSimilarity: row.dimensions, fit: fit ?? null, basisChunkId: fit?.basisChunkId ?? basis?.id ?? null,
      recommendationReason: fit?.reason ?? (basis ? describeChunk(preference, basis.text) : null),
      reasonBasis: fit ? 'identified-chunk-assessment' : 'measured-chunk-features',
    }
  }
  const methods = { A: a.map((row) => format(row, 'A')), B: b.map((row) => format(row, 'B')), C: c.map((row) => format(row, 'C')) }
  const ranksA = new Map(byA.map(({ work }, index) => [work.id, index + 1]))
  const ranksB = new Map(byB.map(({ work }, index) => [work.id, index + 1]))
  const scoresB = new Map(byB.map((row) => [row.work.id, row]))
  const shortlistPositions = new Map(reranked.map(({ work }, index) => [work.id, index + 1]))
  return {
    top: methods.C, methods, legacyTop: legacyTop.map((row) => format(row, 'legacy')),
    sameLegacyCorpus: bLegacy.map((row) => format(row, 'B')), maximumTop: max.map((row) => format(row, 'maximum')),
    detailTop: deepTop.map((row) => format(row, 'detail')),
    legacyDiagnostics: legacy.map(({ work, a: legacyScore }) => ({ id: work.id, legacyScore, rankA: ranksA.get(work.id) ?? null,
      rankB: ranksB.get(work.id) ?? null, expandedScore: scoresB.get(work.id)?.b ?? null,
      shortlistRank: shortlistPositions.get(work.id) ?? null, fit: evaluation.assessed.get(work.id) ?? null })),
    counts: { ...catalog.counts, indexVersion, indexed, legacyScored: legacy.length, registered: existing.size, scored: pool.length, paratextExcluded,
      dimensionMismatch, chunks, semanticCandidates: firstStage.length, shortlisted: shortlistRows.length,
      reranked: evaluation.assessed.size, failedRerankBatches: evaluation.failedBatches, rejectedAssessments: evaluation.rejected,
      detailTexts, detailWorks: detailed.size, detailStatus, fallbackToSemantic: !evaluation.assessed.size },
    rerankRejections: evaluation.rejections,
    performance: fileMetrics, timing: { indexSetupMs, userEmbeddingMs, searchMs, detailMs, rerankMs }, requests: { bookApis: 0 },
  }
}

export function describeChunk(preference: ReadingPreference, text: string) {
  const wanted = preferenceText(preference)
  const groups = [
    { trait: /謎|推理|探偵|証言/, terms: ['証言', '証拠', '犯人', '事件', '探偵', '手掛かり', '手がかり', '謎'] },
    { trait: /音|声|リズム/, terms: ['音', '声', '響き', '静か'] },
    { trait: /家族|心理|人間関係|会話/, terms: ['家族', '父', '母', '会話', '心', '友人'] },
  ]
  const terms = [...new Set(groups.filter(({ trait }) => trait.test(wanted)).flatMap((group) => group.terms))]
    .filter((term) => text.includes(term)).slice(0, 4)
  if (terms.length) return '類似度が最も高い本文断片に、嗜好と接点のある語「' + terms.join('」「') + '」がある。'
  const sentences = text.split(/[。！？]/u).map((sentence) => [...sentence.trim()].length).filter(Boolean).sort((a, b) => a - b)
  const dialogue = [...text.matchAll(/「/g)].length
  return '類似度が最も高い本文断片では、文の長さの中央値は約' + (sentences[Math.floor(sentences.length / 2)] ?? 0)
    + '文字、会話の開始かぎ括弧は' + dialogue + '箇所。'
}
