import { z } from 'zod'
import { normalizeIsbn } from './isbn'

const identifier = z.object({ '@type': z.string(), '@value': z.string() })
const linked = z.object({ '@id': z.string().optional(), 'dc:title': z.string().optional() })
const optionalText = z.string().trim().min(1)
const item = z.object({
  '@id': z.string(), title: optionalText.max(500),
  'dc:creator': z.union([z.array(z.string()), z.string()]).optional(),
  'dc:publisher': z.string().optional(),
  'dc:type': z.string().optional(),
  'dc:identifier': z.array(identifier).optional(),
  'dc:subject': z.array(z.union([z.string(), z.object({ '@value': z.string() })])).optional(),
  'dc:source': z.array(linked).optional(),
  'prism:publicationDate': z.string().optional(),
  'dc:date': z.string().optional(),
})
const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
const searchResults = z.object({ 'opensearch:totalResults': count, items: z.array(z.unknown()).optional() })
const holdingsResults = z.object({ 'opensearch:totalResults': count })
const ncidPattern = /^[A-Z]{2}\d{7}[\dX]$/
export const ciniiLimits = { queries: 3, perQuery: 30, holdings: 20, holdingsConcurrency: 2, searchTimeoutMs: 5000, holdingsTimeoutMs: 3000 }

export type CiniiBook = {
  isbn13: string | null; isbns: string[]; ncid: string | null; title: string; author: string | null
  publisher: string | null; year: number | null; sourceUrl: string; subjects: string[]; nacsisMetadata: boolean
}

function ncidIn(value: string | undefined) {
  return /^https?:\/\/ci\.nii\.ac\.jp\/ncid\/([A-Z]{2}\d{7}[\dX])(?:[/?#.]|$)/i.exec(value ?? '')?.[1]?.toUpperCase() ?? null
}

export function parseCiniiBook(value: unknown): CiniiBook | null {
  const parsed = item.safeParse(value)
  if (!parsed.success) return null
  const book = parsed.data
  if (/journal|periodical|雑誌|逐次刊行/i.test(book['dc:type'] ?? '')) return null
  const types = book['dc:identifier'] ?? []
  const values = (type: string) => types.filter((id) => id['@type'].split(/[:/#]/).at(-1)?.toUpperCase() === type).map((id) => id['@value'])
  const isbns = [...new Set(values('ISBN').map(normalizeIsbn).filter((id): id is string => id !== null))].slice(0, 8)
  const sources = book['dc:source'] ?? []
  const source = sources.find((entry) => ncidIn(entry['@id']))
  const ncid = values('NCID').map((value) => value.trim().toUpperCase()).find((value) => ncidPattern.test(value))
    ?? (source && ncidIn(source['@id'])) ?? ncidIn(book['@id'])
  const crid = /^https?:\/\/cir\.nii\.ac\.jp\/crid\/(\d+)(?:[/?#.]|$)/i.exec(book['@id'])?.[1]
  if (!crid && !ncid) return null
  const authors = book['dc:creator']
  const year = /^(\d{4})/.exec(book['prism:publicationDate'] ?? book['dc:date'] ?? '')?.[1]
  return {
    isbn13: isbns[0] ?? null, isbns, ncid: ncid ?? null, title: book.title,
    author: (Array.isArray(authors) ? authors.join(', ') : authors)?.trim() || null,
    publisher: book['dc:publisher']?.trim() || null, year: year ? Number(year) : null,
    sourceUrl: crid ? `https://cir.nii.ac.jp/crid/${crid}` : `https://ci.nii.ac.jp/ncid/${ncid}`,
    subjects: (book['dc:subject'] ?? []).map((entry) => typeof entry === 'string' ? entry : entry['@value']).filter(Boolean).slice(0, 8),
    // Search is restricted to NACSIS-CAT; require an explicit provenance marker as well.
    nacsisMetadata: Boolean(ncidIn(book['@id']) || (sources.length && sources.every((entry) =>
      ncidIn(entry['@id']) || /^(?:NACSIS[-_ ]CAT(?:\/ILL)?|目録所在情報サービス[（(]NACSIS-CAT\/ILL[）)])$/i.test(entry['dc:title'] ?? '')))),
  }
}

export class CiniiProviderError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

export function createCiniiProvider(appId: string, fetcher: typeof fetch = fetch) {
  async function get(path: string, params: Record<string, string>, timeoutMs: number) {
    const url = new URL(path, 'https://cir.nii.ac.jp')
    url.search = new URLSearchParams({ ...params, appid: appId, format: 'json' }).toString()
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
      if (!response.ok) throw new CiniiProviderError(`CiNii request failed (HTTP ${response.status})`, response.status)
      return await response.json() as unknown
    } catch (error) {
      if (error instanceof CiniiProviderError) throw error
      throw new CiniiProviderError('CiNii connection, timeout, or JSON error')
    }
  }
  return {
    async search(query: string) {
      const parsed = searchResults.safeParse(await get('/opensearch/v2/books', {
        q: query, count: String(ciniiLimits.perQuery), languageType: 'ja', resourceType: 'book',
        dataSourceType: 'NACSIS_CAT', sortorder: '4',
      }, ciniiLimits.searchTimeoutMs))
      if (!parsed.success || (parsed.data['opensearch:totalResults'] > 0 && !parsed.data.items)) {
        throw new CiniiProviderError('Invalid CiNii book search response')
      }
      return (parsed.data.items ?? []).slice(0, ciniiLimits.perQuery).map(parseCiniiBook)
    },
    async holdings(ncid: string) {
      if (!ncidPattern.test(ncid)) throw new CiniiProviderError('Invalid NCID')
      const parsed = holdingsResults.safeParse(await get('/opensearch/holder', { ncid }, ciniiLimits.holdingsTimeoutMs))
      if (!parsed.success) throw new CiniiProviderError('Invalid CiNii holdings response')
      return parsed.data['opensearch:totalResults']
    },
  }
}
