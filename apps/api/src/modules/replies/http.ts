import type { OpenAPIHono } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { ApiError } from '../../shared/errors'
import { identity } from '../../shared/http'
import { replyRoutes } from './routes'
import * as replies from './service'

export function registerReplyRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use('/api/v1/bookmarks/:bookmarkId/replies', (c, next) => (c.req.method === 'GET' ? auth.optional : auth.required)(c, next))
  app.use('/api/v1/replies/:replyId', auth.required)
  app.openapi(replyRoutes.list, async (c) => c.json(await database(c.env ?? {}, (db) => replies.listReplies(db, c.req.valid('param').bookmarkId, c.req.valid('query'), c.get('identity'))), 200))
  app.openapi(replyRoutes.create, async (c) => {
    const viewer = identity(c)
    if (viewer.isAnonymous) throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
    return c.json(await database(c.env ?? {}, (db) => replies.createReply(db, viewer, c.req.valid('param').bookmarkId, c.req.valid('json'))), 201)
  })
  app.openapi(replyRoutes.patch, async (c) => c.json(await database(c.env ?? {}, (db) => replies.patchReply(db, identity(c), c.req.valid('param').replyId, c.req.valid('json'))), 200))
  app.openapi(replyRoutes.delete, async (c) => {
    await database(c.env ?? {}, (db) => replies.deleteReply(db, identity(c), c.req.valid('param').replyId))
    return c.body(null, 204)
  })
}
