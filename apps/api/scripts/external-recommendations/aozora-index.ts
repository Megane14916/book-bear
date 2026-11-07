import { parse } from 'csv-parse/sync'
import { unzipSync } from 'fflate'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { embeddingModel } from '../../src/integrations/workers-ai'
import { type AozoraCatalog, type AozoraWork } from './aozora-catalog'
import { elapsed, readJson, sha256, stateDir, writeJson } from './local-state'
import { normalize } from './experiment'

export const aozoraArchiveUrl = 'https://soranoha.org/bulk/soranoha-plaintext.zip'
export const aozoraArchivePath = join(stateDir, 'soranoha-plaintext.zip')
export const aozoraIndexVersion = 2
export const maxIndexCalls = 650
export const maxIndexInputChars = 24_000_000
const chunkSize = 720
const sampleLimit = 8
const batchSize = 6
const archiveLimit = 360_000_000
const textLimit = 8_000_000
type Source = { identifier: string; url: string; filename: string; release: string; sourceHash: string }
export type Chunk = { id: string; text: string }
type Prepared = { source: Source; bodyHash: string; bodyChars: number; availableChunks: number; baselineCount: number; chunks: Chunk[] }
type Legacy = Omit<Prepared, 'baselineCount'> & { id: string; signature: string; model: string; vectors: number[][] }
type StoredWork = Prepared & { id: string; title: string; author: string; rights: 'confirmed'; signature: string;
  preprocessingVersion: number; model: string; archiveKey: string; indexedAt: string; dimension: number; vectors: string }
export type IndexedWork = Omit<StoredWork, 'vectors'> & { vectors: Float32Array[] }
const reasons = ['text-not-in-archive', 'metadata-mismatch', 'invalid-utf8', 'text-too-short', 'text-size-limit', 'ai-error'] as const
type FailureReason = typeof reasons[number]
type Failure = { id: string; signature: string; archiveKey: string; reason: FailureReason; failedAt: string; bodyMatched: boolean }
type Archive = { key: string; read: () => Promise<Uint8Array> }
const oldPath = (id: string) => join(stateDir, 'aozora-index', id + '.json')
const indexPath = (id: string) => join(stateDir, 'aozora-index-v2', id + '.json')
const failPath = (id: string) => join(stateDir, 'aozora-index-failures', id + '.json')
const activeArchivePath = join(stateDir, 'aozora-active-archive.json')

