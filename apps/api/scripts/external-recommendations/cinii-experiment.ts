import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { ciniiLimits, CiniiProviderError, type CiniiBook, type createCiniiProvider } from '../../src/integrations/cinii'
import type { lookupOpenBd } from '../../src/integrations/openbd-batch'
import type { workersAi } from '../../src/integrations/workers-ai'
import { embeddingBatchLimit } from '../../src/modules/recommendations/service'
import { similarity, titleAuthor, type Identity, type Plan, type Registered } from './experiment'

export const ciniiEvidenceChars = 600
const top = 10
const popularityCap = 1000
const semanticFloor = 0.60
const semanticWindow = 0.15
const evidence = z.string().trim().min(1).max(500)
const permissionEntry = z.object({
  openBdDescription: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/), evidence, embedding: z.literal(true), workersAi: z.literal(true),
  }).strict().optional(),
  ownContent: z.object({ text: z.string().trim().min(1).max(ciniiEvidenceChars), evidence, workersAi: z.literal(true) }).strict().optional(),
}).strict().refine((entry) => entry.openBdDescription || entry.ownContent)
export const ciniiPermissions = z.record(z.string().regex(/^(?:97[89]\d{10}|[A-Z]{2}\d{7}[\dX])$/), permissionEntry)
type Permissions = z.infer<typeof ciniiPermissions>
type EmbeddingSource = 'licensed_description' | 'bibliographic_metadata' | 'own_content' | 'none'

const identity = (book: CiniiBook, isbn13 = book.isbn13): Identity => ({
  volumeId: null, isbn13, title: book.title, author: book.author,
})

export function deduplicateCinii(books: CiniiBook[]) {
  const groups: { book: CiniiBook; identifiers: Set<string>; name: string | null; hasIsbn: boolean }[] = []
  for (const book of books) {
    const identifiers = new Set([book.sourceUrl, ...book.isbns, ...(book.ncid ? [book.ncid] : [])])
    const name = titleAuthor(identity(book))
    const matches = groups.filter((group) => [...identifiers].some((id) => group.identifiers.has(id))
      || (name !== null && name === group.name && (!group.hasIsbn || !book.isbn13)))
    const group = matches[0]
    if (!group) {
      groups.push({ book, identifiers, name, hasIsbn: Boolean(book.isbn13) })
      continue
    }
    // Retain one edition's identifiers/metadata. Other identifiers are aliases for exclusion.
    if ((!group.book.nacsisMetadata && book.nacsisMetadata) || (!group.book.isbn13 && book.isbn13 && book.nacsisMetadata === group.book.nacsisMetadata)) {
      group.book = book
    }
    for (const id of identifiers) group.identifiers.add(id)
    for (const match of matches.slice(1)) {
      for (const id of match.identifiers) group.identifiers.add(id)
      group.hasIsbn ||= match.hasIsbn
      groups.splice(groups.indexOf(match), 1)
    }
    group.hasIsbn ||= Boolean(book.isbn13)
  }
  return groups.map(({ book, identifiers }) => ({ book, aliases: [...identifiers].filter((id) => /^97[89]\d{10}$/.test(id)) }))
}

type OpenBdRecord = Awaited<ReturnType<typeof lookupOpenBd>>['records'] extends Map<string, infer T> ? T : never
function chooseText(book: CiniiBook, openBd: OpenBdRecord | undefined, permissions: Permissions) {
  const description = openBd?.description
  const digest = description ? createHash('sha256').update(description).digest('hex') : null
  // An ISBN-bound digest ensures a changed publisher description is reviewed again.
  const descriptionPermissionConfirmed = Boolean(digest && book.isbn13
    && permissions[book.isbn13]?.openBdDescription?.sha256 === digest)
  if (description && descriptionPermissionConfirmed && description.length <= ciniiEvidenceChars) {
    return { input: description, embeddingSource: 'licensed_description' as const, descriptionPermissionConfirmed }
  }
  const own = (book.isbn13 ? permissions[book.isbn13]?.ownContent : undefined)
    ?? (book.ncid ? permissions[book.ncid]?.ownContent : undefined)
  if (own) return { input: own.text, embeddingSource: 'own_content' as const, descriptionPermissionConfirmed }
  if (book.nacsisMetadata) return {
    input: [book.title, book.author, ...book.subjects].filter(Boolean).join('。').slice(0, ciniiEvidenceChars),
    embeddingSource: 'bibliographic_metadata' as const, descriptionPermissionConfirmed,
  }
  return { input: null, embeddingSource: 'none' as const, descriptionPermissionConfirmed }
}

