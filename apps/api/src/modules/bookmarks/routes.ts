import { createRoute, type RouteConfig } from '@hono/zod-openapi'
import { authErrors, body, commonErrors, json } from '../../shared/http'
import { BookmarkFlowParams, BookmarkIdParams, cursor, ErrorSchema, PaginationQuery } from '../../shared/schemas'
import { BookmarkCard, BookmarkFlowPage, CreateBookmarkRequest, FeedPage, PatchBookmarkRequest } from './schemas'

const owner = { tags: ['Bookmarks'], security: [{ bearerAuth: [] }], 'x-implementation-status': 'implemented' as const, 'x-auth': 'Owner' }
const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]
const errors = { ...commonErrors, ...authErrors, 404: json(ErrorSchema, 'NOT_FOUND: 対象なし。他人の栞・本棚、第三者の非公開栞、削除済み栞も404') }
const publishError = { 403: json(ErrorSchema, 'REGISTRATION_REQUIRED: 匿名ユーザーは公開状態の作成・編集不可') }
const query = PaginationQuery.extend({ cursor: cursor.openapi({ description: '日時・IDのBase64URLカーソル。署名・有効期限なし。不正形式は400 INVALID_CURSOR。SQLで本人・未削除条件を毎回確認。' }).optional() })

export const bookmarkRoutes = {
  flow: createRoute({ ...owner, 'x-auth': 'OptionalAuth', security: optionalBearer, method: 'get', path: '/api/v1/users/{userId}/books/{bookId}/bookmarks', operationId: 'getUsersUseridBooksBookidBookmarks', summary: '栞の流れ',
    description: 'JWT任意。提示時は必ず検証。本人は公開・非公開、それ以外は公開のみ。削除済みは除外。created_at ASC, id ASC（ページ番号順ではない）。limit既定15・最大30、limit+1件で続きを判定。日時はDBの小数6桁を保持。組み合わせや閲覧可能な栞がなければitems=[]。authorとbookはルートに1回だけ。',
    request: { params: BookmarkFlowParams, query: PaginationQuery.extend({ cursor: cursor.openapi({ description: '日時・IDのBase64URLカーソル。署名・有効期限なし。不正形式は400 INVALID_CURSOR。SQLで対象本棚・公開範囲・未削除条件を毎回確認。' }).optional() }) },
    responses: { ...errors, 401: json(ErrorSchema, 'UNAUTHORIZED: 提示されたJWTが無効・期限切れ'), 404: json(ErrorSchema, 'NOT_FOUND: 対象プロフィールまたは書籍が存在しない'), 200: json(BookmarkFlowPage) } }),
  create: createRoute({ ...owner, 'x-auth': 'AnyAuth', method: 'post', path: '/api/v1/bookmarks', operationId: 'postBookmarks', summary: '栞作成',
    description: 'JWT本人の本棚のみ。公開は正式ユーザーのみ。省略時private・isSpoiler=false。所有者確認・本棚の状態をreadingに更新・栞のINSERT・応答取得は同一トランザクション。',
    request: { body: body(CreateBookmarkRequest) }, responses: { ...errors, ...publishError, 201: json(BookmarkCard) } }),
  get: createRoute({ ...owner, 'x-auth': 'OptionalAuth', security: optionalBearer, method: 'get', path: '/api/v1/bookmarks/{bookmarkId}', operationId: 'getBookmarksBookmarkid', summary: '公開または本人の栞詳細',
    description: 'JWT任意。提示時は必ず検証。不正JWTは401。非公開は本人のみ、削除済みは本人にも404。',
    request: { params: BookmarkIdParams }, responses: { ...errors, 200: json(BookmarkCard) } }),
  patch: createRoute({ ...owner, method: 'patch', path: '/api/v1/bookmarks/{bookmarkId}', operationId: 'patchBookmarksBookmarkid', summary: '自分の栞を編集',
    description: '本人・未削除を行ロックして確認。更新後がpublicなら匿名は403（visibility省略も同様）。所属先・createdAtは変更不可。pageNumberはDB正整数またはnull。',
    request: { params: BookmarkIdParams, body: body(PatchBookmarkRequest) }, responses: { ...errors, ...publishError, 200: json(BookmarkCard) } }),
  delete: createRoute({ ...owner, method: 'delete', path: '/api/v1/bookmarks/{bookmarkId}', operationId: 'deleteBookmarksBookmarkid', summary: '自分の栞を論理削除',
    description: '本人のみ。deletedAt・updatedAtをDB時刻で更新。削除済みへの再DELETEは404。関連行と本棚を保持する。',
    request: { params: BookmarkIdParams }, responses: { ...errors, 204: { description: '成功（本文なし）' } } }),
  list: createRoute({ ...owner, method: 'get', path: '/api/v1/me/bookmarks', operationId: 'getMeBookmarks', summary: '自分の公開・非公開栞',
    description: 'JWT本人の未削除栞のみ。created_at DESC, id DESC（ページ番号順ではない）。limit既定15・最大30、limit+1件で続きを判定。日時はDBの小数6桁を保持。',
    request: { query }, responses: { ...errors, 200: json(FeedPage) } }),
}
