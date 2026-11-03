import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { FeedPage } from '../src/modules/bookmarks/schemas'
import { SearchUserPage } from '../src/modules/users/schemas'
import { encodeCursor } from '../src/shared/cursor'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
type Actor = { id: string; token: string }
let owner: Actor, other: Actor, anonymous: Actor
const key = () => `s${randomUUID().replaceAll('-', '').slice(0, 20)}`
const env = () => ({ SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString } })
function request(path: string, token: string | null = null, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env())
}
const url = (kind: 'posts' | 'users', q: string, extra: Record<string, string> = {}) => `/search/${kind}?${new URLSearchParams({ q, ...extra })}`
async function actor(options: { name?: string; handle?: string; anonymous?: boolean; unconfirmed?: boolean } = {}): Promise<Actor> {
  const id = randomUUID()
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  const token = await signing.sign({ sub: id, is_anonymous: options.anonymous ?? false })
  // Unconfirmed formal identities have only initialized with an anonymous JWT.
  const initial = options.unconfirmed ? await signing.sign({ sub: id, is_anonymous: true }) : token
  expect((await request('/me', initial, 'PUT')).status).toBe(200)
  if (options.name || options.handle) expect((await request('/me', token, 'PATCH', { displayName: options.name ?? key(), ...(options.handle ? { handle: options.handle } : {}) })).status).toBe(200)
  return { id, token }
}
async function shelf(user = owner, title = key()): Promise<string> {
  const book = await request('/books/manual', user.token, 'POST', { title })
  expect(book.status).toBe(201)
  const entry = await request('/me/books', user.token, 'POST', { bookId: (await book.json()).id })
  expect(entry.status).toBe(201)
  return (await entry.json()).id
}
async function seed(shelfId: string, content: string, options: { id?: string; time?: string; private?: boolean; deleted?: boolean; spoiler?: boolean } = {}) {
  const id = options.id ?? randomUUID(), createdAt = options.time ?? '2300-01-01T00:00:00.123456Z'
  await fixture.client.query(`INSERT INTO bookmarks (id,user_book_id,content,visibility,created_at,deleted_at,is_spoiler)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, shelfId, content, options.private ? 'private' : 'public', createdAt, options.deleted ? createdAt : null, options.spoiler ?? false])
  return { createdAt, id }
}
async function posts(q: string, extra: Record<string, string> = {}, token: string | null = null) {
  const response = await request(url('posts', q, extra), token)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const raw = await response.json()
  expect(Object.keys(raw).sort()).toEqual(['items', 'nextCursor'])
  for (const item of raw.items) {
    expect(Object.keys(item).sort()).toEqual(['id', 'content', 'visibility', 'pageNumber', 'isSpoiler', 'createdAt', 'updatedAt', 'likeCount', 'replyCount', 'likedByMe', 'author', 'book'].sort())
    expect(Object.keys(item.author).sort()).toEqual(['id', 'displayName', 'avatarUrl'].sort())
    expect(Object.keys(item.book).sort()).toEqual(['id', 'isbn13', 'title', 'author', 'coverUrl'].sort())
  }
  return FeedPage.parse(raw)
}
async function users(q: string, extra: Record<string, string> = {}, token: string | null = null) {
  const response = await request(url('users', q, extra), token)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const raw = await response.json()
  expect(Object.keys(raw).sort()).toEqual(['items', 'nextCursor'])
  for (const item of raw.items) expect(Object.keys(item).sort()).toEqual(['id', 'displayName', 'avatarUrl', 'handle'].sort())
  return SearchUserPage.parse(raw)
}
beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: (bindings, query) => withDatabase(bindings, async (db) => {
    await db.execute(sql`SET ROLE book_bear_api`)
    try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
  }) })
  owner = await actor()
  other = await actor()
  anonymous = await actor({ anonymous: true })
}, 30000)
afterAll(async () => { await fixture?.close() })

describe('投稿検索の公開範囲・部分一致・集計', () => {
  it('本人の非公開も除外し、未初期化・匿名・正式・metadata偽装でも公開未削除だけを返す', async () => {
    const q = key(), mine = await shelf(), theirs = await shelf(other)
    const visible = await seed(mine, `${q} ネタバレ本文`, { spoiler: true })
    await seed(mine, q, { private: true })
    await seed(theirs, q, { private: true })
    await seed(mine, q, { deleted: true })
    await seed(theirs, q, { private: true, deleted: true })
    const forged = await signing.sign({ sub: anonymous.id, user_metadata: { sub: owner.id, is_anonymous: false } })
    for (const token of [null, owner.token, other.token, anonymous.token, forged, await signing.sign()]) {
      const result = await posts(q, { limit: '1' }, token)
      expect(result.items.map(item => item.id)).toEqual([visible.id])
      expect(result.items[0]).toMatchObject({ visibility: 'public', content: `${q} ネタバレ本文`, isSpoiler: true, author: { id: owner.id } })
      expect(result.nextCursor).toBeNull()
    }
    expect(await posts(key())).toEqual({ items: [], nextCursor: null })
  })
  it('本文だけを検索し、書名・プロフィール・返信本文の一致を投稿検索に含めない', async () => {
    const q = key(), author = await actor({ name: q }), entry = await shelf(author, q)
    const excluded = await seed(entry, '検索語を含まない本文')
    await fixture.client.query('INSERT INTO bookmark_replies (user_id,bookmark_id,content) VALUES ($1,$2,$3)', [author.id, excluded.id, q])
    expect(await posts(q)).toEqual({ items: [], nextCursor: null })
  })
  it.each(['日本語', 'MiXeD Case', '%', '_', '\\', "' OR true --"] )('検索語をリテラルで部分一致させる: %s', async (term) => {
    const prefix = key(), content = `${prefix}${term}`, entry = await shelf()
    const match = await seed(entry, `前 ${content} 後`)
    await seed(entry, `${prefix}${term.replace(/[%_\\]/g, 'X')} 対照`, { private: true })
    if (/[%_\\]/.test(term)) await seed(entry, `${prefix}X 対照`)
    const q = term === 'MiXeD Case' ? content.toLowerCase() : content
    expect((await posts(`　 ${q} \t`)).items.map(item => item.id)).toEqual([match.id])
  })
  it('いいね・未削除返信を実数で一括集計し、1件と15件で問い合わせ数を増やさない', async () => {
    const q = key(), entry = await shelf(), rows = []
    for (let i = 0; i < 16; i++) rows.push(await seed(entry, q))
    rows.sort((a, b) => b.id.localeCompare(a.id))
    await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$3),($2,$3)', [owner.id, other.id, rows[0].id])
    await fixture.client.query("INSERT INTO bookmark_replies (user_id,bookmark_id,content,deleted_at) VALUES ($1,$2,'a',null),($1,$2,'b',null),($1,$2,'c',null),($1,$2,'削除',now())", [other.id, rows[0].id])
    const spoofed = await signing.sign({ sub: anonymous.id, user_metadata: { sub: owner.id } })
    for (const token of [null, anonymous.token, owner.token, other.token, spoofed]) {
      const result = await posts(q, {}, token)
      expect(result.items[0]).toMatchObject({ id: rows[0].id, likeCount: 2, replyCount: 3, likedByMe: token === owner.token || token === other.token })
      expect(result.items.slice(1).every(item => item.likeCount === 0 && item.replyCount === 0 && !item.likedByMe)).toBe(true)
    }
    const spy = vi.spyOn(Client.prototype, 'query')
    try {
      const readCounts = []
      for (const limit of ['1', '15']) {
        spy.mockClear()
        expect((await posts(q, { limit })).items).toHaveLength(Number(limit))
        readCounts.push(spy.mock.calls.filter(([raw]) => /^(select|with)\b/i.test(typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text)).length)
      }
      expect(readCounts).toEqual([3, 3])
      spy.mockClear()
      expect(await posts(key())).toEqual({ items: [], nextCursor: null })
      expect(spy.mock.calls.some(([raw]) => /bookmark_likes|bookmark_replies/.test(typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text))).toBe(false)
    } finally { spy.mockRestore() }
  })
})

describe('投稿検索の高精度keyset', () => {
  it('33件を同一日時・マイクロ秒差でも既定15件／最大30件で重複・欠落なく返す', async () => {
    const q = key(), entry = await shelf(), ids = Array.from({ length: 33 }, () => randomUUID()).sort().reverse()
    const rows = []
    for (let i = 0; i < ids.length; i++) rows.push(await seed(entry, q, { id: ids[i], time: `2300-01-01T00:00:00.${i < 17 ? '123456' : '123455'}Z` }))
    const seen = [], first = await posts(q)
    expect(first.items).toHaveLength(15)
    expect(first.items[0].createdAt).toBe('2300-01-01T00:00:00.123456Z')
    let page = first
    do {
      seen.push(...page.items.map(item => item.id))
      if (!page.nextCursor) break
      page = await posts(q, { cursor: page.nextCursor })
    } while (true)
    expect(seen).toEqual(ids)
    expect(new Set(seen).size).toBe(33)
    expect((await posts(q, { limit: '30' })).items.map(item => item.id)).toEqual(ids.slice(0, 30))
    expect(await posts(q, { cursor: encodeCursor(rows.at(-1)!) })).toEqual({ items: [], nextCursor: null })
    const foreign = encodeCursor({ createdAt: '2301-01-01T00:00:00.000000Z', id: randomUUID() })
    expect((await posts(q, { cursor: foreign })).items.map(item => item.id)).toEqual(ids.slice(0, 15))
    expect(await posts(key(), { cursor: first.nextCursor! })).toEqual({ items: [], nextCursor: null })
  })
  it.each(['private', 'deleted'])('境界の%s化・本文の一致解除・並行追加後も継続できる', async (change) => {
    const q = key(), entry = await shelf(), rows = []
    for (let i = 1; i <= 5; i++) rows.push(await seed(entry, q, { time: `2300-01-0${6 - i}T00:00:00.000000Z` }))
    const first = await posts(q, { limit: '1' })
    expect(first.items[0].id).toBe(rows[0].id)
    expect((await request(`/bookmarks/${rows[0].id}`, owner.token, change === 'private' ? 'PATCH' : 'DELETE', change === 'private' ? { visibility: 'private' } : undefined)).status).toBe(change === 'private' ? 200 : 204)
    expect((await request(`/bookmarks/${rows[1].id}`, owner.token, 'PATCH', { content: key() })).status).toBe(200)
    expect((await request(`/bookmarks/${rows[3].id}`, owner.token, 'PATCH', { visibility: 'private' })).status).toBe(200)
    expect((await request(`/bookmarks/${rows[4].id}`, owner.token, 'DELETE')).status).toBe(204)
    await Promise.all([seed(entry, q, { time: '2301-01-01T00:00:00.000000Z' }), seed(entry, key())])
    const next = await posts(q, { limit: '1', cursor: first.nextCursor! })
    expect(next.items.map(item => item.id)).toEqual([rows[2].id])
    expect(next.nextCursor).toBeNull()
  })
})

describe('ユーザー検索の登録確認・検索専用レスポンス', () => {
  it('handle／表示名を検索し、NULL・両方一致・重複なしと4項目の返却を保証する', async () => {
    const q = key(), named = await actor({ name: `${q} 表示名` }), handled = await actor({ name: '別表示名', handle: q }), both = await actor({ name: q, handle: `${q}_both` })
    const result = await users(q)
    expect(new Set(result.items.map(item => item.id))).toEqual(new Set([named.id, handled.id, both.id]))
    expect(result.items).toHaveLength(3)
    expect(result.items.find(item => item.id === named.id)?.handle).toBeNull()
    expect(result.items.find(item => item.id === handled.id)?.handle).toBe(q)
    expect(result.items.find(item => item.id === both.id)?.handle).toBe(`${q}_both`)
    expect(result.nextCursor).toBeNull()
  })
  it('匿名と未確認の正式ユーザーを除外し、正式PUT /me後に検索・フォロー可能になる', async () => {
    const q = key(), anon = await actor({ name: q, handle: `${q}_a`, anonymous: true }), pending = await actor({ name: q, handle: `${q}_p`, unconfirmed: true })
    expect(await users(q)).toEqual({ items: [], nextCursor: null })
    for (const target of [anon, pending]) {
      expect((await request(`/users/${target.id}`)).status).toBe(200)
      expect((await request(`/users/${target.id}/follow`, owner.token, 'PUT')).status).toBe(404)
    }
    expect((await request('/me', pending.token, 'PUT')).status).toBe(200)
    expect((await users(q)).items.map(item => item.id)).toEqual([pending.id])
    expect((await request(`/users/${pending.id}/follow`, owner.token, 'PUT')).status).toBe(204)
    const formal = await signing.sign({ sub: anon.id, is_anonymous: false })
    expect((await users(q)).items.map(item => item.id)).toEqual([pending.id])
    expect((await request('/me', formal, 'PUT')).status).toBe(200)
    expect(new Set((await users(q)).items.map(item => item.id))).toEqual(new Set([anon.id, pending.id]))
    // An old anonymous JWT must not erase the confirmed history.
    expect((await request('/me', anon.token, 'PUT')).status).toBe(200)
    expect((await users(q)).items).toHaveLength(2)
    const relation = await (await request(`/users/${owner.id}/following`)).json()
    expect(Object.keys(relation.items.find((item: { id: string }) => item.id === pending.id)).sort()).toEqual(['id', 'displayName', 'avatarUrl'].sort())
    const publicProfile = await (await request(`/users/${pending.id}`)).json()
    expect(Object.keys(publicProfile).sort()).toEqual(['id', 'displayName', 'avatarUrl', 'handle', 'bio', 'followersCount', 'followingCount', 'publicBookmarkCount', 'followedByMe'].sort())
  })
  it('31件以上の一致でも登録確認済みを先に絞り、既定20・最大30、同名はID昇順', async () => {
    const q = key(), actors = []
    for (let i = 0; i < 32; i++) actors.push(await actor({ name: `${q} z` }))
    await actor({ name: `${q} a`, anonymous: true })
    await actor({ name: `${q} b`, unconfirmed: true })
    const ids = actors.map(person => person.id).sort()
    expect((await users(q)).items.map(item => item.id)).toEqual(ids.slice(0, 20))
    const maximum = await users(q, { limit: '30' })
    expect(maximum.items.map(item => item.id)).toEqual(ids.slice(0, 30))
    expect(maximum.nextCursor).toBeNull()
    expect(await users(q, { limit: '30', cursor: 'invalid!' })).toEqual(maximum)
    expect((await users(q, { limit: '1' })).items.map(item => item.id)).toEqual(ids.slice(0, 1))
  })
  it.each(['日本語', 'MiXeD Case', '%', '_', '\\', "' OR true --"])('ユーザー名をリテラルで部分一致検索する: %s', async (term) => {
    const prefix = key(), name = `${prefix}${term}`, match = await actor({ name })
    if (/[%_\\]/.test(term)) await actor({ name: `${prefix}X` })
    const q = term === 'MiXeD Case' ? name.toLowerCase() : name
    expect((await users(`　${q}  `)).items.map(item => item.id)).toEqual([match.id])
  })
  it('Publicのため不正JWTでも検証せず、全閲覧者へ同じ結果を返す', async () => {
    const q = key(), target = await actor({ name: q })
    const verifyToken = vi.fn(async () => { throw new Error('must not verify') }), publicApp = createApp({ verifyToken, database: withDatabase })
    for (const token of [null, 'invalid', 'a.b.c', anonymous.token, owner.token]) {
      const response = await publicApp.request(`/api/v1${url('users', q)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env())
      expect(response.status).toBe(200)
      expect(SearchUserPage.parse(await response.json()).items.map(item => item.id)).toEqual([target.id])
    }
    expect(verifyToken).not.toHaveBeenCalled()
    expect(await users(key())).toEqual({ items: [], nextCursor: null })
  })
})

