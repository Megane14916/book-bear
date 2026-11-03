import { createRoute, type RouteConfig } from '@hono/zod-openapi'
import { authErrors, commonErrors, json } from '../../shared/http'
import { ErrorSchema, PaginationQuery, SearchQuery, nonEmptyText } from '../../shared/schemas'
import { FeedPage } from '../bookmarks/schemas'
import { SearchUserPage } from '../users/schemas'

const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]
const errors = { 400: commonErrors[400], 500: commonErrors[500] }
export const searchRoutes = {
  posts: createRoute({ method: 'get', path: '/api/v1/search/posts', operationId: 'getSearchPosts', tags: ['Search'], summary: '公開栞のテキスト検索',
    'x-implementation-status': 'implemented' as const, 'x-auth': 'OptionalAuth', security: optionalBearer,
    description: 'JWTは任意、提示時は入力検証より先に必ず検証する。公開・未削除の本文をILIKEで部分一致検索し、本人の非公開も除外。%、_、バックスラッシュは文字として検索。created_at DESC, id DESC、limit既定15・最大30、limit+1で続きを判定。日時の小数6桁と既存カーソルを使い、同じ検索語で続きを取得する。いいね・未削除返信を一括集計し、未認証のlikedByMe=false。ネタバレの初期非表示はUIの責務。0件は200空配列。',
    request: { query: PaginationQuery.extend({ q: nonEmptyText() }) },
    responses: { ...errors, ...authErrors, 200: json(FeedPage), 401: json(ErrorSchema, 'UNAUTHORIZED: 提示JWTが無効・期限切れ') } }),
  users: createRoute({ method: 'get', path: '/api/v1/search/users', operationId: 'getSearchUsers', tags: ['Search'], summary: '登録確認済みユーザーの表示名・handle検索',
    'x-implementation-status': 'implemented' as const, 'x-auth': 'Public', security: [],
    description: '認証不要、Authorizationは検証しない。正式JWTによるPUT /meでregistration_confirmed_atが記録済みのプロフィールのみ。表示名またはhandleのILIKE部分一致、%、_、バックスラッシュは文字として検索。id・displayName・avatarUrl・nullableなhandleだけを返し、登録確認日時・Auth情報・私有情報は返さない。表示名ASC, ID ASC、limit既定20・最大30。MVPではカーソル入力なし、nextCursorは常にnull。上限を超える候補は追加取得できない。0件は200空配列。既存の公開プロフィール・フォロー一覧の権限や応答は変更しない。',
    request: { query: SearchQuery }, responses: { ...errors, 200: json(SearchUserPage) } }),
}