type Recommendation = {
  isbn13: string | null; ncid: string | null; title: string; author: string | null; sourceUrl: string; year: number | null
  publisher: string | null; coverUrl: string | null; ownerCount: number | null; descriptionAvailable: boolean
  descriptionPermissionConfirmed: boolean; embeddingSource: EmbeddingSource; semanticScore: number | null; popularityScore: number | null
}

export function popularityScore(count: number | null) {
  return count === null ? null : Math.min(1, Math.log1p(count) / Math.log1p(popularityCap))
}

export function scoreByPopularity<T extends Pick<Recommendation, 'semanticScore' | 'popularityScore'>>(books: T[], weight: number) {
  const best = Math.max(0, ...books.map(({ semanticScore }) => semanticScore ?? 0))
  return books.flatMap((book) => {
    const { semanticScore: semantic, popularityScore: popularity } = book
    if (semantic === null) return []
    const gate = semantic >= Math.max(semanticFloor, best - semanticWindow)
    const finalScore = gate && popularity !== null ? (1 - weight) * semantic + weight * popularity : semantic
    return [{ ...book, finalScore }]
  }).sort((a, b) => b.finalScore - a.finalScore || b.semanticScore! - a.semanticScore!)
}

const elapsed = (started: number) => Math.round(performance.now() - started)
const ratio = (value: number, total: number) => total ? value / total : null

