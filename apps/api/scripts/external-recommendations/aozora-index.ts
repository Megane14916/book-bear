import { parse } from 'csv-parse/sync'
import { unzipSync } from 'fflate'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { embeddingModel } from '../../src/integrations/workers-ai'
import { type AozoraCatalog, type AozoraWork } from './aozora-catalog'
import { elapsed, readJson, sha256, stateDir, writeJson } from './local-state'
import { normalize } from './experiment'

export const aozoraArchiveUrl = 'https://soranoha.org/bulk/soranoha-plaintext.zip'
export const aozoraArchivePath = join(stateDir, 'soranoha-plaintext.zip')
export const indexLimit = 300
const revision = 1
const chunkSize = 720
const sampleLimit = 4
const batchSize = 8
const archiveLimit = 360_000_000
type Source = { identifier: string; url: string; filename: string; release: string; sourceHash: string }
type Chunk = { id: string; text: string }
type Prepared = { source: Source; bodyHash: string; bodyChars: number; availableChunks: number; chunks: Chunk[] }
export type IndexedWork = Prepared & { id: string; signature: string; model: string; vectors: number[][] }

export function cleanAozoraText(text: string) {
  let body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const rule = /^-{15,}\s*$/gm
  const rules = [...body.matchAll(rule)]
  if (rules.length >= 2 && rules[0].index! < 500) body = body.slice(rules[1].index! + rules[1][0].length)
  return body.split(/^\s*(?:底本[：:]|青空文庫作成ファイル[：:]|このファイルは、インターネットの図書館青空文庫)/m, 1)[0]
    .replace(/※?［＃[^］]*］|《[^》]*》|｜/g, '').replace(/^[ \u3000\t]+|[ \t\u3000]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export function prepareAozora(workId: string, text: string, source: Source): Prepared | null {
  const body = cleanAozoraText(text)
  const chars = [...body]
  if (chars.length < 260) return null
  const availableChunks = Math.ceil(chars.length / chunkSize)
  const count = Math.min(availableChunks, sampleLimit)
  const chunks = Array.from({ length: count }, (_, index) => {
    const offset = count === 1 ? 0 : Math.round(index * (chars.length - chunkSize) / (count - 1))
    return { id: workId + ':' + offset, text: chars.slice(offset, offset + chunkSize).join('') }
  })
  return { source, bodyHash: sha256(body), bodyChars: chars.length, availableChunks, chunks }
}

export function selectAozoraWorks(catalog: AozoraCatalog, limit: number) {
  const list = catalog.works.filter(({ rightsConfirmed, kind }) => rightsConfirmed && kind === 'fiction')
    .map((work) => ({ work, order: sha256('book-bear-aozora-v1:' + work.id) })).sort((a, b) => a.order.localeCompare(b.order))
  const counts = new Map<string, number>()
  const selected = new Map<string, AozoraWork>()
  const add = (work: AozoraWork) => {
    if (selected.has(work.id) || (counts.get(work.author) ?? 0) >= 5) return
    counts.set(work.author, (counts.get(work.author) ?? 0) + 1)
    selected.set(work.id, work)
  }
  for (const { work } of list) {
    if (selected.size >= Math.floor(limit / 5)) break
    if (/探偵|推理|殺人|密室|怪盗|事件|謎/.test(work.title + work.subtitle)) add(work)
  }
  for (const { work } of list) {
    if (selected.size >= limit) break
    add(work)
  }
  return [...selected.values()]
}

function signature(work: AozoraWork) {
  return sha256(JSON.stringify([revision, work.id, work.textUrl, work.revised, work.copyright, work.people]))
}
const indexedPath = (id: string) => join(stateDir, 'aozora-index', id + '.json')
export async function readIndexed(work: AozoraWork) {
  if (!work.rightsConfirmed || !/^\d{1,6}$/.test(work.id)) return undefined
  const record = await readJson(indexedPath(work.id)) as IndexedWork | undefined
  if (record?.id !== work.id || record.model !== embeddingModel || record.signature !== signature(work)
    || !Array.isArray(record.chunks) || !Array.isArray(record.vectors) || !record.vectors.length || record.vectors.length !== record.chunks.length
    || !record.vectors.every((vector) => Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite))) return undefined
  return record
}

function openArchive(bytes: Uint8Array, works: AozoraWork[]) {
  const content = unzipSync(bytes, { filter: ({ name, originalSize }) => name === 'catalog.csv' && originalSize <= 16_000_000 })
  if (!content['catalog.csv']) throw new Error('Missing Soranoha catalog.csv')
  const rows: Record<string, string>[] = parse(new TextDecoder('utf-8', { fatal: true }).decode(content['catalog.csv']),
    { columns: true, bom: true, skip_empty_lines: true })
  const sources = new Map(rows.filter((row) => /^\d{6}_\d{6}$/.test(row.identifier)
    && /^[^\\/]+\.txt$/.test(row.filename) && /^[a-f0-9]{64}$/.test(row.release)
    && /^sha256:[a-f0-9]{64}$/.test(row.source_content_hash))
    .map((row) => [row.identifier, row]))
  const selected = works.flatMap((work) => {
    const ids = work.people.map(({ id }) => work.id.padStart(6, '0') + '_' + id.padStart(6, '0'))
    const row = ids.map((id) => sources.get(id)).find((entry) => entry && normalize(entry.title) === normalize(work.title)
      && normalize(entry.subtitle ?? '') === normalize(work.subtitle))
    return row ? [{ work, source: { identifier: row.identifier, filename: row.filename, release: row.release,
      url: 'https://soranoha.org/works/' + row.identifier + '/', sourceHash: row.source_content_hash } }] : []
  })
  const wanted = new Set(selected.map(({ source }) => source.filename))
  const files = unzipSync(bytes, { filter: ({ name, originalSize }) => wanted.has(name) && originalSize <= 8_000_000 })
  return selected.flatMap(({ work, source }) => {
    if (!files[source.filename]) return []
    try {
      const prepared = prepareAozora(work.id, new TextDecoder('utf-8', { fatal: true }).decode(files[source.filename]), source)
      return prepared ? [{ work, prepared }] : []
    } catch { return [] }
  })
}

export async function indexAozora(catalog: AozoraCatalog, limit: number, embed: (texts: string[]) => Promise<number[][]>,
  readArchive: () => Promise<Uint8Array> = async () => {
    if ((await stat(aozoraArchivePath)).size > archiveLimit) throw new Error('Soranoha ZIP exceeds size limit')
    return readFile(aozoraArchivePath)
  }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > indexLimit) throw new Error('Invalid Aozora index limit')
  const started = performance.now()
  const selected = selectAozoraWorks(catalog, limit)
  const prior = await Promise.all(selected.map(readIndexed))
  const missing = selected.filter((_, index) => !prior[index])
  const prepared = missing.length ? openArchive(await readArchive(), missing) : []
  const preparationMs = elapsed(started)
  let indexed = 0
  let chunks = 0
  let calls = 0
  const embeddingStart = performance.now()
  for (let offset = 0; offset < prepared.length; offset += batchSize) {
    const batch = prepared.slice(offset, offset + batchSize)
    const texts = [...new Set(batch.flatMap(({ prepared: item }) => item.chunks.map(({ text }) => text)))]
    const embedded = await embed(texts)
    if (embedded.length !== texts.length || !embedded.every((vector) => vector.length && vector.every(Number.isFinite))) {
      throw new Error('Invalid Aozora embedding batch')
    }
    calls++
    const vectors = new Map(texts.map((text, index) => [text, embedded[index]]))
    for (const { work, prepared: item } of batch) {
      const record: IndexedWork = { ...item, id: work.id, signature: signature(work), model: embeddingModel,
        vectors: item.chunks.map(({ text }) => vectors.get(text)!) }
      await writeJson(indexedPath(work.id), record)
      indexed++
      chunks += record.chunks.length
    }
  }
  return { selected: selected.length, reused: selected.length - missing.length, bodyPrepared: prepared.length,
    unavailable: missing.length - prepared.length, indexed, chunks, calls, preparationMs, embeddingMs: elapsed(embeddingStart), durationMs: elapsed(started) }
}
