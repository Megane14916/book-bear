import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { AiUnavailable, workersAi } from '../src/integrations/workers-ai'
import { loadDataset } from '../scripts/seed/dataset'
import { resolveSeedTarget } from '../scripts/seed/target'
import { writeSeed } from '../scripts/seed/write'
import { createTestDatabase } from './helpers/database'

let db: Awaited<ReturnType<typeof createTestDatabase>>
let dataset: Awaited<ReturnType<typeof loadDataset>>
beforeAll(async () => {
  db = await createTestDatabase({ isolated: true })
  dataset = await loadDataset()
  await writeSeed(db.client, dataset, await resolveSeedTarget([], dataset.users))
}, 20000)
afterAll(async () => { await db?.close() })

const app = createApp({ verifyToken: async (token) => {
  const key = token === 'a.b.c' ? 'mystery-a' : token === 'a.b.d' ? 'empty' : 'mystery-b'
  const user = dataset.users.find((row) => row.key === key)!
  return { id: user.localUid, isAnonymous: user.anonymous }
} })
const request = (query: string, token: string | undefined, run: (model: string, input: Record<string, unknown>) => Promise<unknown>) =>
  app.request(`/api/v1/me/recommendations${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    { HYPERDRIVE: { connectionString: db.apiConnectionString }, AI: { run } })

it('ranks public candidates and excludes private, deleted and already shelved books', async () => {
  const positive = dataset.books.find((book) => book.key === 'mystery-2')!
  const privateNote = dataset.bookmarks.find((bookmark) => bookmark.shelf === 'private:mystery-6')!
  const deletedShelf = dataset.shelves.find((shelf) => shelf.key === 'prose-b:prose-4')!
  await db.client.query('UPDATE bookmarks SET deleted_at=now() WHERE user_book_id=$1', [deletedShelf.id])
  const run = vi.fn(async (_model: string, input: Record<string, unknown>) => {
    const text = input.text as string[]
    expect(text).not.toContain(privateNote.content)
    expect(text.some((note) => note.includes('色のない風景'))).toBe(false)
    expect(text.slice(8).some((note) => note.includes('宛先を並べ替える'))).toBe(false)
    return { data: text.map((note, index) => index < 8 || note.includes('予備鍵') ? [1, 0] : [0, 1]) }
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
    .mockResolvedValueOnce({ choices: [{ message: { content: '{"themes":["伏線"]}' } }] })
    .mockResolvedValueOnce({ response: { themes: [42] } })
    .mockResolvedValueOnce({ data: [[1]] }) } })
  await expect(ai.summarize(['栞'])).resolves.toEqual({ themes: ['謎解き'] })
  await expect(ai.summarize(['栞'])).resolves.toEqual({ themes: ['伏線'] })
  await expect(ai.summarize(['栞'])).rejects.toBeInstanceOf(AiUnavailable)
  await expect(ai.embed(['栞', '別の栞'])).rejects.toBeInstanceOf(AiUnavailable)
  await expect(workersAi({ AI: { run: () => new Promise(() => {}) } }, 1).embed(['栞'])).rejects.toBeInstanceOf(AiUnavailable)
})
