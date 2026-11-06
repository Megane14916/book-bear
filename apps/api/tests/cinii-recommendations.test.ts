import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { createCiniiProvider, parseCiniiBook } from '../src/integrations/cinii'
import { normalizeIsbn } from '../src/integrations/isbn'
import { lookupOpenBd } from '../src/integrations/openbd-batch'
import { workersAi } from '../src/integrations/workers-ai'
import { catalogSchema } from '../scripts/external-recommendations/experiment'
import { deduplicateCinii, popularityScore, runCiniiExperiment, scoreByPopularity } from '../scripts/external-recommendations/cinii-experiment'
import { createCiniiMock } from '../scripts/external-recommendations/cinii-mock'

const firstIsbn = '9780306406157'
const secondIsbn = '9784101010014'
const plan = { interests: ['証言と事件の検証'], queries: ['密室 推理', '証言 探偵小説', '心理 謎'], kind: 'fiction' as const }

function item(ncid: string, id: string, isbn?: string) {
  return {
    '@id': `https://cir.nii.ac.jp/crid/${id}`, title: '書名', 'dc:creator': ['著者'],
    'dc:identifier': [{ '@type': 'cir:NCID', '@value': ncid }, ...(isbn ? [{ '@type': 'ISBN', '@value': isbn }] : [])],
    'dc:source': [{ '@id': `https://ci.nii.ac.jp/ncid/${ncid}`, 'dc:title': 'NACSIS-CAT/ILL' }],
    'dc:subject': ['推理'], 'prism:publicationDate': '1987-03', 'cinii:ownerCount': '999',
  }
}

it('reads CiNii JSON-LD, validates ISBNs and groups editions by ISBN or NCID', () => {
  expect(normalizeIsbn('0-306-40615-2')).toBe(firstIsbn)
  expect(normalizeIsbn('0-306-40615-3')).toBeNull()
  expect(normalizeIsbn(firstIsbn)).toBe(firstIsbn)
  const first = parseCiniiBook(item('BA00000001', '111', '0-306-40615-2'))!
  expect(first).toMatchObject({ isbn13: firstIsbn, ncid: 'BA00000001', author: '著者', title: '書名', year: 1987, nacsisMetadata: true })
  expect(first).not.toHaveProperty('ownerCount')
  const sameIsbn = parseCiniiBook(item('BA00000002', '222', firstIsbn))!
  const sameNcid = parseCiniiBook(item('BA00000001', '333', secondIsbn))!
  expect(deduplicateCinii([first, sameIsbn, sameNcid])).toEqual([{ book: first, aliases: [firstIsbn, secondIsbn] }])
  expect(parseCiniiBook(item('BA00000003', '444'))?.isbn13).toBeNull()
  expect(parseCiniiBook(item('BA8164687X', '555'))?.ncid).toBe('BA8164687X')
  const mixed = { ...item('BA00000001', '111', firstIsbn), 'dc:source': [
    ...item('BA00000001', '111')['dc:source'], { '@id': 'https://example.test/mixed', 'dc:title': 'Other provider' },
  ] }
  expect(parseCiniiBook(mixed)?.nacsisMetadata).toBe(false)
  expect(parseCiniiBook({ title: 1 })).toBeNull()
})

it('uses Research OpenSearch and per-NCID holdings; rejects malformed and timed-out replies', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ 'opensearch:totalResults': '1', items: [item('BA00000001', '111', firstIsbn)] }))
    .mockResolvedValueOnce(Response.json({ 'opensearch:totalResults': '0' }))
    .mockResolvedValueOnce(Response.json({ 'opensearch:totalResults': '' }))
    .mockResolvedValueOnce(Response.json({ 'opensearch:totalResults': '1' }))
    .mockRejectedValueOnce(new DOMException('Timeout', 'TimeoutError'))
  const provider = createCiniiProvider('test-appid', fetcher)
  expect(await provider.search('推理小説')).toHaveLength(1)
  expect(await provider.holdings('BA8164687X')).toBe(0)
  await expect(provider.holdings('BA00000001')).rejects.toThrow('Invalid CiNii holdings response')
  await expect(provider.search('推理小説')).rejects.toThrow('Invalid CiNii book search response')
  await expect(provider.search('推理小説')).rejects.toThrow('timeout')
  const url = new URL(String(fetcher.mock.calls[0][0]))
  expect(url.pathname).toBe('/opensearch/v2/books')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    appid: 'test-appid', count: '30', languageType: 'ja', resourceType: 'book', dataSourceType: 'NACSIS_CAT', format: 'json',
  })
  expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  expect(new URL(String(fetcher.mock.calls[1][0])).pathname).toBe('/opensearch/holder')
})

