import type { OpenAPIHono } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { identity } from '../../shared/http'
import { libraryRoutes } from './routes'
import * as library from './service'

export function registerLibraryRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use('/api/v1/me/books', auth.required)
  app.use('/api/v1/me/books/:userBookId', auth.required)
  app.use('/api/v1/users/:userId/books', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.openapi(libraryRoutes.list, async (c) => c.json(await database(c.env ?? {}, (db) => library.listBooks(db, identity(c), c.req.valid('query'))), 200))
  app.openapi(libraryRoutes.create, async (c) => {
    const result = await database(c.env ?? {}, (db) => library.createUserBook(db, identity(c), c.req.valid('json')))
    return c.json(result.book, result.created ? 201 : 200)
  })
  app.openapi(libraryRoutes.patch, async (c) => c.json(await database(c.env ?? {}, (db) => library.patchUserBook(db, identity(c), c.req.valid('param').userBookId, c.req.valid('json'))), 200))
  app.openapi(libraryRoutes.delete, async (c) => {
    await database(c.env ?? {}, (db) => library.deleteUserBook(db, identity(c), c.req.valid('param').userBookId))
    return c.body(null, 204)
  })
  app.openapi(libraryRoutes.publicBooks, async (c) => c.json(await database(c.env ?? {}, (db) => library.publicBooks(db, c.req.valid('param').userId, c.req.valid('query'))), 200))
}
