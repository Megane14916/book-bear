import { z } from '@hono/zod-openapi'
import { count, cursorPage, dateTime, patchObject, positivePage, uuid } from '../../shared/schemas'
import { BookSummary } from '../books/schemas'

export const ReadingStatus = z.enum(['want_to_read', 'reading', 'completed'])
export const UserBook = z.object({
  id: uuid, userId: uuid, book: BookSummary, status: ReadingStatus,
  currentPage: count.nullable(), createdAt: dateTime, updatedAt: dateTime,
  latestBookmarkPage: positivePage.nullable().optional().openapi({ description: '最後に投稿した未削除の栞のページ。栞がない場合やページが未入力の場合はnull。' }),
}).openapi('UserBook')
export const CreateUserBookRequest = z.object({
  bookId: uuid, status: ReadingStatus.optional(),
}).strict().openapi('CreateUserBookRequest')
export const PatchUserBookRequest = patchObject({
  status: ReadingStatus, currentPage: count.max(2147483647).nullable(),
}).openapi('PatchUserBookRequest')
export const UserBookPage = cursorPage('UserBookPage', UserBook)
