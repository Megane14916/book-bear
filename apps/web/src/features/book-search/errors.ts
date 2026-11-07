import { ApiError, HttpError, isAbortError } from '../../lib/api/errors'

export function bookErrorMessage(error: unknown, context: 'search' | 'registration' = 'registration') {
  if (isAbortError(error)) return '操作を中断しました。必要に応じてもう一度お試しください。'
  if (error instanceof HttpError) {
    if (error.status === 400) return context === 'search'
      ? '入力内容を確認してください。ISBNは有効な13桁の番号を指定してください。' : '入力内容を確認してください。'
    if (error.status === 404) return '書籍情報が見つかりません。検索からもう一度選び直してください。'
    if (error.status === 502) return '外部の書籍情報サービスを利用できません。少し待ってから再試行してください。'
    if (error.status === 401) return '認証を確認できませんでした。セッションを再確認してからお試しください。'
    if (error.status === 403) return 'この操作を実行する権限がありません。'
  }
  if (error instanceof ApiError && error.kind === 'auth') return error.message
  return '処理できませんでした。通信環境を確認して再試行してください。'
}
