import { ApiError, isAbortError } from '../api/errors'

export class AuthError extends ApiError {
  constructor(public readonly stage: 'config' | 'restore' | 'signin' | 'signout' | 'oauth', message: string) {
    super('auth', message)
    this.name = 'AuthError'
  }
}

export function safeAuthError(error: unknown, stage: 'restore' | 'signin' | 'signout'): Error {
  if (isAbortError(error) || error instanceof ApiError) return error
  const messages = {
    restore: 'セッションを確認できませんでした。接続を確認して再試行してください。',
    signin: '匿名認証に失敗しました。接続や認証設定を確認して再試行してください。',
    signout: 'サインアウトを確認できませんでした。保存を停止しています。再試行してください。',
  }
  return new AuthError(stage, messages[stage])
}
