import { z } from '@hono/zod-openapi'
import { cursorPage, nonEmptyText, positivePage, uuid } from '../../shared/schemas'

export const BookProvider = z.enum(['google_books', 'openbd'])
export const Isbn13 = z.string().regex(/^97[89]\d{10}$/).refine((value) => {
  const sum = [...value].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return sum % 10 === 0
}, '有効なISBN-13を指定してください').openapi({ description: 'ハイフンなしのISBN-13。978/979の接頭辞とチェックディジットを検証。' })

export const BookSummary = z.object({
  id: uuid,
  isbn13: Isbn13.nullable(),
  title: nonEmptyText(),
  author: z.string().nullable(),
  coverUrl: z.string().url().nullable(),
}).openapi('BookSummary')
export const Book = BookSummary.extend({
  publisher: z.string().nullable(),
  totalPages: positivePage.nullable(),
  source: z.enum(['google_books', 'openbd', 'manual']),
}).openapi('Book')
export const BookSearchItem = z.object({
  ...BookSummary.omit({ id: true }).shape,
  localBookId: uuid.nullable(),
  provider: BookProvider.nullable(),
  providerId: nonEmptyText().nullable(),
  totalPages: positivePage.nullable(),
}).refine((item) => item.localBookId !== null || (item.provider !== null && item.providerId !== null), {
  message: '外部候補にはproviderとproviderIdが必要です',
}).openapi('BookSearchItem', {
  description: 'localBookIdがあればimport不要。外部候補はproviderとproviderIdを必ず持つ。',
})
export const BookSearchResult = z.object({ items: z.array(BookSearchItem) }).openapi('BookSearchResult')
export const ImportBookRequest = z.object({
  provider: BookProvider, providerId: nonEmptyText(),
}).strict().superRefine((value, ctx) => {
  if (value.provider === 'openbd' && !Isbn13.safeParse(value.providerId).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerId'], message: 'openBDのproviderIdはISBN-13です' })
  }
}).openapi('ImportBookRequest', { description: '書誌情報はサーバーで再取得する。openBDのproviderIdはISBN-13。' })
export const ManualBookRequest = z.object({
  title: nonEmptyText(), author: z.string().nullable().optional(), totalPages: positivePage.nullable().optional(),
}).strict().openapi('ManualBookRequest')
export const PublicBookPage = cursorPage('PublicBookPage', BookSummary)
