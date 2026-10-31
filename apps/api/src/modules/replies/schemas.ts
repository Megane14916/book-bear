import { z } from '@hono/zod-openapi'
import { cursorPage, dateTime, nonEmptyText, patchObject, uuid } from '../../shared/schemas'
import { UserSummary } from '../users/schemas'

export const ReplyContent = nonEmptyText().max(1000)
export const Reply = z.object({
  id: uuid, author: UserSummary, content: ReplyContent, isSpoiler: z.boolean(),
  createdAt: dateTime, updatedAt: dateTime,
}).openapi('Reply')
export const CreateReplyRequest = z.object({
  content: ReplyContent, isSpoiler: z.boolean().default(false),
}).strict().openapi('CreateReplyRequest')
export const PatchReplyRequest = patchObject({
  content: ReplyContent, isSpoiler: z.boolean(),
}).openapi('PatchReplyRequest')
export const ReplyPage = cursorPage('ReplyPage', Reply)
