import type { OpenAPIHono } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { decodeCursor } from '../../shared/cursor'
import { listPublicBookmarks } from '../bookmarks/service'
import { searchUsers } from '../users/service'
import { searchRoutes } from './routes'

export function registerSearchRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use('/api/v1/search/posts', auth.optional)
  app.use('/api/v1/search/users', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.openapi(searchRoutes.posts, async (c) => {
    const query = c.req.valid('query'), boundary = decodeCursor(query.cursor)
    return c.json(await database(c.env ?? {}, (db) => listPublicBookmarks(db, { q: query.q, limit: query.limit, boundary }, c.get('identity'))), 200)
  })
  app.openapi(searchRoutes.users, async (c) => c.json(await database(c.env ?? {}, (db) => searchUsers(db, c.req.valid('query'))), 200))
}
