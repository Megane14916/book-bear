import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { BookmarkCard, BookmarkFlowPage, FeedPage } from '../src/modules/bookmarks/schemas'
import { encodeCursor } from '../src/shared/cursor'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
type Actor = { id: string; token: string }
type Shelf = { id: string; book: { id: string } }
let anonymous: Actor, registered: Actor, stranger: Actor
const env = () => ({ SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString } })
function request(path: string, token: string | null = null, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env())
}
async function actor(isAnonymous = true): Promise<Actor> {
  const id = randomUUID()
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  const token = await signing.sign({ sub: id, is_anonymous: isAnonymous })
  expect((await request('/me', token, 'PUT')).status).toBe(200)
  return { id, token }
}
async function shelf(owner: Actor, bookId?: string): Promise<Shelf> {
  if (!bookId) {
    const response = await request('/books/manual', owner.token, 'POST', { title: `流れの本 ${randomUUID()}`, totalPages: 10 })
    expect(response.status).toBe(201)
    bookId = (await response.json()).id
  }
  const response = await request('/me/books', owner.token, 'POST', { bookId, status: 'reading' })
  expect(response.status).toBe(201)
  return await response.json() as Shelf
}
async function create(entry: Shelf, owner: Actor, extra: Record<string, unknown> = {}) {
  const response = await request('/bookmarks', owner.token, 'POST', { userBookId: entry.id, content: '流れの感想', ...extra })
  expect(response.status).toBe(201)
  return BookmarkCard.parse(await response.json())
}
const path = (owner: Actor, entry: Shelf) => `/users/${owner.id}/books/${entry.book.id}/bookmarks`
async function page(url: string, token: string | null = null) {
  const response = await request(url, token)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const raw = await response.json()
  expect(Object.keys(raw).sort()).toEqual(['author', 'book', 'items', 'nextCursor'])
  for (const item of raw.items) expect(Object.keys(item).sort()).toEqual([
    'id', 'content', 'visibility', 'pageNumber', 'isSpoiler', 'createdAt', 'updatedAt', 'likeCount', 'replyCount', 'likedByMe',
  ].sort())
  expect(Object.keys(raw.author).sort()).toEqual(['id', 'displayName', 'avatarUrl'].sort())
  expect(Object.keys(raw.book).sort()).toEqual(['id', 'isbn13', 'title', 'author', 'coverUrl'].sort())
  return BookmarkFlowPage.parse(raw)
}
beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: (bindings, query) => withDatabase(bindings, async (db) => {
    await db.execute(sql`SET ROLE book_bear_api`)
    try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
  }) })
  anonymous = await actor()
  registered = await actor(false)
  stranger = await actor(false)
}, 30000)
afterAll(async () => { await fixture?.close() })

