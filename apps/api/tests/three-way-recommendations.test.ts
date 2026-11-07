import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { afterAll, expect, it, vi } from 'vitest'
import { parseAozoraCsv } from '../scripts/external-recommendations/aozora-catalog'
import { cleanAozoraText, indexAozora, planAozoraIndex, prepareAozora, readIndexed, selectAozoraWorks } from '../scripts/external-recommendations/aozora-index'
import { adjustedMean, aggregateChunks, diverseAozoraTop, runAozoraRecommendation } from '../scripts/external-recommendations/aozora-experiment'
import { assessAozora, rerankScore } from '../scripts/external-recommendations/aozora-rerank'
import { readJson, stateDir, writeJson } from '../scripts/external-recommendations/local-state'
import { loadPreference, type ReadingPreference } from '../scripts/external-recommendations/reading-preference'
import { proposalGroup, runDirectRecommendation, runNdlRecommendation, verifyProposal } from '../scripts/external-recommendations/ndl-experiment'
import { createNdlProvider, createNdlVerification, parseNdl, parseNdlSru } from '../src/integrations/ndl'
import { workersAi } from '../src/integrations/workers-ai'

vi.mock('../scripts/external-recommendations/local-state', async (importOriginal) => {
  const real = await importOriginal<typeof import('../scripts/external-recommendations/local-state')>()
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { ...real, stateDir: await mkdtemp(join(tmpdir(), 'book-bear-three-ways-')) }
})
afterAll(async () => {
  if (resolve(dirname(stateDir)) === resolve(tmpdir()) && basename(stateDir).startsWith('book-bear-three-ways-')) {
    await rm(stateDir, { recursive: true, force: true })
  }
})

const preference: ReadingPreference = { interests: ['伏線'], preferredGenres: ['推理小説'], preferredThemes: ['謎解き'],
  preferredStyle: ['論理的な展開'], kind: 'fiction' }
const notRegistered = async () => new Set<never>()
const columns = '作品ID,作品名,図書カードURL,作品著作権フラグ,人物ID,役割フラグ,分類番号,テキストファイルURL,人物著作権フラグ,没年月日,最終更新日,姓,名,副題,原題'
function row(id: number, person: number, { role = '著者', death = '1910-01-01', copyright = 'なし', workRights = 'なし', ndc = '913' } = {}) {
  return [String(id).padStart(6, '0'), '本の題' + id, 'https://www.aozora.gr.jp/cards/000001/card' + id + '.html', workRights,
    String(person).padStart(6, '0'), role, 'NDC ' + ndc, 'https://www.aozora.gr.jp/cards/000001/files/' + id + '.zip',
    copyright, death, '2020-01-01', '作家', person, '', ''].join(',')
}
const source = { identifier: '000001_000001', url: 'https://soranoha.org/works/000001_000001/', filename: 'file.txt',
  release: 'a'.repeat(64), sourceHash: 'sha256:' + 'b'.repeat(64) }
const catalogZip = (rows: string[]) => zipSync({ 'list_person_all_extended_utf8.csv': strToU8('\uFEFF' + [columns, ...rows].join('\r\n')) })

it('reads all UTF-8 CSV rows from ZIP, groups people and conservatively checks public-domain translations', () => {
  const catalog = parseAozoraCsv(catalogZip([row(1, 1), row(1, 1), row(2, 2, { ndc: '933' }),
    row(2, 3, { ndc: '933', role: '翻訳者', copyright: 'あり' }), row(3, 3, { workRights: '' }), row(4, 4, { death: '' }),
    row(5, 5, { ndc: '933' }), row(5, 6, { ndc: '933', role: '翻訳者' }), row(6, 6, { ndc: '914' })]), new Date('2026-11-07'))
  expect(catalog.counts).toMatchObject({ rows: 9, works: 6, eligible: 2 })
  expect(catalog.works[0]).toMatchObject({ id: '000001', title: '本の題1', author: '作家1', people: [{ id: '000001' }] })
  expect(catalog.works[1].people.map(({ role }) => role)).toEqual(['著者', '翻訳者'])
  expect(catalog.works.map(({ rightsConfirmed }) => rightsConfirmed)).toEqual([true, false, false, false, true, true])
  expect(() => parseAozoraCsv(zipSync({ 'other.csv': strToU8('bad') }))).toThrow('ZIP entry')
})

