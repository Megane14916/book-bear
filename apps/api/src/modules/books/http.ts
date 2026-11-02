import type { OpenAPIHono } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { createBookProvider } from '../../integrations/books'
import { identity } from '../../shared/http'
import { bookRoutes } from './routes'
import * as books from './service'

export function registerBookRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>, fetcher?: typeof fetch) {
  app.use('/api/v1/books/import', auth.required)
  app.use('/api/v1/books/manual', auth.required)
  app.openapi(bookRoutes.search, async (c) => c.json(await books.searchBooks(database, c.env ?? {}, c.req.valid('query'), createBookProvider(fetcher, c.env?.GOOGLE_BOOKS_API_KEY)), 200))
  app.openapi(bookRoutes.get, async (c) => c.json(await database(c.env ?? {}, (db) => books.getBook(db, c.req.valid('param').bookId)), 200))
  app.openapi(bookRoutes.import, async (c) => {
    const result = await books.importBook(database, c.env ?? {}, identity(c), c.req.valid('json'), createBookProvider(fetcher, c.env?.GOOGLE_BOOKS_API_KEY))
    return c.json(result.book, result.created ? 201 : 200)
  })
  app.openapi(bookRoutes.manual, async (c) => c.json(await database(c.env ?? {}, (db) => books.manualBook(db, identity(c), c.req.valid('json'))), 201))
}
