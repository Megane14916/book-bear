import { createRoute } from '@hono/zod-openapi'
import { authErrors, commonErrors, json } from '../../shared/http'
import { BookmarkIdParams, cursor, ErrorSchema, PaginationQuery, UserIdParams } from '../../shared/schemas'
import { UserPage } from '../users/schemas'

const registered = { tags: ['Social'], security: [{ bearerAuth: [] }], 'x-auth': 'Registered', 'x-implementation-status': 'implemented' as const }
const errors = { ...commonErrors, ...authErrors, 403: json(ErrorSchema, 'REGISTRATION_REQUIRED: 匿名ユーザーの公開操作は不可') }
const empty = { 204: { description: '成功（本文なし）。有効な対象へのPUT/DELETEは冪等。' } }
const params = { params: UserIdParams }
const likeParams = { params: BookmarkIdParams }
const query = PaginationQuery.extend({ cursor: cursor.openapi({ description: '関係の日時・相手IDのBase64URL。署名・期限なし。不正内容は400 INVALID_CURSOR。対象UIDと関係の向きをSQLで毎回確認。' }).optional() })
const publicRoute = { tags: ['Social'], security: [], 'x-auth': 'Public', 'x-implementation-status': 'implemented' as const,
  request: { params: UserIdParams, query }, responses: { ...commonErrors, 200: json(UserPage) } }
export const socialRoutes = {
  followers: createRoute({ ...publicRoute, method: 'get', path: '/api/v1/users/{userId}/followers', operationId: 'getUsersUseridFollowers', summary: 'followers一覧',
    description: '公開のUserSummaryのみ。関係のcreated_at DESC, 相手ID DESC。limit既定15・最大30、limit+1件で続きを判定。対象プロフィールなし404、関係なし200空結果。' }),
  following: createRoute({ ...publicRoute, method: 'get', path: '/api/v1/users/{userId}/following', operationId: 'getUsersUseridFollowing', summary: 'following一覧',
    description: '公開のUserSummaryのみ。関係のcreated_at DESC, 相手ID DESC。limit既定15・最大30、limit+1件で続きを判定。対象プロフィールなし404、関係なし200空結果。' }),
  follow: createRoute({ ...registered, method: 'put', path: '/api/v1/users/{userId}/follow', operationId: 'putUsersUseridFollow', summary: 'フォロー追加',
    description: 'JWT→Zod入力検証→正式登録ガード。自己指定400。本人プロフィールと対象の正式登録確認履歴が必要、未確認・不存在404。正式JWTでPUT /meを実行して確認履歴を記録する。重複で日時・件数を変えない。', request: params, responses: { ...errors, ...empty } }),
  unfollow: createRoute({ ...registered, method: 'delete', path: '/api/v1/users/{userId}/follow', operationId: 'deleteUsersUseridFollow', summary: 'フォロー解除',
    description: 'JWT→Zod入力検証→正式登録ガード。自己指定400、プロフィールなし404。対象の登録確認履歴は不問で、自分の関係だけを解除。解除済みも204。', request: params, responses: { ...errors, ...empty } }),
  like: createRoute({ ...registered, method: 'put', path: '/api/v1/bookmarks/{bookmarkId}/like', operationId: 'putBookmarksBookmarkidLike', summary: 'いいね追加',
    description: 'JWT→Zod入力検証→正式登録ガード。公開・未削除の元栞だけ。FOR SHAREで状態を確認して本人のいいねを追加。非公開は本人にも404。重複は204。', request: likeParams, responses: { ...errors, ...empty } }),
  unlike: createRoute({ ...registered, method: 'delete', path: '/api/v1/bookmarks/{bookmarkId}/like', operationId: 'deleteBookmarksBookmarkidLike', summary: 'いいね解除',
    description: 'JWT→Zod入力検証→正式登録ガード。公開・未削除の元栞をFOR SHAREで確認し、本人のいいねだけを解除。解除済みも204。非公開化・削除後は本人にも404。', request: likeParams, responses: { ...errors, ...empty } }),
}
