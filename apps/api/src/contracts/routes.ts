import { createRoute, type RouteConfig, z } from '@hono/zod-openapi'
import {
  BookmarkFlowParams, BookmarkIdParams, BookIdParams, ErrorSchema, PaginationQuery,
  ReplyIdParams, SearchQuery, UserBookIdParams, UserIdParams, nonEmptyText,
} from '../shared/schemas'
import { UserPage } from '../modules/users/schemas'
import { Book, BookSearchResult, ImportBookRequest, ManualBookRequest, PublicBookPage } from '../modules/books/schemas'
import { CreateUserBookRequest, PatchUserBookRequest, UserBook, UserBookPage } from '../modules/library/schemas'
import { BookmarkCard, BookmarkFlowPage, CreateBookmarkRequest, FeedPage, PatchBookmarkRequest } from '../modules/bookmarks/schemas'
import { FeedQuery } from '../modules/feed/schemas'
import { CreateReplyRequest, PatchReplyRequest, Reply, ReplyPage } from '../modules/replies/schemas'

const json = (schema: z.ZodTypeAny, description = '成功') => ({
  description, content: { 'application/json': { schema } },
})
const body = (schema: z.ZodTypeAny) => ({ required: true, content: { 'application/json': { schema } } })
const noContent = { description: '成功（本文なし）。PUT/DELETEのフォロー・いいねは冪等。' }
const bearer: NonNullable<RouteConfig['security']> = [{ bearerAuth: [] }]
const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]

// Error bodies use the same schema; descriptions specify the applicable codes.
const errors = {
  400: json(ErrorSchema, 'VALIDATION_ERROR / INVALID_CURSOR: 入力不正、または不正・期限切れのカーソル'),
  401: json(ErrorSchema, 'UNAUTHORIZED: 必須JWTがない、または送信されたJWTが無効・期限切れ'),
  403: json(ErrorSchema, 'REGISTRATION_REQUIRED: 正式登録が必要 / FORBIDDEN: 操作権限なし'),
  404: json(ErrorSchema, 'NOT_FOUND: 対象なし。第三者の非公開栞・削除済み栞も存在を明かさず404'),
  409: json(ErrorSchema, 'ALREADY_EXISTS / HAS_BOOKMARKS / ACCOUNT_LINK_CONFLICT: 重複・競合'),
  429: json(ErrorSchema, 'RATE_LIMITED: 操作回数制限'),
  500: json(ErrorSchema, 'INTERNAL_ERROR: 内部情報を含めないサーバーエラー'),
  502: json(ErrorSchema, 'BOOK_PROVIDER_UNAVAILABLE: 外部書籍API障害'),
}
type Auth = 'Public' | 'OptionalAuth' | 'AnyAuth' | 'Owner' | 'Registered'
type PlannedRoute = RouteConfig & { 'x-implementation-status': 'planned'; 'x-auth': Auth }
const authNotes: Record<Auth, string> = {
  Public: '認証なしで利用可能。',
  OptionalAuth: 'JWTは任意。送信されたJWTは検証し、無効なら401。',
  AnyAuth: 'Supabase Bearer JWT必須。匿名・正式ユーザーともに利用可能。',
  Owner: 'Supabase Bearer JWT必須。匿名・正式ともに本人のみ。所有者は検証済みJWTのsubから判定。',
  Registered: 'Supabase Bearer JWT必須。is_anonymous=falseの正式ユーザーのみ。匿名は403 REGISTRATION_REQUIRED。',
}

function planned(route: RouteConfig, auth: Auth, codes: (keyof typeof errors)[] = []): PlannedRoute {
  const authErrors: (keyof typeof errors)[] = auth === 'Public' ? [] : [401]
  if (auth === 'Owner' || auth === 'Registered') authErrors.push(403)
  const responses = { ...route.responses }
  for (const code of new Set([400, 429, 500, ...authErrors, ...codes] as const)) responses[code] = errors[code]
  return {
    ...createRoute(route),
    security: auth === 'Public' ? [] : auth === 'OptionalAuth' ? optionalBearer : bearer,
    description: `【未実装・契約のみ】実APIのハンドラーは未登録（現在は404）。${authNotes[auth]} ${route.description ?? ''}`,
    responses,
    'x-implementation-status': 'planned',
    'x-auth': auth,
  }
}

const descPagination = 'limitは既定15・最大30。SQLはlimit+1件取得し、続きがなければnextCursor=null。カーソルの署名または対象・条件の厳格照合が必要。'
const descNewest = `${descPagination} created_at DESC, id DESC。`
const descOldest = `${descPagination} created_at ASC, id ASC（ページ番号順ではない）。`
const publicBookmark = '公開栞のみ。他人の非公開栞および削除済み栞は返さない。'
const registeredPublish = 'visibility=publicの作成・公開化は正式ユーザーのみ（匿名は403 REGISTRATION_REQUIRED）。userBookIdの所有権をJWTのsubで確認。'