describe('検索の入力検証・エラー優先順位', () => {
  it.each(['', 'q=', 'q=%20%E3%80%80', 'q=test&limit=0', 'q=test&limit=31', 'q=test&limit=1.5', 'q=test&limit=abc'])('Zod不正はDB前に400、投稿検索の不正JWTがあれば401: %s', async (query) => {
    const database = vi.fn(async () => { throw new Error('must not connect') }), guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    for (const kind of ['posts', 'users']) for (const token of [null, anonymous.token, owner.token, 'invalid']) {
      const response = await guarded.request(`/api/v1/search/${kind}?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env())
      const invalidJwt = kind === 'posts' && token === 'invalid'
      expect(response.status).toBe(invalidJwt ? 401 : 400)
      expect(await response.json()).toMatchObject({ error: { code: invalidJwt ? 'UNAUTHORIZED' : 'VALIDATION_ERROR' } })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(database).not.toHaveBeenCalled()
  })
  it.each(['', 'invalid!', 'a', 'x'.repeat(513), Buffer.from('{}').toString('base64url'),
    encodeCursor({ createdAt: '2300-02-30T00:00:00.000000Z', id: randomUUID() }),
    encodeCursor({ createdAt: '2300-01-01T00:00:00.000000Z', id: 'invalid' }),
  ])('不正カーソルをDB前に400で拒否する: %s', async (cursor) => {
    const database = vi.fn(async () => { throw new Error('must not connect') }), guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    for (const token of [null, anonymous.token, owner.token]) {
      const response = await guarded.request(`/api/v1${url('posts', 'test', { cursor })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env())
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: cursor === '' ? 'VALIDATION_ERROR' : 'INVALID_CURSOR' } })
    }
    expect(database).not.toHaveBeenCalled()
  })
  it('期限切れJWTは401、認証障害は503、DB障害は安全な500とする', async () => {
    const database = vi.fn(async () => { throw new Error('private SQL password') }), guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    const expired = await signing.sign({ exp: Math.floor(Date.now() / 1000) - 60 })
    const response = await guarded.request('/api/v1/search/posts?q=test&limit=0', { headers: { Authorization: `Bearer ${expired}` } }, env())
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    const unavailable = createApp({ database, verifyToken: createTokenVerifier(async () => { throw new Error('private JWKS details') }) })
    const authFailure = await unavailable.request('/api/v1/search/posts?q=test&limit=0', { headers: { Authorization: `Bearer ${owner.token}` } }, env())
    expect(authFailure.status).toBe(503)
    expect(await authFailure.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '認証サービスを利用できません' } })
    expect(database).not.toHaveBeenCalled()
    for (const kind of ['posts', 'users']) {
      const failure = await guarded.request(`/api/v1/search/${kind}?q=test`)
      expect(failure.status).toBe(500)
      expect(await failure.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
      expect(failure.headers.get('Cache-Control')).toBe('no-store')
    }
  })
})

