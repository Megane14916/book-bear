import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { inArray, and, eq, exists, or } from 'drizzle-orm'
import { z } from 'zod'
import { withDatabase } from '../src/db/client'
import { books, userBooks } from '../src/db/schema'
import { createBookProvider } from '../src/integrations/books'
import { ciniiLimits, CiniiProviderError, createCiniiProvider } from '../src/integrations/cinii'
import { lookupOpenBd } from '../src/integrations/openbd-batch'
import { lookupOpenLibrary } from '../src/integrations/open-library'
import { AiUnavailable, embeddingModel, languageModel, workersAi, type AiBinding } from '../src/integrations/workers-ai'
import { loadDataset, check, SeedError } from './seed/dataset'
import { catalogSchema, compareCatalog, inspectGoogleSearch, limits, planSearch, titleAuthor, type Registered } from './external-recommendations/experiment'
import { ciniiPermissions, runCiniiExperiment } from './external-recommendations/cinii-experiment'
import { createCiniiMock } from './external-recommendations/cinii-mock'
import { evidencePermissions } from './external-recommendations/evidence'
import { googleOpenLibraryLimits, runGoogleOpenLibrary } from './external-recommendations/google-openlibrary-experiment'
import { createGoogleOpenLibraryMock } from './external-recommendations/google-openlibrary-mock'

const loopback = { HYPERDRIVE: { connectionString: 'postgres://postgres:postgres@127.0.0.1:5433/postgres' } }
const usageSchema = z.object({ usage: z.object({
  prompt_tokens: z.number().nonnegative().optional(), completion_tokens: z.number().nonnegative().optional(),
  neurons: z.number().nonnegative().optional(),
}) })

const registered = (ownerId?: string): Registered => async (items) => {
  if (!items.length) return new Set()
  const ids = [...new Set(items.flatMap(({ volumeId }) => volumeId ?? []))]
  const isbns = [...new Set(items.flatMap(({ isbn13 }) => isbn13 ?? []))]
  const titles = [...new Set(items.flatMap(({ title }) => [title, title.normalize('NFKC')]))]
  const rows = await withDatabase(loopback, (db) => db.select({
    isbn13: books.isbn13, volumeId: books.sourceId, source: books.source, title: books.title, author: books.author,
  }).from(books).where(and(or(
    ids.length ? and(eq(books.source, 'google_books'), inArray(books.sourceId, ids)) : undefined,
    isbns.length ? inArray(books.isbn13, isbns) : undefined,
    inArray(books.title, titles),
  ), ownerId ? exists(db.select({ id: userBooks.id }).from(userBooks)
    .where(and(eq(userBooks.userId, ownerId), eq(userBooks.bookId, books.id)))) : undefined)))
  return new Set(items.filter((book) => rows.some((row) =>
    (book.volumeId && row.source === 'google_books' && book.volumeId === row.volumeId)
    || (book.isbn13 && book.isbn13 === row.isbn13)
    || (titleAuthor(book) && titleAuthor(book) === titleAuthor(row)))))
}

function mockRun(input: Record<string, unknown>, hybridUser?: string) {
  if (Array.isArray(input.text)) {
    return { data: input.text.map((item: string) => {
      const vector = Array<number>(64).fill(0)
      for (const char of item) vector[char.codePointAt(0)! % vector.length]++
      return vector
    }) }
  }
  const { messages } = input as { messages: { content: string }[] }
  const request = JSON.parse(messages[1].content.replace(/^\/no_think\n/, ''))
  if (hybridUser) {
    if (!Array.isArray(request)) return { response: { reasons: request.books.map(({ index }: { index: number }) =>
      ({ index, reason: 'モックが返した検証用の理由' })) } }
    const samples: Record<string, string[]> = { 'growth-b': ['人物の成長', '心理小説'], 'prose-b': ['文章表現', '文学小説'] }
    const interests = samples[hybridUser] ?? ['食い違う証言', '探偵小説']
    return { response: { interests, queries: [interests.join(' ')], kind: 'fiction' } }
  }
  return { response: Array.isArray(request)
    ? { interests: ['証言が食い違う推理小説', '読者が手掛かりを検証できる仕掛け'],
      queries: ['探偵小説 証言', '密室 推理', '心理 謎'], kind: 'fiction' }
    : { ranking: request.books.map(({ index }: { index: number }) => ({ index, reason: 'モックが返した検証用の理由' })).reverse() } }
}

