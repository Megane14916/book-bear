import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { isbn10, normalizeIsbn } from './isbn'

export const ndlProvider = 'iss-ndl-opac-national'
export const ndlUrl = 'https://ndlsearch.ndl.go.jp/api/opensearch'
export class NdlError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, textNodeName: 'text' })
const array = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value]
const field = (value: unknown) => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const content = (value: unknown) => typeof value === 'string' ? value.trim() : typeof field(value).text === 'string' ? String(field(value).text).trim() : ''
const strings = (value: unknown) => array(value).map(content).filter(Boolean)
const unique = (values: string[]) => [...new Set(values)]
const authorName = (name: string) => name.replace(/[,，]\s*(?:[0-9]{3,4}|[?？])(?:\s*[-–]\s*[0-9?？]*)?.*$/u, '').trim()

export function literaryKind(title: string, ndc: string | null) {
  if (/文学(?:史|評論|研究)|評論集|小説(?:論|作法|史|研究)|辞典|事典|作品論|解説書/.test(title)) return 'nonfiction'
  if (/^(?:9[1-9]3|909\.3)/.test(ndc ?? '')) return 'fiction'
  return ndc && (/^914/.test(ndc) || !/^9/.test(ndc)) ? 'nonfiction' : 'unknown'
}

export function parseNdl(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new NdlError('Invalid NDL RSS')
  const channel = field(field(parser.parse(xml).rss).channel)
  const total = content(channel['openSearch:totalResults'])
  if (!/^\d+$/.test(total)) throw new NdlError('Missing NDL totalResults')
  const rows = array(channel.item)
  return { total: Number(total), received: rows.length, records: rows.flatMap(parseItem) }
}

function parseItem(value: unknown) {
  const item = field(value)
  const title = content(item['dc:title']) || content(item.title)
  const link = content(item.link) || content(item.guid)
  const ref = /^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/R100000002-I(\d{9,12})$/.exec(link)
  if (!ref || !title || !strings(item.category).includes('図書')) return []
  const identifiers = array(item['dc:identifier']).filter((id) => /^dcndl:ISBN(?:10|13)?$/i.test(String(field(id)['@_xsi:type'])))
  const values = identifiers.map(content)
  const isbns = unique(values.map(normalizeIsbn).filter((id): id is string => id !== null))
  const subjects = array(item['dc:subject'])
  const ndc = subjects.find((subject) => /^dcndl:NDC(?:\d+)?$/.test(String(field(subject)['@_xsi:type'])))
  const classification = content(ndc) || null
  const names = unique(strings(item['dc:creator']).map(authorName).filter(Boolean))
  const credited = [...content(item.author).matchAll(/(?:^|[,，])\s*([^,，]+?)\s+著(?:[,.，、]|$)/gu)].map((match) => match[1])
  const aliases = unique([...names, ...strings(item['dcndl:creatorTranscription']).map(authorName), ...credited])
  const year = /^(18|19|20)\d{2}/.exec(content(item['dcterms:issued']) || content(item['dc:date']))
  return [{
    ndlId: ref[1], title, author: names[0] ?? null, authors: names, authorAliases: aliases, sourceUrl: link,
    isbn13: isbns[0] ?? null, isbn10: values.map(isbn10).find(Boolean) ?? null, isbns,
    publisher: content(item['dc:publisher']) || null, year: year ? Number(year[0]) : null, ndc: classification,
    subjects: unique(subjects.filter((subject) => !/^dcndl:(?:NDC|NDLC)/.test(String(field(subject)['@_xsi:type'])))
      .map(content).filter(Boolean)).slice(0, 6),
    kind: literaryKind(title, classification),
  }]
}
export type NdlBook = ReturnType<typeof parseNdl>['records'][number]

