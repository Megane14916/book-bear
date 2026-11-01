import type { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { withDatabase } from '../../db/client'
import type { AppEnv, authentication } from '../../middleware/auth'
import { unauthorized } from '../../shared/errors'
import { profileRoutes } from './routes'
import * as users from './service'

export function registerProfileRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use('/api/v1/me', auth.required)
  app.use('/api/v1/me/preferences', auth.required)
  app.use('/api/v1/users/:userId', auth.optional)
  const identity = (c: Context<AppEnv>) => {
    const viewer = c.get('identity')
    if (!viewer) throw unauthorized()
    return viewer
  }
  app.openapi(profileRoutes.getMe, async (c) => c.json(await database(c.env ?? {}, (db) => users.getMe(db, identity(c))), 200))
  app.openapi(profileRoutes.putMe, async (c) => c.json(await database(c.env ?? {}, (db) => users.initializeMe(db, identity(c))), 200))
  app.openapi(profileRoutes.patchMe, async (c) => c.json(await database(c.env ?? {}, (db) => users.patchMe(db, identity(c), c.req.valid('json'))), 200))
  app.openapi(profileRoutes.getPreferences, async (c) => c.json(await database(c.env ?? {}, (db) => users.getPreferences(db, identity(c))), 200))
  app.openapi(profileRoutes.patchPreferences, async (c) => c.json(await database(c.env ?? {}, (db) => users.patchPreferences(db, identity(c), c.req.valid('json'))), 200))
  app.openapi(profileRoutes.getPublicProfile, async (c) => c.json(await database(c.env ?? {}, (db) => users.getPublicProfile(db, c.req.valid('param').userId, c.get('identity'))), 200))
}