try {
  const [mode, user, flag, ...extra] = process.argv.slice(2)
  const simulated = mode === 'mock' || mode === 'cinii-mock' || mode === 'google-openlibrary-mock'
  const ciniiMode = mode === 'cinii' || mode === 'cinii-mock'
  const hybrid = mode === 'google-openlibrary' || mode === 'google-openlibrary-mock'
  check(user && !extra.length && ((simulated && flag === undefined)
    || ((mode === 'catalog' || mode === 'google' || mode === 'cinii' || mode === 'google-openlibrary') && flag === '--execute')),
  'Use mock|cinii-mock|google-openlibrary-mock <seed-user> or catalog|google|cinii|google-openlibrary <seed-user> --execute')
  const dataset = await loadDataset()
  const reader = dataset.users.find((row) => row.key === user && !row.anonymous)
  check(reader, 'Select a registered seed user')
  const shelfIds = new Set(dataset.shelves.filter((shelf) => shelf.user === user).map((shelf) => shelf.key))
  const notes = dataset.bookmarks.filter((note) => shelfIds.has(note.shelf) && note.visibility === 'public')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limits.notes).map(({ content }) => content)
  check(notes.length, 'No public seed bookmarks for this user')
  const catalog = mode === 'google' || mode === 'cinii' ? [] : catalogSchema.parse(JSON.parse(
    await readFile(new URL('external-recommendations/catalog.json', import.meta.url), 'utf8'),
  ))

  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  const booksKey = process.env.GOOGLE_BOOKS_API_KEY?.trim()
  const appId = process.env.CINII_APP_ID?.trim()
  if (mode === 'cinii') check(appId, 'Set the application ID from CiNii API registration in CINII_APP_ID')
  const permissionsFile = process.env.CINII_EXPERIMENT_PERMISSIONS_FILE
  const permissions = mode === 'cinii' && permissionsFile ? ciniiPermissions.parse(
    JSON.parse(await readFile(permissionsFile, 'utf8')),
  ) : {}
  if (!simulated) {
    check(account && /^[a-f0-9]{32}$/i.test(account) && token, 'Approved Workers AI account ID and API token are required')
    if (mode === 'google' || hybrid) check(booksKey, 'An approved Google Books API key is required')
    // Fail before spending quota if the read-only Book Bear registry is unavailable.
    await withDatabase(loopback, (db) => db.select({ id: books.id }).from(books).limit(1))
  }
  const hybridPermissionsFile = hybrid && !simulated ? process.env.GOOGLE_OPENLIBRARY_PERMISSIONS_FILE : undefined
  const hybridPermissions = hybridPermissionsFile ? evidencePermissions.parse(JSON.parse(await readFile(hybridPermissionsFile, 'utf8'))) : {}
  const maxInputChars = ciniiMode || hybrid ? 70_000 : 20_000
  const maxCalls = mode === 'google' ? 1 : 3
  const usage = { calls: 0, inputChars: 0, reportedPromptTokens: 0, reportedCompletionTokens: 0,
    reportedNeurons: 0, tokenMeteredCalls: 0, neuronMeteredCalls: 0 }
  const binding: AiBinding = { async run(model, input) {
    const chars = JSON.stringify(input).length
    if (usage.calls >= maxCalls || usage.inputChars + chars > maxInputChars) throw new AiUnavailable('Experiment AI budget exhausted')
    usage.calls++
    usage.inputChars += chars
    if (simulated) return mockRun(input, hybrid ? user : undefined)
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
  const plan = await planSearch(ai, notes, ciniiMode ? 'cinii' : hybrid ? 'google-openlibrary' : undefined)
  const planMs = Math.round(performance.now() - start)
  const seedBookKeys = new Set(dataset.shelves.filter((shelf) => shelf.user === user).map((shelf) => shelf.book))
  const seedOwned = new Set(dataset.books.filter(({ key }) => seedBookKeys.has(key))
    .map(({ title, author }) => titleAuthor({ title, author, volumeId: null, isbn13: null })).filter(Boolean))
  const readerShelf: Registered = async (items) => {
    const existing = simulated ? new Set<Parameters<Registered>[0][number]>() : await registered(reader.localUid)(items)
    for (const item of items) if (seedOwned.has(titleAuthor(item))) existing.add(item)
    return existing
  }
  const ciniiOptions = mode === 'cinii-mock' ? createCiniiMock(catalog) : mode === 'cinii' ? {
    cinii: createCiniiProvider(appId!), openBd: lookupOpenBd, permissions, registered: readerShelf,
  } : null
  const hybridOptions = mode === 'google-openlibrary-mock' ? createGoogleOpenLibraryMock(catalog) : mode === 'google-openlibrary' ? {
    search: createBookProvider(fetch, booksKey).searchJapanese, openLibrary: (isbns: string[]) => lookupOpenLibrary(isbns, process.env.OPEN_LIBRARY_USER_AGENT?.trim()),
    openBd: lookupOpenBd, permissions: hybridPermissions,
  } : null
  const outcome = mode === 'google'
    ? await inspectGoogleSearch(plan, createBookProvider(fetch, booksKey).searchJapanese, registered())
    : hybridOptions ? await runGoogleOpenLibrary(plan, { ...hybridOptions, ai, catalog, registered: readerShelf })
    : ciniiOptions ? await runCiniiExperiment(plan, { ...ciniiOptions, ai })
      : await compareCatalog(plan, catalog, ai, simulated ? async () => new Set() : registered())
  console.log(JSON.stringify({ reportVersion: 1, mode, simulated, seedVersion: dataset.version, user,
    models: simulated ? [] : mode === 'google' ? [languageModel] : [languageModel, embeddingModel],
    attribution: ciniiMode ? { cinii: '国立情報学研究所 CiNii Research / NACSIS-CAT', license: 'https://creativecommons.org/licenses/by/4.0/',
      licenseScope: 'NACSIS-CAT由来と確認した書誌・件名のみ', openBd: 'openBD（照会・書誌補完）',
      metadataTransform: '対象フィールドの連結・長さ制限、ISBN-13正規化' }
      : hybrid ? { google: 'https://books.google.com/', openLibrary: 'https://openlibrary.org/', openBd: 'https://openbd.jp/', scope: 'local-experiment' }
      : mode === 'google' ? 'Google Books search results — https://books.google.com/' : '青空文庫の書誌を参照した独立カタログ',
    limits: { ...limits, ...(ciniiMode ? ciniiLimits : {}), ...(hybrid ? { queries: 1, perQuery: googleOpenLibraryLimits.perQuery,
      candidates: googleOpenLibraryLimits.perQuery } : {}), maxCalls, maxInputChars }, plan, planMs, ...outcome,
    usage: { ...usage, reportedPromptTokens: usage.tokenMeteredCalls ? usage.reportedPromptTokens : null,
      reportedCompletionTokens: usage.tokenMeteredCalls ? usage.reportedCompletionTokens : null,
      reportedNeurons: usage.neuronMeteredCalls ? usage.reportedNeurons : null },
    durationMs: Math.round(performance.now() - start),
  }, null, 2))
} catch (error) {
  const detail = error instanceof SeedError || error instanceof AiUnavailable || error instanceof CiniiProviderError
    ? error.message : 'Check the local registry, credentials, and provider availability.'
  console.error(`External recommendation experiment failed. ${detail}`)
  process.exitCode = 1
}