it('cleans ruby, notes and colophons and keeps stable chunk IDs with two aggregation methods', () => {
  expect(cleanAozoraText('　｜東京《とうきょう》へ※［＃外字］\r\n\r\n底本：例')).toBe('東京へ')
  const text = prepareAozora('000001', '長い本文。'.repeat(800), source)!
  expect(text.chunks).toHaveLength(4)
  expect(text.chunks[0]).toMatchObject({ id: '000001:0' })
  expect(text.chunks.every(({ text }) => [...text].length <= 720)).toBe(true)
  expect(prepareAozora('000001', '短い', source)).toBeNull()
  expect(aggregateChunks([0.8, 0.2, 0.4, 0.6]).mean).toBeCloseTo(0.6)
  expect(aggregateChunks([0.8, 0.2, 0.4, 0.6]).max).toBe(0.8)
  const expanded = prepareAozora('000001', '長い本文。'.repeat(1500), source, 8)!
  expect(expanded.chunks).toHaveLength(8)
  expect(expanded.chunks.slice(0, 4)).toEqual(prepareAozora('000001', '長い本文。'.repeat(1500), source)!.chunks)
  expect(new Set(expanded.chunks.map(({ id }) => id)).size).toBe(8)
  expect(adjustedMean(Array(8).fill(0.6))).toBeLessThan(adjustedMean(Array(4).fill(0.6)))
})

it('resumes committed batches, records failures, and only embeds query inputs without a focus archive', async () => {
  const catalog = parseAozoraCsv(catalogZip(Array.from({ length: 9 }, (_, i) => row(i + 1, i + 1))))
  const names = selectAozoraWorks(catalog)
  const metadata = names.map((work) => [work.id + '_' + work.people[0].id, work.title, '', work.id + '.txt',
    source.release, source.sourceHash].join(','))
  const archive = zipSync({ 'catalog.csv': strToU8(['identifier,title,subtitle,filename,release,source_content_hash', ...metadata].join('\n')),
    ...Object.fromEntries(names.map((work) => [work.id + '.txt', strToU8((work.title + '　本の本文。').repeat(200))])) })
  const input = { key: 'test-archive', read: vi.fn(async () => archive) }
  const embed = vi.fn(async (input: string[]) => input.map(() => [1, 0])).mockImplementationOnce(async (input) => input.map(() => [1, 0]))
    .mockRejectedValueOnce(new Error('unavailable'))
  expect(await indexAozora(names, input, embed)).toMatchObject({ indexed: 6, failed: 3, stopped: 'unavailable' })
  expect(await readdir(join(stateDir, 'aozora-index-v2'))).toHaveLength(6)
  expect((await planAozoraIndex(catalog, input)).state).toMatchObject({ indexed: 6, pending: 0, failures: { 'ai-error': 3 } })
  const retry = await planAozoraIndex(catalog, input, true)
  expect(await indexAozora(retry.queue, input, embed)).toMatchObject({ indexed: 3, calls: 1 })
  expect((await planAozoraIndex(catalog, input)).state).toMatchObject({ indexed: 9, pending: 0, failed: 0 })
  expect(input.read).toHaveBeenCalledTimes(2)
  expect(await readIndexed(names[0])).toMatchObject({ id: names[0].id, vectors: expect.any(Array) })
  expect(await readIndexed({ ...names[0], rightsConfirmed: false })).toBeUndefined()
  await writeJson(join(stateDir, 'aozora-catalog.json'), catalog)
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    if (Array.isArray(input.text)) return { data: input.text.map(() => [1, 0]) }
    const messages = input.messages as { content: string }[]
    const { books } = JSON.parse(messages[1].content.replace(/^\/no_think\n/, ''))
    return { response: { assessments: books.map(({ workId, passages }: { workId: string; passages: { key: string }[] }) =>
      ({ workId, evidence: workId === 'W000002' ? 'W000001E1' : passages[0].key,
        genreFit: '3', themeFit: '4', styleFit: 'unknown', narrativeFit: '3', overallFit: '4', confidence: 'medium' })) } }
  })
  const result = await runAozoraRecommendation(preference, workersAi({ AI: { run } }), notRegistered)
  expect(result.top).toHaveLength(9)
  expect(run.mock.calls[0][1]).toMatchObject({ text: expect.arrayContaining([expect.stringContaining('推理小説')]) })
  expect(run).toHaveBeenCalledTimes(3)
  expect(result.top[0]).toMatchObject({ basisChunkId: expect.stringMatching(/^\d+:\d+$/), fit: { themeFit: 4, styleFit: null } })
  expect(result.top.find(({ workId }) => workId === '000002')?.reasonBasis).toBe('measured-chunk-features')
  const path = join(stateDir, 'aozora-index-v2', names[0].id + '.json')
  const saved = await readJson(path) as Record<string, unknown>
  await writeJson(path, { ...saved, model: 'old-model' })
  expect(await readIndexed(names[0])).toBeUndefined()
  await writeJson(path, { ...saved, preprocessingVersion: 1 })
  expect(await readIndexed(names[0])).toBeUndefined()
  const vectorBytes = Buffer.alloc((saved.chunks as unknown[]).length * 3 * 4)
  await writeJson(path, { ...saved, dimension: 3, vectors: vectorBytes.toString('base64') })
  const fallbackAi = workersAi({ AI: { run: async (_model, input) => {
    if (Array.isArray(input.text)) return { data: input.text.map(() => [1, 0]) }
    throw new Error('Model unavailable')
  } } })
  const fallback = await runAozoraRecommendation(preference, fallbackAi, notRegistered)
  expect(fallback.counts).toMatchObject({ dimensionMismatch: 1, fallbackToSemantic: true })
  expect(fallback.methods.C.map(({ workId }) => workId)).toEqual(fallback.methods.B.map(({ workId }) => workId))
  await writeJson(path, saved)
})

