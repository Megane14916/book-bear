import type { ManualBookInput } from './api'

export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export type ManualErrors = { title?: string; totalPages?: string }
export function validateManualBook(input: { title: string; author: string; totalPages: string }):
  { data: ManualBookInput; errors?: never } | { errors: ManualErrors; data?: never } {
  const title = input.title.trim(), pages = input.totalPages.trim()
  const errors: ManualErrors = {}
  if (!title) errors.title = 'タイトルを入力してください。'
  if (pages && (!/^\d+$/.test(pages) || !Number.isSafeInteger(Number(pages)) || Number(pages) < 1 || Number(pages) > 2147483647)) {
    errors.totalPages = '総ページ数は1〜2,147,483,647の整数で入力してください。'
  }
  if (Object.keys(errors).length) return { errors }
  return { data: { title, author: input.author.trim() || null, totalPages: pages ? Number(pages) : null } }
}
