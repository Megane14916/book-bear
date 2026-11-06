import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { withDatabase } from '../src/db/client'
import { type AiBinding, AiUnavailable, embeddingModel, languageModel, workersAi } from '../src/integrations/workers-ai'
import {
  embeddingBatchLimit, loadRecommendationCandidates, loadRecommendationHistory, noteLength,
  rankRecommendations, type RecommendationStrategy,
} from '../src/modules/recommendations/service'
import { check, loadDataset, SeedError } from './seed/dataset'
import { measureRanking } from './seed/metrics'

const judgments = z.record(z.string().min(1))
const casesSchema = z.object({
  version: z.string(),
  cases: z.array(z.object({ user: z.string(), relevant: judgments, hardNegatives: judgments, clearNegatives: judgments })).min(10).max(20),
})
const maxInputChars = 300_000
const k = 3
let currentCase: string | undefined

type Note = { content: string }
type Candidate = Note & { id: string }
type Ranking = 'lexical' | 'embedding' | 'llm' | 'embedding-mean'
type Scope = 'fixed' | 'db'
type EvaluationResult = ReturnType<typeof measureRanking> & {
  user: string; scope: Scope; ranker: Ranking; candidateCount: number; historyBooks: number;
  top: string[]; candidateMisses: string[]; rankingMisses: string[]; unjudgedTop3: number;
  dbMs: number; rankingMs: number; embeddingMs: number; llmMs: number;
}
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

function bigrams(text: string) {
  const chars = [...text.slice(0, noteLength).normalize('NFKC').replace(/[\s\p{P}]/gu, '')]
  return new Set(chars.slice(1).map((value, i) => chars[i] + value))
}

function lexical(history: Note[], candidates: Candidate[]) {
  const interests = history.map(({ content }) => bigrams(content))
  const best = new Map<string, number>()
  for (const { id, content } of candidates) {
    const terms = bigrams(content)
    const score = interests.reduce((sum, interest) => sum + [...interest].filter((term) => terms.has(term)).length, 0)
    best.set(id, Math.max(score, best.get(id) ?? 0))
  }
  return [...best].sort(([a, left], [b, right]) => right - left || a.localeCompare(b)).map(([id]) => id)
}