it('moves beyond 300 works, keeps author limits out of indexing and tracks rights and archive mismatches', async () => {
  const catalog = parseAozoraCsv(catalogZip([...Array.from({ length: 304 }, (_, index) => row(index + 100, 10)),
    row(404, 10, { workRights: '' }), row(405, 10), row(406, 10)]))
  const works = selectAozoraWorks(catalog)
  expect(works).toHaveLength(306)
  const metadata = works.filter(({ id }) => id !== '000405').map((work) => [work.id + '_000010', work.id === '000406' ? '別の題名' : work.title,
    '', 'same.txt', source.release, source.sourceHash].join(','))
  const archive = { key: 'large-mock', read: async () => zipSync({
    'catalog.csv': strToU8(['identifier,title,subtitle,filename,release,source_content_hash', ...metadata].join('\n')),
    'same.txt': strToU8('本文の検証。'.repeat(150)),
  }) }
  const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))
  const first = await planAozoraIndex(catalog, archive)
  expect(await indexAozora(first.queue.slice(0, 200), archive, embed)).toMatchObject({ indexed: 200 })
  const second = await planAozoraIndex(catalog, archive)
  expect(second.queue[0].id).toBe('000300')
  expect(await indexAozora(second.queue, archive, embed)).toMatchObject({ indexed: 104, failed: 2 })
  const final = await planAozoraIndex(catalog, archive)
  expect(final.state).toMatchObject({ indexed: 304, pending: 0, rightsNotConfirmed: 1,
    failures: { 'metadata-mismatch': 1, 'text-not-in-archive': 1 } })
  expect(final.queue).toEqual([])
  expect((await planAozoraIndex(catalog, archive, true)).queue.map(({ id }) => id)).toEqual(['000405', '000406'])
}, 20_000)