export function cleanAozoraText(text: string) {
  let body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const rule = /^-{15,}\s*$/gm
  const rules = [...body.matchAll(rule)]
  if (rules.length >= 2 && rules[0].index! < 500) body = body.slice(rules[1].index! + rules[1][0].length)
  return body.split(/^\s*(?:底本[：:]|青空文庫作成ファイル[：:]|このファイルは、インターネットの図書館青空文庫)/m, 1)[0]
    .replace(/※?［＃[^］]*］|《[^》]*》|｜/g, '').replace(/^[ \u3000\t]+|[ \t\u3000]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim()
}

function extraOffsets(last: number, offsets: number[], count: number) {
  const additional: number[] = []
  const taken = [...offsets]
  while (additional.length < count) {
    const sorted = [...taken].sort((a, b) => a - b)
    const gaps = sorted.slice(1).map((end, index) => ({ start: sorted[index], width: end - sorted[index] }))
      .sort((a, b) => b.width - a.width || a.start - b.start)
    if (!gaps.length || gaps[0].width < 480) break
    const next = gaps[0].start + Math.round(gaps[0].width / 2)
    if (next >= last) break
    taken.push(next)
    additional.push(next)
  }
  return additional
}

export function prepareAozora(workId: string, text: string, source: Source, sample = 4): Prepared | null {
  const body = cleanAozoraText(text)
  const chars = [...body]
  if (chars.length < 260) return null
  const availableChunks = Math.ceil(chars.length / chunkSize)
  const baselineCount = Math.min(availableChunks, 4)
  const last = Math.max(0, chars.length - chunkSize)
  const baseline = Array.from({ length: baselineCount }, (_, index) => baselineCount === 1 ? 0 : Math.round(index * last / (baselineCount - 1)))
  const offsets = [...baseline, ...extraOffsets(last, baseline, Math.min(sample, availableChunks) - baselineCount)]
  const chunks = offsets.map((offset) => ({ id: workId + ':' + offset, text: chars.slice(offset, offset + chunkSize).join('') }))
  return { source, bodyHash: sha256(body), bodyChars: chars.length, availableChunks, baselineCount, chunks }
}

export function selectAozoraWorks(catalog: AozoraCatalog) {
  return catalog.works.filter(({ id, rightsConfirmed, kind }) => /^\d{1,6}$/.test(id) && rightsConfirmed && kind === 'fiction')
    .sort((a, b) => Number(a.id) - Number(b.id))
}

function signature(work: AozoraWork, version: number) {
  const original = [version, work.id, work.textUrl, work.revised, work.copyright, work.people]
  return sha256(JSON.stringify(version === 1 ? original : [...original, work.title, work.subtitle, work.author]))
}

export async function readLegacyIndexed(work: AozoraWork) {
  if (!work.rightsConfirmed || !/^\d{1,6}$/.test(work.id)) return undefined
  const record = await readJson(oldPath(work.id)) as Legacy | undefined
  if (record?.id !== work.id || record.model !== embeddingModel || record.signature !== signature(work, 1)
    || !Array.isArray(record.chunks) || !Array.isArray(record.vectors) || !record.vectors.length || record.vectors.length !== record.chunks.length
    || !record.vectors.every((vector) => Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite))) return undefined
  return record
}

async function readStored(work: AozoraWork) {
  if (!work.rightsConfirmed || !/^\d{1,6}$/.test(work.id)) return undefined
  const record = await readJson(indexPath(work.id)).catch((error) => {
    if (error instanceof SyntaxError) return undefined
    throw error
  }) as StoredWork | undefined
  if (record?.id !== work.id || record.model !== embeddingModel || record.preprocessingVersion !== aozoraIndexVersion
    || record.rights !== 'confirmed' || record.signature !== signature(work, aozoraIndexVersion)
    || !Array.isArray(record.chunks) || !record.chunks.length || record.chunks.length > sampleLimit
    || !Number.isInteger(record.baselineCount) || record.baselineCount < 1 || record.baselineCount > record.chunks.length
    || !record.chunks.every((chunk) => chunk && typeof chunk.id === 'string' && chunk.id.startsWith(work.id + ':')
      && typeof chunk.text === 'string' && chunk.text.length > 0)
    || !Number.isInteger(record.dimension) || record.dimension < 1 || record.dimension > 4096
    || typeof record.vectors !== 'string' || typeof record.archiveKey !== 'string'
    || Buffer.byteLength(record.vectors, 'base64') !== record.chunks.length * record.dimension * 4) return undefined
  return record
}

function decode(record: StoredWork): IndexedWork | undefined {
  const bytes = Buffer.from(record.vectors, 'base64')
  if (bytes.length !== record.chunks.length * record.dimension * 4) return undefined
  const vectors = record.chunks.map((_, index) => Float32Array.from({ length: record.dimension },
    (_value, position) => bytes.readFloatLE((index * record.dimension + position) * 4)))
  return vectors.every((vector) => vector.every(Number.isFinite)) ? { ...record, vectors } : undefined
}

export async function readIndexed(work: AozoraWork, archiveKey?: string) {
  const record = await readStored(work)
  return record && (!archiveKey || record.archiveKey === archiveKey) ? decode(record) : undefined
}