try {
  const [mode, strategy = 'legacy', scope = 'fixed', ...extra] = process.argv.slice(2)
  check(extra.length === 0 && ['lexical', 'embedding', 'llm', 'embedding-mean', 'embeddings', 'compare'].includes(mode)
    && (strategy === 'legacy' || strategy === 'diverse' || strategy === 'balanced') && ['fixed', 'db', 'both'].includes(scope),
  'Use lexical|embedding|llm|embedding-mean|embeddings|compare [legacy|diverse|balanced] [fixed|db|both]')
  const modes: Ranking[] = mode === 'compare' ? ['lexical', 'embedding', 'llm', 'embedding-mean']
    : mode === 'embeddings' ? ['embedding', 'embedding-mean'] : [mode as Ranking]
  const maxCalls = modes.includes('llm') ? 45 : 20
  const scopes: Scope[] = scope === 'both' ? ['fixed', 'db'] : [scope as Scope]
  const port = z.coerce.number().int().min(1).max(65535).parse(process.env.RECOMMENDATION_EVAL_LOCAL_PORT ?? 5433)
  const local = { HYPERDRIVE: { connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` } }
  const dataset = await loadDataset()
  const evaluation = casesSchema.parse(JSON.parse(await readFile(new URL('seed/evaluation.json', import.meta.url), 'utf8')))
  check(evaluation.version === dataset.version, 'Evaluation and dataset versions differ')
  check(new Set(evaluation.cases.map(({ user }) => user)).size === evaluation.cases.length, 'Duplicate evaluation user')
  const users = new Map(dataset.users.map((user) => [user.key, user.localUid]))
  const books = new Map(dataset.books.map((book) => [book.key, book.id]))
  const bookKeys = new Map(dataset.books.map((book) => [book.id, book.key]))
  const shelves = new Map(dataset.shelves.map((shelf) => [shelf.key, shelf]))
  const publicFixtures = dataset.bookmarks.filter((bookmark) => bookmark.visibility === 'public')
  const publicCandidate = new Set(publicFixtures.map((note) => JSON.stringify([books.get(shelves.get(note.shelf)!.book), note.content])))
  const publicHistory = new Set(publicFixtures.map((note) => JSON.stringify([shelves.get(note.shelf)!.user, note.content])))
  const inputs = []
  // Validate every case against the seeded DB before spending any AI quota.
  for (const fixture of evaluation.cases) {
    currentCase = fixture.user
    const uid = users.get(fixture.user)
    check(uid, `Unknown evaluation user: ${fixture.user}`)
    const positiveKeys = Object.keys(fixture.relevant)
    const hardKeys = Object.keys(fixture.hardNegatives)
    const clearKeys = Object.keys(fixture.clearNegatives)
    const keys = [...positiveKeys, ...hardKeys, ...clearKeys]
    check(keys.length >= 10 && keys.length <= 24 && positiveKeys.length && hardKeys.length && clearKeys.length
      && new Set(keys).size === keys.length && keys.every((key) => books.has(key)), `Invalid judgments: ${fixture.user}`)
    const ids = keys.map((key) => books.get(key)!)
    const data = await withDatabase(local, async (db) => {
      const started = performance.now()
      const history = await loadRecommendationHistory(db, uid, strategy as RecommendationStrategy)
      const historyMs = performance.now() - started
      const candidates = new Map<Scope, { rows: Candidate[]; dbMs: number }>()
      for (const type of scopes) {
        const start = performance.now()
        const rows = await loadRecommendationCandidates(db, uid, strategy as RecommendationStrategy, type === 'fixed' ? ids : undefined)
        candidates.set(type, { rows, dbMs: performance.now() - start + historyMs })
      }
      return { history, candidates }
    })
    check(data.history.length && data.history.every(({ content }) => publicHistory.has(JSON.stringify([fixture.user, content]))),
      `Use the unedited seed history: ${fixture.user}`)
    for (const [type, { rows }] of data.candidates) {
      check(rows.every(({ id, content }) => publicCandidate.has(JSON.stringify([id, content]))), `Use the unedited seed candidates: ${fixture.user}`)
      if (type === 'fixed') check(new Set(rows.map(({ id }) => id)).size === ids.length, `Fixed candidate pool missing from DB: ${fixture.user}`)
    }
    inputs.push({ user: fixture.user, ...data, judged: new Set(ids), relevant: new Set(positiveKeys.map((key) => books.get(key)!)),
      negative: new Set(hardKeys.map((key) => books.get(key)!)) })
  }
  currentCase = undefined
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (modes.some((item) => item !== 'lexical')) {
    check(account && /^[a-f0-9]{32}$/i.test(account) && token, 'Cloudflare account ID and Workers AI token are required')
  }
  let calls = 0
  let inputChars = 0
  let neurons = 0
  let meteredCalls = 0
  const AI: AiBinding = { async run(model, input) {
    check(/^@[\w.-]+\/[\w.-]+\/[\w.-]+$/.test(model), 'Invalid Workers AI model ID')
    const chars = Array.isArray(input.text) ? input.text.join('').length : JSON.stringify(input.messages ?? []).length
    if (calls >= maxCalls || inputChars + chars > maxInputChars) throw new AiUnavailable('Evaluation AI budget exhausted')
    calls++
    inputChars += chars
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(10000), redirect: 'error',
    })
    if (!response.ok) throw new AiUnavailable(`Workers AI REST request failed (HTTP ${response.status})`)
    const payload = z.object({ success: z.literal(true), result: z.unknown() }).safeParse(await response.json())
    if (!payload.success) throw new AiUnavailable('Workers AI REST response was unsuccessful or invalid')
    const usage = z.object({ usage: z.object({ neurons: z.number().nonnegative() }) }).safeParse(payload.data.result)
    if (usage.success) { neurons += usage.data.usage.neurons; meteredCalls++ }
    return payload.data.result
  } }
  const embedModel = process.env.RECOMMENDATION_EMBEDDING_MODEL ?? embeddingModel
  const llmModel = process.env.RECOMMENDATION_LLM_MODEL ?? languageModel
  const ai = workersAi({ AI, RECOMMENDATION_EMBEDDING_MODEL: embedModel, RECOMMENDATION_LLM_MODEL: llmModel })
  const results: EvaluationResult[] = []
  for (const fixture of inputs) {
    currentCase = fixture.user
    const startLlm = performance.now()
    const themes = modes.includes('llm') ? (await ai.summarize(fixture.history.map(({ content }) => content.slice(0, noteLength)))).themes : []
    const llmMs = modes.includes('llm') ? performance.now() - startLlm : 0
    const llmHistory = themes.length ? themes.map((content) => ({ content })) : fixture.history
    const vectors = new Map<string, number[]>()
    const startEmbedding = performance.now()
    if (modes.some((item) => item !== 'lexical')) {
      // Cache only within this case. The compared scopes and rankers share identical vectors.
      const history = modes.includes('embedding') || modes.includes('embedding-mean') ? fixture.history : []
      const all = [...history, ...(modes.includes('llm') ? llmHistory : []), ...[...fixture.candidates.values()].flatMap(({ rows }) => rows)]
      const texts = [...new Set(all.map(({ content }) => content.slice(0, noteLength)))]
      for (let start = 0; start < texts.length; start += embeddingBatchLimit) {
        const batch = texts.slice(start, start + embeddingBatchLimit)
        const result = await ai.embed(batch)
        batch.forEach((text, index) => vectors.set(text, result[index]))
      }
    }
    const embeddingMs = modes.some((item) => item !== 'lexical') ? performance.now() - startEmbedding : 0
    const cachedEmbed = async (texts: string[]) => texts.map((text) => vectors.get(text)!)
    for (const [type, { rows, dbMs }] of fixture.candidates) {
      const ids = [...new Set(rows.map(({ id }) => id))]
      for (const ranker of modes) {
        const started = performance.now()
        const ranked = ranker === 'lexical' ? lexical(fixture.history, rows)
          : (await rankRecommendations(ranker === 'llm' ? llmHistory : fixture.history, rows, cachedEmbed, ids.length,
            ranker === 'embedding-mean' ? 'mean' : 'max')).map(({ id }) => id)
        const rankingMs = performance.now() - started
        const missed = [...fixture.relevant].filter((id) => !ids.includes(id))
        results.push({ user: fixture.user, scope: type, ranker, candidateCount: ids.length, historyBooks: new Set(fixture.history.map(({ bookId }) => bookId)).size,
          top: ranked.slice(0, k).map((id) => bookKeys.get(id)!),
          candidateMisses: missed.map((id) => bookKeys.get(id)!),
          rankingMisses: [...fixture.relevant].filter((id) => ids.includes(id) && !ranked.slice(0, k).includes(id)).map((id) => bookKeys.get(id)!),
          unjudgedTop3: ranked.slice(0, k).filter((id) => !fixture.judged.has(id)).length,
          ...measureRanking(ranked, ids, fixture.relevant, fixture.negative),
          dbMs, rankingMs, embeddingMs: ranker === 'lexical' ? 0 : embeddingMs, llmMs: ranker === 'llm' ? llmMs : 0 })
      }
    }
  }
  const summary = scopes.flatMap((type) => modes.map((ranker) => {
    const subset = results.filter((row) => row.scope === type && row.ranker === ranker)
    return { scope: type, ranker, cases: subset.length, meanCandidates: average(subset.map((row) => row.candidateCount)),
      historyBooks: average(subset.map((row) => row.historyBooks)),
      precisionAt1: average(subset.map((row) => row.precisionAt1)), recallAt3: average(subset.map((row) => row.recallAt3)),
      mrr: average(subset.map((row) => row.mrr)), hardNegativeHitRate: average(subset.map((row) => row.hardNegativeHitRate)),
      candidateRecall: average(subset.map((row) => row.candidateRecall)),
      unjudgedTop3: average(subset.map((row) => row.unjudgedTop3)),
      random: { precisionAt1: average(subset.map((row) => row.random.precisionAt1)), recallAt3: average(subset.map((row) => row.random.recallAt3)),
        mrr: average(subset.map((row) => row.random.mrr)), hardNegativeHitRate: average(subset.map((row) => row.random.hardNegativeHitRate)) },
      meanDbMs: average(subset.map((row) => row.dbMs)), meanRankingMs: average(subset.map((row) => row.rankingMs)),
      meanSharedEmbeddingMs: average(subset.map((row) => row.embeddingMs)), meanLlmMs: average(subset.map((row) => row.llmMs)) }
  }))
  console.log(JSON.stringify({ version: evaluation.version, mode, strategy, k,
    models: mode === 'lexical' ? [] : modes.includes('llm') ? [llmModel, embedModel] : [embedModel],
    budget: { maxCalls, maxInputChars, batchLimit: embeddingBatchLimit, noteLength },
    usage: { calls, inputChars, meteredCalls, reportedNeurons: meteredCalls ? neurons : null }, summary, results }, null, 2))
} catch (error) {
  const detail = error instanceof SeedError || error instanceof AiUnavailable
    ? error.message : 'Check the local seed and Workers AI settings.'
  console.error(`Evaluation failed${currentCase ? ` for ${currentCase}` : ''}. ${detail}`)
  process.exitCode = 1
}
