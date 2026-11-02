import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { SignJWT, UnsecuredJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { authentication, createTokenVerifier, requireRegistered, type AppEnv } from '../src/middleware/auth'
import { createSigningFixture, issuer, supabaseUrl } from './helpers/tokens'

let signing: Awaited<ReturnType<typeof createSigningFixture>>
beforeAll(async () => { signing = await createSigningFixture() })
const env = { SUPABASE_URL: supabaseUrl }

describe('Supabase JWT検証', () => {
  it('Custom OIDC由来のSupabase JWTはprovider名やGoogle情報を認可へ持ち込まない', async () => {
    const id = randomUUID()
    const token = await signing.sign({ sub: id, is_anonymous: false,
      app_metadata: { provider: 'custom:google', providers: ['custom:google'] },
      user_metadata: { email: 'private@example.invalid', name: 'Google name', picture: 'https://example.invalid/private.png',
        sub: randomUUID(), is_anonymous: true },
    })
    expect(await createTokenVerifier(signing.fetcher)(token, env)).toEqual({ id, isAnonymous: false })
  })
  it('GoogleのID tokenとprovider access tokenをアプリのJWTとして受け付けない', async () => {
    const google = await createSigningFixture('RS256')
    const database = vi.fn()
    const app = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    const tokens = [
      await google.sign({ iss: 'https://accounts.google.com', aud: 'client.apps.googleusercontent.com', sub: 'google-user-id' }),
      await signing.sign({ iss: 'https://accounts.google.com' }),
      await signing.sign({ aud: 'client.apps.googleusercontent.com' }),
      'opaque-provider-access-token',
    ]
    for (const token of tokens) {
      const response = await app.request('/api/v1/me', { headers: { Authorization: `Bearer ${token}` } }, env)
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(database).not.toHaveBeenCalled()
  })
  it.each([true, false])('ES256署名・issuer・audience・期限の検証後にsubと匿名状態を取得する (%s)', async (isAnonymous) => {
    const id = randomUUID()
    const verify = createTokenVerifier(signing.fetcher)
    const token = await signing.sign({ sub: id, is_anonymous: isAnonymous,
      user_metadata: { is_anonymous: !isAnonymous, sub: randomUUID() } })
    expect(await verify(token, env)).toEqual({ id, isAnonymous })
    expect(String(signing.fetcher.mock.lastCall?.[0])).toBe(`${issuer}/.well-known/jwks.json`)
  })
  it('RS256も検証できる', async () => {
    const rsa = await createSigningFixture('RS256')
    expect(await createTokenVerifier(rsa.fetcher)(await rsa.sign(), env)).toMatchObject({ isAnonymous: true })
  })
  it('公開鍵を再利用し、JWT内のjkuやissのURLへはアクセスしない', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(signing.jwks))
    const verify = createTokenVerifier(fetcher)
    await verify(await signing.sign({}, { jku: 'https://attacker.invalid/keys' }), env)
    await verify(await signing.sign(), env)
    await expect(verify(await signing.sign({ iss: 'https://attacker.invalid' }), env)).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe(`${issuer}/.well-known/jwks.json`)
  })
  it.each([
    { iss: 'https://other.supabase.co/auth/v1' }, { aud: 'anon' }, { exp: 1 }, { exp: undefined },
    { sub: undefined }, { sub: 'invalid' }, { role: 'service_role' }, { role: 'anon' },
    { is_anonymous: undefined }, { is_anonymous: 'false' }, { session_id: undefined },
    { iat: undefined }, { iat: 9999999999 }, { nbf: 9999999999 },
  ])('不正または必須claim欠落を拒否する: %j', async (claims) => {
    await expect(createTokenVerifier(signing.fetcher)(await signing.sign(claims), env)).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  })
  it('他の鍵による偽造署名、未知kid、署名なし、HS256を拒否する', async () => {
    const other = await createSigningFixture()
    const verify = createTokenVerifier(signing.fetcher)
    for (const token of [
      await other.sign({}, { kid: signing.jwks.keys[0].kid }),
      await other.sign(), new UnsecuredJWT({ sub: randomUUID() }).encode(),
      await new SignJWT({ sub: randomUUID() }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('test-secret'.repeat(4))),
    ]) await expect(verify(token, env)).rejects.toMatchObject({ status: 401 })
  })
  it('未知kidはcooldown後にJWKSを再取得し、キャッシュ期限後は失効した旧鍵を拒否する', async () => {
    const rotated = await createSigningFixture()
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(signing.jwks))
    const verify = createTokenVerifier(fetcher)
    const oldToken = await signing.sign(), newToken = await rotated.sign()
    await verify(oldToken, env)
    fetcher.mockImplementation(async () => Response.json(rotated.jwks))
    await expect(verify(newToken, env)).rejects.toMatchObject({ status: 401 })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
    try {
      expect(await verify(newToken, env)).toMatchObject({ isAnonymous: true })
      expect(fetcher).toHaveBeenCalledTimes(2)
      clock.mockReturnValue(now + 11 * 60_000)
      await expect(verify(oldToken, env)).rejects.toMatchObject({ status: 401 })
      expect(fetcher).toHaveBeenCalledTimes(3)
    } finally { clock.mockRestore() }
  })
  it.each([undefined, '', 'http://project.supabase.co', 'https://user:password@project.supabase.co', 'https://project.supabase.co/other', 'https://project.supabase.co/?key=value'])('URL設定不備は秘密情報を返さず503: %s', async (SUPABASE_URL) => {
    const verify = createTokenVerifier(signing.fetcher)
    await expect(verify(await signing.sign(), { SUPABASE_URL })).rejects.toMatchObject({ status: 503, message: '認証サービスを利用できません' })
  })
  it.each(['network', 'status', 'json', 'shape'])('JWKS取得障害は401と区別して503: %s', async (kind) => {
    const fetcher: typeof fetch = async () => {
      if (kind === 'network') throw new Error('secret upstream detail')
      if (kind === 'status') return new Response('secret upstream detail', { status: 500 })
      if (kind === 'json') return new Response('invalid json')
      return Response.json({ wrong: [] })
    }
    await expect(createTokenVerifier(fetcher)(await signing.sign(), env)).rejects.toMatchObject({ status: 503, message: '認証サービスを利用できません' })
  })
})

