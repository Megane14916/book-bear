import { createRoute, z, type RouteConfig } from '@hono/zod-openapi'
import { ErrorSchema, UserIdParams } from '../../shared/schemas'
import { PatchProfile, Profile, PublicProfile } from './schemas'
import { PatchPreferences, Preferences } from '../preferences/schemas'

const json = <T extends z.ZodTypeAny>(schema: T, description = '成功') => ({ description, content: { 'application/json': { schema } } })
const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true, content: { 'application/json': { schema } } })
const responses = {
  400: json(ErrorSchema, 'VALIDATION_ERROR: 入力不正'),
  401: json(ErrorSchema, 'UNAUTHORIZED: JWTなし・無効・期限切れ'),
  404: json(ErrorSchema, 'NOT_FOUND: プロフィールまたは設定が未作成'),
  500: json(ErrorSchema, 'INTERNAL_ERROR: 内部情報を含めないエラー'),
  503: json(ErrorSchema, 'INTERNAL_ERROR: 認証設定不備・JWKS取得失敗'),
}
const authenticated = { tags: ['Profile'], security: [{ bearerAuth: [] }], 'x-implementation-status': 'implemented' as const, 'x-auth': 'AnyAuth' }
const optionalBearer: NonNullable<RouteConfig['security']> = [{}, { bearerAuth: [] }]

export const profileRoutes = {
  getMe: createRoute({ ...authenticated, method: 'get', path: '/api/v1/me', operationId: 'getMe', summary: '自分のプロフィール',
    responses: { ...responses, 200: json(Profile) } }),
  putMe: createRoute({ ...authenticated, method: 'put', path: '/api/v1/me', operationId: 'putMe', summary: 'プロフィール初期化（冪等）',
    description: 'JWTのsubでprofilesとuser_preferencesを同一トランザクション内で既定値作成。既存データは変更しない。表示名ゲスト、設定tap。クライアントのIDやメタデータは使用しない。',
    responses: { ...responses, 200: json(Profile) } }),
  patchMe: createRoute({ ...authenticated, 'x-auth': 'Owner', method: 'patch', path: '/api/v1/me', operationId: 'patchMe', summary: '本人のプロフィール編集',
    description: 'JWTのsubに一致するプロフィールのみ更新。handleは小文字英数字と_の3〜30文字、nullで解除。',
    request: { body: body(PatchProfile) }, responses: { ...responses, 200: json(Profile), 409: json(ErrorSchema, 'ALREADY_EXISTS: handleが使用済み') } }),
  getPreferences: createRoute({ ...authenticated, method: 'get', path: '/api/v1/me/preferences', operationId: 'getMePreferences', summary: '本人の表示設定取得',
    responses: { ...responses, 200: json(Preferences) } }),
  patchPreferences: createRoute({ ...authenticated, method: 'patch', path: '/api/v1/me/preferences', operationId: 'patchMePreferences', summary: '本人の表示設定更新',
    request: { body: body(PatchPreferences) }, responses: { ...responses, 200: json(Preferences) } }),
  getPublicProfile: createRoute({ ...authenticated, 'x-auth': 'OptionalAuth', security: optionalBearer, method: 'get', path: '/api/v1/users/{userId}', operationId: 'getUsersUserid', summary: '公開プロフィール',
    description: 'JWTは任意。送信時は検証し無効なら401。非公開・削除済み栞は件数に含めず、匿名状態や設定を公開しない。未認証のfollowedByMeはfalse。',
    request: { params: UserIdParams }, responses: { ...responses, 200: json(PublicProfile) } }),
}
