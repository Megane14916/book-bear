import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { withDatabase } from '../../db/client'
import { AiUnavailable, workersAi } from '../../integrations/workers-ai'
import type { AppEnv, authentication } from '../../middleware/auth'
import { ApiError, unauthorized } from '../../shared/errors'
import { ErrorSchema } from '../../shared/schemas'
import { BookSummary } from '../books/schemas'
import { loadRecommendationInput, rankRecommendations } from './service'

const json = (schema: z.ZodTypeAny, description: string) => ({ description, content: { 'application/json': { schema } } })
const recommendationRoute = createRoute({
  method: 'get', path: '/api/v1/me/recommendations', operationId: 'getMeRecommendations',
  summary: '自分の公開栞に基づく書籍推薦',
  description: '公開・未削除の栞を使用し、本人の本棚にある書籍を除外する。履歴・候補なしは空配列。',
  'x-implementation-status': 'implemented', 'x-auth': 'Registered', security: [{ bearerAuth: [] }],
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(10).default(5) }) },
  responses: {
    200: json(z.object({ items: z.array(BookSummary) }).openapi('BookRecommendations'), '推薦順の書籍'),
    400: json(ErrorSchema, '候補件数が範囲外'),
    401: json(ErrorSchema, '認証が必要'),
    403: json(ErrorSchema, '正式登録が必要'),
    404: json(ErrorSchema, 'プロフィールが未初期化'),
    500: json(ErrorSchema, '内部エラー'),
    503: json(ErrorSchema, 'AIまたは認証サービスを利用できない'),
  },
})

export function registerRecommendationRoutes(app: OpenAPIHono<AppEnv>, database: typeof withDatabase, auth: ReturnType<typeof authentication>) {
  app.use(recommendationRoute.path, auth.required)
  app.openapi(recommendationRoute, async (c) => {
    const viewer = c.get('identity')
    if (!viewer) throw unauthorized()
    if (viewer.isAnonymous) throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
    const env = c.env ?? {}
    const { history, candidates } = await database(env, (db) => loadRecommendationInput(db, viewer.id))
    try {
      const { limit } = c.req.valid('query')
      return c.json({ items: await rankRecommendations(history, candidates, workersAi(env).embed, limit) }, 200)
    } catch (error) {
      if (error instanceof AiUnavailable) throw new ApiError(503, 'INTERNAL_ERROR', '推薦サービスを利用できません')
      throw error
    }
  })
}
