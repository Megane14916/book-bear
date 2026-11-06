import { and, desc, eq, inArray, isNull, lte, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../../db/client'
import { bookmarks, books, userBooks } from '../../db/schema'
import { requireProfile } from '../books/service'

export const historyLimit = 8
const candidateLimit = 48
export const noteLength = 600
export const embeddingBatchLimit = historyLimit + candidateLimit
export type RecommendationStrategy = 'legacy' | 'diverse' | 'balanced'

const publicNotes = and(eq(bookmarks.visibility, 'public'), isNull(bookmarks.deletedAt))
const recentNote = [desc(bookmarks.createdAt), desc(bookmarks.id)] as const
const perBookPosition = sql<number>`row_number() over (partition by ${userBooks.bookId} order by ${bookmarks.createdAt} desc, ${bookmarks.id} desc)`.as('position')

export async function loadRecommendationHistory(db: Database, userId: string, strategy: RecommendationStrategy) {
  const ownNotes = and(eq(userBooks.userId, userId), publicNotes)
  if (strategy !== 'balanced') {
    return db.select({ content: bookmarks.content, bookId: userBooks.bookId }).from(bookmarks)
      .innerJoin(userBooks, eq(bookmarks.userBookId, userBooks.id))
      .where(ownNotes).orderBy(...recentNote).limit(historyLimit)
  }
  const notes = db.select({
    content: bookmarks.content, bookId: userBooks.bookId, createdAt: bookmarks.createdAt, noteId: bookmarks.id,
    position: perBookPosition,
  }).from(bookmarks)
    .innerJoin(userBooks, eq(bookmarks.userBookId, userBooks.id))
    .where(ownNotes).as('history_notes')
  return db.select({ content: notes.content, bookId: notes.bookId }).from(notes)
    .where(lte(notes.position, 3)).orderBy(notes.position, desc(notes.createdAt), desc(notes.noteId)).limit(historyLimit)
}

export async function loadRecommendationCandidates(db: Database, userId: string, strategy: RecommendationStrategy, bookIds?: string[]) {
  const owned = alias(userBooks, 'owned')
  const notes = db.select({
    bookId: userBooks.bookId, content: bookmarks.content, createdAt: bookmarks.createdAt, noteId: bookmarks.id,
    position: perBookPosition,
  }).from(bookmarks).innerJoin(userBooks, eq(bookmarks.userBookId, userBooks.id))
    .where(and(publicNotes, ne(userBooks.userId, userId), bookIds ? inArray(userBooks.bookId, bookIds) : undefined,
      notExists(db.select({ id: owned.id }).from(owned)
        .where(and(eq(owned.userId, userId), eq(owned.bookId, userBooks.bookId))))))
    .as('candidate_notes')
  const candidates = db.select({
    id: books.id, title: books.title, author: books.author, isbn13: books.isbn13, coverUrl: books.coverUrl,
    content: notes.content,
  }).from(notes).innerJoin(books, eq(notes.bookId, books.id))
    .where(lte(notes.position, 2))
  if (bookIds) return candidates.orderBy(books.id, notes.position)
  if (strategy === 'legacy') return candidates.orderBy(desc(notes.createdAt), desc(notes.noteId)).limit(candidateLimit)
  // A stable per-viewer order visits every book before taking a second note.
  return candidates.orderBy(notes.position, sql`md5(${books.id}::text || ${userId})`, books.id).limit(candidateLimit)
}

export async function loadRecommendationInput(db: Database, userId: string) {
  await requireProfile(db, userId)
  const history = await loadRecommendationHistory(db, userId, 'diverse')
  const candidates = history.length ? await loadRecommendationCandidates(db, userId, 'diverse') : []
  return { history, candidates }
}

export async function rankRecommendations<T extends { id: string; content: string }>(
  history: { content: string }[], candidates: T[], embed: (texts: string[]) => Promise<number[][]>, limit: number,
  aggregation: 'max' | 'mean' = 'max',
) {
  if (!history.length || !candidates.length) return []
  const texts = [...history, ...candidates].map((row) => row.content.slice(0, noteLength))
  const unique = [...new Set(texts)]
  const vectors = await embed(unique)
  const byText = new Map(unique.map((text, index) => {
    const vector = vectors[index]
    const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return [text, length ? vector.map((value) => value / length) : vector]
  }))
  const normalized = texts.map((text) => byText.get(text)!)
  const interests = normalized.slice(0, history.length)
  const centroid = interests[0].map((_, dimension) => interests.reduce((sum, vector) => sum + vector[dimension], 0))
  const byBook = new Map<string, { book: Omit<T, 'content'>; max: number; sum: number; count: number }>()
  candidates.forEach(({ content: _content, ...book }, index) => {
    const score = normalized[history.length + index].reduce((sum, value, dimension) => sum + value * centroid[dimension], 0)
    const current = byBook.get(book.id)
    byBook.set(book.id, { book, max: Math.max(current?.max ?? -Infinity, score),
      sum: (current?.sum ?? 0) + score, count: (current?.count ?? 0) + 1 })
  })
  return [...byBook.values()].map(({ book, max, sum, count }) => ({ book, score: aggregation === 'max' ? max : sum / count }))
    .sort((a, b) => b.score - a.score || a.book.id.localeCompare(b.book.id))
    .slice(0, limit).map(({ book }) => book)
}
