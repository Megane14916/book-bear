import { z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { unauthorized } from './errors'
import { ErrorSchema } from './schemas'

export const json = <T extends z.ZodTypeAny>(schema: T, description = '成功') => ({ description, content: { 'application/json': { schema } } })
export const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true, content: { 'application/json': { schema } } })
export const commonErrors = {
  400: json(ErrorSchema, 'VALIDATION_ERROR / INVALID_CURSOR: 入力・カーソル不正'),
  404: json(ErrorSchema, 'NOT_FOUND: 対象なし、または本人以外の本棚'),
  500: json(ErrorSchema, 'INTERNAL_ERROR: 内部情報を含めないエラー'),
}
export const authErrors = {
  401: json(ErrorSchema, 'UNAUTHORIZED: JWTなし・無効・期限切れ'),
  503: json(ErrorSchema, 'INTERNAL_ERROR: 認証設定不備・JWKS取得失敗'),
}
export const identity = (c: Context<AppEnv>) => {
  const viewer = c.get('identity')
  if (!viewer) throw unauthorized()
  return viewer
}
