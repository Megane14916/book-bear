import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { AiUnavailable, workersAi } from '../src/integrations/workers-ai'
import { loadDataset } from '../scripts/seed/dataset'
import { resolveSeedTarget } from '../scripts/seed/target'
import { writeSeed } from '../scripts/seed/write'
import { withDatabase } from '../src/db/client'
import { embeddingBatchLimit, loadRecommendationCandidates, loadRecommendationHistory, rankRecommendations } from '../src/modules/recommendations/service'
import { createTestDatabase } from './helpers/database'

let db: Awaited<ReturnType<typeof createTestDatabase>>
let dataset: Awaited<ReturnType<typeof loadDataset>>
beforeAll(async () => {
  db = await createTestDatabase({ isolated: true })
  dataset = await loadDataset()
  await writeSeed(db.client, dataset, await resolveSeedTarget([], dataset.users))
}, 20000)
afterAll(async () => { await db?.close() })

let databaseActive = false
const app = createApp({ database: async (env, query) => {
  databaseActive = true
  try { return await withDatabase(env, query) } finally { databaseActive = false }
}, verifyToken: async (token) => {
  const key = token === 'a.b.c' ? 'mystery-a' : token === 'a.b.d' ? 'empty' : 'mystery-b'
  const user = dataset.users.find((row) => row.key === key)!
  return { id: user.localUid, isAnonymous: user.anonymous }
} })
const request = (query: string, token: string | undefined, run: (model: string, input: Record<string, unknown>) => Promise<unknown>) =>
  app.request(`/api/v1/me/recommendations${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    { HYPERDRIVE: { connectionString: db.apiConnectionString }, AI: { run } })

it('balances the history across books and candidate order across publication dates', async () => {
  const uid = dataset.users.find(({ key }) => key === 'mystery-a')!.localUid
  const env = { HYPERDRIVE: { connectionString: db.apiConnectionString } }
  await withDatabase(env, async (connection) => {
    const legacy = await loadRecommendationHistory(connection, uid, 'legacy')
    const balanced = await loadRecommendationHistory(connection, uid, 'balanced')
    expect(new Set(balanced.map(({ bookId }) => bookId)).size).toBeGreaterThan(1)
    expect(balanced.filter(({ bookId }) => bookId === legacy[0].bookId)).toHaveLength(1)
    const rows = await loadRecommendationCandidates(connection, uid, 'balanced')
    const bookCount = new Set(rows.map(({ id }) => id)).size
    expect(bookCount).toBeGreaterThan(20)
    expect(new Set(rows.slice(0, bookCount).map(({ id }) => id)).size).toBe(bookCount)
    expect(balanced.length + rows.length).toBeLessThanOrEqual(embeddingBatchLimit)
    const excluded = dataset.books.filter(({ key }) => ['mystery-3', 'mystery-6'].includes(key)).map(({ id }) => id)
    expect(await loadRecommendationCandidates(connection, uid, 'diverse', excluded)).toEqual([])
  })
})

it('ranks public candidates and excludes private, deleted and already shelved books', async () => {
  const positive = dataset.books.find((book) => book.key === 'mystery-2')!
  const privateNote = dataset.bookmarks.find((bookmark) => bookmark.shelf === 'private:mystery-6')!
  const deletedShelf = dataset.shelves.find((shelf) => shelf.key === 'prose-b:prose-4')!
  await db.client.query('UPDATE bookmarks SET deleted_at=now() WHERE user_book_id=$1', [deletedShelf.id])
  const deleted = new Set(dataset.bookmarks.filter(({ shelf }) => shelf === deletedShelf.key).map(({ content }) => content))
  const privatized = dataset.bookmarks.find(({ shelf, visibility, content }) =>
    shelf === 'world-b:world-4' && visibility === 'public' && content.startsWith('前半のメモ。'))!
  await db.client.query("UPDATE bookmarks SET visibility='private' WHERE id=$1", [privatized.id])
  const positives = new Set(dataset.bookmarks.filter(({ shelf, visibility, content }) =>
    shelf === 'mystery-b:mystery-2' && visibility === 'public' && content.includes('灯りの数')).map(({ content }) => content))
  const owned = new Set(dataset.bookmarks.filter(({ shelf }) => shelf === 'mystery-a:mystery-3').map(({ content }) => content))
  const uid = dataset.users.find(({ key }) => key === 'mystery-a')!.localUid
  const history = await withDatabase({ HYPERDRIVE: { connectionString: db.apiConnectionString } },
    (connection) => loadRecommendationHistory(connection, uid, 'legacy'))
  const ownText = new Set(history.map(({ content }) => content))
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    expect(databaseActive).toBe(false)
    const text = input.text as string[]
    expect(text).not.toContain(privateNote.content)
    expect(text).not.toContain(privatized.content)
    // Generic reading-log wording can also occur in a different book.
    expect(text.some((note) => deleted.has(note) && note.includes('景色'))).toBe(false)
    expect(text.some((note) => !ownText.has(note) && owned.has(note) && note.includes('配達順'))).toBe(false)
    return { data: text.map((note) => ownText.has(note) || positives.has(note) ? [1, 0] : [0, 1]) }
  })
  const response = await request('?limit=1', 'a.b.c', run)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const { items } = await response.json() as { items: { id: string }[] }
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ id: positive.id })
  expect(items[0]).not.toHaveProperty('content')
  expect(run).toHaveBeenCalledOnce()
})

it('embeds identical input once and can compare maximum and mean book scores', async () => {
  const history = [{ content: 'same' }, { content: 'same' }]
  const candidates = [{ id: 'a', content: 'same' }, { id: 'a', content: 'different' }, { id: 'b', content: 'nearby' }]
  const embed = vi.fn(async () => [[1, 0], [-1, 0], [0.7, 0.7]])
  await expect(rankRecommendations(history, candidates, embed, 2, 'max')).resolves.toEqual([{ id: 'a' }, { id: 'b' }])
  await expect(rankRecommendations(history, candidates, embed, 2, 'mean')).resolves.toEqual([{ id: 'b' }, { id: 'a' }])
  expect(embed).toHaveBeenCalledWith(['same', 'different', 'nearby'])
})

it('returns documented errors for unauthorized, invalid, and unavailable requests', async () => {
  const run = vi.fn(async () => { throw new Error('upstream rate limit') })
  expect((await request('', undefined, run)).status).toBe(401)
  expect((await request('', 'a.b.d', run)).status).toBe(403)
  expect((await request('?limit=11', 'a.b.c', run)).status).toBe(400)
  expect(run).not.toHaveBeenCalled()
  expect((await request('', 'a.b.c', run)).status).toBe(503)
  expect(run).toHaveBeenCalledOnce()
})

it('handles empty history and validates both structured output shapes and timeout', async () => {
  const verifyToken = async () => ({ id: dataset.users.find((row) => row.key === 'empty')!.localUid, isAnonymous: false })
  const emptyApp = createApp({ verifyToken })
  const run = vi.fn()
  const response = await emptyApp.request('/api/v1/me/recommendations', { headers: { Authorization: 'Bearer a.b.c' } },
    { HYPERDRIVE: { connectionString: db.apiConnectionString }, AI: { run } })
  expect(await response.json()).toEqual({ items: [] })
  expect(run).not.toHaveBeenCalled()

  const ai = workersAi({ AI: { run: vi.fn()
    .mockResolvedValueOnce({ response: { themes: ['謎解き'] } })
    .mockResolvedValueOnce({ response: null, choices: [{ finish_reason: 'stop', message: { content: '{"themes":["伏線"]}' } }] })
    .mockResolvedValueOnce({ response: null, choices: [{ finish_reason: 'length', message: { content: null } }] })
    .mockResolvedValueOnce({ response: { themes: [42] } })
    .mockResolvedValueOnce({ data: [[1]] }) } })
  await expect(ai.summarize(['栞'])).resolves.toEqual({ themes: ['謎解き'] })
  await expect(ai.summarize(['栞'])).resolves.toEqual({ themes: ['伏線'] })
  await expect(ai.summarize(['栞'])).rejects.toThrow('output token limit')
  await expect(ai.summarize(['栞'])).rejects.toBeInstanceOf(AiUnavailable)
  await expect(ai.embed(['栞', '別の栞'])).rejects.toBeInstanceOf(AiUnavailable)
  await expect(workersAi({ AI: { run: () => new Promise(() => {}) } }, 1).embed(['栞'])).rejects.toBeInstanceOf(AiUnavailable)
})
