import { createHash, randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertGoogleAuthorizationUrl, auditMetadata, createPkce, googleOidc, hasAdditionalMetadata, readCheckConfig } from '../scripts/auth/google-oidc'
import { GoogleCheckClient } from '../scripts/auth/check-client'
import { startCallback } from '../scripts/auth/callback'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

const env = { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  GOOGLE_OIDC_CLIENT_ID: '123-client.apps.googleusercontent.com', API_BASE_URL: 'http://127.0.0.1:8787' }
const config = readCheckConfig(env)
const redirectTo = 'http://127.0.0.1:8790/auth/callback'
function googleUrl(overrides: Record<string, string | undefined> = {}) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: config.clientId, scope: 'openid email', response_type: 'code', state: 'state', nonce: 'nonce',
    redirect_uri: `${supabaseUrl}/auth/v1/callback`, code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' }).toString()
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) url.searchParams.set(key, value)
  return url.toString()
}

describe('Custom Google OIDC設定・最小scope', () => {
  it('provider設定はopenid email、PKCEとnonce検証を使う', () => {
    expect(googleOidc).toMatchObject({ identifier: 'custom:google', issuer: 'https://accounts.google.com', scopes: ['openid', 'email'], pkce_enabled: true, skip_nonce_check: false,
      authorization_params: { scope: 'openid email', access_type: 'online', include_granted_scopes: 'false' } })
    expect(readCheckConfig(env)).toMatchObject({ port: 8790, apiUrl: env.API_BASE_URL })
  })
  it.each([
    { SUPABASE_URL: 'http://example.com' }, { SUPABASE_URL: 'https://user:secret@example.com' },
    { SUPABASE_URL: 'https://example.com/auth/v1' }, { API_BASE_URL: 'http://remote.example.com' },
    { API_BASE_URL: 'https://example.com?token=secret' }, { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_secret' },
    { SUPABASE_PUBLISHABLE_KEY: 'legacy.service_role.token' }, { OIDC_CALLBACK_PORT: '0' },
    { OIDC_CALLBACK_PORT: '8790.5' }, { OIDC_CALLBACK_PORT: '65536' }, { GOOGLE_OIDC_CLIENT_ID: 'invalid' },
  ])('不正URL・秘密キー・port等を受け付けない: %j', (override) => {
    expect(() => readCheckConfig({ ...env, ...override })).toThrow()
  })
  it('PKCEはランダムなverifierとS256のchallengeを使う', () => {
    const a = createPkce(), b = createPkce()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'))
    expect(a.verifier).not.toBe(b.verifier)
  })
  it('openid emailの順序によらず検証する', () => {
    expect(assertGoogleAuthorizationUrl(googleUrl({ scope: 'email openid' }), config.clientId).origin).toBe(googleOidc.issuer)
  })
  it.each([
    { scope: 'openid email profile' }, { scope: 'openid email https://www.googleapis.com/auth/userinfo.profile' },
    { scope: 'openid' }, { scope: 'openid email email' }, { access_type: 'offline' }, { include_granted_scopes: 'true' },
    { client_id: 'other-client' }, { response_type: 'token' }, { nonce: '' }, { state: '' },
    { code_challenge_method: 'plain' }, { code_challenge: 'invalid' }, { request_uri: 'https://evil.invalid' },
  ])('追加scope・offline・不正な認可設定ならブラウザへ進まない: %j', (override) => {
    expect(() => assertGoogleAuthorizationUrl(googleUrl(override), config.clientId)).toThrow()
  })
  it('偽のGoogle origin・重複scope・URLのuserinfoを拒否する', () => {
    for (const url of [googleUrl().replace('accounts.google.com', 'evil.invalid'), `${googleUrl()}&scope=openid%20email`, googleUrl().replace('https://', 'https://secret@')]) {
      expect(() => assertGoogleAuthorizationUrl(url, config.clientId)).toThrow()
    }
  })
  it('メタデータ監査は追加claimを検出し、メール・名前・画像URL等の値を出力しない', () => {
    const audit = auditMetadata({ id: randomUUID(), is_anonymous: false, user_metadata: { email: 'private@example.invalid', name: 'private name', secretKey: 'secret value' },
      identities: [{ provider: 'custom:google', identity_data: { sub: 'subject', picture: 'https://private.invalid/a.png' } }] }, { email_verified: true })
    expect(hasAdditionalMetadata(audit)).toBe(true)
    expect(audit.userMetadata.additionalFieldCount).toBe(2)
    expect(audit.identities[0].profileFieldsPresent).toEqual(['picture'])
    for (const value of ['private@example.invalid', 'private name', 'secretKey', 'secret value', 'https://private.invalid']) expect(JSON.stringify(audit)).not.toContain(value)
    expect(hasAdditionalMetadata(auditMetadata({ id: randomUUID(), is_anonymous: false, user_metadata: { email: 'private@example.invalid', email_verified: true, name: '' } }, undefined))).toBe(false)
  })
})

describe('手動確認クライアント（外部通信なし）', () => {
  let accessToken: string
  const id = randomUUID()
  const authUser = { id, is_anonymous: false, user_metadata: { email: 'private@example.invalid', email_verified: true }, identities: [{ provider: 'custom:google', identity_data: { sub: 'google-id', email: 'private@example.invalid' } }] }
  beforeAll(async () => { accessToken = await (await createSigningFixture()).sign({ sub: id, is_anonymous: false, user_metadata: authUser.user_metadata }) })
  const profile = { id, displayName: 'ゲスト', avatarUrl: null, bio: null, handle: null, isAnonymous: false, followersCount: 0, followingCount: 0 }
  const preferences = { feedContentMode: 'tap' }
  const makeSession = () => ({ access_token: accessToken, refresh_token: 'refresh-secret', user: authUser })
  function transport() {
    return vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input))
      if (url.origin === supabaseUrl && ['/auth/v1/authorize', '/auth/v1/user/identities/authorize'].includes(url.pathname)) {
        const target = googleUrl({ nonce: url.searchParams.get('nonce')! })
        return url.pathname.endsWith('/identities/authorize') ? Response.json({ url: target }) : Response.redirect(target, 302)
      }
      if (url.origin === supabaseUrl && url.pathname === '/auth/v1/user') return Response.json(authUser)
      if (url.origin === supabaseUrl && url.pathname === '/auth/v1/token') return Response.json(makeSession())
      if (url.origin === config.apiUrl && url.pathname === '/api/v1/me') return Response.json(profile)
      if (url.origin === config.apiUrl && url.pathname === '/api/v1/me/preferences') return Response.json(preferences)
      if (url.origin === config.apiUrl && url.pathname === `/api/v1/users/${id}`) {
        const { isAnonymous: _, ...publicProfile } = profile
        return Response.json({ ...publicProfile, publicBookmarkCount: 0, followedByMe: false })
      }
      throw new Error(`Unexpected mock endpoint (${init?.method})`)
    })
  }
  it('login/linkともproviderのscopeを上書きせず、Googleへ資格情報を転送しない', async () => {
    const fetcher = transport(), client = new GoogleCheckClient(config, fetcher)
    await client.authorization(createPkce().challenge, redirectTo)
    await client.authorization(createPkce().challenge, redirectTo, makeSession())
    for (const [input, init] of fetcher.mock.calls) {
      const url = new URL(String(input))
      expect(url.origin).toBe(supabaseUrl)
      expect(url.searchParams.get('provider')).toBe('custom:google')
      expect(url.searchParams.has('scopes')).toBe(false)
      expect(url.searchParams.get('code_challenge_method')).toBe('s256')
      expect(init?.redirect).toBe('manual')
      expect(new Headers(init?.headers).get('apikey')).toBe(env.SUPABASE_PUBLISHABLE_KEY)
    }
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe(`Bearer ${accessToken}`)
  })
  it('providerが余分なscope・違うnonce・callbackを返せば拒否する', async () => {
    for (const extra of [{ scope: 'openid email profile' }, { nonce: 'wrong' }, { redirect_uri: 'https://evil.invalid' }]) {
      const fetcher: typeof fetch = async (input) => Response.redirect(googleUrl({ nonce: new URL(String(input)).searchParams.get('nonce')!, ...extra }), 302)
      await expect(new GoogleCheckClient(config, fetcher).authorization(createPkce().challenge, redirectTo)).rejects.toThrow()
    }
  })
  it('scope上書きprobeはSupabaseだけに要求し、Google向けURLのscopeが増えたら拒否する', async () => {
    const pinned = transport()
    await new GoogleCheckClient(config, pinned).authorization(createPkce().challenge, redirectTo, undefined, true)
    expect(new URL(String(pinned.mock.calls[0][0])).searchParams.get('scopes')).toBe('openid email profile')
    expect(new URL(String(pinned.mock.calls[0][0])).origin).toBe(supabaseUrl)
    const unpinned: typeof fetch = async (input) => Response.redirect(googleUrl({
      nonce: new URL(String(input)).searchParams.get('nonce')!, scope: 'openid email profile',
    }), 302)
    await expect(new GoogleCheckClient(config, unpinned).authorization(createPkce().challenge, redirectTo, undefined, true)).rejects.toThrow('scope')
  })
  it('PKCE交換・更新と既存APIで同UIDを検証し、Data APIを呼ばない', async () => {
    const fetcher = transport(), client = new GoogleCheckClient(config, fetcher)
    const session = await client.exchange('one-time-code', 'verifier-secret')
    const before = await client.initialize(session)
    expect(await client.verify(session, before)).toMatchObject({ uid: id, isAnonymous: false, sameUid: true, profilePreserved: true, additionalMetadataDetected: false })
    await client.refresh(session)
    for (const [input, init] of fetcher.mock.calls) {
      expect(String(input)).not.toMatch(/\/rest\/v1|\/graphql|\/userinfo/)
      const url = new URL(String(input))
      if (url.origin === config.apiUrl) expect(new Headers(init?.headers).has('apikey')).toBe(false)
      if (url.searchParams.get('grant_type') === 'pkce') expect(JSON.parse(String(init?.body))).toEqual({ auth_code: 'one-time-code', code_verifier: 'verifier-secret' })
      if (url.searchParams.get('grant_type') === 'refresh_token') expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'refresh-secret' })
    }
  })
  it('連携前の検証データは本人のHono APIだけで準備する', async () => {
    const fetcher = transport(), client = new GoogleCheckClient(config, fetcher)
    await client.prepareLink(makeSession())
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(writes).toHaveLength(2)
    expect(writes.map(([input]) => new URL(String(input)).pathname)).toEqual(['/api/v1/me', '/api/v1/me/preferences'])
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ displayName: '連携確認用', bio: 'OIDC連携前の確認データ' })
    expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ feedContentMode: 'all' })
    for (const [input, init] of writes) {
      expect(new URL(String(input)).origin).toBe(config.apiUrl)
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${accessToken}`)
    }
  })
  it('UID不一致ではアプリAPIへ書き込まず、Authの応答・ネットワークエラーを漏らさない', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...authUser, id: randomUUID() }))
    await expect(new GoogleCheckClient(config, fetcher).verify(makeSession(), { profile, preferences: { feedContentMode: 'tap' } })).rejects.toThrow('UID')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const fail = new GoogleCheckClient(config, async () => { throw new Error('private token or upstream body') })
    await expect(fail.refresh(makeSession())).rejects.toThrow('could not connect')
    const upstream = new GoogleCheckClient(config, async () => new Response('private upstream body', { status: 403 }))
    await expect(upstream.refresh(makeSession())).rejects.toThrow('HTTP 403')
  })
})

describe('検証用loopbackコールバック', () => {
  let callback: Awaited<ReturnType<typeof startCallback>> | undefined
  afterEach(async () => { await callback?.close(); callback = undefined })
  it('GETの1回だけコードを受け取り、ブラウザにコードを表示せずURLを消す', async () => {
    callback = await startCallback(0)
    const response = await fetch(`${callback.redirectTo}?code=secret-code`, { redirect: 'manual' })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/complete')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).not.toContain('secret-code')
    expect(await callback.code).toBe('secret-code')
    expect((await fetch(`${callback.redirectTo}?code=again`, { redirect: 'manual' })).status).toBe(409)
  })
  it('不正path・method・host・重複codeを消費せず拒否する', async () => {
    callback = await startCallback(0)
    expect((await fetch(callback.redirectTo.replace('/auth/callback', '/other'))).status).toBe(404)
    expect((await fetch(callback.redirectTo, { method: 'POST' })).status).toBe(405)
    const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${callback!.redirectTo}?code=x`, { headers: { Host: 'evil.invalid' } }, (response) => { response.resume(); resolve(response.statusCode) })
      request.once('error', reject)
      request.end()
    })
    expect(invalidHostStatus).toBe(400)
    expect((await fetch(`${callback.redirectTo}?code=x&code=y`)).status).toBe(400)
    expect((await fetch(`${callback.redirectTo}?code=x&error=bad`)).status).toBe(400)
    await fetch(`${callback.redirectTo}?code=correct`, { redirect: 'manual' })
    expect(await callback.code).toBe('correct')
  })
  it('キャンセル時はproviderのerror_descriptionをログ用エラーに含めない', async () => {
    callback = await startCallback(0)
    const rejected = expect(callback.code).rejects.toThrow('cancelled or rejected')
    await fetch(`${callback.redirectTo}?error=access_denied&error_description=private`, { redirect: 'manual' })
    await rejected
  })
  it('待ち時間を制限する', async () => {
    callback = await startCallback(0, 20)
    await expect(callback.code).rejects.toThrow('Timed out')
  })
})
