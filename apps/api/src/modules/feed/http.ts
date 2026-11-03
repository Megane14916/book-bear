import type { OpenAPIHono } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { decodeCursor } from '../../shared/cursor'
import { ApiError, unauthorized } from '../../shared/errors'
import { listPublicBookmarks } from '../bookmarks/service'
import { feedRoutes } from './routes'

export function registerFeedRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use('/api/v1/feed', auth.optional)
  app.openapi(feedRoutes.get, async (c) => {
    const query = c.req.valid('query'), viewer = c.get('identity')
    if (query.scope === 'following') {
      if (!viewer) throw unauthorized()
      if (viewer.isAnonymous) throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
      throw new ApiError(404, 'NOT_FOUND', 'フォロー中フィードはまだ利用できません')
    }
    const boundary = decodeCursor(query.cursor)
    return c.json(await database(c.env ?? {}, (db) => listPublicBookmarks(db, { limit: query.limit, boundary }, viewer)), 200)
  })
}
