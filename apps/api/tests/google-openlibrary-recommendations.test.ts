import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { catalogSchema, planSearch } from '../scripts/external-recommendations/experiment'
import { createGoogleOpenLibraryMock } from '../scripts/external-recommendations/google-openlibrary-mock'
import { matchOpenLibrary, rankGoogleOpenLibrary, readingLogScore, runGoogleOpenLibrary } from '../scripts/external-recommendations/google-openlibrary-experiment'
import { createBookProvider } from '../src/integrations/books'
import { lookupOpenLibrary } from '../src/integrations/open-library'
import { workersAi } from '../src/integrations/workers-ai'

const firstIsbn = '9780451526533'
const secondIsbn = '9780140328721'
const volume = { id: 'one', volumeInfo: { title: 'The Adventures of Tom Sawyer', authors: ['Mark Twain'], language: 'ja',
  categories: ['Fiction'], publishedDate: '2000', industryIdentifiers: [
    { type: 'ISBN_13', identifier: '9780451526534' }, { type: 'ISBN_10', identifier: '0451526538' },
  ] } }
const plan = { queries: ['推理小説 証言'], interests: ['食い違う証言'], kind: 'fiction' as const }

it('extracts valid ISBN-10 from a single Japanese relevance search with at most 40 entries', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ totalItems: 1, items: [volume] }))
  const [book] = await createBookProvider(fetcher, 'test-key').searchJapanese(plan.queries[0], 40)
  expect(book).toMatchObject({ isbn13: firstIsbn, isbn10: '0451526538', publishedDate: '2000' })
  const url = new URL(String(fetcher.mock.calls[0][0]))
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ maxResults: '40', langRestrict: 'ja', printType: 'books', orderBy: 'relevance' })
  expect(url.searchParams.get('fields')).not.toContain('description')
})

it('requests both ISBN forms in one batch and only joins an exact identifier and compatible title and author', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ numFound: 4, docs: [
    { key: '/works/OL1W', title: 'Different work', author_name: ['Mark Twain'], isbn: ['0451526538'], readinglog_count: 2500 },
    { key: '/works/OL2W', title: 'Title from another edition', author_name: ['Mark Twain'], isbn: ['0451526538'],
      editions: { docs: [{ title: volume.volumeInfo.title, isbn: [firstIsbn] }] }, readinglog_count: 0, ratings_count: 5 },
    { key: 'OL3W', title: volume.volumeInfo.title, author_name: ['Different author'], isbn: [firstIsbn], readinglog_count: 1000 },
    { key: '/works/OL4W', title: 'Fantastic Mr Fox', isbn: [secondIsbn] },
  ] }))
  const result = await lookupOpenLibrary([firstIsbn, secondIsbn, '9784101010014'], 'Book Bear (contact@example.org)', fetcher)
  expect(result.calls).toBe(1)
  const [url, init] = fetcher.mock.calls[0]
  expect(new URL(String(url)).searchParams.get('q')).toContain('9780451526533 OR 0451526538')
  expect(init?.headers).toEqual({ 'User-Agent': 'Book Bear (contact@example.org)' })
  expect(result.works.get(secondIsbn)?.[0].readinglogCount).toBeNull()
  expect(result.works.has('9784101010014')).toBe(false)
  const [book] = await createBookProvider(async () => Response.json({ totalItems: 1, items: [volume] }), 'test-key').searchJapanese('test', 40)
  const works = result.works.get(firstIsbn)!
  expect(matchOpenLibrary(book!, works)).toMatchObject({ status: 'matched', work: { id: 'OL2W', readinglogCount: 0, ratingsCount: 5 } })
  expect(matchOpenLibrary(book!, [works[0], works[2]]).status).toBe('metadata-mismatch')
  expect(matchOpenLibrary(book!, [works[1], { ...works[1], id: 'OL5W' }]).status).toBe('ambiguous')
  expect(matchOpenLibrary(book!, result.works.get(secondIsbn)!).status).toBe('missing')
})