describe('栞の流れの認可・空結果・ヘッダー', () => {
  it.each([true, false])('本人は匿名状態によらず公開・非公開を読み、第三者は公開のみ: anonymous=%s', async (isAnonymous) => {
    const owner = await actor(isAnonymous), entry = await shelf(owner)
    const promoted = { ...owner, token: await signing.sign({ sub: owner.id, is_anonymous: false }) }
    const publicCard = await create(entry, promoted, { visibility: 'public', isSpoiler: true })
    const privateCard = await create(entry, owner)
    const deleted = await create(entry, owner)
    expect((await request(`/bookmarks/${deleted.id}`, owner.token, 'DELETE')).status).toBe(204)
    const otherBook = await shelf(owner)
    await create(otherBook, promoted, { visibility: 'public' })
    const sameBook = await shelf(stranger, entry.book.id)
    await create(sameBook, stranger, { visibility: 'public' })
    await create(sameBook, stranger)
    for (const token of [owner.token, promoted.token]) {
      const result = await page(path(owner, entry), token)
      expect(result.items.map((item) => item.id)).toEqual([publicCard.id, privateCard.id])
      expect(result.author.id).toBe(owner.id)
      expect(result.book.id).toBe(entry.book.id)
    }
    for (const token of [null, anonymous.token, stranger.token]) {
      const result = await page(path(owner, entry), token)
      expect(result.items.map((item) => item.id)).toEqual([publicCard.id])
      expect(result.items[0]).toMatchObject({ content: publicCard.content, isSpoiler: true })
      expect(result.nextCursor).toBeNull()
    }
    const forged = await signing.sign({ sub: stranger.id, is_anonymous: false, user_metadata: { sub: owner.id, userId: owner.id, is_anonymous: false } })
    expect((await page(path(owner, entry), forged)).items.map((item) => item.id)).toEqual([publicCard.id])
    expect((await page(path(stranger, entry), owner.token)).items.every((item) => item.visibility === 'public')).toBe(true)
    expect((await page(path(owner, otherBook), stranger.token)).items).toHaveLength(1)
  })
  it('組み合わせなし・空・非公開のみ・削除済みのみは公開ヘッダー付き空結果', async () => {
    const owner = await actor(), entry = await shelf(registered)
    const url = path(owner, entry)
    const missing = await page(url)
    expect(missing).toMatchObject({ author: { id: owner.id }, book: { id: entry.book.id }, items: [], nextCursor: null })
    const own = await shelf(owner, entry.book.id)
    expect(await page(url)).toEqual(missing)
    const card = await create(own, owner)
    expect(await page(url)).toEqual(missing)
    expect((await page(url, owner.token)).items.map((item) => item.id)).toEqual([card.id])
    await request(`/bookmarks/${card.id}`, owner.token, 'DELETE')
    expect(await page(url, owner.token)).toEqual(missing)
    expect(await page(url, stranger.token)).toEqual(missing)
  })
  it('対象プロフィール／書籍がなければ404、閲覧者のプロフィール初期化は不要', async () => {
    const entry = await shelf(registered)
    await create(entry, registered, { visibility: 'public' })
    for (const url of [path({ id: randomUUID(), token: '' }, entry), path(registered, { id: '', book: { id: randomUUID() } })]) {
      const response = await request(url)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect((await page(path(registered, entry), await signing.sign())).items).toHaveLength(1)
  })
  it('無効・期限切れJWTはDB接続前に401、DB障害は内部情報を出さず500', async () => {
    const entry = await shelf(registered), url = `/api/v1${path(registered, entry)}`
    const database = vi.fn(async () => { throw new Error('private SQL connection password') })
    const failing = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database })
    for (const token of ['invalid', await signing.sign({ exp: 1 }), await signing.sign({}, { kid: randomUUID() })]) {
      const response = await failing.request(url, { headers: { Authorization: `Bearer ${token}` } }, env())
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    }
    expect(database).not.toHaveBeenCalled()
    const response = await failing.request(url, {}, env())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('栞の流れの昇順カーソル', () => {
  it('15件既定・同一日時・マイクロ秒の境界をページ番号に依存せず取得する', async () => {
    const owner = await actor(), entry = await shelf(owner), ids = Array.from({ length: 33 }, () => randomUUID()).sort()
    const expected = [...ids.slice(0, 17), ...ids.slice(17).reverse()]
    for (let i = 0; i < expected.length; i++) await fixture.client.query(
      'INSERT INTO bookmarks (id,user_book_id,content,page_number,created_at) VALUES ($1,$2,$3,$4,$5)',
      [expected[i], entry.id, '昇順確認', i % 3 === 0 ? null : 100 - i, i < 17 ? '2026-01-01T00:00:00.123456Z' : `2026-01-01T00:00:00.${123456 + i}Z`])
    const first = await page(path(owner, entry), owner.token)
    expect(first.items.map((item) => item.id)).toEqual(expected.slice(0, 15))
    expect(first.items[0].createdAt).toBe('2026-01-01T00:00:00.123456Z')
    const second = await page(`${path(owner, entry)}?cursor=${first.nextCursor}`, owner.token)
    expect(second.items.map((item) => item.id)).toEqual(expected.slice(15, 30))
    const third = await page(`${path(owner, entry)}?cursor=${second.nextCursor}`, owner.token)
    expect(third.items.map((item) => item.id)).toEqual(expected.slice(30))
    expect(third.nextCursor).toBeNull()
    const all = [...first.items, ...second.items, ...third.items].map((item) => item.id)
    expect(new Set(all).size).toBe(33)
    const max = await page(`${path(owner, entry)}?limit=30`, owner.token)
    expect(max.items.map((item) => item.id)).toEqual(expected.slice(0, 30))
    const edited = await request(`/bookmarks/${expected[0]}`, owner.token, 'PATCH', { pageNumber: 999, content: '編集後' })
    expect(edited.status).toBe(200)
    expect((await page(path(owner, entry), owner.token)).items.map((item) => item.id)).toEqual(expected.slice(0, 15))
  })
  it('境界削除・途中追加・非公開化・削除を再評価し、隠れた行から次カーソルを作らない', async () => {
    const owner = await actor(false), entry = await shelf(owner), cards = []
    for (let i = 0; i < 5; i++) cards.push(await create(entry, owner, { visibility: 'public' }))
    for (let i = 0; i < cards.length; i++) await fixture.client.query('UPDATE bookmarks SET created_at=$1 WHERE id=$2', [`2026-01-01T00:00:0${i}.000001Z`, cards[i].id])
    const first = await page(`${path(owner, entry)}?limit=2`)
    expect(first.items.map((item) => item.id)).toEqual(cards.slice(0, 2).map((item) => item.id))
    await request(`/bookmarks/${cards[1].id}`, owner.token, 'DELETE')
    await request(`/bookmarks/${cards[2].id}`, owner.token, 'PATCH', { visibility: 'private' })
    await request(`/bookmarks/${cards[3].id}`, owner.token, 'DELETE')
    const before = await create(entry, owner, { visibility: 'public' }), after = await create(entry, owner, { visibility: 'public' })
    await fixture.client.query("UPDATE bookmarks SET created_at='2025-01-01T00:00:00.000001Z' WHERE id=$1", [before.id])
    const next = await page(`${path(owner, entry)}?limit=2&cursor=${first.nextCursor}`)
    expect(next.items.map((item) => item.id)).toEqual([cards[4].id, after.id])
    expect(next.nextCursor).toBeNull()
    await fixture.client.query("INSERT INTO bookmarks (user_book_id,content) SELECT $1,'非公開' FROM generate_series(1,20)", [entry.id])
    expect((await page(`${path(owner, entry)}?limit=2&cursor=${first.nextCursor}`)).nextCursor).toBeNull()
    expect((await page(`${path(owner, entry)}?limit=2&cursor=${first.nextCursor}`, owner.token)).items.map((item) => item.id)).toEqual([cards[2].id, cards[4].id])
  })
  it('別ユーザー・別本・降順一覧のカーソルも境界に留め、対象と認可をSQLで適用する', async () => {
    const owner = await actor(false), entry = await shelf(owner), other = await shelf(stranger, entry.book.id)
    const publicCard = await create(entry, owner, { visibility: 'public' })
    await create(entry, owner)
    await create(other, stranger)
    const old = encodeCursor({ createdAt: '2000-01-01T00:00:00.000001Z', id: randomUUID() })
    const descending = FeedPage.parse(await (await request('/me/bookmarks?limit=1', owner.token)).json())
    for (const cursor of [old, encodeCursor({ createdAt: publicCard.createdAt, id: publicCard.id }), descending.nextCursor!]) {
      const result = await page(`${path(owner, entry)}?cursor=${cursor}`, stranger.token)
      expect(result.items.every((item) => item.visibility === 'public' && item.id === publicCard.id)).toBe(true)
      expect((await page(`${path(stranger, other)}?cursor=${cursor}`, owner.token)).items).toEqual([])
    }
  })
  it.each(['invalid!', 'a', 'x'.repeat(513), Buffer.from('{}').toString('base64url'),
    encodeCursor({ createdAt: '2026-02-30T00:00:00.000000Z', id: randomUUID() }),
    encodeCursor({ createdAt: '2026-01-01T00:00:00.000000Z', id: 'bad' }),
  ])('不正カーソルは400 INVALID_CURSOR: %s', async (cursor) => {
    const entry = await shelf(anonymous)
    const response = await request(`${path(anonymous, entry)}?cursor=${encodeURIComponent(cursor)}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it.each(['cursor=', 'limit=0', 'limit=31', 'limit=1.5', 'limit=abc'])('不正入力は400 VALIDATION_ERROR: %s', async (query) => {
    const response = await request(`/users/${anonymous.id}/books/${randomUUID()}/bookmarks?${query}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })
  it.each([`/users/invalid/books/${randomUUID()}/bookmarks`, `/users/${randomUUID()}/books/invalid/bookmarks`])('不正UUIDは400: %s', async (url) => {
    expect((await request(url)).status).toBe(400)
  })
})

it('軽量itemsにも一括集計を適用し、1件と15件でDB往復数を増やさず空結果では集計しない', async () => {
  const owner = await actor(false), entry = await shelf(owner), cards = []
  for (let i = 0; i < 15; i++) cards.push(await create(entry, owner, { visibility: 'public' }))
  const target = cards[0]
  await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$3),($2,$3)', [owner.id, stranger.id, target.id])
  await fixture.client.query("INSERT INTO bookmark_replies (user_id,bookmark_id,content,deleted_at) VALUES ($1,$2,'1',null),($1,$2,'2',null),($1,$2,'3',null),($1,$2,'削除',now())", [stranger.id, target.id])
  for (const token of [owner.token, stranger.token, null, anonymous.token]) {
    const item = (await page(path(owner, entry), token)).items[0]
    expect(item).toMatchObject({ id: target.id, likeCount: 2, replyCount: 3, likedByMe: token === owner.token || token === stranger.token })
  }
  const spy = vi.spyOn(Client.prototype, 'query'), reads: number[] = []
  try {
    for (const limit of [1, 15]) {
      spy.mockClear()
      const result = await page(`${path(owner, entry)}?limit=${limit}`, owner.token)
      expect(result.items).toHaveLength(limit)
      expect(result.items.slice(1).every((item) => item.likeCount === 0 && item.replyCount === 0 && !item.likedByMe)).toBe(true)
      reads.push(spy.mock.calls.filter(([raw]) => {
        const query = raw as unknown as string | { text: string }
        return /^(select|with)\b/i.test(typeof query === 'string' ? query : query.text)
      }).length)
    }
    expect(reads).toEqual([6, 6])
    spy.mockClear()
    await page(`${path(owner, entry)}?cursor=${encodeCursor({ createdAt: '2099-01-01T00:00:00.000000Z', id: randomUUID() })}`, owner.token)
    expect(spy.mock.calls.some(([raw]) => /bookmark_likes|bookmark_replies/.test(typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text))).toBe(false)
  } finally { spy.mockRestore() }
})

it('実Workersでも署名検証・本人の非公開閲覧・公開のみの閲覧・昇順カーソルが動作する', async () => {
  const entry = await shelf(anonymous), first = await create(entry, anonymous), second = await create(entry, anonymous)
  const names = ['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE', 'WRANGLER_LOG_PATH', 'WRANGLER_SEND_METRICS'] as const
  const previous = names.map((name) => process.env[name])
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = fixture.apiConnectionString
  process.env.WRANGLER_LOG_PATH = resolve('.wrangler/logs')
  process.env.WRANGLER_SEND_METRICS = 'false'
  const { unstable_dev } = await import('wrangler')
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined
  try {
    worker = await unstable_dev('tests/fixtures/auth-worker.ts', { config: 'wrangler.jsonc', local: true, ip: '127.0.0.1', port: 0, inspectorPort: 0, persist: false, logLevel: 'error',
      vars: { SUPABASE_URL: supabaseUrl, TEST_JWKS: JSON.stringify(signing.jwks) }, experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false } })
    const url = `/api/v1${path(anonymous, entry)}`, headers = { Authorization: `Bearer ${anonymous.token}` }
    const response = await worker.fetch(`${url}?limit=1`, { headers })
    expect(response.status).toBe(200)
    const result = BookmarkFlowPage.parse(await response.json())
    expect(result.items.map((item) => item.id)).toEqual([first.id])
    const next = BookmarkFlowPage.parse(await (await worker.fetch(`${url}?cursor=${result.nextCursor}`, { headers })).json())
    expect(next.items.map((item) => item.id)).toEqual([second.id])
    expect(next.nextCursor).toBeNull()
    expect(BookmarkFlowPage.parse(await (await worker.fetch(url)).json()).items).toEqual([])
    expect((await worker.fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  } finally {
    await worker?.stop()
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
  }
}, 60000)
