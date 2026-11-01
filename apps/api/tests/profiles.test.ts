import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { Profile, PublicProfile } from '../src/modules/users/schemas'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
const userId = randomUUID()
const otherId = randomUUID()
let token: string
let otherToken: string

beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  token = await signing.sign({ sub: userId })
  otherToken = await signing.sign({ sub: otherId, is_anonymous: false })
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [userId, otherId])
  app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: (env, query) => withDatabase(env, async (db) => {
    // Embedded PGlite shares its session. Real PostgreSQL also connects using
    // the app login. Both paths exercise application privileges and RLS.
    await db.execute(sql`SET ROLE book_bear_api`)
    try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
  }) })
}, 30000)
afterAll(async () => { await fixture?.close() })

function request(path = '/api/v1/me', method = 'GET', body?: unknown, bearer: string | null = token) {
  return app.request(path, { method, headers: {
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, {
    SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString },
  })
}

describe('プロフィール・表示設定API（実DB・最小権限・署名済みJWT）', () => {
  it.each([
    ['/api/v1/me', 'GET'], ['/api/v1/me', 'PUT'], ['/api/v1/me', 'PATCH'],
    ['/api/v1/me/preferences', 'GET'], ['/api/v1/me/preferences', 'PATCH'],
  ])('本人用APIはJWTなしで401: %s %s', async (path, method) => {
    expect((await request(path, method, undefined, null)).status).toBe(401)
  })
  it('初期化前の取得・更新は404で、自動作成しない', async () => {
    for (const [path, method, body] of [
      ['/api/v1/me', 'GET', undefined], ['/api/v1/me', 'PATCH', { displayName: '変更' }],
      ['/api/v1/me/preferences', 'GET', undefined], ['/api/v1/me/preferences', 'PATCH', { feedContentMode: 'all' }],
    ] as const) expect((await request(path, method, body)).status).toBe(404)
    expect((await fixture.client.query('SELECT id FROM profiles WHERE id=$1', [userId])).rowCount).toBe(0)
  })
  it('PUTはJWT本人のプロフィール・tap設定を作成し、クライアントの所有者や状態を採用しない', async () => {
    const response = await request('/api/v1/me', 'PUT', { id: otherId, isAnonymous: false, displayName: '偽の名前' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const profile = await response.json()
    expect(Profile.parse(profile)).toEqual({ id: userId, displayName: 'ゲスト', avatarUrl: null, bio: null, handle: null,
      followersCount: 0, followingCount: 0, isAnonymous: true })
    expect((await fixture.client.query('SELECT id FROM profiles WHERE id=$1', [otherId])).rowCount).toBe(0)
    expect(await (await request('/api/v1/me/preferences')).json()).toEqual({ feedContentMode: 'tap' })
    expect((await request('/api/v1/me', 'PUT', undefined, otherToken)).status).toBe(200)
  })
  it('PATCHは本人のみ更新し、trim・null・省略を区別する', async () => {
    const response = await request('/api/v1/me', 'PATCH', { displayName: '  読書好き  ', bio: '紹介', handle: 'reader_9' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: userId, displayName: '読書好き', bio: '紹介', handle: 'reader_9', isAnonymous: true })
    expect(await (await request('/api/v1/me', 'GET', undefined, otherToken)).json()).toMatchObject({ id: otherId, displayName: 'ゲスト', bio: null, handle: null, isAnonymous: false })
    expect(await (await request('/api/v1/me', 'PATCH', { bio: null })).json()).toMatchObject({ bio: null, handle: 'reader_9', displayName: '読書好き' })
  })
  it('設定の更新も本人に限定する', async () => {
    expect(await (await request('/api/v1/me/preferences', 'PATCH', { feedContentMode: 'all' })).json()).toEqual({ feedContentMode: 'all' })
    expect(await (await request('/api/v1/me/preferences', 'GET', undefined, otherToken)).json()).toEqual({ feedContentMode: 'tap' })
  })
  it('再PUTでプロフィール・設定・作成更新日時を上書きしない', async () => {
    const before = (await fixture.client.query('SELECT p.*, u.feed_content_mode, u.updated_at AS preference_updated_at FROM profiles p JOIN user_preferences u ON u.user_id=p.id WHERE p.id=$1', [userId])).rows[0]
    expect((await request('/api/v1/me', 'PUT')).status).toBe(200)
    expect((await fixture.client.query('SELECT p.*, u.feed_content_mode, u.updated_at AS preference_updated_at FROM profiles p JOIN user_preferences u ON u.user_id=p.id WHERE p.id=$1', [userId])).rows[0]).toEqual(before)
  })
  it('既存プロフィールに設定だけ欠けた場合も、プロフィールを保って補完する', async () => {
    await fixture.client.query('DELETE FROM user_preferences WHERE user_id=$1', [otherId])
    expect((await request('/api/v1/me', 'PUT', undefined, otherToken)).status).toBe(200)
    expect(await (await request('/api/v1/me/preferences', 'GET', undefined, otherToken)).json()).toEqual({ feedContentMode: 'tap' })
  })
  it.each([
    {}, { id: otherId, displayName: '侵入' }, { userId: otherId }, { isAnonymous: false }, { avatarUrl: 'https://example.com/a.png' },
    { displayName: '　' }, { displayName: 'a'.repeat(51) }, { bio: 'a'.repeat(501) },
    { handle: 'ab' }, { handle: 'a'.repeat(31) }, { handle: 'UpperCase' }, { handle: '読者' }, { handle: 'a/b' },
  ])('不正・所有者変更PATCHを共通400で拒否する: %j', async (body) => {
    const response = await request('/api/v1/me', 'PATCH', body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each([{}, { feedContentMode: 'hidden' }, { feedContentMode: 'tap', userId: otherId }])('設定の不正入力も400: %j', async (body) => {
    expect((await request('/api/v1/me/preferences', 'PATCH', body)).status).toBe(400)
  })
  it('不正JSONも共通400を返す', async () => {
    const response = await app.request('/api/v1/me', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{' }, { SUPABASE_URL: supabaseUrl })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください' } })
  })
  it('重複handleは409で更新全体を取り消し、nullで解除後は再利用できる', async () => {
    const conflict = await request('/api/v1/me', 'PATCH', { handle: 'reader_9', displayName: '変更されない' }, otherToken)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: { code: 'ALREADY_EXISTS', message: 'このhandleは既に使用されています' } })
    expect(await (await request('/api/v1/me', 'GET', undefined, otherToken)).json()).toMatchObject({ displayName: 'ゲスト', handle: null })
    expect((await request('/api/v1/me', 'PATCH', { handle: null })).status).toBe(200)
    expect((await request('/api/v1/me', 'PATCH', { handle: 'reader_9' }, otherToken)).status).toBe(200)
  })
  it('同UIDの新JWTの匿名状態を返し、プロフィールは維持する', async () => {
    const registeredToken = await signing.sign({ sub: userId, is_anonymous: false })
    expect(await (await request('/api/v1/me', 'GET', undefined, registeredToken)).json()).toMatchObject({ id: userId, displayName: '読書好き', isAnonymous: false })
  })
  it('公開プロフィールは公開中・未削除の栞だけを集計し、設定・匿名状態を返さない', async () => {
    const bookId = randomUUID(), shelfId = randomUUID()
    await fixture.client.query("INSERT INTO books (id,title,source) VALUES ($1,'公開集計テスト','manual')", [bookId])
    await fixture.client.query('INSERT INTO user_books (id,user_id,book_id) VALUES ($1,$2,$3)', [shelfId, userId, bookId])
    await fixture.client.query("INSERT INTO bookmarks (user_book_id,content,visibility,deleted_at) VALUES ($1,'公開','public',null),($1,'非公開','private',null),($1,'削除済み','public',now())", [shelfId])
    await fixture.client.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2)', [otherId, userId])
    const publicResponse = await request(`/api/v1/users/${userId}`, 'GET', undefined, null)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.headers.get('Cache-Control')).toBe('no-store')
    const publicProfile = await publicResponse.json()
    expect(PublicProfile.parse(publicProfile)).toEqual(publicProfile)
    expect(publicProfile).toMatchObject({ id: userId, publicBookmarkCount: 1, followersCount: 1, followingCount: 0, followedByMe: false })
    expect(publicProfile).not.toHaveProperty('isAnonymous')
    expect(publicProfile).not.toHaveProperty('feedContentMode')
    expect(publicProfile).not.toHaveProperty('createdAt')
    expect(await (await request(`/api/v1/users/${userId}`, 'GET', undefined, otherToken)).json()).toMatchObject({ followedByMe: true })
    expect(await (await request('/api/v1/me')).json()).toMatchObject({ followersCount: 1, followingCount: 0 })
    expect(await (await request('/api/v1/me', 'GET', undefined, otherToken)).json()).toMatchObject({ followersCount: 0, followingCount: 1 })
  })
  it('公開プロフィールは不正IDを400、存在しないIDを404にする', async () => {
    expect((await request('/api/v1/users/invalid', 'GET', undefined, null)).status).toBe(400)
    expect((await request(`/api/v1/users/${randomUUID()}`, 'GET', undefined, null)).status).toBe(404)
  })
  it('Authに存在しないユーザーは初期化できない', async () => {
    const response = await request('/api/v1/me', 'PUT', undefined, await signing.sign())
    expect(response.status).toBe(401)
  })
  it('設定作成が失敗した場合、プロフィール作成もロールバックする', async () => {
    const id = randomUUID()
    await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
    await fixture.client.query(`CREATE FUNCTION public.test_reject_preferences() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${id}'::uuid THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_preferences BEFORE INSERT ON user_preferences FOR EACH ROW EXECUTE FUNCTION public.test_reject_preferences();`)
    try {
      expect((await request('/api/v1/me', 'PUT', undefined, await signing.sign({ sub: id }))).status).toBe(500)
      expect((await fixture.client.query('SELECT id FROM profiles WHERE id=$1', [id])).rowCount).toBe(0)
    } finally {
      await fixture.client.query('DROP TRIGGER test_reject_preferences ON user_preferences; DROP FUNCTION public.test_reject_preferences()')
    }
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('並行PUTでもプロフィール・設定は各1件になる（PostgreSQL）', async () => {
    const id = randomUUID()
    await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
    const bearer = await signing.sign({ sub: id })
    const responses = await Promise.all(Array.from({ length: 4 }, () => request('/api/v1/me', 'PUT', undefined, bearer)))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect((await fixture.client.query('SELECT count(*)::int AS count FROM profiles WHERE id=$1', [id])).rows[0].count).toBe(1)
    expect((await fixture.client.query('SELECT count(*)::int AS count FROM user_preferences WHERE user_id=$1', [id])).rows[0].count).toBe(1)
  })
})
