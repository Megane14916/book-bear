import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { catalogSchema, compareCatalog, inspectGoogleSearch, limits, planSearch } from '../scripts/external-recommendations/experiment'
import { createBookProvider } from '../src/integrations/books'
import { workersAi } from '../src/integrations/workers-ai'

const plan = { interests: ['事件の手掛かりと食い違う証言'], queries: ['証言 推理小説', '密室 探偵小説'], kind: 'fiction' as const }
const readCatalog = async () => catalogSchema.parse(JSON.parse(await readFile(
  new URL('../scripts/external-recommendations/catalog.json', import.meta.url), 'utf8',
)))

function volume(id: string, title: string, extras: Record<string, unknown> = {}) {
  return { id, volumeInfo: { title, authors: ['テスト著者'], language: 'ja', categories: ['Fiction'], ...extras } }
}

it('preserves provider order while annotating ISBN and volume duplicates, unknown IDs, and exclusions', async () => {
  const fixture = [
    volume('legacy', '書籍A', { industryIdentifiers: [{ type: 'ISBN_10', identifier: '0-306-40615-2' }] }),
    volume('same-isbn', '書籍Aの別表記', { industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780306406157' }] }),
    volume('legacy', '再取得した書籍'),
    volume('missing-isbn', '架空の書籍 Ｂ'),
    volume('missing-isbn-alias', '架空の書籍 B'),
    volume('critical', '推理小説事典', { categories: ['Literary Criticism'] }),
    volume('translated', '別言語', { language: 'en' }),
    volume('existing', '登録済み書籍'),
    volume('unknown', '分類なし', { categories: [] }),
    { id: 'invalid' },
    volume('overflow', '上限外'),
  ]
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ totalItems: fixture.length, items: fixture }))
  const provider = createBookProvider(fetcher, 'mock-key')
  const result = await inspectGoogleSearch(plan, provider.searchJapanese,
    async (items) => new Set(items.filter(({ volumeId }) => volumeId === 'existing')))
  expect(fetcher).toHaveBeenCalledTimes(2)
  for (const [request] of fetcher.mock.calls) {
    const url = new URL(String(request))
    expect(url.origin).toBe('https://www.googleapis.com')
    expect(url.searchParams.get('langRestrict')).toBe('ja')
    expect(url.searchParams.get('printType')).toBe('books')
    expect(url.searchParams.get('orderBy')).toBe('relevance')
    expect(url.searchParams.get('maxResults')).toBe(String(limits.perQuery))
    expect(url.searchParams.get('fields')).not.toContain('description')
  }
  const [first] = result.methods.A.byQuery
  expect(first.top).toHaveLength(10)
  expect(first.top.map(({ status }) => status)).toEqual([
    'eligible', 'duplicate', 'duplicate', 'eligible', 'duplicate', 'kind', 'language', 'registered', 'eligible', 'invalid',
  ])
  expect(first.top[0]).toMatchObject({ searchRank: 1, book: { volumeId: 'legacy', isbn10: '0306406152', isbn13: '9780306406157' } })
  expect(first.top[3]).toMatchObject({ book: { volumeId: 'missing-isbn', isbn13: null } })
  expect(result.candidateGeneration.counts).toMatchObject({ received: 20, eligible: 3, invalid: 2 })
  expect(result.methods.B.status).toBe('blocked-by-content-policy')
  expect(result.methods.C.status).toBe('blocked-by-content-policy')
})

it('compares the same independent catalog candidates, including missing descriptions, in one embedding batch', async () => {
  const catalog = await readCatalog()
  const aiRun = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    if (Array.isArray(input.text)) return { data: input.text.map((_, index) => [1, index]) }
    const messages = input.messages as { content: string }[]
    const { books } = JSON.parse(messages[1].content.replace(/^\/no_think\n/, ''))
    return { response: { ranking: books.reverse().map(({ index }: { index: number }) => ({ index, reason: 'モックの理由' })) } }
  })
  const result = await compareCatalog(plan, catalog, workersAi({ AI: { run: aiRun } }), async () => new Set())
  expect(result.candidateGeneration.booksCalls).toBe(0)
  expect(result.candidateGeneration.eligibleIds).not.toContain('criticism')
  expect(result.methods.A.top).toHaveLength(10)
  expect(result.methods.B.top).toHaveLength(10)
  expect(result.methods.C.top.map(({ book }) => book?.catalogId)).toEqual(result.methods.B.top.map(({ book }) => book?.catalogId).reverse())
  expect(aiRun).toHaveBeenCalledTimes(2)
  expect((aiRun.mock.calls[0][1].text as string[]).length).toBeLessThanOrEqual(49)

  const noDescription = await compareCatalog(plan, catalog.filter(({ id }) => id === 'cat'), workersAi({ AI: { run: aiRun } }), async () => new Set())
  expect(noDescription.candidateGeneration.counts.missingDescription).toBe(1)
  expect(noDescription.methods.B.top[0]).toMatchObject({ evidence: 'metadata-only' })

  aiRun.mockClear()
  const alreadyRegistered = await compareCatalog(plan, catalog, workersAi({ AI: { run: aiRun } }), async (items) => new Set(items))
  expect(alreadyRegistered.candidateGeneration.counts.eligible).toBe(0)
  expect(alreadyRegistered.methods.A.top).toEqual([])
  expect(aiRun).not.toHaveBeenCalled()
})

it('rejects query operators and prevents Qwen from inserting its own candidate IDs', async () => {
  const malicious = workersAi({ AI: { run: async () => ({ response: { ...plan, queries: ['inauthor:誰か', '密室 推理'] } }) } })
  await expect(planSearch(malicious, ['公開栞'])).rejects.toThrow('Invalid LLM output schema')
  const tooMany = workersAi({ AI: { run: async () => ({ response: { ...plan, queries: [...plan.queries, '手掛かり', '探偵小説'] } }) } })
  await expect(planSearch(tooMany, ['公開栞'])).rejects.toThrow('Invalid LLM output schema')
  const catalog = (await readCatalog()).slice(0, 2)
  const ai = workersAi({ AI: { run: async (_model, input) => Array.isArray(input.text)
    ? { data: input.text.map(() => [1]) }
    : { response: { ranking: [{ index: 1, reason: '一冊目' }, { index: 3, reason: '存在しない候補' }] } } } })
  await expect(compareCatalog(plan, catalog, ai, async () => new Set())).rejects.toThrow('Invalid LLM output schema')
})