it('looks up deduplicated ISBNs in one openBD request and ignores null and mismatched rows', async () => {
  const fixture = { summary: { isbn: firstIsbn, title: '書籍' }, onix: { CollateralDetail: { TextContent: [
    { ContentType: '04', Text: '目次' }, { ContentType: '03', Text: '紹介文' },
  ] } } }
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([fixture, null]))
    .mockResolvedValueOnce(Response.json([fixture, fixture]))
    .mockRejectedValueOnce(new DOMException('Timeout', 'TimeoutError'))
    .mockResolvedValueOnce(Response.json({ invalid: true }))
  const input = [firstIsbn, '0-306-40615-2', secondIsbn]
  const result = await lookupOpenBd(input, fetcher)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('isbn')).toBe(`${firstIsbn},${secondIsbn}`)
  expect(result.records.get(firstIsbn)).toMatchObject({ title: '書籍', description: '紹介文' })
  expect(result.records.has(secondIsbn)).toBe(false)
  expect((await lookupOpenBd(input, fetcher)).records.size).toBe(1)
  expect(await lookupOpenBd(input, fetcher)).toMatchObject({ calls: 1, status: 'unavailable' })
  expect(await lookupOpenBd(input, fetcher)).toMatchObject({ calls: 1, status: 'invalid-response' })
})

it('leaves unknown holdings neutral and limits the influence of very large counts', () => {
  expect(popularityScore(null)).toBeNull()
  expect(popularityScore(0)).toBe(0)
  expect(popularityScore(1_000_000)).toBe(popularityScore(1000))
  expect(popularityScore(80)).toBeGreaterThan(0.6)
  const books = [
    { id: 'first', semanticScore: 0.85, popularityScore: null },
    { id: 'second', semanticScore: 0.82, popularityScore: 1 },
    { id: 'off-topic', semanticScore: 0.60, popularityScore: 1 },
  ]
  expect(scoreByPopularity(books, 0).map(({ id }) => id)).toEqual(['first', 'second', 'off-topic'])
  expect(scoreByPopularity(books, 0.2)).toEqual([
    { ...books[1], finalScore: expect.closeTo(0.856) },
    { ...books[0], finalScore: 0.85 },
    { ...books[2], finalScore: 0.60 },
  ])
  expect(scoreByPopularity(books, 0.1).map(({ id }) => id)).toEqual(['first', 'second', 'off-topic'])
})

it('separates description availability from permission and excludes shelved books before inference', async () => {
  const catalog = catalogSchema.parse(JSON.parse(await readFile(
    new URL('../scripts/external-recommendations/catalog.json', import.meta.url), 'utf8',
  )))
  const providers = createCiniiMock(catalog)
  const input = vi.fn(async (_model: string, request: Record<string, unknown>) => ({
    data: (request.text as string[]).map((_, index) => [1, index / 20]),
  }))
  const ai = workersAi({ AI: { run: input } })
  const result = await runCiniiExperiment(plan, { ...providers, ai })
  expect(result.candidateGeneration).toMatchObject({ received: 39, duplicates: 24, offTopic: 3, registered: 1, candidates: 11,
    descriptions: { available: 3, permissionConfirmed: 1, embedded: 1 },
    embeddingSources: { licensed_description: 1, own_content: 1, bibliographic_metadata: 9, none: 0 },
    holdings: { calls: 11, failed: 1, known: 10 } })
  const texts = input.mock.calls.flatMap(([, request]) => request.text as string[])
  expect(new Set(texts).size).toBe(texts.length)
  expect(texts.filter((text) => text.startsWith('模擬紹介文。'))).toHaveLength(1)
  expect(texts.join(' ')).not.toContain('こころ')
  expect(result.methods.A).toHaveLength(10)
  expect(result.methods.B).toHaveLength(10)
  expect(result.methods.C).toHaveLength(10)

  input.mockClear()
  const denied = await runCiniiExperiment(plan, { ...providers, ai, permissions: {} })
  expect(denied.candidateGeneration.descriptions).toMatchObject({ available: 3, permissionConfirmed: 0, embedded: 0 })
  expect(denied.candidateGeneration.embeddingSources.none).toBe(1)
  expect(input.mock.calls.flatMap(([, request]) => request.text as string[]).join(' ')).not.toContain('模擬紹介文。')
})
