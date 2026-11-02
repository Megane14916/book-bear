import { createRoute } from '@hono/zod-openapi'
import { cursor, ErrorSchema, PaginationQuery, UserBookIdParams, UserIdParams } from '../../shared/schemas'
import { authErrors, body, commonErrors, json } from '../../shared/http'
import { PublicBookPage } from '../books/schemas'
import { CreateUserBookRequest, PatchUserBookRequest, UserBook, UserBookPage } from './schemas'

const base = { tags: ['Library'], 'x-implementation-status': 'implemented' as const }
const owner = { ...base, security: [{ bearerAuth: [] }], 'x-auth': 'Owner' }
const errors = { ...commonErrors, ...authErrors }
const pagination = 'created_at DESC, id DESC。limit既定15・最大30、limit+1件で続きを判定。日時（小数6桁）・IDのBase64URLカーソル。署名・有効期限なし。SQLで所有者・公開条件を毎回検証。'
const libraryQuery = PaginationQuery.extend({ cursor: cursor.openapi({ description: '日時とIDのBase64URLカーソル。署名・有効期限なし。不正な形式は400 INVALID_CURSOR。認可はSQLで毎回確認。' }).optional() })

export const libraryRoutes = {
  list: createRoute({ ...owner, method: 'get', path: '/api/v1/me/books', operationId: 'getMeBooks', summary: '自分の本棚', description: pagination,
    request: { query: libraryQuery }, responses: { ...errors, 200: json(UserBookPage) } }),
  create: createRoute({ ...owner, 'x-auth': 'AnyAuth', method: 'post', path: '/api/v1/me/books', operationId: 'postMeBooks', summary: '本棚へ登録（冪等）',
    description: '同一ユーザー・書籍は既存を返し、状態・進捗・日時を変更しない。status省略時want_to_read。プロフィール未初期化は404。',
    request: { body: body(CreateUserBookRequest) }, responses: { ...errors, 200: json(UserBook, '既存を再利用'), 201: json(UserBook, '新規登録') } }),
  patch: createRoute({ ...owner, method: 'patch', path: '/api/v1/me/books/{userBookId}', operationId: 'patchMeBooksUserbookid', summary: '本棚情報更新',
    description: '本人のみ。他人のIDは404。currentPageは0以上のDB整数またはnull。総ページ数を上限としない。',
    request: { params: UserBookIdParams, body: body(PatchUserBookRequest) }, responses: { ...errors, 200: json(UserBook) } }),
  delete: createRoute({ ...owner, method: 'delete', path: '/api/v1/me/books/{userBookId}', operationId: 'deleteMeBooksUserbookid', summary: '本棚から削除',
    description: '本人のみ。他人のIDは404。論理削除済みを含む栞の参照があれば409 HAS_BOOKMARKS。共有書籍は削除しない。',
    request: { params: UserBookIdParams }, responses: { ...errors, 204: { description: '成功（本文なし）' }, 409: json(ErrorSchema, 'HAS_BOOKMARKS: 栞の参照が残っている') } }),
  publicBooks: createRoute({ ...base, security: [], 'x-auth': 'Public', method: 'get', path: '/api/v1/users/{userId}/books', operationId: 'getUsersUseridBooks', summary: '公開栞のある本一覧',
    description: `${pagination} 公開中・未削除の栞がある本だけ。状態・進捗・非公開栞は返さない。`,
    request: { params: UserIdParams, query: libraryQuery }, responses: { ...commonErrors, 200: json(PublicBookPage) } }),
}
