import { z } from '@hono/zod-openapi'

export const uuid = z.string().uuid()
export const dateTime = z.string().datetime()
export const count = z.number().int().nonnegative()
export const positivePage = z.number().int().positive()
export const nonEmptyText = () => z.string().trim().min(1)
export const cursor = z.string().min(1).openapi({
  description: '不透明なカーソル。内容を解析せず次回の同じ条件のリクエストに渡す。不正・期限切れは400 INVALID_CURSOR。',
})

export const errorCodes = [
  'VALIDATION_ERROR', 'INVALID_CURSOR', 'UNAUTHORIZED', 'REGISTRATION_REQUIRED',
  'FORBIDDEN', 'NOT_FOUND', 'ALREADY_EXISTS', 'HAS_BOOKMARKS',
  'ACCOUNT_LINK_CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR', 'BOOK_PROVIDER_UNAVAILABLE',
] as const

export const ErrorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
}).openapi('Error')

// Only HTTP query values are coerced. JSON numbers/booleans stay strict.
export const limit = (defaultValue = 15) => z.coerce.number().int().min(1).max(30).default(defaultValue)
export const PaginationQuery = z.object({ cursor: cursor.optional(), limit: limit() })
export const SearchQuery = z.object({ q: nonEmptyText(), limit: limit(20) })

export const cursorPage = <T extends z.ZodTypeAny>(name: string, item: T) =>
  z.object({ items: z.array(item), nextCursor: cursor.nullable() }).openapi(name)

// PATCH must contain at least one supported field. Reject ownership/immutable fields.
export const patchObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).partial().strict().refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: '更新するフィールドを1つ以上指定してください' },
  ).openapi({ minProperties: 1 })

export const UserIdParams = z.object({ userId: uuid })
export const BookIdParams = z.object({ bookId: uuid })
export const UserBookIdParams = z.object({ userBookId: uuid })
export const BookmarkIdParams = z.object({ bookmarkId: uuid })
export const ReplyIdParams = z.object({ replyId: uuid })
export const BookmarkFlowParams = UserIdParams.extend({ bookId: uuid })
