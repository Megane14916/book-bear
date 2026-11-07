import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadDataset } from '../scripts/seed/dataset'
import { resolveSeedTarget } from '../scripts/seed/target'
import { writeSeed } from '../scripts/seed/write'
import { createTestDatabase } from './helpers/database'

describe('development seed', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>
  beforeAll(async () => { database = await createTestDatabase({ isolated: true }) }, 20000)
  afterAll(async () => { await database?.close() })

  it('inserts fixtures once and rolls back new rows if an existing record differs', async () => {
    const data = await loadDataset()
    const target = await resolveSeedTarget([], data.users)
    const first = await writeSeed(database.client, data, target)
    expect(first['public.books'].added).toBe(30)
    expect(first['public.bookmarks'].added).toBeGreaterThanOrEqual(150)
    expect(data.books.filter(({ coverUrl }) => coverUrl !== null).length).toBeGreaterThan(0)
    expect(data.bookmarks.some(({ content }) => content.length >= 150)).toBe(true)
    const second = await writeSeed(database.client, data, target)
    expect(Object.values(second).every((value) => value.added === 0)).toBe(true)
    expect(second['public.bookmarks'].skipped).toBe(data.bookmarks.length)

    const book = data.books[0]
    const newBook = { ...book, id: 'f611fd32-80a7-4560-8e23-c942685ba281' }
    await database.client.query('UPDATE public.books SET title=$1 WHERE id=$2', ['既存の編集', book.id])
    await expect(writeSeed(database.client, { ...data, books: [newBook, ...data.books] }, target)).rejects.toThrow('Seed row differs')
    const { rows } = await database.client.query('SELECT title FROM public.books WHERE id IN ($1, $2)', [book.id, newBook.id])
    expect(rows).toEqual([{ title: '既存の編集' }])
  }, 20000)

  it('rejects an unapproved remote target before contacting Auth', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const ref = 'aaaaaaaaaaaaaaaaaaaa'
    await expect(resolveSeedTarget(['--development', ref], [], {
      SEED_DEVELOPMENT_PROJECT_REF: ref,
      SEED_SUPABASE_URL: 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co',
    }, fetcher)).rejects.toThrow('development project ref')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
