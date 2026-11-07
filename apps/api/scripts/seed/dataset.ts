import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { BookmarkContent, Visibility } from '../../src/modules/bookmarks/schemas'
import { ReadingStatus } from '../../src/modules/library/schemas'

const key = z.string().min(1)
const id = z.string().uuid()
const page = z.number().int().min(1).max(2147483647)
const datasetSchema = z.object({
  version: key,
  users: z.array(z.object({
    key, localUid: id, anonymous: z.boolean(), displayName: z.string().trim().min(1).max(50),
    handle: z.string().regex(/^seed_[a-z0-9_]{1,25}$/), bio: z.string().max(500).nullable(),
  })),
  books: z.array(z.object({
    key, id, title: z.string().startsWith('【架空】'), author: key, totalPages: page.nullable(),
    coverUrl: z.string().url().nullable(),
  })),
  shelves: z.array(z.object({
    key, id, user: key, book: key, status: ReadingStatus, currentPage: page.min(0).nullable(),
  })),
  bookmarks: z.array(z.object({
    id, shelf: key, content: BookmarkContent, visibility: Visibility, isSpoiler: z.boolean(),
    pageNumber: page.nullable(), createdAt: z.string().datetime(),
  })),
  follows: z.array(z.object({ follower: key, following: key })),
  likes: z.array(z.object({ user: key, bookmark: id })),
  replies: z.array(z.object({
    id, user: key, bookmark: id, content: z.string().trim().min(1).max(1000), isSpoiler: z.boolean(),
  })),
})

export type Dataset = z.infer<typeof datasetSchema>

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SeedError(message)
}

export class SeedError extends Error {}

function unique<T>(rows: T[], identify: (row: T) => string) {
  const indexed = new Map<string, T>()
  for (const row of rows) {
    const key = identify(row)
    check(!indexed.has(key), `Duplicate dataset key: ${key}`)
    indexed.set(key, row)
  }
  return indexed
}

export async function loadDataset(): Promise<Dataset> {
  const result = datasetSchema.safeParse(JSON.parse(await readFile(new URL('data.json', import.meta.url), 'utf8')))
  check(result.success, 'Invalid seed dataset structure')
  const data = result.data
  const users = unique(data.users, (row) => row.key)
  const books = unique(data.books, (row) => row.key)
  const shelves = unique(data.shelves, (row) => row.key)
  const bookmarks = unique(data.bookmarks, (row) => row.id)
  unique(data.users, (row) => row.localUid)
  unique(data.users, (row) => row.handle)
  unique(data.books, (row) => row.id)
  unique(data.shelves, (row) => row.id)
  unique(data.shelves, (row) => JSON.stringify([row.user, row.book]))
  unique(data.replies, (row) => row.id)
  unique(data.follows, (row) => JSON.stringify([row.follower, row.following]))
  unique(data.likes, (row) => JSON.stringify([row.user, row.bookmark]))
  for (const row of data.shelves) {
    const book = books.get(row.book)
    check(users.has(row.user) && book, `Unknown shelf reference: ${row.key}`)
    check(row.currentPage === null || book.totalPages === null || row.currentPage <= book.totalPages, `Invalid shelf progress: ${row.key}`)
  }
  for (const row of data.bookmarks) {
    const shelf = shelves.get(row.shelf)
    check(shelf && (row.visibility === 'private' || users.get(shelf.user)?.anonymous === false), `Invalid bookmark owner or visibility: ${row.id}`)
    const totalPages = books.get(shelf.book)?.totalPages
    check(row.pageNumber === null || totalPages == null || row.pageNumber <= totalPages, `Invalid bookmark page: ${row.id}`)
  }
  for (const row of data.follows) {
    check(row.follower !== row.following && users.get(row.follower)?.anonymous === false
      && users.get(row.following)?.anonymous === false, `Invalid follow: ${row.follower} → ${row.following}`)
  }
  for (const row of [...data.likes, ...data.replies]) {
    check(users.get(row.user)?.anonymous === false && bookmarks.get(row.bookmark)?.visibility === 'public',
      `Invalid interaction: ${row.user} → ${row.bookmark}`)
  }
  return data
}
