import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { withDatabase } from '../src/db/client'
import { type AiBinding, AiUnavailable, embeddingModel, languageModel, workersAi } from '../src/integrations/workers-ai'
import { loadRecommendationInput, noteLength, rankRecommendations } from '../src/modules/recommendations/service'
import { check, loadDataset, SeedError } from './seed/dataset'

const casesSchema = z.object({
  version: z.string(),
  cases: z.array(z.object({
    user: z.string(), candidates: z.array(z.string()).min(3), relevant: z.array(z.string()).min(1),
    hardNegatives: z.array(z.object({ book: z.string(), reason: z.string() })),
  })).min(1),
})
const local = { HYPERDRIVE: { connectionString: 'postgres://postgres:postgres@127.0.0.1:5433/postgres' } }
const k = 3
let currentCase: string | undefined

function bigrams(text: string) {
  const chars = [...text.normalize('NFKC').replace(/[\s\p{P}]/gu, '')]
  return new Set(chars.slice(1).map((value, i) => chars[i] + value))
}

try {
  const [mode, ...extra] = process.argv.slice(2)
  check(extra.length === 0 && (mode === 'lexical' || mode === 'embedding' || mode === 'llm'), 'Choose lexical, embedding, or llm')
  const dataset = await loadDataset()
  const evaluation = casesSchema.parse(JSON.parse(await readFile(new URL('seed/evaluation.json', import.meta.url), 'utf8')))
  check(evaluation.version === dataset.version, 'Evaluation and dataset versions differ')
  const users = new Map(dataset.users.map((user) => [user.key, user.localUid]))
  const books = new Map(dataset.books.map((book) => [book.key, book.id]))
  const shelves = new Map(dataset.shelves.map((shelf) => [shelf.key, shelf]))
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (mode !== 'lexical') check(account && /^[a-f0-9]{32}$/i.test(account) && token, 'Cloudflare account ID and Workers AI token are required')
  let calls = 0
  let inputChars = 0
  const AI: AiBinding = { async run(model, input) {
    check(/^@[\w.-]+\/[\w.-]+\/[\w.-]+$/.test(model), 'Invalid Workers AI model ID')
    calls++
    inputChars += Array.isArray(input.text) ? input.text.join('').length : JSON.stringify(input.messages ?? []).length
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(10000), redirect: 'error',
    })
    if (!response.ok) throw new AiUnavailable(`Workers AI REST request failed (HTTP ${response.status})`)
    const payload = z.object({ success: z.literal(true), result: z.unknown() }).safeParse(await response.json())
    if (!payload.success) throw new AiUnavailable('Workers AI REST response was unsuccessful or invalid')
    return payload.data.result
  } }
  const embedModel = process.env.RECOMMENDATION_EMBEDDING_MODEL ?? embeddingModel
  const llmModel = process.env.RECOMMENDATION_LLM_MODEL ?? languageModel
  const ai = workersAi({ AI, RECOMMENDATION_EMBEDDING_MODEL: embedModel, RECOMMENDATION_LLM_MODEL: llmModel })
  const results = []
  for (const fixture of evaluation.cases) {
    currentCase = fixture.user
    const uid = users.get(fixture.user)
    check(uid, `Unknown user: ${fixture.user}`)
    const candidateIds = new Set(fixture.candidates.map((book) => books.get(book)))
    const relevant = new Set(fixture.relevant.map((book) => books.get(book)))
    const negative = new Set(fixture.hardNegatives.map(({ book }) => books.get(book)))
    check(candidateIds.size === fixture.candidates.length && !candidateIds.has(undefined)
      && [...relevant].every((id) => candidateIds.has(id))
      && [...negative].every((id) => candidateIds.has(id) && !relevant.has(id)), `Invalid judgments: ${fixture.user}`)
    const { history, candidates } = await withDatabase(local, (db) => loadRecommendationInput(db, uid))
    const options = candidates.filter((row) => candidateIds.has(row.id))
    check(history.length && new Set(options.map(({ id }) => id)).size === candidateIds.size, `Seed dataset missing from local DB: ${fixture.user}`)
    const publicFixtures = dataset.bookmarks.filter((bookmark) => bookmark.visibility === 'public')
    check(history.every(({ content }) => publicFixtures.some((bookmark) => bookmark.content === content
      && shelves.get(bookmark.shelf)?.user === fixture.user))
      && options.every(({ id, content }) => publicFixtures.some((bookmark) => bookmark.content === content
        && books.get(shelves.get(bookmark.shelf)!.book) === id)), `Use an unedited seed dataset: ${fixture.user}`)
    const started = performance.now()
    const themes = mode === 'llm' ? (await ai.summarize(history.map(({ content }) => content.slice(0, noteLength)))).themes : []
    const ranked = mode === 'lexical'
      ? [...new Set(options.map(({ id }) => id))].map((id) => {
        const score = Math.max(...options.filter((row) => row.id === id).map(({ content }) => {
          const terms = bigrams(content.slice(0, noteLength))
          return history.reduce((sum, note) => sum + [...bigrams(note.content.slice(0, noteLength))]
            .filter((term) => terms.has(term)).length, 0)
        }))
        return { id, score }
      }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k)
      : await rankRecommendations(themes.length ? themes.map((content) => ({ content })) : history, options, ai.embed, k)
    const hits = ranked.filter(({ id }) => relevant.has(id)).length
    results.push({ user: fixture.user, top: ranked.map(({ id }) => dataset.books.find((book) => book.id === id)?.key),
      precision: hits / k, recall: hits / relevant.size, hardNegativeHits: ranked.filter(({ id }) => negative.has(id)).length,
      durationMs: Math.round(performance.now() - started) })
  }
  console.log(JSON.stringify({ version: evaluation.version, mode, k, models: mode === 'lexical' ? [] : mode === 'llm' ? [llmModel, embedModel] : [embedModel],
    calls, inputChars, results }, null, 2))
} catch (error) {
  const detail = error instanceof SeedError || error instanceof AiUnavailable
    ? error.message : 'Check the local seed and Workers AI settings.'
  console.error(`Evaluation failed${currentCase ? ` for ${currentCase}` : ''}. ${detail}`)
  process.exitCode = 1
}
