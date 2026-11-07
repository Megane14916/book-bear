import { HttpError } from '../../lib/api/errors'
import type { BookmarkInput } from './api'

export const registrationMessage = '公開するには正式登録が必要です。Google連携機能の提供後に登録できます。非公開での保存をご利用ください。'

export function validateBookmark(content: string, page: string): string | null {
  if (!content.trim()) return '本文を入力してください（空白のみは保存できません）。'
  if (content.trim().length > 2000) return '本文は2,000文字以内で入力してください。'
  if (page.trim() && (!/^\d+$/.test(page.trim()) || Number(page) < 1 || Number(page) > 2_147_483_647)) {
    return 'ページ番号は1〜2,147,483,647の整数で入力してください。'
  }
  return null
}

export function bookmarkInput(content: string, page: string, visibility: 'private' | 'public', isSpoiler: boolean): BookmarkInput {
  return { content: content.trim(), pageNumber: page.trim() ? Number(page) : null, visibility, isSpoiler }
}

export function bookmarkError(error: unknown): string {
  if (error instanceof HttpError && error.code === 'REGISTRATION_REQUIRED') return registrationMessage
  if (error instanceof HttpError && error.status === 401) return '認証の有効期限を確認できませんでした。認証を再確認してから再試行してください。'
  return error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。'
}
