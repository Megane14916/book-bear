import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import app, { openApiConfig } from '../index'
import { plannedRoutes } from './routes'
import { profileRoutes } from '../modules/users/routes'
import { bookRoutes } from '../modules/books/routes'
import { libraryRoutes } from '../modules/library/routes'
import { bookmarkRoutes } from '../modules/bookmarks/routes'
import { feedRoutes } from '../modules/feed/routes'
import { socialRoutes } from '../modules/social/routes'
import { replyRoutes } from '../modules/replies/routes'
import { CreateBookmarkRequest } from '../modules/bookmarks/schemas'
import { ErrorSchema } from '../shared/schemas'

const document = app.getOpenAPIDocument(openApiConfig)
const operations = Object.values(document.paths).flatMap((path) => Object.values(path ?? {}))

describe('OpenAPI契約と稼働APIの区別', () => {
  it('主要34操作・healthが一意のoperationIdを持ち、全未実装操作を明示する', () => {
    expect(plannedRoutes).toHaveLength(2)
    expect(operations).toHaveLength(36)
    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(36)
    for (const route of plannedRoutes) {
      const operation = document.paths[route.path]?.[route.method]
      expect(operation?.['x-implementation-status']).toBe('planned')
      expect(operation?.description).toContain('未実装・契約のみ')
      expect(operation?.responses[400]).toBeDefined()
      expect(operation?.responses[429]).toBeDefined()
      expect(operation?.responses[500]).toBeDefined()
    }
    expect(document.paths['/api/v1/health']?.get?.['x-implementation-status']).toBe('implemented')
    expect(document.paths['/api/v1/health/db']?.get?.['x-implementation-status']).toBe('implemented')
    for (const route of [...Object.values(profileRoutes), ...Object.values(bookRoutes), ...Object.values(libraryRoutes), ...Object.values(bookmarkRoutes), ...Object.values(feedRoutes), ...Object.values(socialRoutes), ...Object.values(replyRoutes)]) {
      const operation = document.paths[route.path]?.[route.method]
      expect(operation?.['x-implementation-status']).toBe('implemented')
      expect(operation?.description ?? '').not.toContain('未実装・契約のみ')
      if (route['x-auth'] !== 'Public') expect(operation?.responses[503]).toBeDefined()
    }
  })

  it('初期ドラフトの全操作をZod定義でカバーする', async () => {
    const draft = await readFile(new URL('../../../../contracts/openapi-draft.yaml', import.meta.url), 'utf8')
    const ids = [...draft.matchAll(/operationId: (\S+)/g)].map((match) => match[1])
    expect(ids).toHaveLength(34)
    expect([...plannedRoutes, ...Object.values(profileRoutes), ...Object.values(bookRoutes), ...Object.values(libraryRoutes), ...Object.values(bookmarkRoutes), ...Object.values(feedRoutes), ...Object.values(socialRoutes), ...Object.values(replyRoutes)].map((route) => route.operationId).sort()).toEqual(ids.sort())
  })

  it('followingと自分の返信DELETEの実際の認可を契約に明記する', () => {
    const feed = document.paths['/api/v1/feed']?.get
    expect(feed?.description).toContain('followingは正式ユーザー本人のフォロー先のみ')
    expect(feed?.description).not.toContain('未実装')
    expect(feed?.responses[404]?.description).toContain('本人プロフィール未初期化')
    const deletion = document.paths['/api/v1/replies/{replyId}']?.delete
    expect(deletion?.description).toContain('元栞の非公開化・論理削除後も可')
    expect(deletion?.responses[204]).not.toHaveProperty('content')
    expect(deletion?.responses[403]).toBeUndefined()
    expect(feed?.responses[503]).toBeDefined()
    expect(feed?.responses[429]).toBeUndefined()
    expect(feed?.parameters?.find((param) => 'name' in param && param.name === 'scope')).toMatchObject({ schema: { enum: ['all', 'following'], default: 'all' } })
  })

  it('必須・任意・正式認証と条件付き403を記載する', () => {
    const paths = document.paths
    expect(document.components?.securitySchemes?.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    expect(paths['/api/v1/me']?.get?.security).toEqual([{ bearerAuth: [] }])
    expect(paths['/api/v1/books/search']?.get?.security).toEqual([])
    for (const path of ['/api/v1/feed', '/api/v1/bookmarks/{bookmarkId}', '/api/v1/users/{userId}', '/api/v1/users/{userId}/books/{bookId}/bookmarks', '/api/v1/bookmarks/{bookmarkId}/replies', '/api/v1/search/posts']) {
      expect(paths[path]?.get?.security).toEqual([{}, { bearerAuth: [] }])
      expect(paths[path]?.get?.responses[401]).toBeDefined()
    }
    expect(paths['/api/v1/feed']?.get?.responses[403]).toBeDefined()
    expect(paths['/api/v1/bookmarks']?.post?.responses[403]).toBeDefined()
    expect(paths['/api/v1/users/{userId}/follow']?.put?.['x-auth']).toBe('Registered')
    expect(paths['/api/v1/bookmarks/{bookmarkId}/like']?.put?.['x-auth']).toBe('Registered')
  })

  it('冪等な200/201・本文なし204・外部API障害502を区別する', () => {
    for (const path of ['/api/v1/books/import', '/api/v1/me/books']) {
      expect(document.paths[path]?.post?.responses[200]).toBeDefined()
      expect(document.paths[path]?.post?.responses[201]).toBeDefined()
    }
    expect(document.paths['/api/v1/bookmarks/{bookmarkId}/like']?.put?.responses[204]).not.toHaveProperty('content')
    expect(document.paths['/api/v1/books/search']?.get?.responses[502]).toBeDefined()
    expect(document.paths['/api/v1/books/import']?.post?.responses[502]).toBeDefined()
    expect(document.paths['/api/v1/me/books/{userBookId}']?.delete?.responses[409]).toBeDefined()
  })

  it('OpenAPIでも既定値・文字数制限・空PATCH拒否を表現する', () => {
    const schemas = document.components?.schemas
    expect(schemas?.CreateBookmarkRequest).toMatchObject({
      properties: { visibility: { default: 'private' }, isSpoiler: { default: false }, content: { minLength: 1, maxLength: 2000 } },
      required: ['userBookId', 'content'], additionalProperties: false,
    })
    expect(schemas?.PatchBookmarkRequest).toMatchObject({ minProperties: 1, additionalProperties: false })
    expect(schemas?.BookmarkFlowItem).not.toHaveProperty('properties.author')
    expect(schemas?.BookmarkFlowItem).not.toHaveProperty('properties.book')
  })

  it('healthと公開仕様を配信し、契約のみの操作に成功レスポンスを返さない', async () => {
    expect(await (await app.request('/api/v1/health')).json()).toEqual({ status: 'ok' })
    const response = await app.request('/openapi.json')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(document)
    for (const route of plannedRoutes) {
      const url = route.path.replace(/\{\w+\}/g, 'a0000000-0000-4000-8000-000000000001')
      expect((await app.request(url, { method: route.method.toUpperCase() })).status).toBe(404)
    }
  })

  it('DB未設定は接続情報を返さず503、キャッシュを禁止する', async () => {
    const response = await app.request('/api/v1/health/db')
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'データベースを利用できません' } })
  })

  it('Zodスキーマを実際のHonoバリデーションに再利用できる', async () => {
    const testApp = new OpenAPIHono({ defaultHook: (result, c) => {
      if (!result.success) return c.json(ErrorSchema.parse({ error: { code: 'VALIDATION_ERROR', message: '入力不正' } }), 400)
    } })
    testApp.openapi({ method: 'post', path: '/validate', request: { body: { required: true, content: { 'application/json': { schema: CreateBookmarkRequest } } } },
      responses: { 200: { description: 'test', content: { 'application/json': { schema: z.object({ visibility: z.string() }) } } }, 400: { description: 'error', content: { 'application/json': { schema: ErrorSchema } } } },
    }, (c) => c.json({ visibility: c.req.valid('json').visibility }, 200))
    const request = (payload: unknown) => testApp.request('/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    expect(await (await request({ userBookId: 'a0000000-0000-4000-8000-000000000001', content: '感想' })).json()).toEqual({ visibility: 'private' })
    const invalid = await request({ content: ' ' })
    expect(invalid.status).toBe(400)
    expect(ErrorSchema.safeParse(await invalid.json()).success).toBe(true)
  })
})
