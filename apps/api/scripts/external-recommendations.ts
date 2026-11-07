import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { inArray, and, eq, exists, or } from 'drizzle-orm'
import { withDatabase } from '../src/db/client'
import { books, userBooks } from '../src/db/schema'
import { createBookProvider } from '../src/integrations/books'
import { ciniiLimits, CiniiProviderError, createCiniiProvider } from '../src/integrations/cinii'
import { lookupOpenBd } from '../src/integrations/openbd-batch'
import { lookupOpenLibrary } from '../src/integrations/open-library'
import { AiUnavailable, embeddingModel, languageModel } from '../src/integrations/workers-ai'
import { createNdlProvider, createNdlVerification, NdlError, ndlProvider } from '../src/integrations/ndl'
import { loadDataset, check, SeedError } from './seed/dataset'
import { catalogSchema, compareCatalog, inspectGoogleSearch, limits, planSearch, titleAuthor, type Registered } from './external-recommendations/experiment'
import { ciniiPermissions, runCiniiExperiment } from './external-recommendations/cinii-experiment'
import { createCiniiMock } from './external-recommendations/cinii-mock'
import { evidencePermissions } from './external-recommendations/evidence'
import { googleOpenLibraryLimits, runGoogleOpenLibrary } from './external-recommendations/google-openlibrary-experiment'
import { createGoogleOpenLibraryMock } from './external-recommendations/google-openlibrary-mock'
import { runAozoraRecommendation } from './external-recommendations/aozora-experiment'
import { aozoraCsv } from './external-recommendations/aozora-catalog'
import { runDirectRecommendation, runNdlRecommendation } from './external-recommendations/ndl-experiment'
import { loadPreference } from './external-recommendations/reading-preference'
import { createExperimentAi } from './external-recommendations/rest-ai'

const loopback = { HYPERDRIVE: { connectionString: 'postgres://postgres:postgres@127.0.0.1:5433/postgres' } }

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
  const comparison = ['aozora', 'ndl', 'llm-direct', 'preferences'].includes(mode)
  check(user && !extra.length && ((simulated && flag === undefined)
    || ((mode === 'catalog' || mode === 'google' || mode === 'cinii' || mode === 'google-openlibrary' || comparison) && flag === '--execute')),
  'Use mock|cinii-mock|google-openlibrary-mock <seed-user> or catalog|google|cinii|google-openlibrary|aozora|ndl|llm-direct|preferences <seed-user> --execute')
  const dataset = await loadDataset()
  const reader = dataset.users.find((row) => row.key === user && !row.anonymous)
  check(reader, 'Select a registered seed user')
  const shelfIds = new Set(dataset.shelves.filter((shelf) => shelf.user === user).map((shelf) => shelf.key))
  const notes = dataset.bookmarks.filter((note) => shelfIds.has(note.shelf) && note.visibility === 'public')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limits.notes).map(({ content }) => content)
  check(notes.length, 'No public seed bookmarks for this user')
  const catalog = mode === 'google' || mode === 'cinii' || comparison ? [] : catalogSchema.parse(JSON.parse(
    await readFile(new URL('external-recommendations/catalog.json', import.meta.url), 'utf8'),
  ))

  const booksKey = process.env.GOOGLE_BOOKS_API_KEY?.trim()
  const appId = process.env.CINII_APP_ID?.trim()
  if (mode === 'cinii') check(appId, 'Set the application ID from CiNii API registration in CINII_APP_ID')
  const permissionsFile = process.env.CINII_EXPERIMENT_PERMISSIONS_FILE
  const permissions = mode === 'cinii' && permissionsFile ? ciniiPermissions.parse(
    JSON.parse(await readFile(permissionsFile, 'utf8')),
  ) : {}
  if (!simulated && mode !== 'preferences') {
    if (mode === 'google' || hybrid) check(booksKey, 'An approved Google Books API key is required')
    // Fail before spending quota if the read-only Book Bear registry is unavailable.
    await withDatabase(loopback, (db) => db.select({ id: books.id }).from(books).limit(1))
  }
  const hybridPermissionsFile = hybrid && !simulated ? process.env.GOOGLE_OPENLIBRARY_PERMISSIONS_FILE : undefined
  const hybridPermissions = hybridPermissionsFile ? evidencePermissions.parse(JSON.parse(await readFile(hybridPermissionsFile, 'utf8'))) : {}
  const maxInputChars = ciniiMode || hybrid || comparison ? 70_000 : 20_000
  const maxCalls = mode === 'ndl' ? 6 : mode === 'llm-direct' ? 5 : mode === 'google' || mode === 'preferences' ? 1 : 3
  const { ai, usage } = createExperimentAi(maxCalls, maxInputChars, simulated ? async (_model, input) => mockRun(input, hybrid ? user : undefined) : undefined,
    comparison ? 25_000 : 15_000)
  const start = performance.now()
  const seedBookKeys = new Set(dataset.shelves.filter((shelf) => shelf.user === user).map((shelf) => shelf.book))
  const seedOwned = new Set(dataset.books.filter(({ key }) => seedBookKeys.has(key))
    .map(({ title, author }) => titleAuthor({ title, author, volumeId: null, isbn13: null })).filter(Boolean))
  const readerShelf: Registered = async (items) => {
    const existing = simulated ? new Set<Parameters<Registered>[0][number]>() : await registered(reader.localUid)(items)
    for (const item of items) if (seedOwned.has(titleAuthor(item))) existing.add(item)
    return existing
  }
  if (comparison) {
    const { preference, ...preferenceSource } = await loadPreference(ai, user, dataset.version, notes.map((note) => note.slice(0, limits.noteChars)))
    const ndl = createNdlProvider()
    const result = mode === 'aozora' ? await runAozoraRecommendation(preference, ai, readerShelf)
      : mode === 'ndl' ? await runNdlRecommendation(preference, ai, ndl, readerShelf)
      : mode === 'llm-direct' ? await runDirectRecommendation(preference, ai, createNdlVerification(), readerShelf) : null
    console.log(JSON.stringify({ reportVersion: 1, mode, user, seedVersion: dataset.version, preference, preferenceSource,
      attribution: mode === 'aozora' ? { source: aozoraCsv, catalog: '青空文庫 CC BY 4.0', text: 'Soranoha plaintext' }
        : { source: ndlProvider, catalog: '国立国会図書館 CC BY 4.0' },
      ...result, usage: usage(), durationMs: Math.round(performance.now() - start) }, null, 2))
  } else {
    const plan = await planSearch(ai, notes, ciniiMode ? 'cinii' : hybrid ? 'google-openlibrary' : undefined)
    const planMs = Math.round(performance.now() - start)
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
      usage: usage(),
      durationMs: Math.round(performance.now() - start),
    }, null, 2))
  }
} catch (error) {
  const detail = error instanceof SeedError || error instanceof AiUnavailable || error instanceof CiniiProviderError || error instanceof NdlError
    ? error.message : 'Check the local registry, credentials, and provider availability.'
  console.error(`External recommendation experiment failed. ${detail}`)
  process.exitCode = 1
}
