import { createRoute, type RouteConfig } from '@hono/zod-openapi'
import { authErrors, commonErrors, json } from '../../shared/http'
import { cursor, ErrorSchema } from '../../shared/schemas'
import { FeedPage } from '../bookmarks/schemas'
import { FeedQuery } from './schemas'

const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]
export const feedRoutes = {
  get: createRoute({ method: 'get', path: '/api/v1/feed', operationId: 'getFeed', tags: ['Feed'], summary: '公開タイムライン',
    'x-implementation-status': 'implemented' as const, 'x-auth': 'OptionalAuth', security: optionalBearer,
    description: 'scope=allのみ実装済み（省略時all）。公開・未削除のみ、本人の非公開も除外。created_at DESC, id DESC、limit既定15・最大30、limit+1件で続きを判定。日時の小数6桁を保持。JWT任意だが提示時は必ず検証。未認証のlikedByMe=false。JWT検証→Zod入力検証→followingガード→allのみカーソル内容検証。scope=followingはIssue #14まで未実装で、未認証401・匿名403・正式JWT404。404はフォロー対象なしを意味せず一時的な未実装応答。フロントではIssue #14完了まで利用可能扱いしない。',
    request: { query: FeedQuery.extend({ cursor: cursor.openapi({ description: '日時・IDのBase64URLカーソル。署名・有効期限なし。allの内容不正は400 INVALID_CURSOR。followingでは非空文字列の内容検証よりガードを優先。空文字は400 VALIDATION_ERROR。公開・未削除条件をSQLで毎回確認。' }).optional() }) },
    responses: { ...commonErrors, ...authErrors, 200: json(FeedPage),
      401: json(ErrorSchema, 'UNAUTHORIZED: 提示JWTが無効・期限切れ、またはfollowingでJWTなし'),
      403: json(ErrorSchema, 'REGISTRATION_REQUIRED: followingを匿名JWTで指定'),
      404: json(ErrorSchema, 'NOT_FOUND: followingはIssue #14まで未実装（正式JWT）。フォロー対象の不存在ではない'),
    } }),
}