it('keeps semantic scores when Qwen fails and demotes a grounded genre mismatch', async () => {
  const candidates = [{ id: '1', title: '怪異を描く作品', author: '作家', ndc: '913', semantic: 0.70,
    dimensions: { genre: 0.4, theme: 0.4, style: 0.4, narrative: 0.4 }, evidence: [{ id: '1:0', text: '夜道に幽霊が現れた。' }] }]
  const fail = await assessAozora(preference, candidates, workersAi({ AI: { run: async () => { throw new Error('unavailable') } } }))
  expect(fail.assessed.size).toBe(0)
  expect(rerankScore(0.7, fail.assessed.get('1'))).toBe(0.7)
  expect(rerankScore(0.7, { genreFit: 1, overallFit: 1, confidence: 'high' })).toBeLessThan(
    rerankScore(0.62, { genreFit: 5, overallFit: 5, confidence: 'medium' }),
  )
  const optimistic = workersAi({ AI: { run: async () => ({ response: { assessments: [{
    workId: 'W1', evidence: '1', genreFit: '5', themeFit: '5', styleFit: '5', narrativeFit: '5', overallFit: '5', confidence: 'high',
  }] } }) } })
  const grounded = await assessAozora(preference, candidates, optimistic)
  expect(grounded.assessed.get('1')).toMatchObject({ genreFit: 2, overallFit: 2.5, genreGuard: '幽霊', modelOverallFit: 5 })
  const both = await assessAozora(preference, [{
    ...candidates[0], evidence: [...candidates[0].evidence, { id: '1:30', text: '探偵がアリバイを調べた。' }],
  }], optimistic)
  expect(both.assessed.get('1')).toMatchObject({ genreFit: 5, genreGuard: null })
})

it('applies author and collection limits after sorting and collapses duplicate editions', () => {
  const [base] = selectAozoraWorks(parseAozoraCsv(catalogZip([row(99, 1)])))
  const works = [
    { ...base, id: '1', title: '短編集', subtitle: '01 一作目' },
    { ...base, id: '2', title: '一作目 新装版' },
    { ...base, id: '3', title: '短編集', subtitle: '02 二作目' },
    { ...base, id: '4', title: '別の作品' },
    { ...base, id: '5', title: '短編集', subtitle: '03 三作目', author: '別作家', people: [{ ...base.people[0], id: '000002' }] },
    { ...base, id: '6', title: '作品', author: '第三の作家', people: [{ ...base.people[0], id: '000003' }] },
  ]
  expect(diverseAozoraTop(works.map((work) => ({ work }))).map(({ work }) => work.id)).toEqual(['1', '3', '6'])
})

const rss = (items: string) => '<rss><channel><openSearch:totalResults>2</openSearch:totalResults>' + items + '</channel></rss>'
const record = (id: string, title: string, author: string, isbn = '') => '<item><dc:title>' + title
  + '</dc:title><link>https://ndlsearch.ndl.go.jp/books/R100000002-I' + id + '</link><category>図書</category><dc:creator>' + author
  + '</dc:creator><dc:subject xsi:type="dcndl:NDC10">913.6</dc:subject><dc:subject>推理</dc:subject>'
  + (isbn ? '<dc:identifier xsi:type="dcndl:ISBN">' + isbn + '</dc:identifier>' : '') + '</item>'
const fiction = record('000007890602', '架空のテスト作品', '東野, 圭吾, 1958-', '4-16-323860-3')
const noIsbn = record('000007890603', 'ISBNなし作品', '異なる, 著者')

it('parses national-bibliography RSS, handles ISBN-10 and missing values, and isolates API failures', async () => {
  expect(parseNdl(rss(fiction + noIsbn)).records).toMatchObject([
    { ndlId: '000007890602', isbn13: '9784163238609', author: '東野, 圭吾', subjects: ['推理'], kind: 'fiction' },
    { ndlId: '000007890603', isbn13: null },
  ])
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(rss(fiction)))
    .mockResolvedValueOnce(new Response(null, { status: 429 })).mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
  const search = createNdlProvider(fetcher)
  expect((await search({ cnt: 20, idx: 21, ndc: '913.6' })).received).toBe(1)
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('dpid')).toBe('iss-ndl-opac-national')
  await expect(search({ cnt: 1 })).rejects.toThrow('HTTP 429')
  await expect(search({ cnt: 1 })).rejects.toThrow('timed out')
  expect(() => parseNdl('<!DOCTYPE rss [<!ENTITY boom "bad">]><rss/>')).toThrow('Invalid NDL RSS')
})

