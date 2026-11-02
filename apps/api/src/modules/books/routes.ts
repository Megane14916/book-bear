import { createRoute } from '@hono/zod-openapi'
import { BookIdParams, ErrorSchema, SearchQuery } from '../../shared/schemas'
import { authErrors, body, commonErrors, json } from '../../shared/http'
import { Book, BookSearchResult, ImportBookRequest, ManualBookRequest } from './schemas'

const base = { tags: ['Books'], 'x-implementation-status': 'implemented' as const }
const authenticated = { ...base, security: [{ bearerAuth: [] }], 'x-auth': 'AnyAuth' }
const publicRoute = { ...base, security: [], 'x-auth': 'Public' }
const providerError = { 502: json(ErrorSchema, 'BOOK_PROVIDER_UNAVAILABLE: 外部書籍API障害（検索はDB候補があれば200）') }

export const bookRoutes = {
  search: createRoute({ ...publicRoute, method: 'get', path: '/api/v1/books/search', operationId: 'getBooksSearch', summary: '書名・著者・ISBNから書籍候補を検索',
    description: 'DB候補を優先。外部API障害でもDB候補があれば200、なければ502。limit既定20・最大30。',
    request: { query: SearchQuery }, responses: { 400: commonErrors[400], 500: commonErrors[500], ...providerError, 200: json(BookSearchResult) } }),
  get: createRoute({ ...publicRoute, method: 'get', path: '/api/v1/books/{bookId}', operationId: 'getBooksBookid', summary: '書籍詳細',
    request: { params: BookIdParams }, responses: { ...commonErrors, 200: json(Book) } }),
  import: createRoute({ ...authenticated, method: 'post', path: '/api/v1/books/import', operationId: 'postBooksImport', summary: '外部書籍情報の取り込み',
    description: '外部APIから再取得・検証。同一ISBN-13は既存を再利用。ISBNなしは重複を許容する。プロフィール未初期化は404。',
    request: { body: body(ImportBookRequest) }, responses: { ...commonErrors, ...authErrors, ...providerError, 200: json(Book, '既存書籍を再利用'), 201: json(Book, '新規書籍') } }),
  manual: createRoute({ ...authenticated, method: 'post', path: '/api/v1/books/manual', operationId: 'postBooksManual', summary: 'ISBNなしの書籍を手動登録',
    description: 'ISBNは受け付けない。作成者はJWTから追跡。ISBNなしの重複は許容し、レート制限は今回の対象外。プロフィール未初期化は404。',
    request: { body: body(ManualBookRequest) }, responses: { ...commonErrors, ...authErrors, 201: json(Book) } }),
}