it('bounds Open Library requests and returns unavailable, rate-limited and truncated states without retrying', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ numFound: 101, docs: [] }))
    .mockResolvedValueOnce(Response.json({ invalid: true }))
  for (const status of ['unavailable', 'rate-limited', 'truncated', 'invalid-response']) {
    expect(await lookupOpenLibrary([firstIsbn], undefined, fetcher)).toMatchObject({ status, calls: 1, works: new Map() })
  }
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(await lookupOpenLibrary([], undefined, fetcher)).toMatchObject({ calls: 0, status: 'skipped' })
})

it('adds a bounded bonus without penalizing zero or missing counts or admitting low relevance', () => {
  expect(readingLogScore(0)).toBe(0)
  expect(readingLogScore(null)).toBeNull()
  expect(readingLogScore(10 ** 6)).toBe(1)
  const books = [
    { googleSearchRank: 1, semanticScore: 0.85, popularityScore: null },
    { googleSearchRank: 2, semanticScore: 0.79, popularityScore: 1 },
    { googleSearchRank: 3, semanticScore: 0.68, popularityScore: 1 },
    { googleSearchRank: 4, semanticScore: null, popularityScore: 1 },
    { googleSearchRank: 5, semanticScore: 0.75, popularityScore: 0 },
  ]
  expect(rankGoogleOpenLibrary(books, 0.05).map(({ googleSearchRank }) => googleSearchRank)).toEqual([1, 2, 5, 3])
  expect(rankGoogleOpenLibrary(books, 0.10).map(({ finalScore }) => Number(finalScore.toFixed(2)))).toEqual([0.89, 0.85, 0.75, 0.68])
})

it('runs provider-shaped mocks and keeps unapproved introductions and Google fields out of AI input', async () => {
  const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL('../scripts/external-recommendations/catalog.json', import.meta.url), 'utf8')))
  const fixture = createGoogleOpenLibraryMock(catalog)
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    if (Array.isArray(input.text)) return { data: input.text.map(() => [1, 0]) }
    const messages = input.messages as { content: string }[]
    const data = JSON.parse(messages[1].content.replace(/^\/no_think\n/, ''))
    return { response: Array.isArray(data) ? plan : { reasons: data.books.map(({ index }: { index: number }) => ({ index, reason: '資料に共通点がある' })) } }
  })
  const ai = workersAi({ AI: { run } })
  const extracted = await planSearch(ai, ['公開栞'], 'google-openlibrary')
  expect(extracted.queries).toEqual(plan.queries)
  const result = await runGoogleOpenLibrary(extracted, { ...fixture, ai, catalog,
    registered: async (books) => new Set(books.filter(({ volumeId }) => volumeId === 'mock-shinri')) })
  expect(result.googleSearchOrder).toHaveLength(14)
  expect(result.candidateGeneration).toMatchObject({ duplicates: 1, offTopic: 1, registered: 1,
    openBd: { descriptionsEmbedded: 1, permissionConfirmed: 1 } })
  expect(result.candidates.some(({ openBdFound }) => !openBdFound)).toBe(true)
  expect(result.methods.A).toHaveLength(10)
  expect(result.methods.B[0].recommendationReason).toBe('資料に共通点がある')
  expect(result.requests).toEqual({ googleBooks: 1, openLibrary: 1, openBd: 1 })
  const inputs = JSON.stringify(run.mock.calls)
  expect(inputs).toContain('モック用の独自文章')
  expect(inputs).not.toMatch(/許諾未確認の模擬紹介文|mock-yabu|googleSearchRank|readinglogCount/)
  expect(run).toHaveBeenCalledTimes(3)

  const missing = await runGoogleOpenLibrary(extracted, { ...fixture, permissions: {}, ai, catalog: [], registered: async () => new Set() })
  expect(missing.embedding.status).toBe('no-evidence')
  expect(missing.candidates.every(({ semanticScore }) => semanticScore === null)).toBe(true)
  expect(missing.methods).toEqual({ A: [], B: [], C: [] })
  expect(run).toHaveBeenCalledTimes(3)
})
