import { z } from '@hono/zod-openapi'
import { count, cursor, cursorPage, dateTime, nonEmptyText, patchObject, positivePage, uuid } from '../../shared/schemas'
import { BookSummary } from '../books/schemas'
import { UserSummary } from '../users/schemas'

export const BookmarkContent = nonEmptyText().max(2000)
export const Visibility = z.enum(['public', 'private'])
export const BookmarkFlowItem = z.object({
  id: uuid, pageNumber: positivePage.nullable(), content: BookmarkContent,
  visibility: Visibility, isSpoiler: z.boolean(), likeCount: count, replyCount: count,
  likedByMe: z.boolean(), createdAt: dateTime, updatedAt: dateTime,
}).openapi('BookmarkFlowItem')
export const BookmarkCard = BookmarkFlowItem.extend({
  author: UserSummary, book: BookSummary,
}).openapi('BookmarkCard')
export const CreateBookmarkRequest = z.object({
  userBookId: uuid, pageNumber: positivePage.nullable().optional(), content: BookmarkContent,
  visibility: Visibility.default('private'), isSpoiler: z.boolean().default(false),
}).strict().openapi('CreateBookmarkRequest')
export const PatchBookmarkRequest = patchObject({
  pageNumber: positivePage.nullable(), content: BookmarkContent, visibility: Visibility, isSpoiler: z.boolean(),
}).openapi('PatchBookmarkRequest')
export const FeedPage = cursorPage('FeedPage', BookmarkCard)
export const BookmarkFlowPage = z.object({
  author: UserSummary, book: BookSummary, items: z.array(BookmarkFlowItem), nextCursor: cursor.nullable(),
}).openapi('BookmarkFlowPage')
