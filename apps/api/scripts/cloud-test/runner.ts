import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Book } from '../../src/modules/books/schemas'
import { UserBook, UserBookPage } from '../../src/modules/library/schemas'
import { CloudTestError, ensure, type CloudConfig, type ManualConfirmation } from './config'
import type { Observer } from './database'

export type Report = {
  runId: string; startedAt: string; finishedAt?: string; commit: string
  apiOrigin: string; projectRef: string; userId: string; manual: ManualConfirmation
  bookId?: string; userBookId?: string; lastOperation: string
  steps: { stage: string; via: 'api-hyperdrive' | 'db-direct' | 'auth'; result: 'passed' }[]
  result: 'running' | 'passed' | 'failed'; failure?: { stage: string; reason: string; status?: number }
  cleanup: 'not-needed' | 'pending' | 'deleted' | 'failed'
  uncertainWrite?: boolean; retainedBook: boolean; cleanupFailure?: { stage: string; reason: string; status?: number }
}

export function failure(error: unknown, stage: string) {
  return error instanceof CloudTestError
    ? { stage: error.stage, reason: error.reason, ...(error.status === undefined ? {} : { status: error.status }) }
    : { stage, reason: 'unavailable' }
}

export async function runCloudTest(config: CloudConfig, manual: ManualConfirmation, deps: {
  fetcher: typeof fetch; openDatabase: () => Promise<Observer>; save: (report: Report) => Promise<void>; commit: string
}): Promise<Report> {
  const report: Report = { runId: randomUUID(), startedAt: new Date().toISOString(), commit: deps.commit,
    apiOrigin: config.apiOrigin, projectRef: config.projectRef, userId: config.userId, manual,
    lastOperation: 'preflight', steps: [], result: 'running', cleanup: 'not-needed', retainedBook: false }
  const title = `cloud-test-${report.runId}`
  let db: Observer | undefined
  let bookAttempted = false
  let shelfAttempted = false
  const save = async () => {
    try { await deps.save(report) } catch { throw new CloudTestError('record', 'could-not-save') }
  }
  const step = async (stage: string, via: Report['steps'][number]['via'], action: () => Promise<void>) => {
    report.lastOperation = stage
    await save()
    await action()
    report.steps.push({ stage, via, result: 'passed' })
    await save()
  }
  const request = async <T>(stage: string, origin: string, path: string, status: number,
    schema: z.ZodType<T> | undefined, method = 'GET', body?: unknown, authService = false): Promise<T> => {
    let response: Response
    try {
      response = await deps.fetcher(`${origin}${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${config.accessToken}`, ...(authService ? { apikey: config.publishableKey } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (response.status !== status) throw new CloudTestError(stage, 'unexpected-status', response.status)
      if (!schema) {
        ensure(await response.text() === '', stage, 'unexpected-body')
        return undefined as T
      }
      const parsed = schema.safeParse(await response.json())
      ensure(parsed.success, stage, 'invalid-response')
      return parsed.data
    } catch (error) {
      if (error instanceof CloudTestError) throw error
      throw new CloudTestError(stage, 'unavailable-or-invalid-response')
    }
  }
  const api = <T>(stage: string, path: string, status: number, schema?: z.ZodType<T>, method?: string, body?: unknown) =>
    request(stage, config.apiOrigin, `/api/v1${path}`, status, schema, method, body)
  const verifyBook = async () => {
    const book = await db!.book(report.bookId!)
    ensure(book && book.id === report.bookId && book.title === title && book.isbn13 === null
      && book.created_by_user_id === config.userId, 'db-book')
    report.retainedBook = true
  }
  const verifyShelf = async (updated: boolean) => {
    const shelf = await db!.shelf(report.userBookId!)
    ensure(shelf && shelf.id === report.userBookId && shelf.user_id === config.userId && shelf.book_id === report.bookId
      && shelf.status === (updated ? 'reading' : 'want_to_read') && shelf.current_page === (updated ? 10 : null), 'db-shelf')
  }
  const verifyApiShelf = (shelf: z.infer<typeof UserBook>, updated: boolean) => {
    ensure(shelf.id === report.userBookId && shelf.userId === config.userId && shelf.book.id === report.bookId
      && shelf.status === (updated ? 'reading' : 'want_to_read') && shelf.currentPage === (updated ? 10 : null), 'api-shelf')
  }
  const list = async (present: boolean) => {
    let cursor: string | null = null
    const seen = new Set<string>()
    do {
      const page: z.infer<typeof UserBookPage> = await api('list-books', `/me/books${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`, 200, UserBookPage)
      const item = page.items.find((entry) => entry.id === report.userBookId)
      if (item) {
        ensure(present, 'list-books', 'deleted-shelf-still-present')
        verifyApiShelf(item, true)
        return
      }
      cursor = page.nextCursor
      if (cursor !== null) {
        ensure(!seen.has(cursor), 'list-books', 'repeated-cursor')
        seen.add(cursor)
      }
    } while (cursor !== null)
    ensure(!present, 'list-books', 'shelf-not-found')
  }
  try {
    await save()
    await step('auth-user', 'auth', async () => {
      const user = await request('auth-user', config.supabaseUrl, '/auth/v1/user', 200,
        z.object({ id: z.string().uuid(), is_anonymous: z.boolean() }), 'GET', undefined, true)
      ensure(user.id === config.userId && !user.is_anonymous, 'auth-user')
    })
    await step('db-preflight', 'db-direct', async () => { db = await deps.openDatabase() })
    for (const path of ['/health', '/health/db']) {
      await step(path, 'api-hyperdrive', async () => {
        await api(path, path, 200, z.object({ status: z.literal('ok') }))
      })
    }
    await step('initialize-profile', 'api-hyperdrive', async () => {
      const profile = await api('initialize-profile', '/me', 200,
        z.object({ id: z.string().uuid(), isAnonymous: z.boolean() }), 'PUT')
      ensure(profile.id === config.userId && !profile.isAnonymous, 'initialize-profile')
    })
    await step('create-book', 'api-hyperdrive', async () => {
      bookAttempted = true
      const book = await api('create-book', '/books/manual', 201, Book, 'POST', { title })
      report.bookId = book.id
      await save()
      ensure(book.title === title && book.isbn13 === null && book.source === 'manual', 'create-book')
    })
    await step('get-book', 'api-hyperdrive', async () => {
      const book = await api('get-book', `/books/${report.bookId}`, 200, Book)
      ensure(book.id === report.bookId && book.title === title && book.isbn13 === null, 'get-book')
    })
    await step('create-shelf', 'api-hyperdrive', async () => {
      shelfAttempted = true
      const shelf = await api('create-shelf', '/me/books', 201, UserBook, 'POST', { bookId: report.bookId })
      report.userBookId = shelf.id
      report.cleanup = 'pending'
      await save()
      verifyApiShelf(shelf, false)
    })
    await step('db-created', 'db-direct', async () => { await verifyBook(); await verifyShelf(false) })
    await step('update-shelf', 'api-hyperdrive', async () => {
      const shelf = await api('update-shelf', `/me/books/${report.userBookId}`, 200, UserBook, 'PATCH', { status: 'reading', currentPage: 10 })
      verifyApiShelf(shelf, true)
    })
    await step('db-updated', 'db-direct', () => verifyShelf(true))
    await step('list-updated', 'api-hyperdrive', () => list(true))
    await step('delete-shelf', 'api-hyperdrive', async () => {
      await api('delete-shelf', `/me/books/${report.userBookId}`, 204, undefined, 'DELETE')
    })
    await step('list-deleted', 'api-hyperdrive', () => list(false))
    await step('db-deleted-book-retained', 'db-direct', async () => {
      ensure(!await db!.shelf(report.userBookId!), 'db-deleted')
      await verifyBook()
      report.cleanup = 'deleted'
    })
    report.result = 'passed'
  } catch (error) {
    report.result = 'failed'
    report.failure = failure(error, report.lastOperation)
    if (db && bookAttempted) {
      try {
        // Only recover this run's exact title and creator. Never replay a POST.
        if (!report.bookId || (shelfAttempted && !report.userBookId)) {
          report.uncertainWrite = true
          const recovered = await db.recover(title, config.userId)
          ensure(recovered.books.length === 1 && recovered.shelves.length <= 1, 'cleanup', 'ambiguous-write')
          report.bookId = recovered.books[0].id
          if (recovered.shelves[0]) {
            ensure(recovered.shelves[0].book_id === report.bookId, 'cleanup')
            report.userBookId = recovered.shelves[0].id
          }
        }
        await verifyBook()
        if (report.userBookId) {
          const shelf = await db.shelf(report.userBookId)
          if (shelf) {
            report.cleanup = 'pending'
            ensure(shelf.user_id === config.userId && shelf.book_id === report.bookId, 'cleanup', 'ownership-mismatch')
            await api('cleanup-delete', `/me/books/${report.userBookId}`, 204, undefined, 'DELETE')
          }
          ensure(!await db.shelf(report.userBookId), 'cleanup', 'shelf-remains')
          report.cleanup = 'deleted'
        }
      } catch (cleanupError) {
        report.cleanup = 'failed'
        report.cleanupFailure = failure(cleanupError, 'cleanup')
      }
    }
  } finally {
    try { await db?.close() } catch {
      report.result = 'failed'
      report.failure ??= { stage: 'db-close', reason: 'unavailable' }
    }
    report.finishedAt = new Date().toISOString()
    await save()
  }
  return report
}
