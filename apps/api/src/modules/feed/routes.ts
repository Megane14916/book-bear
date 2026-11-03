import { createRoute, type RouteConfig } from '@hono/zod-openapi'
import { authErrors, commonErrors, json } from '../../shared/http'
import { cursor, ErrorSchema } from '../../shared/schemas'
import { FeedPage } from '../bookmarks/schemas'
import { FeedQuery } from './schemas'

const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]
export const feedRoutes = {
  get: createRoute({ method: 'get', path: '/api/v1/feed', operationId: 'getFeed', tags: ['Feed'], summary: '公開タイムライン',
    'x-implementation-status': 'implemented' as const, 'x-auth': 'OptionalAuth', security: optionalBearer,
    description: 'all（省略時）はJWT任意、followingは正式ユーザー本人のフォロー先のみ。両方とも公開・未削除のみで本人の非公開も除外。created_at DESC, id DESC、limit既定15・最大30、limit+1件で続きを判定。DB日時の小数6桁を保持し一括集計。提示JWTは必ず検証、未認証のlikedByMe=false。JWT→Zod入力検証→followingの認証・登録ガード→カーソル内容検証。フォロー先・公開栞なしは200空結果。',
    request: { query: FeedQuery.extend({ cursor: cursor.openapi({ description: '日時・IDのBase64URLカーソル。署名・有効期限なし。内容不正は400 INVALID_CURSOR、空文字は400 VALIDATION_ERROR。followingは内容検証前に未認証401／匿名403。フォロー関係・公開・未削除条件をSQLで毎回確認。' }).optional() }) },
    responses: { ...commonErrors, ...authErrors, 200: json(FeedPage),
      401: json(ErrorSchema, 'UNAUTHORIZED: 提示JWTが無効・期限切れ、またはfollowingでJWTなし'),
      403: json(ErrorSchema, 'REGISTRATION_REQUIRED: followingを匿名JWTで指定'),
      404: json(ErrorSchema, 'NOT_FOUND: followingで本人プロフィール未初期化'),
    } }),
}