describe('認証ミドルウェアとHTTPエラー', () => {
  it.each([undefined, '', 'Basic secret', 'Bearer invalid', 'Bearer a.b.c, Bearer a.b.c'])('未提示・不正ヘッダーをDBアクセスより先に拒否する: %s', async (header) => {
    const database = vi.fn()
    const app = createApp({ database })
    const response = await app.request('/api/v1/me', { headers: header === undefined ? {} : { Authorization: header } }, env)
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: '認証が必要です。再度ログインしてください' } })
    expect(database).not.toHaveBeenCalled()
  })
  it('未認証PATCHは本文の検証より先に401を返す', async () => {
    const response = await createApp().request('/api/v1/me', { method: 'PATCH', body: '{', headers: { 'Content-Type': 'application/json' } }, env)
    expect(response.status).toBe(401)
  })
  it('OptionalAuthでも提示済みの無効トークンは401', async () => {
    const database = vi.fn()
    const app = createApp({ database })
    expect((await app.request(`/api/v1/users/${randomUUID()}`, { headers: { Authorization: 'Bearer invalid' } }, env)).status).toBe(401)
    expect(database).not.toHaveBeenCalled()
  })
  it('有効なJWTでもDB障害時は内部情報を漏らさない', async () => {
    const app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: async () => { throw new Error('postgres://private:secret@internal') } })
    const response = await app.request('/api/v1/me', { headers: { Authorization: `Bearer ${await signing.sign()}` } }, env)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('CORS preflightはJWTなしでAuthorizationを許可する', async () => {
    const response = await createApp().request('/api/v1/me', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type',
    } })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
  })
  it.each([true, false])('登録済みガードは検証済み匿名状態に従う (%s)', async (isAnonymous) => {
    const app = new Hono<AppEnv>()
    app.use('*', authentication(createTokenVerifier(signing.fetcher)).required, requireRegistered)
    app.get('/', (c) => c.json({ ok: true }))
    app.onError((error, c) => c.json({ message: error.message }, 'status' in error ? error.status as 401 | 403 : 500))
    const response = await app.request('/', { headers: { Authorization: `Bearer ${await signing.sign({ is_anonymous: isAnonymous })}` } }, env)
    expect(response.status).toBe(isAnonymous ? 403 : 200)
  })
})
