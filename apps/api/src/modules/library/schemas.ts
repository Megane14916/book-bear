import { z } from '@hono/zod-openapi'
import { count, cursorPage, dateTime, patchObject, uuid } from '../../shared/schemas'
import { BookSummary } from '../books/schemas'

export const ReadingStatus = z.enum(['want_to_read', 'reading', 'completed'])
export const UserBook = z.object({
  id: uuid, userId: uuid, book: BookSummary, status: ReadingStatus,
  currentPage: count.nullable(), createdAt: dateTime, updatedAt: dateTime,
}).openapi('UserBook')
export const CreateUserBookRequest = z.object({
  bookId: uuid, status: ReadingStatus.optional(),
}).strict().openapi('CreateUserBookRequest')
export const PatchUserBookRequest = patchObject({
  status: ReadingStatus, currentPage: count.nullable(),
}).openapi('PatchUserBookRequest')
export const UserBookPage = cursorPage('UserBookPage', UserBook)
