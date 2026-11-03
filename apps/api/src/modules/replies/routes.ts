import { createRoute, type RouteConfig } from '@hono/zod-openapi'
import { authErrors, body, commonErrors, json } from '../../shared/http'
import { BookmarkIdParams, cursor, ErrorSchema, PaginationQuery, ReplyIdParams } from '../../shared/schemas'
import { CreateReplyRequest, PatchReplyRequest, Reply, ReplyPage } from './schemas'

const owner = { tags: ['Replies'], security: [{ bearerAuth: [] }], 'x-auth': 'Owner', 'x-implementation-status': 'implemented' as const }
const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]
const errors = { ...commonErrors, ...authErrors, 404: json(ErrorSchema, 'NOT_FOUND: 対象なし、削除済み、または操作の所有者・閲覧条件を満たさない') }
const publishError = { 403: json(ErrorSchema, 'REGISTRATION_REQUIRED: 公開操作は正式登録が必要') }
export const replyRoutes = {
  list: createRoute({ ...owner, 'x-auth': 'OptionalAuth', security: optionalBearer, method: 'get', path: '/api/v1/bookmarks/{bookmarkId}/replies', operationId: 'getBookmarksBookmarkidReplies', summary: '栞の返信一覧',
    description: 'JWT任意、提示時は検証。公開元栞は全員、非公開は元栞の所有者だけ。元栞なし・削除済み・閲覧不可404。返信なし・削除済みのみ・境界より後なしは200空結果。返信のcreated_at ASC, id ASC、既定15・最大30、limit+1。親の可読性と返信条件は同じSQLで適用。',
    request: { params: BookmarkIdParams, query: PaginationQuery.extend({ cursor: cursor.openapi({ description: '返信日時・IDのBase64URL。署名・期限なし、DBの小数6桁を保持。不正内容は400 INVALID_CURSOR。親・公開範囲・未削除条件をSQLで毎回確認。' }).optional() }) },
    responses: { ...errors, 200: json(ReplyPage) } }),
  create: createRoute({ ...owner, 'x-auth': 'Registered', method: 'post', path: '/api/v1/bookmarks/{bookmarkId}/replies', operationId: 'postBookmarksBookmarkidReplies', summary: '公開栞に返信',
    description: 'JWT→Zod入力検証→正式登録ガード。公開・未削除の元栞をFOR SHAREで確認。INSERTと応答取得を同一トランザクションで実施。返信は1階層、isSpoiler省略時false。',
    request: { params: BookmarkIdParams, body: body(CreateReplyRequest) }, responses: { ...errors, ...publishError, 201: json(Reply) } }),
  patch: createRoute({ ...owner, method: 'patch', path: '/api/v1/replies/{replyId}', operationId: 'patchRepliesReplyid', summary: '自分の返信を編集',
    description: '本人・未削除と元栞の可読性が必要。親FOR SHARE→返信FOR UPDATEの順。公開元栞への編集は匿名403。自分の非公開元栞の自分の返信は匿名でも編集可。本文・isSpoiler以外は変更不可。',
    request: { params: ReplyIdParams, body: body(PatchReplyRequest) }, responses: { ...errors, ...publishError, 200: json(Reply) } }),
  delete: createRoute({ ...owner, method: 'delete', path: '/api/v1/replies/{replyId}', operationId: 'deleteRepliesReplyid', summary: '自分の返信を論理削除',
    description: '匿名・正式とも自分の未削除返信を削除可能。元栞の非公開化・論理削除後も可。親の確認・ロックなし。返信の所有者・未削除条件をSQLで適用し、deletedAtとupdatedAtを同じDB時刻で更新。成功204本文なしで親情報は返さない。他人・削除済み・不存在・再DELETEは404。',
    request: { params: ReplyIdParams }, responses: { ...errors, 204: { description: '成功（本文なし）' } } }),
}