it('実Workersで検索・登録確認条件・高精度カーソル・JWTと公開範囲を保証する', async () => {
  const q = key(), entry = await shelf(), first = await seed(entry, q), second = await seed(entry, q, { time: '2300-01-01T00:00:00.123455Z' })
  await seed(entry, q, { private: true })
  await seed(entry, q, { deleted: true })
  const target = await actor({ name: q, handle: q }), pending = await actor({ name: q, unconfirmed: true })
  await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$2)', [owner.id, first.id])
  const names = ['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE', 'WRANGLER_LOG_PATH', 'WRANGLER_SEND_METRICS'] as const
  const previous = names.map(name => process.env[name])
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = fixture.apiConnectionString
  process.env.WRANGLER_LOG_PATH = resolve('.wrangler/logs')
  process.env.WRANGLER_SEND_METRICS = 'false'
  const { unstable_dev } = await import('wrangler')
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined
  try {
    worker = await unstable_dev('tests/fixtures/auth-worker.ts', { config: 'wrangler.jsonc', local: true, ip: '127.0.0.1', port: 0, inspectorPort: 0, persist: false, logLevel: 'error',
      vars: { SUPABASE_URL: supabaseUrl, TEST_JWKS: JSON.stringify(signing.jwks) }, experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } })
    const response = await worker.fetch(`/api/v1${url('posts', q, { limit: '1' })}`, { headers: { Authorization: `Bearer ${owner.token}` } })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const page = FeedPage.parse(await response.json())
    expect(page.items[0]).toMatchObject({ id: first.id, createdAt: first.createdAt, likedByMe: true })
    const next = FeedPage.parse(await (await worker.fetch(`/api/v1${url('posts', q, { cursor: page.nextCursor! })}`)).json())
    expect(next.items.map(item => item.id)).toEqual([second.id])
    expect(next.nextCursor).toBeNull()
    expect((await worker.fetch('/api/v1/search/posts?q=test&limit=0', { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401)
    const searchUsers = await worker.fetch(`/api/v1${url('users', q)}`, { headers: { Authorization: 'Bearer invalid' } })
    expect(searchUsers.status).toBe(200)
    expect(SearchUserPage.parse(await searchUsers.json()).items).toEqual([{ id: target.id, displayName: q, avatarUrl: null, handle: q }])
    expect((await worker.fetch('/api/v1/me', { method: 'PUT', headers: { Authorization: `Bearer ${pending.token}` } })).status).toBe(200)
    expect(SearchUserPage.parse(await (await worker.fetch(`/api/v1${url('users', q)}`)).json()).items).toHaveLength(2)
  } finally {
    await worker?.stop()
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
  }
}, 60000)
