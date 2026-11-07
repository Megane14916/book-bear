import { parse } from 'csv-parse/sync'
import { unzipSync } from 'fflate'
import { join } from 'node:path'
import { literaryKind } from '../../src/integrations/ndl'
import { readJson, sha256, stateDir, writeJson } from './local-state'

export const aozoraCsv = 'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip'
export const aozoraTerms = 'https://www.aozora.gr.jp/guide/kijyunn.html'
const license = 'https://creativecommons.org/licenses/by/4.0/'
const columns = ['作品ID', '作品名', '図書カードURL', '作品著作権フラグ', '人物ID', '役割フラグ', '分類番号',
  'テキストファイルURL', '人物著作権フラグ', '没年月日', '最終更新日']
type Person = { id: string; name: string; role: string; copyright: string; died: string }
export type AozoraWork = { id: string; title: string; subtitle: string; originalTitle: string; author: string; people: Person[]
  ndc: string | null; kind: ReturnType<typeof literaryKind>; copyright: string; cardUrl: string; textUrl: string | null
  textEncoding: string; revised: string; rightsConfirmed: boolean }

function officialUrl(value: string, path: RegExp) {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && url.hostname === 'www.aozora.gr.jp' && !url.username && !url.password
      && !url.port && !url.search && !url.hash && path.test(url.pathname) ? 'https://www.aozora.gr.jp' + url.pathname : null
  } catch { return null }
}

function publicDomain(work: AozoraWork, year: number) {
  const foreign = Boolean(work.originalTitle || (work.ndc && /^9[2-9]3/.test(work.ndc)))
  if (work.copyright !== 'なし' || !work.textUrl || !work.author
    || (foreign && !work.people.some(({ role }) => role === '翻訳者'))) return false
  return work.people.every((person) => /^\d+$/.test(person.id) && person.copyright === 'なし'
    && Boolean(person.name) && /^(著者|翻訳者|編者|校訂者)$/.test(person.role)
    && /^\d{4}(?:-|$)/.test(person.died) && Number(person.died.slice(0, 4)) <= year - (foreign ? 82 : 71))
}

export function zipEntry(bytes: Uint8Array, name: RegExp, maxSize: number) {
  const files = Object.values(unzipSync(bytes, { filter: ({ name: path, originalSize }) => name.test(path) && originalSize <= maxSize }))
  if (files.length !== 1) throw new Error('Expected exactly one permitted ZIP entry')
  return files[0]
}

export function parseAozoraCsv(bytes: Uint8Array, now = new Date()) {
  const csv = new TextDecoder('utf-8', { fatal: true }).decode(zipEntry(bytes, /^list_person_all_extended_utf8\.csv$/, 24_000_000))
  const rows: Record<string, string>[] = parse(csv, { bom: true, skip_empty_lines: true, columns: (header: string[]) => {
    if (!columns.every((column) => header.includes(column))) throw new Error('Unexpected Aozora CSV header')
    return header
  } })
  const works = new Map<string, AozoraWork>()
  let rejectedRows = 0
  for (const row of rows) {
    const id = row['作品ID']?.trim()
    const title = row['作品名']?.trim()
    const cardUrl = officialUrl(row['図書カードURL'], /^\/cards\/\d+\/card\d+\.html$/)
    if (!/^\d{1,6}$/.test(id) || !title || !cardUrl) { rejectedRows++; continue }
    const person = { id: row['人物ID'], role: row['役割フラグ'], name: [row['姓'], row['名']].filter(Boolean).join(''),
      copyright: row['人物著作権フラグ'], died: row['没年月日'] }
    const textUrl = officialUrl(row['テキストファイルURL'], /^\/cards\/\d+\/files\/[\w-]+\.zip$/)
    const existing = works.get(id)
    if (existing) {
      if (!existing.people.some((entry) => entry.id === person.id && entry.role === person.role
        && entry.copyright === person.copyright && entry.died === person.died)) existing.people.push(person)
      if (existing.title !== title || existing.cardUrl !== cardUrl || existing.textUrl !== textUrl
        || existing.copyright !== row['作品著作権フラグ']) existing.copyright = 'conflict'
      continue
    }
    const ndc = /\bNDC\s+(\d{3}(?:\.\d+)?)/i.exec(row['分類番号'])?.[1] ?? null
    works.set(id, { id, title, subtitle: row['副題'] || '', originalTitle: row['原題'] || '', author: '', people: [person],
      ndc, kind: literaryKind(title, ndc), copyright: row['作品著作権フラグ'], cardUrl, textUrl,
      textEncoding: row['テキストファイル符号化方式'] || '', revised: row['テキストファイル最終更新日'] || row['最終更新日'], rightsConfirmed: false })
  }
  for (const work of works.values()) {
    work.author = [...new Set(work.people.filter(({ role }) => role === '著者').map(({ name }) => name).filter(Boolean))].join('・')
    work.rightsConfirmed = publicDomain(work, now.getUTCFullYear())
  }
  const entries = [...works.values()]
  const fiction = entries.filter(({ kind }) => kind === 'fiction')
  return { version: 1, source: aozoraCsv, attribution: '青空文庫', license, importedAt: now.toISOString(), csvHash: sha256(csv),
    counts: { rows: rows.length, works: entries.length, rejectedRows, fiction: fiction.length, nonFictionOrUnknown: entries.length - fiction.length,
      rightsConfirmed: entries.filter(({ rightsConfirmed }) => rightsConfirmed).length,
      eligible: fiction.filter(({ rightsConfirmed }) => rightsConfirmed).length }, works: entries }
}
export type AozoraCatalog = ReturnType<typeof parseAozoraCsv>
const path = join(stateDir, 'aozora-catalog.json')
export async function loadAozoraCatalog() {
  const data = await readJson(path) as AozoraCatalog | undefined
  if (!data || data.version !== 1 || data.source !== aozoraCsv || !Array.isArray(data.works)) return undefined
  return data
}

export async function importAozora(refresh = false, fetcher: typeof fetch = fetch) {
  const current = refresh ? undefined : await loadAozoraCatalog()
  if (current) return current
  const response = await fetcher(aozoraCsv, { signal: AbortSignal.timeout(25_000), redirect: 'error' })
  if (!response.ok) throw new Error('Aozora CSV returned HTTP ' + response.status)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 16_000_000) throw new Error('Aozora CSV ZIP exceeds size limit')
  const catalog = parseAozoraCsv(bytes)
  await writeJson(path, catalog)
  return catalog
}
