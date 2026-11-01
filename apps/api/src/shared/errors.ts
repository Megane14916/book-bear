import type { errorCodes } from './schemas'

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
    readonly code: typeof errorCodes[number],
    message: string,
  ) { super(message) }
}

export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', '認証が必要です。再度ログインしてください')
export const authUnavailable = () => new ApiError(503, 'INTERNAL_ERROR', '認証サービスを利用できません')
export const notFound = () => new ApiError(404, 'NOT_FOUND', '対象が見つかりません。初回はPUT /meを実行してください')
