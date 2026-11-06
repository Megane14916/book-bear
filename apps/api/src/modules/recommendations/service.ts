import { and, desc, eq, isNull, lte, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../../db/client'
import { bookmarks, books, userBooks } from '../../db/schema'
import { requireProfile } from '../books/service'

export const historyLimit = 8
const candidateLimit = 48
export const noteLength = 600

export async function loadRecommendationInput(db: Database, userId: string) {
  await requireProfile(db, userId)
  const publicNotes = and(eq(bookmarks.visibility, 'public'), isNull(bookmarks.deletedAt))
  const history = await db.select({ content: bookmarks.content }).from(bookmarks)
    .innerJoin(userBooks, eq(bookmarks.userBookId, userBooks.id))
    .where(and(eq(userBooks.userId, userId), publicNotes))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).limit(historyLimit)
  if (!history.length) return { history, candidates: [] }

  const owned = alias(userBooks, 'owned')
  const notes = db.select({
    bookId: userBooks.bookId, content: bookmarks.content, createdAt: bookmarks.createdAt, noteId: bookmarks.id,
    position: sql<number>`row_number() over (partition by ${userBooks.bookId} order by ${bookmarks.createdAt} desc, ${bookmarks.id} desc)`.as('position'),
  }).from(bookmarks).innerJoin(userBooks, eq(bookmarks.userBookId, userBooks.id))
    .where(and(publicNotes, ne(userBooks.userId, userId),
      notExists(db.select({ id: owned.id }).from(owned)
        .where(and(eq(owned.userId, userId), eq(owned.bookId, userBooks.bookId))))))
    .as('candidate_notes')
  const candidates = await db.select({
    id: books.id, title: books.title, author: books.author, isbn13: books.isbn13, coverUrl: books.coverUrl,
    content: notes.content,
  }).from(notes).innerJoin(books, eq(notes.bookId, books.id))
    .where(lte(notes.position, 2)).orderBy(desc(notes.createdAt), desc(notes.noteId)).limit(candidateLimit)
  return { history, candidates }
}

export async function rankRecommendations<T extends { id: string; content: string }>(
  history: { content: string }[], candidates: T[], embed: (texts: string[]) => Promise<number[][]>, limit: number,
) {
  if (!history.length || !candidates.length) return []
  const vectors = await embed([...history, ...candidates].map((row) => row.content.slice(0, noteLength)))
  const normalized = vectors.map((vector) => {
    const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return length ? vector.map((value) => value / length) : vector
  })
  const interests = normalized.slice(0, history.length)
  const centroid = interests[0].map((_, dimension) => interests.reduce((sum, vector) => sum + vector[dimension], 0))
  const bestByBook = new Map<string, { book: Omit<T, 'content'>; score: number }>()
  candidates.forEach(({ content: _content, ...book }, index) => {
    const score = normalized[history.length + index].reduce((sum, value, dimension) => sum + value * centroid[dimension], 0)
    const best = bestByBook.get(book.id)
    if (!best || score > best.score) bestByBook.set(book.id, { book, score })
  })
  return [...bestByBook.values()].sort((a, b) => b.score - a.score || a.book.id.localeCompare(b.book.id))
    .slice(0, limit).map(({ book }) => book)
}