export async function runCiniiExperiment(plan: Plan, options: {
  cinii: ReturnType<typeof createCiniiProvider>; openBd: typeof lookupOpenBd; ai: ReturnType<typeof workersAi>;
  registered: Registered; permissions: Permissions;
}) {
  let started = performance.now()
  const searches = []
  for (const query of plan.queries.slice(0, ciniiLimits.queries)) {
    searches.push({ query, items: await options.cinii.search(query) })
  }
  const searchMs = elapsed(started)
  started = performance.now()
  const fetched = searches.flatMap(({ items }) => items)
  const valid = fetched.filter((book): book is CiniiBook => book !== null)
  const suitable = plan.kind === 'fiction' ? valid.filter(({ title, subjects }) =>
    !/(事典|辞典|小説研究|文学評論|文学史|作品論|作家論)/.test([title, ...subjects].join(' '))) : valid
  const unique = deduplicateCinii(suitable)
  const identities = unique.map(({ book, aliases }) => [identity(book), ...aliases.map((isbn) => identity(book, isbn))])
  const existing = await options.registered(identities.flat())
  const remaining = unique.filter((_, index) => !identities[index].some((entry) => existing.has(entry))).map(({ book }) => book)
  const isbns = [...new Set(remaining.flatMap(({ isbn13 }) => isbn13 ?? []))]
  const identityMs = elapsed(started)

  started = performance.now()
  const openBd = await options.openBd(isbns)
  const openBdMs = elapsed(started)
  const candidates = remaining.map((book) => {
    const supplemental = book.isbn13 ? openBd.records.get(book.isbn13) : undefined
    const selected = chooseText(book, supplemental, options.permissions)
    return { book, supplemental, ...selected, descriptionAvailable: Boolean(supplemental?.description) }
  })

  started = performance.now()
  const preference = plan.interests.join('。').slice(0, ciniiEvidenceChars)
  const texts = candidates.flatMap(({ input }) => input ?? [])
  const batch = texts.length ? [...new Set([preference, ...texts])] : []
  const vectors = new Map<string, number[]>()
  let embeddingCalls = 0
  for (let offset = 0; offset < batch.length; offset += embeddingBatchLimit) {
    const chunk = batch.slice(offset, offset + embeddingBatchLimit)
    embeddingCalls++
    const result = await options.ai.embed(chunk)
    chunk.forEach((text, index) => vectors.set(text, result[index]))
  }
  const scored = candidates.map(({ book, supplemental, input, embeddingSource, descriptionAvailable, descriptionPermissionConfirmed }): Recommendation => ({
    isbn13: book.isbn13, ncid: book.ncid, title: book.title, author: book.author ?? supplemental?.author ?? null,
    year: book.year, publisher: book.publisher ?? supplemental?.publisher ?? null, coverUrl: supplemental?.coverUrl ?? null,
    sourceUrl: book.sourceUrl, ownerCount: null, descriptionAvailable, descriptionPermissionConfirmed, embeddingSource,
    semanticScore: input ? (1 + Math.max(-1, Math.min(1, similarity(vectors.get(preference)!, vectors.get(input)!)))) / 2 : null,
    popularityScore: null,
  }))
  const embeddingMs = elapsed(started)

  started = performance.now()
  const shortlist = scoreByPopularity(scored, 0).filter(({ ncid }) => ncid).slice(0, ciniiLimits.holdings)
  const holdings = new Map<string, number>()
  let holdingsCalls = 0
  let holdingsFailures = 0
  let rateLimited = false
  for (let offset = 0; offset < shortlist.length && !rateLimited; offset += ciniiLimits.holdingsConcurrency) {
    await Promise.all(shortlist.slice(offset, offset + ciniiLimits.holdingsConcurrency).map(async ({ ncid }) => {
      holdingsCalls++
      try { holdings.set(ncid!, await options.cinii.holdings(ncid!)) } catch (error) {
        holdingsFailures++
        if (error instanceof CiniiProviderError && error.status === 429) rateLimited = true
      }
    }))
  }
  const holdingsMs = elapsed(started)
  started = performance.now()
  const books = scored.map((book) => {
    const ownerCount = (book.ncid ? holdings.get(book.ncid) : undefined) ?? null
    return { ...book, ownerCount, popularityScore: popularityScore(ownerCount) }
  })
  const methods = { A: scoreByPopularity(books, 0).slice(0, top),
    B: scoreByPopularity(books, 0.2).slice(0, top), C: scoreByPopularity(books, 0.1).slice(0, top) }
  const rankingMs = elapsed(started)
  const withIsbn = books.filter(({ isbn13 }) => isbn13 !== null).length
  const descriptions = books.filter(({ descriptionAvailable }) => descriptionAvailable).length
  const permitted = books.filter(({ descriptionPermissionConfirmed }) => descriptionPermissionConfirmed).length
  const sources = { licensed_description: 0, bibliographic_metadata: 0, own_content: 0, none: 0 }
  for (const book of books) sources[book.embeddingSource]++
  const owners = [...holdings.values()].sort((a, b) => a - b)
  return {
    candidateGeneration: { queries: searches.map(({ query, items }) => ({ query, received: items.length })),
      received: fetched.length, invalid: fetched.length - valid.length, offTopic: valid.length - suitable.length,
      duplicates: suitable.length - unique.length, registered: unique.length - books.length, candidates: books.length,
      isbn: { count: withIsbn, rate: ratio(withIsbn, books.length) },
      openBd: { status: openBd.status, calls: openBd.calls, requested: isbns.length, found: openBd.records.size, rate: ratio(openBd.records.size, isbns.length) },
      descriptions: { available: descriptions, availableRate: ratio(descriptions, openBd.records.size),
        permissionConfirmed: permitted, permissionRate: ratio(permitted, descriptions),
        embedded: sources.licensed_description, embeddedRate: ratio(sources.licensed_description, descriptions) },
      embeddingSources: sources, ranked: books.length - sources.none,
      evidenceByBook: books.map(({ isbn13, ncid, title, sourceUrl, descriptionAvailable, descriptionPermissionConfirmed, embeddingSource }) =>
        ({ isbn13, ncid, title, sourceUrl, descriptionAvailable, descriptionPermissionConfirmed, embeddingSource })),
      holdings: { calls: holdingsCalls, failed: holdingsFailures, rateLimited, known: owners.length, rate: ratio(owners.length, books.length),
        min: owners[0] ?? null, median: owners.length ? (owners[Math.floor((owners.length - 1) / 2)] + owners[Math.floor(owners.length / 2)]) / 2 : null,
        max: owners.at(-1) ?? null, capped: owners.filter((count) => count > popularityCap).length },
    },
    timings: { searchMs, identityMs, openBdMs, embeddingMs, holdingsMs, rankingMs },
    embedding: { calls: embeddingCalls, texts: batch.length },
    ranking: { popularityCap, semanticFloor, semanticWindow, weights: { A: 0, B: 0.2, C: 0.1 } },
    methods,
  }
}