it('rejects fuzzy titles and wrong or ambiguous authors, while preserving verified works without ISBN', () => {
  const { records } = parseNdl(rss(fiction + noIsbn))
  expect(verifyProposal({ title: '架空のテスト作品', author: '東野圭吾' }, records).status).toBe('verified')
  expect(verifyProposal({ title: 'テスト作品', author: '東野圭吾' }, records).status).toBe('unverified')
  expect(verifyProposal({ title: '架空のテスト作品', author: '別の著者' }, records).status).toBe('author-mismatch')
  expect(verifyProposal({ title: 'ISBNなし作品', author: '異なる著者' }, records).status).toBe('verified-no-isbn')
  expect(verifyProposal({ title: '架空のテスト作品', author: '東野圭吾' },
    [records[0], { ...records[0], author: '同じ名前の別人', ndlId: '000007890605' }]).status).toBe('ambiguous')
  expect(proposalGroup.safeParse({ books: [{ title: '必須項目なし' }] }).success).toBe(false)
})

it('combines three verification terms in one SRU request and reads escaped DC-NDL RDF', async () => {
  const rdf = '<rdf:RDF><dcndl:BibResource rdf:about="https://ndlsearch.ndl.go.jp/books/R100000002-I000007890602#material">'
    + '<dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book"/><dcterms:title>書名</dcterms:title>'
    + '<dcterms:creator><foaf:Agent><foaf:name>東野, 圭吾, 1958-</foaf:name></foaf:Agent></dcterms:creator>'
    + '<dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">4-16-323860-3</dcterms:identifier>'
    + '<dcterms:subject rdf:resource="http://id.ndl.go.jp/class/ndc10/913.6"/></dcndl:BibResource></rdf:RDF>'
  const xml = '<searchRetrieveResponse><numberOfRecords>1</numberOfRecords><records><record><recordData>'
    + rdf.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</recordData></record></records></searchRetrieveResponse>'
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(xml))
  const found = await createNdlVerification(fetcher)([{ title: '書名', author: '東野圭吾' }, { title: '別の本', author: '別人' }])
  expect(found.records[0]).toMatchObject({ isbn13: '9784163238609', author: '東野, 圭吾', ndc: '913.6' })
  const url = new URL(String(fetcher.mock.calls[0][0]))
  expect(url.pathname).toBe('/api/sru')
  expect(url.searchParams.get('query')).toContain('title any "書名 別の本" AND creator any "東野圭吾 別人"')
  expect(() => parseNdlSru('<searchRetrieveResponse><diagnostics/></searchRetrieveResponse>')).toThrow('diagnostics')
})

it('reuses one preference and deduplicates NDL candidates and repeated model proposals', async () => {
  const proposal = { title: '架空のテスト作品', author: '東野圭吾', fit: 5, reason: '推定の理由', confidence: 'high' }
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    const messages = input.messages as { content: string }[]
    const payload = JSON.parse(messages[1].content.replace(/^\/no_think\n/, ''))
    if (Array.isArray(payload)) return { response: preference }
    if (payload.books) return { response: { items: payload.books.map(({ index }: { index: number }) =>
      ({ index, relevance: 'supported', reason: '件名は推理' })) } }
    return { response: { books: payload.viewpoint.includes('定番') ? [proposal, proposal, { ...proposal, title: '実在不明' }] : [] } }
  })
  const ai = workersAi({ AI: { run } })
  expect(await loadPreference(ai, 'test-user', '2', ['公開栞'])).toMatchObject({ reused: false })
  expect(await loadPreference(ai, 'test-user', '2', ['公開栞'])).toMatchObject({ reused: true, preference })
  expect(run).toHaveBeenCalledTimes(1)
  const search = vi.fn(async () => parseNdl(rss(fiction + noIsbn)))
  const ndl = await runNdlRecommendation(preference, ai, search, notRegistered)
  expect(ndl.counts).toMatchObject({ received: 8, withIsbn: 4, duplicates: 3, ranked: 1 })
  expect(ndl.top).toHaveLength(1)
  const direct = await runDirectRecommendation(preference, ai, search, notRegistered)
  expect(direct.counts).toMatchObject({ generated: 3, unique: 2, verified: 1, verificationRate: 0.5 })
  expect(direct.top).toHaveLength(1)
  expect(direct.verification[1].status).toBe('unverified')
})
