import type { OpenAPIHono } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { identity } from '../../shared/http'
import { bookmarkRoutes } from './routes'
import * as bookmarks from './service'

export function registerBookmarkRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use('/api/v1/bookmarks', auth.required)
  // Detail GET is public/optional; mutations on the same path require a JWT.
  app.use('/api/v1/bookmarks/:bookmarkId', (c, next) => (c.req.method === 'GET' ? auth.optional : auth.required)(c, next))
  app.use('/api/v1/me/bookmarks', auth.required)
  app.use('/api/v1/books/:bookId/bookmarks', auth.optional)
  app.use('/api/v1/users/:userId/bookmarks', auth.optional)
  app.use('/api/v1/users/:userId/books/:bookId/bookmarks', auth.optional)
  app.openapi(bookmarkRoutes.flow, async (c) => {
    const { userId, bookId } = c.req.valid('param')
    return c.json(await database(c.env ?? {}, (db) => bookmarks.getBookmarkFlow(db, userId, bookId, c.req.valid('query'), c.get('identity'))), 200)
  })
  app.openapi(bookmarkRoutes.create, async (c) => c.json(await database(c.env ?? {}, (db) => bookmarks.createBookmark(db, identity(c), c.req.valid('json'))), 201))
  app.openapi(bookmarkRoutes.get, async (c) => c.json(await database(c.env ?? {}, (db) => bookmarks.getBookmark(db, c.req.valid('param').bookmarkId, c.get('identity'))), 200))
  app.openapi(bookmarkRoutes.list, async (c) => c.json(await database(c.env ?? {}, (db) => bookmarks.listBookmarks(db, identity(c), c.req.valid('query'))), 200))
  app.openapi(bookmarkRoutes.bookList, async (c) => c.json(await database(c.env ?? {}, (db) =>
    bookmarks.listBookBookmarks(db, c.req.valid('param').bookId, c.req.valid('query'), c.get('identity'))), 200))
  app.openapi(bookmarkRoutes.publicList, async (c) => c.json(await database(c.env ?? {}, (db) =>
    bookmarks.listAuthorBookmarks(db, c.req.valid('param').userId, c.req.valid('query'), c.get('identity'))), 200))
  app.openapi(bookmarkRoutes.patch, async (c) => c.json(await database(c.env ?? {}, (db) => bookmarks.patchBookmark(db, identity(c), c.req.valid('param').bookmarkId, c.req.valid('json'))), 200))
  app.openapi(bookmarkRoutes.delete, async (c) => {
    await database(c.env ?? {}, (db) => bookmarks.deleteBookmark(db, identity(c), c.req.valid('param').bookmarkId))
    return c.body(null, 204)
  })
}