export function parseNdlSru(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new NdlError('Invalid NDL SRU XML')
  const root = field(parser.parse(xml).searchRetrieveResponse)
  const total = content(root.numberOfRecords)
  if (!/^\d+$/.test(total) || root.diagnostics) throw new NdlError('NDL SRU diagnostics or missing result count')
  const entries = array(field(root.records).record)
  const records = entries.flatMap((entry) => {
    const raw = field(entry).recordData
    if (typeof raw === 'string' && /<!DOCTYPE|<!ENTITY/i.test(raw)) return []
    const rdf = field(typeof raw === 'string' ? parser.parse(raw)['rdf:RDF'] : field(raw)['rdf:RDF'])
    return array(rdf['dcndl:BibResource']).flatMap((resource) => {
      const book = field(resource)
      const type = field(book['dcndl:materialType'])['@_rdf:resource']
      if (type !== 'http://ndl.go.jp/ndltype/Book') return []
      const agents = array(book['dcterms:creator']).map((creator) => field(field(creator)['foaf:Agent']))
      const subjects = array(book['dcterms:subject']).map((subject) => {
        const code = /\/class\/ndc(?:\d+)?\/([\d.]+)$/.exec(String(field(subject)['@_rdf:resource']))?.[1]
        return code ? { '@_xsi:type': 'dcndl:NDC', text: code }
          : content(field(field(subject)['rdf:Description'])['rdf:value']) || content(subject)
      })
      return parseItem({
        'dc:title': book['dcterms:title'], link: String(book['@_rdf:about']).replace(/#material$/, ''), category: '図書',
        author: strings(book['dc:creator']).join(','), 'dc:creator': agents.map((agent) => content(agent['foaf:name'])),
        'dcndl:creatorTranscription': agents.map((agent) => content(agent['dcndl:transcription'])),
        'dc:publisher': field(field(book['dcterms:publisher'])['foaf:Agent'])['foaf:name'],
        'dcterms:issued': book['dcterms:issued'],
        'dc:identifier': array(book['dcterms:identifier']).map((id) => ({
          '@_xsi:type': 'dcndl:' + String(field(id)['@_rdf:datatype']).split('/').at(-1), text: content(id),
        })),
        'dc:subject': subjects,
      })
    })
  })
  return { total: Number(total), received: entries.length, records }
}

export function createNdlVerification(fetcher: typeof fetch = fetch) {
  return async (books: { title: string; author: string }[]) => {
    if (!books.length || books.length > 3) throw new NdlError('NDL verification accepts 1–3 proposals')
    const term = (value: string) => value.normalize('NFKC').replace(/["\\\s]+/gu, '')
    const terms = (key: 'title' | 'author') => books.map((book) => term(book[key])).filter(Boolean).join(' ')
    const titles = terms('title')
    const authors = terms('author')
    if (!titles || !authors) throw new NdlError('Invalid NDL verification terms')
    const url = new URL('https://ndlsearch.ndl.go.jp/api/sru')
    url.search = new URLSearchParams({ operation: 'searchRetrieve', version: '1.2', recordSchema: 'dcndl',
      maximumRecords: '30', query: 'dpid="' + ndlProvider + '" AND title any "' + titles + '" AND creator any "' + authors + '"' }).toString()
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12_000), redirect: 'error' })
      if (!response.ok) throw new NdlError('NDL returned HTTP ' + response.status, response.status)
      return parseNdlSru(await response.text())
    } catch (error) {
      if (error instanceof NdlError) throw error
      throw new NdlError('NDL verification failed or timed out')
    }
  }
}

export function createNdlProvider(fetcher: typeof fetch = fetch) {
  return async (params: { title?: string; creator?: string; any?: string; ndc?: string; from?: string; until?: string; cnt: number; idx?: number }) => {
    const url = new URL(ndlUrl)
    url.searchParams.set('dpid', ndlProvider)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(9000), redirect: 'error' })
      if (!response.ok) throw new NdlError('NDL returned HTTP ' + response.status, response.status)
      return parseNdl(await response.text())
    } catch (error) {
      if (error instanceof NdlError) throw error
      throw new NdlError('NDL request failed or timed out')
    }
  }
}
