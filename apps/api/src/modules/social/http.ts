import type { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { ApiError } from '../../shared/errors'
import { identity } from '../../shared/http'
import { socialRoutes } from './routes'
import * as social from './service'

// Called inside handlers, after OpenAPI's Zod validators.
function registered(c: Context<AppEnv>) {
  const viewer = identity(c)
  if (viewer.isAnonymous) throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
  return viewer
}
export function registerSocialRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  for (const kind of ['followers', 'following']) app.use(`/api/v1/users/:userId/${kind}`, async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.use('/api/v1/users/:userId/follow', auth.required)
  app.use('/api/v1/bookmarks/:bookmarkId/like', auth.required)
  app.openapi(socialRoutes.followers, async (c) => c.json(await database(c.env ?? {}, (db) => social.listRelations(db, c.req.valid('param').userId, 'followers', c.req.valid('query'))), 200))
  app.openapi(socialRoutes.following, async (c) => c.json(await database(c.env ?? {}, (db) => social.listRelations(db, c.req.valid('param').userId, 'following', c.req.valid('query'))), 200))
  app.openapi(socialRoutes.follow, async (c) => {
    const viewer = registered(c)
    await database(c.env ?? {}, (db) => social.follow(db, viewer, c.req.valid('param').userId, true))
    return c.body(null, 204)
  })
  app.openapi(socialRoutes.unfollow, async (c) => {
    const viewer = registered(c)
    await database(c.env ?? {}, (db) => social.follow(db, viewer, c.req.valid('param').userId, false))
    return c.body(null, 204)
  })
  app.openapi(socialRoutes.like, async (c) => {
    const viewer = registered(c)
    await database(c.env ?? {}, (db) => social.like(db, viewer, c.req.valid('param').bookmarkId, true))
    return c.body(null, 204)
  })
  app.openapi(socialRoutes.unlike, async (c) => {
    const viewer = registered(c)
    await database(c.env ?? {}, (db) => social.like(db, viewer, c.req.valid('param').bookmarkId, false))
    return c.body(null, 204)
  })
}