export async function indexArchiveKey(works: AozoraWork[]) {
  const active = await readJson(activeArchivePath) as { key?: unknown } | undefined
  if (typeof active?.key === 'string') return active.key
  for (const work of works) {
    const record = await readStored(work)
    if (record) return record.archiveKey
  }
  return undefined
}

export async function localAozoraArchive(): Promise<Archive | undefined> {
  const info = await stat(aozoraArchivePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (!info) return undefined
  if (info.size > archiveLimit) throw new Error('Soranoha ZIP exceeds size limit')
  return { key: info.size + ':' + info.mtimeMs, read: () => readFile(aozoraArchivePath) }
}

type OpenArchive = ReturnType<typeof openArchive>
function openArchive(bytes: Uint8Array) {
  const content = unzipSync(bytes, { filter: ({ name, originalSize }) => name === 'catalog.csv' && originalSize <= 16_000_000 })
  if (!content['catalog.csv']) throw new Error('Missing Soranoha catalog.csv')
  const rows: Record<string, string>[] = parse(new TextDecoder('utf-8', { fatal: true }).decode(content['catalog.csv']),
    { columns: true, bom: true, skip_empty_lines: true })
  const sources = new Map<string, Source & { title: string; subtitle: string }>()
  for (const row of rows) {
    if (typeof row.title !== 'string' || !/^\d{6}_\d{6}$/.test(row.identifier) || !/^[^\\/]+\.txt$/.test(row.filename)
      || !/^[a-f0-9]{64}$/.test(row.release) || !/^sha256:[a-f0-9]{64}$/.test(row.source_content_hash)) continue
    if (sources.has(row.identifier)) throw new Error('Duplicate Soranoha identifier')
    sources.set(row.identifier, { identifier: row.identifier, filename: row.filename, release: row.release,
      url: 'https://soranoha.org/works/' + row.identifier + '/', sourceHash: row.source_content_hash,
      title: row.title, subtitle: row.subtitle ?? '' })
  }
  return { bytes, sources }
}

function archiveTexts(archive: OpenArchive, works: AozoraWork[]) {
  const wanted = new Set<string>()
  const resolved = works.map((work) => {
    const rows = work.people.map(({ id }) => archive.sources.get(work.id.padStart(6, '0') + '_' + id.padStart(6, '0')))
    const match = rows.find((row) => row && normalize(row.title) === normalize(work.title) && normalize(row.subtitle) === normalize(work.subtitle))
    if (!match) return { work, reason: rows.some(Boolean) ? 'metadata-mismatch' as const : 'text-not-in-archive' as const }
    const { title: _title, subtitle: _subtitle, ...source } = match
    wanted.add(source.filename)
    return { work, source }
  })
  const tooLarge = new Set<string>()
  const files = unzipSync(archive.bytes, { filter: ({ name, originalSize }) => {
    if (!wanted.has(name)) return false
    if (originalSize > textLimit) { tooLarge.add(name); return false }
    return true
  } })
  return resolved.map(({ work, source, reason }) => {
    if (!source) return { work, reason: reason! }
    if (tooLarge.has(source.filename)) return { work, reason: 'text-size-limit' as const }
    if (!files[source.filename]) return { work, reason: 'text-not-in-archive' as const }
    try { return { work, source, text: new TextDecoder('utf-8', { fatal: true }).decode(files[source.filename]) } }
    catch { return { work, reason: 'invalid-utf8' as const } }
  })
}

export async function readAozoraFocus(works: { work: AozoraWork; record: IndexedWork; basisChunkId: string }[], archive?: Archive) {
  const focused = new Map<string, Chunk[]>()
  if (!archive || !works.length) return focused
  const matching = new Map(works.filter(({ record }) => record.archiveKey === archive.key).map((entry) => [entry.work.id, entry]))
  if (!matching.size) return focused
  for (const { work, text } of archiveTexts(openArchive(await archive.read()), [...matching.values()].map((entry) => entry.work))) {
    if (!text) continue
    const { record, basisChunkId } = matching.get(work.id)!
    const body = cleanAozoraText(text)
    if (sha256(body) !== record.bodyHash) continue
    const chars = [...body]
    const last = Math.max(0, chars.length - chunkSize)
    const basis = Number(basisChunkId.split(':').at(-1))
    const present = record.chunks.map(({ id }) => Number(id.split(':').at(-1)))
    const offsets = extraOffsets(last, present, sampleLimit).sort((a, b) => Math.abs(a - basis) - Math.abs(b - basis)).slice(0, 2)
    if (offsets.length) focused.set(work.id, offsets.map((offset) => ({ id: work.id + ':' + offset, text: chars.slice(offset, offset + chunkSize).join('') })))
  }
  return focused
}

export async function planAozoraIndex(catalog: AozoraCatalog, archive?: Archive, retryFailed = false) {
  const works = selectAozoraWorks(catalog)
  const archiveKey = archive?.key ?? await indexArchiveKey(works)
  const state = { eligible: works.length, indexed: 0, chunks: 0, legacy: 0, bodyMatched: 0, failed: 0, pending: 0,
    rightsNotConfirmed: catalog.counts.fiction - works.length, failures: Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<FailureReason, number> }
  const queue: AozoraWork[] = []
  for (let offset = 0; offset < works.length; offset += 48) {
    await Promise.all(works.slice(offset, offset + 48).map(async (work) => {
      const legacy = await stat(oldPath(work.id)).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return false
      })
      if (legacy) state.legacy++
      const stored = await readStored(work)
      if (stored && (!archiveKey || stored.archiveKey === archiveKey)) {
        state.indexed++
        state.chunks += stored.chunks.length
        state.bodyMatched++
        return
      }
      const failure = await readJson(failPath(work.id)) as Failure | undefined
      if (failure?.signature === signature(work, aozoraIndexVersion) && (!archiveKey || archiveKey === failure.archiveKey) && reasons.includes(failure.reason)) {
        state.failed++
        state.failures[failure.reason]++
        if (failure.bodyMatched) state.bodyMatched++
        if (retryFailed) queue.push(work)
      } else {
        state.pending++
        if (!retryFailed) queue.push(work)
      }
    }))
  }
  return { state, queue: queue.sort((a, b) => Number(a.id) - Number(b.id)) }
}