// These definitions are registered only in the OpenAPI registry, never as HTTP handlers.
// When implementing an operation, reuse its schema/route and move it to app.openapi().
export const plannedRoutes: PlannedRoute[] = [
  ...(['followers', 'following'] as const).map((kind) => planned({
    method: 'get', path: `/api/v1/users/{userId}/${kind}`,
    operationId: kind === 'followers' ? 'getUsersUseridFollowers' : 'getUsersUseridFollowing',
    tags: ['Social'], summary: `${kind}一覧`, description: descPagination,
    request: { params: UserIdParams, query: PaginationQuery }, responses: { 200: json(UserPage) },
  }, 'Public', [404])),
  planned({ method: 'get', path: '/api/v1/books/search', operationId: 'getBooksSearch', tags: ['Books'], summary: '書名・著者・ISBNから書籍候補を検索',
    request: { query: SearchQuery }, responses: { 200: json(BookSearchResult) } }, 'Public', [502]),
  planned({ method: 'get', path: '/api/v1/books/{bookId}', operationId: 'getBooksBookid', tags: ['Books'], summary: '書籍詳細',
    request: { params: BookIdParams }, responses: { 200: json(Book) } }, 'Public', [404]),
  planned({ method: 'post', path: '/api/v1/books/import', operationId: 'postBooksImport', tags: ['Books'], summary: '外部書籍情報の取り込み',
    description: '外部APIから再取得・正規化。同一ISBN-13は既存のbookIdを再利用。',
    request: { body: body(ImportBookRequest) }, responses: { 200: json(Book, '既存書籍を再利用'), 201: json(Book, '新規書籍') } }, 'AnyAuth', [404, 502]),
  planned({ method: 'post', path: '/api/v1/books/manual', operationId: 'postBooksManual', tags: ['Books'], summary: 'ISBNなしの書籍を手動登録',
    description: 'ISBNは受け付けない。作成者はJWTから追跡する。', request: { body: body(ManualBookRequest) }, responses: { 201: json(Book) } }, 'AnyAuth'),
  planned({ method: 'get', path: '/api/v1/me/books', operationId: 'getMeBooks', tags: ['Library'], summary: '自分の本棚', description: descNewest,
    request: { query: PaginationQuery }, responses: { 200: json(UserBookPage) } }, 'Owner'),
  planned({ method: 'post', path: '/api/v1/me/books', operationId: 'postMeBooks', tags: ['Library'], summary: '本棚へ登録（冪等）',
    description: '同一ユーザー・書籍は既存レコードを返す。', request: { body: body(CreateUserBookRequest) },
    responses: { 200: json(UserBook, '既存を再利用'), 201: json(UserBook, '新規登録') } }, 'AnyAuth', [404]),
  planned({ method: 'patch', path: '/api/v1/me/books/{userBookId}', operationId: 'patchMeBooksUserbookid', tags: ['Library'], summary: '本棚情報更新',
    description: 'currentPageは0以上またはnull。総ページ数を上限としない。', request: { params: UserBookIdParams, body: body(PatchUserBookRequest) }, responses: { 200: json(UserBook) } }, 'Owner', [404]),
  planned({ method: 'delete', path: '/api/v1/me/books/{userBookId}', operationId: 'deleteMeBooksUserbookid', tags: ['Library'], summary: '本棚から削除',
    description: '栞があれば409 HAS_BOOKMARKS。共有の書籍マスタは削除しない。', request: { params: UserBookIdParams }, responses: { 204: noContent } }, 'Owner', [404, 409]),
  planned({ method: 'get', path: '/api/v1/users/{userId}/books', operationId: 'getUsersUseridBooks', tags: ['Library'], summary: '公開栞のある本一覧',
    description: `${descNewest} 公開中・未削除の栞が1件以上ある本のみ。本棚全体は公開しない。`,
    request: { params: UserIdParams, query: PaginationQuery }, responses: { 200: json(PublicBookPage) } }, 'Public', [404]),
  planned({ method: 'post', path: '/api/v1/bookmarks', operationId: 'postBookmarks', tags: ['Bookmarks'], summary: '栞作成', description: registeredPublish,
    request: { body: body(CreateBookmarkRequest) }, responses: { 201: json(BookmarkCard) } }, 'AnyAuth', [403, 404]),
  planned({ method: 'get', path: '/api/v1/bookmarks/{bookmarkId}', operationId: 'getBookmarksBookmarkid', tags: ['Bookmarks'], summary: '公開または本人の栞詳細',
    description: '非公開は本人のみ取得可能。他人の非公開栞・削除済みは404。', request: { params: BookmarkIdParams }, responses: { 200: json(BookmarkCard) } }, 'OptionalAuth', [404]),
  planned({ method: 'patch', path: '/api/v1/bookmarks/{bookmarkId}', operationId: 'patchBookmarksBookmarkid', tags: ['Bookmarks'], summary: '自分の栞を編集',
    description: `${registeredPublish} createdAt・所属する本棚は変更できない。`, request: { params: BookmarkIdParams, body: body(PatchBookmarkRequest) }, responses: { 200: json(BookmarkCard) } }, 'Owner', [404]),
  planned({ method: 'delete', path: '/api/v1/bookmarks/{bookmarkId}', operationId: 'deleteBookmarksBookmarkid', tags: ['Bookmarks'], summary: '自分の栞を論理削除',
    request: { params: BookmarkIdParams }, responses: { 204: noContent } }, 'Owner', [404]),
  planned({ method: 'get', path: '/api/v1/me/bookmarks', operationId: 'getMeBookmarks', tags: ['Bookmarks'], summary: '自分の公開・非公開栞', description: descNewest,
    request: { query: PaginationQuery }, responses: { 200: json(FeedPage) } }, 'Owner'),
  planned({ method: 'get', path: '/api/v1/users/{userId}/books/{bookId}/bookmarks', operationId: 'getUsersUseridBooksBookidBookmarks', tags: ['Bookmarks'], summary: '栞の流れ',
    description: `${descOldest} 本人は公開・非公開、それ以外は公開のみ。ユーザー・本が存在しても組み合わせや公開栞がなければitems=[]。authorとbookはルートに1回だけ。`,
    request: { params: BookmarkFlowParams, query: PaginationQuery }, responses: { 200: json(BookmarkFlowPage) } }, 'OptionalAuth', [404]),
  planned({ method: 'get', path: '/api/v1/feed', operationId: 'getFeed', tags: ['Feed'], summary: '公開タイムライン',
    description: `${descNewest} ${publicBookmark} scope=followingは正式ユーザーのみ（未認証401、匿名403 REGISTRATION_REQUIRED）。allはJWT任意。未認証のlikedByMeはfalse。`,
    request: { query: FeedQuery }, responses: { 200: json(FeedPage) } }, 'OptionalAuth', [403]),
  ...(['put', 'delete'] as const).map((method) => planned({
    method, path: '/api/v1/users/{userId}/follow', operationId: `${method}UsersUseridFollow`, tags: ['Social'], summary: method === 'put' ? 'フォロー追加' : 'フォロー解除',
    description: '自己フォローは禁止。対象も正式ユーザーであることをサーバーで確認。', request: { params: UserIdParams }, responses: { 204: noContent },
  }, 'Registered', [404])),
  ...(['put', 'delete'] as const).map((method) => planned({
    method, path: '/api/v1/bookmarks/{bookmarkId}/like', operationId: `${method}BookmarksBookmarkidLike`, tags: ['Social'], summary: method === 'put' ? 'いいね追加' : 'いいね解除',
    description: publicBookmark, request: { params: BookmarkIdParams }, responses: { 204: noContent },
  }, 'Registered', [404])),
  planned({ method: 'get', path: '/api/v1/bookmarks/{bookmarkId}/replies', operationId: 'getBookmarksBookmarkidReplies', tags: ['Replies'], summary: '栞の返信一覧',
    description: `${descOldest} 元栞が非公開なら本人のみ取得可能。他人の非公開・削除済み栞は返信も404。`, request: { params: BookmarkIdParams, query: PaginationQuery }, responses: { 200: json(ReplyPage) } }, 'OptionalAuth', [404]),
  planned({ method: 'post', path: '/api/v1/bookmarks/{bookmarkId}/replies', operationId: 'postBookmarksBookmarkidReplies', tags: ['Replies'], summary: '公開栞に返信',
    description: `${publicBookmark} 返信は1階層のみ。`, request: { params: BookmarkIdParams, body: body(CreateReplyRequest) }, responses: { 201: json(Reply) } }, 'Registered', [404]),
  planned({ method: 'patch', path: '/api/v1/replies/{replyId}', operationId: 'patchRepliesReplyid', tags: ['Replies'], summary: '自分の返信を編集',
    request: { params: ReplyIdParams, body: body(PatchReplyRequest) }, responses: { 200: json(Reply) } }, 'Owner', [404]),
  planned({ method: 'delete', path: '/api/v1/replies/{replyId}', operationId: 'deleteRepliesReplyid', tags: ['Replies'], summary: '自分の返信を論理削除',
    request: { params: ReplyIdParams }, responses: { 204: noContent } }, 'Owner', [404]),
  planned({ method: 'get', path: '/api/v1/search/posts', operationId: 'getSearchPosts', tags: ['Search'], summary: '公開栞のテキスト検索',
    description: `${descNewest} ${publicBookmark} 未認証のlikedByMeはfalse。`, request: { query: PaginationQuery.extend({ q: nonEmptyText() }) }, responses: { 200: json(FeedPage) } }, 'OptionalAuth'),
  planned({ method: 'get', path: '/api/v1/search/users', operationId: 'getSearchUsers', tags: ['Search'], summary: '表示名・handle検索',
    description: 'limit既定20・最大30。初期ドラフト互換のUserPageを返し、nextCursorはnull（カーソル入力なし）。',
    request: { query: SearchQuery }, responses: { 200: json(UserPage) } }, 'Public'),
]
