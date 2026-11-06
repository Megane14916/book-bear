import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { inArray, and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { withDatabase } from '../src/db/client'
import { books } from '../src/db/schema'
import { createBookProvider } from '../src/integrations/books'
import { AiUnavailable, embeddingModel, languageModel, workersAi, type AiBinding } from '../src/integrations/workers-ai'
import { loadDataset, check, SeedError } from './seed/dataset'
import { catalogSchema, compareCatalog, inspectGoogleSearch, limits, planSearch, titleAuthor, type Registered } from './external-recommendations/experiment'

const loopback = { HYPERDRIVE: { connectionString: 'postgres://postgres:postgres@127.0.0.1:5433/postgres' } }
const maxInputChars = 20_000
const usageSchema = z.object({ usage: z.object({
  prompt_tokens: z.number().nonnegative().optional(), completion_tokens: z.number().nonnegative().optional(),
  neurons: z.number().nonnegative().optional(),
}) })

const registered: Registered = async (items) => {
  if (!items.length) return new Set()
  const ids = items.flatMap(({ volumeId }) => volumeId ?? [])
  const isbns = items.flatMap(({ isbn13 }) => isbn13 ?? [])
  const titles = [...new Set(items.flatMap(({ title }) => [title, title.normalize('NFKC')]))]
  const rows = await withDatabase(loopback, (db) => db.select({
    isbn13: books.isbn13, volumeId: books.sourceId, source: books.source, title: books.title, author: books.author,
  }).from(books).where(or(
    ids.length ? and(eq(books.source, 'google_books'), inArray(books.sourceId, ids)) : undefined,
    isbns.length ? inArray(books.isbn13, isbns) : undefined,
    inArray(books.title, titles),
  )))
  return new Set(items.filter((book) => rows.some((row) =>
    (book.volumeId && row.source === 'google_books' && book.volumeId === row.volumeId)
    || (book.isbn13 && book.isbn13 === row.isbn13)
    || (titleAuthor(book) && titleAuthor(book) === titleAuthor(row)))))
}

function mockRun(input: Record<string, unknown>) {
  if (Array.isArray(input.text)) {
    return { data: input.text.map((item: string) => {
      const vector = Array<number>(64).fill(0)
      for (const char of item) vector[char.codePointAt(0)! % vector.length]++
      return vector
    }) }
  }
  const { messages } = input as { messages: { content: string }[] }
  const request = JSON.parse(messages[1].content.replace(/^\/no_think\n/, ''))
  return { response: Array.isArray(request)
    ? { interests: ['証言が食い違う推理小説', '読者が手掛かりを検証できる仕掛け'],
      queries: ['探偵小説 証言', '密室 推理', '心理 謎'], kind: 'fiction' }
    : { ranking: request.books.map(({ index }: { index: number }) => ({ index, reason: 'モックが返した検証用の理由' })).reverse() } }
}

try {
  const [mode, user, flag, ...extra] = process.argv.slice(2)
  check(user && !extra.length && ((mode === 'mock' && flag === undefined)
    || ((mode === 'catalog' || mode === 'google') && flag === '--execute')),
  'Use mock <seed-user> or catalog|google <seed-user> --execute')
  const dataset = await loadDataset()
  check(dataset.users.some((row) => row.key === user && !row.anonymous), 'Select a registered seed user')
  const shelfIds = new Set(dataset.shelves.filter((shelf) => shelf.user === user).map((shelf) => shelf.key))
  const notes = dataset.bookmarks.filter((note) => shelfIds.has(note.shelf) && note.visibility === 'public')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limits.notes).map(({ content }) => content)
  check(notes.length, 'No public seed bookmarks for this user')
  const catalog = mode === 'google' ? [] : catalogSchema.parse(JSON.parse(
    await readFile(new URL('external-recommendations/catalog.json', import.meta.url), 'utf8'),
  ))

  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  const booksKey = process.env.GOOGLE_BOOKS_API_KEY?.trim()
  if (mode !== 'mock') {
    check(account && /^[a-f0-9]{32}$/i.test(account) && token, 'Approved Workers AI account ID and API token are required')
    if (mode === 'google') check(booksKey, 'An approved Google Books API key is required')
    // Fail before spending quota if the read-only Book Bear registry is unavailable.
    await withDatabase(loopback, (db) => db.select({ id: books.id }).from(books).limit(1))
  }
  const maxCalls = mode === 'google' ? 1 : 3
  const usage = { calls: 0, inputChars: 0, reportedPromptTokens: 0, reportedCompletionTokens: 0,
    reportedNeurons: 0, tokenMeteredCalls: 0, neuronMeteredCalls: 0 }
  const binding: AiBinding = { async run(model, input) {
    const chars = JSON.stringify(input).length
    if (usage.calls >= maxCalls || usage.inputChars + chars > maxInputChars) throw new AiUnavailable('Experiment AI budget exhausted')
    usage.calls++
    usage.inputChars += chars
    if (mode === 'mock') return mockRun(input)
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(15000), redirect: 'error',
    })
    if (!response.ok) throw new AiUnavailable(`Workers AI REST request failed (HTTP ${response.status})`)
    const body = z.object({ success: z.literal(true), result: z.unknown() }).safeParse(await response.json())
    if (!body.success) throw new AiUnavailable('Workers AI returned an unsuccessful response')
    const metered = usageSchema.safeParse(body.data.result)
    if (metered.success) {
      const { prompt_tokens, completion_tokens, neurons } = metered.data.usage
      usage.reportedPromptTokens += prompt_tokens ?? 0
      usage.reportedCompletionTokens += completion_tokens ?? 0
      usage.reportedNeurons += neurons ?? 0
      if (prompt_tokens !== undefined || completion_tokens !== undefined) usage.tokenMeteredCalls++
      if (neurons !== undefined) usage.neuronMeteredCalls++
    }
    return body.data.result
  } }
  const ai = workersAi({ AI: binding }, 15000)
  const start = performance.now()
  const plan = await planSearch(ai, notes)
  const planMs = Math.round(performance.now() - start)
  const outcome = mode === 'google'
    ? await inspectGoogleSearch(plan, createBookProvider(fetch, booksKey).searchJapanese, registered)
    : await compareCatalog(plan, catalog, ai, mode === 'mock' ? async () => new Set() : registered)
  console.log(JSON.stringify({ reportVersion: 1, mode, simulated: mode === 'mock', seedVersion: dataset.version, user,
    models: mode === 'mock' ? [] : mode === 'google' ? [languageModel] : [languageModel, embeddingModel],
    attribution: mode === 'google' ? 'Google Books search results — https://books.google.com/' : '青空文庫の書誌を参照した独立カタログ',
    limits: { ...limits, maxCalls, maxInputChars }, plan, planMs, ...outcome,
    usage: { ...usage, reportedPromptTokens: usage.tokenMeteredCalls ? usage.reportedPromptTokens : null,
      reportedCompletionTokens: usage.tokenMeteredCalls ? usage.reportedCompletionTokens : null,
      reportedNeurons: usage.neuronMeteredCalls ? usage.reportedNeurons : null },
    durationMs: Math.round(performance.now() - start),
  }, null, 2))
} catch (error) {
  const detail = error instanceof SeedError || error instanceof AiUnavailable ? error.message : 'Check the local registry, credentials, and provider availability.'
  console.error(`External recommendation experiment failed. ${detail}`)
  process.exitCode = 1
}