export function indexBudget(works: number) {
  const planned = Math.min(works, maxIndexCalls * batchSize, Math.floor(maxIndexInputChars / (sampleLimit * (chunkSize * 2 + 4))))
  const maxTexts = planned * sampleLimit
  return { planned, maxCalls: Math.ceil(planned / batchSize), maxTexts,
    roughTokensAtTwoPerCharacter: maxTexts * chunkSize * 2, inputCharCap: maxIndexInputChars, deferredBySafetyCap: works - planned }
}

export async function withAozoraIndexLock<T>(run: () => Promise<T>) {
  await mkdir(stateDir, { recursive: true })
  const path = join(stateDir, 'aozora-index.lock')
  const lock = await open(path, 'wx').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Aozora indexing lock exists. Check whether the recorded process is still running.')
    throw error
  })
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    return await run()
  } finally {
    await lock.close()
    await rm(path, { force: true })
  }
}

export async function indexAozora(queue: AozoraWork[], archive: Archive, embed: (texts: string[]) => Promise<number[][]>) {
  const started = performance.now()
  const { planned, maxCalls } = indexBudget(queue.length)
  const jobs = queue.slice(0, planned).filter(({ id, rightsConfirmed, kind }) => /^\d{1,6}$/.test(id) && rightsConfirmed && kind === 'fiction')
  const source = jobs.length ? openArchive(await archive.read()) : null
  if (source) await writeJson(activeArchivePath, { key: archive.key })
  let indexed = 0
  let chunks = 0
  let calls = 0
  let failed = 0
  let reusedVectors = 0
  let inputChars = 0
  let embeddingMs = 0
  let stopped: string | null = null
  const fail = async (work: AozoraWork, reason: FailureReason, bodyMatched = false) => {
    failed++
    await writeJson(failPath(work.id), { id: work.id, signature: signature(work, aozoraIndexVersion), archiveKey: archive.key,
      reason, failedAt: new Date().toISOString(), bodyMatched } satisfies Failure)
  }

  for (let offset = 0; source && offset < jobs.length && !stopped; offset += 72) {
    const prepared: { work: AozoraWork; body: Prepared; cached: Map<string, ArrayLike<number>> }[] = []
    for (const { work, text, source: link, reason } of archiveTexts(source, jobs.slice(offset, offset + 72))) {
      if (text === undefined || !link) { await fail(work, reason ?? 'text-not-in-archive'); continue }
      const body = prepareAozora(work.id, text, link, sampleLimit)
      if (!body) { await fail(work, 'text-too-short', true); continue }
      const current = await readIndexed(work)
      const previous = current ?? await readLegacyIndexed(work)
      const cached = new Map<string, ArrayLike<number>>()
      if (previous?.bodyHash === body.bodyHash) {
        previous.chunks.forEach(({ text: chunk }, index) => cached.set(chunk, previous.vectors[index]))
      }
      prepared.push({ work, body, cached })
    }
    for (let position = 0; position < prepared.length; position += batchSize) {
      const batch = prepared.slice(position, position + batchSize)
      const known = new Map(batch.flatMap(({ cached }) => [...cached]))
      const texts = [...new Set(batch.flatMap(({ body }) => body.chunks.map(({ text }) => text)))].filter((text) => !known.has(text))
      const size = JSON.stringify({ text: texts }).length
      if (texts.length && (calls >= maxCalls || inputChars + size > maxIndexInputChars)) { stopped = 'safety-cap'; break }
      const embeddingStart = performance.now()
      try {
        if (texts.length) {
          calls++
          inputChars += size
          const vectors = await embed(texts)
          if (vectors.length !== texts.length) throw new Error('Wrong embedding count')
          texts.forEach((text, index) => known.set(text, vectors[index]))
        }
        const dimension = known.values().next().value?.length ?? 0
        if (!dimension || dimension > 4096 || [...known.values()].some((vector) => vector.length !== dimension
          || Array.from(vector).some((value) => !Number.isFinite(Math.fround(value))))) throw new Error('Invalid embedding dimensions or values')
        embeddingMs += elapsed(embeddingStart)
        for (const { work, body } of batch) {
          const bytes = Buffer.alloc(body.chunks.length * dimension * 4)
          body.chunks.forEach(({ text }, index) => {
            const vector = known.get(text)!
            for (let position = 0; position < dimension; position++) bytes.writeFloatLE(vector[position], (index * dimension + position) * 4)
          })
          await writeJson(indexPath(work.id), { ...body, id: work.id, title: work.title, author: work.author, rights: 'confirmed',
            signature: signature(work, aozoraIndexVersion), preprocessingVersion: aozoraIndexVersion, model: embeddingModel,
            archiveKey: archive.key, indexedAt: new Date().toISOString(), dimension, vectors: bytes.toString('base64') } satisfies StoredWork)
          indexed++
          chunks += body.chunks.length
        }
        reusedVectors += batch.reduce((count, { body }) => count + body.chunks.length, 0) - texts.length
      } catch (error) {
        // Keep completed files and stop spending quota on later batches.
        if ((error as NodeJS.ErrnoException).code) throw error
        for (const { work } of batch) await fail(work, 'ai-error', true)
        stopped = error instanceof Error ? error.message : 'Embedding failed'
        break
      }
    }
  }
  return { selected: jobs.length, indexed, chunks, calls, failed, reusedVectors, inputChars, stopped,
    embeddingMs, durationMs: elapsed(started) }
}
