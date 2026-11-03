import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { FeedPage } from '../src/modules/bookmarks/schemas'
import * as cursors from '../src/shared/cursor'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
type Actor = { id: string; token: string }
type Shelf = { id: string; book: { id: string; title: string } }
type Boundary = { createdAt: string; id: string }
let anonymous: Actor, owner: Actor, other: Actor
const timestampFormat = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
const env = () => ({ SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString } })
function request(path: string, token: string | null = null, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env())
}
async function actor(isAnonymous: boolean): Promise<Actor> {
  const id = randomUUID()
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  const token = await signing.sign({ sub: id, is_anonymous: isAnonymous })
  expect((await request('/me', token, 'PUT')).status).toBe(200)
  return { id, token }
}
async function shelf(user = owner): Promise<Shelf> {
  const book = await request('/books/manual', user.token, 'POST', { title: `フィードの本 ${randomUUID()}` })
  expect(book.status).toBe(201)
  const response = await request('/me/books', user.token, 'POST', { bookId: (await book.json()).id, status: 'reading' })
  expect(response.status).toBe(201)
  return await response.json() as Shelf
}
async function seed(entry: Shelf, createdAt: string, extra: { id?: string; visibility?: string; deleted?: boolean; pageNumber?: number | null; isSpoiler?: boolean } = {}) {
  const id = extra.id ?? randomUUID()
  await fixture.client.query(`INSERT INTO bookmarks (id,user_book_id,content,visibility,deleted_at,page_number,is_spoiler,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, entry.id, `感想 ${id}`, extra.visibility ?? 'public', extra.deleted ? createdAt : null, extra.pageNumber ?? null, extra.isSpoiler ?? false, createdAt])
  return { createdAt, id }
}
// A controlled tail below all existing public rows; no wall-clock or empty-DB assumption.
async function tailWindow(): Promise<string[]> {
  const result = await fixture.client.query(`SELECT ARRAY(SELECT to_char((base - n * interval '1 second') AT TIME ZONE 'UTC', $1)
    FROM generate_series(0,9) AS n) AS times FROM (SELECT coalesce(min(created_at), '2300-01-01T00:00:00Z'::timestamptz) - interval '1 second' AS base
    FROM bookmarks WHERE visibility='public' AND deleted_at IS NULL) AS boundary`, [timestampFormat])
  return result.rows[0].times
}
const before = (createdAt: string) => cursors.encodeCursor({ createdAt, id: '00000000-0000-4000-8000-000000000001' })
async function publicRows(boundary?: Boundary): Promise<Boundary[]> {
  const result = await fixture.client.query(`SELECT id,to_char(created_at AT TIME ZONE 'UTC',$1) AS "createdAt" FROM bookmarks
    WHERE visibility='public' AND deleted_at IS NULL ${boundary ? 'AND (created_at,id) < ($2::timestamptz,$3::uuid)' : ''}
    ORDER BY created_at DESC,id DESC`, [timestampFormat, ...(boundary ? [boundary.createdAt, boundary.id] : [])])
  return result.rows
}
async function page(query = '', token: string | null = null) {
  const response = await request(`/feed${query ? `?${query}` : ''}`, token)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const raw = await response.json()
  expect(Object.keys(raw).sort()).toEqual(['items', 'nextCursor'])
  for (const item of raw.items) {
    expect(Object.keys(item).sort()).toEqual(['id', 'content', 'visibility', 'pageNumber', 'isSpoiler', 'createdAt', 'updatedAt', 'likeCount', 'replyCount', 'likedByMe', 'author', 'book'].sort())
    expect(Object.keys(item.author).sort()).toEqual(['id', 'displayName', 'avatarUrl'].sort())
    expect(Object.keys(item.book).sort()).toEqual(['id', 'isbn13', 'title', 'author', 'coverUrl'].sort())
    expect(item.visibility).toBe('public')
  }
  return FeedPage.parse(raw)
}
beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: (bindings, query) => withDatabase(bindings, async (db) => {
    await db.execute(sql`SET ROLE book_bear_api`)
    try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
  }) })
  anonymous = await actor(true)
  owner = await actor(false)
  other = await actor(false)
}, 30000)
afterAll(async () => { await fixture?.close() })

describe('全体フィードの公開範囲と降順ページング（署名済みJWT・実DB）', () => {
  it('本人にも公開のみを返し、複数投稿者・書籍、ネタバレ本文と公開要約を保持する', async () => {
    const entries = [await shelf(), await shelf(other)], times = await tailWindow()
    const cards = [await seed(entries[0], times[1], { isSpoiler: true }), await seed(entries[1], times[2])]
    const hidden = [await seed(entries[0], times[3], { visibility: 'private' }), await seed(entries[1], times[4], { visibility: 'private' }),
      await seed(entries[0], times[5], { deleted: true }), await seed(entries[1], times[6], { visibility: 'private', deleted: true })]
    const query = `cursor=${before(times[0])}`
    const forged = await signing.sign({ sub: anonymous.id, user_metadata: { sub: owner.id, is_anonymous: false } })
    for (const token of [null, anonymous.token, owner.token, other.token, forged, await signing.sign()]) {
      const result = await page(query, token)
      expect(result.items.map((card) => card.id)).toEqual(cards.map((card) => card.id))
      expect(result.items.some((card) => hidden.some((row) => row.id === card.id))).toBe(false)
      expect(result.items[0]).toMatchObject({ author: { id: owner.id }, book: { id: entries[0].book.id, title: entries[0].book.title, isbn13: null }, isSpoiler: true, content: `感想 ${cards[0].id}`, pageNumber: null })
      expect(result.items[1]).toMatchObject({ author: { id: other.id }, book: { id: entries[1].book.id } })
      expect(result.nextCursor).toBeNull()
    }
    const implicit = await page(), explicit = await page('scope=all')
    expect(explicit).toEqual(implicit)
  })
  it('15件既定・最大30件、同一日時とマイクロ秒差を全ページで重複・欠落なく取得する', async () => {
    const entries = [await shelf(), await shelf(other)], ids: string[] = Array.from({ length: 33 }, () => randomUUID()).sort().reverse()
    const fixtureOrder = [...ids.slice(0, 17), ...ids.slice(17).reverse()]
    for (let i = 0; i < fixtureOrder.length; i++) await seed(entries[i % 2], `2300-01-01T00:00:00.${i < 17 ? '123456' : String(123456 - i)}Z`,
      { id: fixtureOrder[i], pageNumber: i % 3 === 0 ? null : i + 1 })
    const boundary = { createdAt: '2301-01-01T00:00:00.000000Z', id: randomUUID() }
    const expected = await publicRows(boundary) // Includes prior tests' public rows in CI.
    let cursor: string | null = cursors.encodeCursor(boundary)
    const seen: string[] = []
    do {
      const result = await page(`cursor=${cursor}`)
      expect(result.items.map((card) => card.id)).toEqual(expected.slice(seen.length, seen.length + 15).map((row) => row.id))
      seen.push(...result.items.map((card) => card.id))
      cursor = result.nextCursor
    } while (cursor)
    expect(seen).toEqual(expected.map((row) => row.id))
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.filter((id) => fixtureOrder.includes(id))).toEqual(fixtureOrder)
    expect((await page()).items).toHaveLength(15)
    const max = await page(`limit=30&cursor=${cursors.encodeCursor(boundary)}`)
    expect(max.items.map((card) => card.id)).toEqual(expected.slice(0, 30).map((row) => row.id))
    const original = await page(`cursor=${cursors.encodeCursor(boundary)}`)
    expect((await request(`/bookmarks/${fixtureOrder[0]}`, owner.token, 'PATCH', { pageNumber: 999, content: '編集後' })).status).toBe(200)
    expect((await page(`cursor=${cursors.encodeCursor(boundary)}`)).items.map((card) => card.id)).toEqual(original.items.map((card) => card.id))
    const exact = original.items.find((card) => card.id === fixtureOrder[0])!
    expect(exact.createdAt).toBe('2300-01-01T00:00:00.123456Z')
  })
  it('境界削除・非公開化・削除・並行追加後も公開条件を再評価し、隠れた行で次ページを作らない', async () => {
    const entry = await shelf(), times = await tailWindow(), cards = []
    for (let i = 1; i <= 5; i++) cards.push(await seed(entry, times[i]))
    const first = await page(`limit=2&cursor=${before(times[0])}`)
    expect(first.items.map((card) => card.id)).toEqual(cards.slice(0, 2).map((card) => card.id))
    expect(first.nextCursor).not.toBeNull()
    await request(`/bookmarks/${cards[1].id}`, owner.token, 'DELETE')
    await request(`/bookmarks/${cards[2].id}`, owner.token, 'PATCH', { visibility: 'private' })
    await request(`/bookmarks/${cards[3].id}`, owner.token, 'DELETE')
    await seed(entry, times[6], { visibility: 'private' })
    await seed(entry, times[7], { deleted: true })
    // This insertion is newer than the page boundary, irrespective of which query wins.
    const [next] = await Promise.all([page(`limit=1&cursor=${first.nextCursor}`), seed(entry, times[1])])
    expect(next.items.map((card) => card.id)).toEqual([cards[4].id])
    expect(next.nextCursor).toBeNull()
    expect((await page(`cursor=${cursors.encodeCursor(cards[4])}`)).items).toEqual([])
  })
  it('非公開や別一覧の境界・別閲覧者のカーソルでも公開条件を緩めない', async () => {
    const entry = await shelf(), times = await tailWindow()
    await seed(entry, times[1], { visibility: 'private' })
    const publicCard = await seed(entry, times[2]), hidden = await seed(entry, times[3], { visibility: 'private' })
    const ownList = await (await request('/me/bookmarks?limit=1', owner.token)).json()
    const ownCard = ownList.items[0] as Boundary
    for (const cursor of [before(times[0]), cursors.encodeCursor(hidden), cursors.encodeCursor({ createdAt: ownCard.createdAt, id: ownCard.id })]) {
      const expected = await publicRows(cursors.decodeCursor(cursor))
      const result = await page(`cursor=${cursor}&limit=30`, other.token)
      expect(result.items.map((card) => card.id)).toEqual(expected.slice(0, 30).map((row) => row.id))
      expect(result.items.some((card) => card.id === hidden.id)).toBe(false)
    }
    expect((await page(`cursor=${before(times[0])}`, anonymous.token)).items.map((card) => card.id)).toEqual([publicCard.id])
  })
})

describe('認証→Zod→followingガード→allのカーソル検証', () => {
  it('不正・期限切れ・署名不正JWTは不正クエリより先に401、認証基盤障害は503', async () => {
    const database = vi.fn(async () => { throw new Error('DB must not be called') })
    const guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    const wrong = await createSigningFixture()
    for (const token of ['invalid', await signing.sign({ exp: 1 }), await wrong.sign({}, { kid: signing.jwks.keys[0].kid })]) {
      for (const query of ['scope=all&limit=0', 'scope=following&cursor=', 'scope=unknown']) {
        const response = await guarded.request(`/api/v1/feed?${query}`, { headers: { Authorization: `Bearer ${token}` } }, env())
        expect(response.status).toBe(401)
        expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
      }
    }
    const unavailable = createApp({ database, verifyToken: createTokenVerifier(async () => { throw new Error('private key information') }) })
    for (const bindings of [{ ...env(), SUPABASE_URL: undefined }, env()]) {
      const response = await unavailable.request('/api/v1/feed?scope=following&limit=0', { headers: { Authorization: `Bearer ${owner.token}` } }, bindings)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '認証サービスを利用できません' } })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(database).not.toHaveBeenCalled()
  })
  it.each(['cursor=', 'limit=0', 'limit=31', 'limit=1.5', 'limit=abc', 'scope=private'])('Zod不正入力は認証状態・scopeによらず400: %s', async (invalid) => {
    const database = vi.fn(async () => { throw new Error('DB must not be called') })
    const guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    const decode = vi.spyOn(cursors, 'decodeCursor')
    try {
      for (const scope of ['all', 'following']) for (const token of [null, anonymous.token, owner.token]) {
        const response = await guarded.request(`/api/v1/feed?scope=${scope}&${invalid}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env())
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
      }
      expect(decode).not.toHaveBeenCalled()
      expect(database).not.toHaveBeenCalled()
    } finally { decode.mockRestore() }
  })
  it.each(['', '&cursor=invalid!', `&cursor=${before('2300-01-01T00:00:00.000000Z')}`])('followingは内容検証・DB前に未認証401／匿名403／正式404: %s', async (query) => {
    const database = vi.fn(async () => { throw new Error('DB must not be called') })
    const guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    const decode = vi.spyOn(cursors, 'decodeCursor')
    try {
      for (const [token, status, code] of [[null, 401, 'UNAUTHORIZED'], [anonymous.token, 403, 'REGISTRATION_REQUIRED'], [owner.token, 404, 'NOT_FOUND']] as const) {
        const response = await guarded.request(`/api/v1/feed?scope=following${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env())
        expect(response.status).toBe(status)
        expect(await response.json()).toMatchObject({ error: { code } })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
      }
      expect(decode).not.toHaveBeenCalled()
      expect(database).not.toHaveBeenCalled()
    } finally { decode.mockRestore() }
  })
  it.each(['invalid!', 'a', 'x'.repeat(513), Buffer.from('{}').toString('base64url'),
    cursors.encodeCursor({ createdAt: '2300-02-30T00:00:00.000000Z', id: randomUUID() }),
    cursors.encodeCursor({ createdAt: '2300-01-01T00:00:00.000000Z', id: 'invalid' }),
  ])('allの内容不正カーソルは400 INVALID_CURSOR、DB接続なし: %s', async (cursor) => {
    const database = vi.fn(async () => { throw new Error('DB must not be called') })
    const guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    for (const token of [null, anonymous.token, owner.token]) {
      const response = await guarded.request(`/api/v1/feed?cursor=${encodeURIComponent(cursor)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env())
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(database).not.toHaveBeenCalled()
  })
  it('DB障害は内部情報を返さず500にする', async () => {
    const failing = createApp({ database: async () => { throw new Error('private SQL password') } })
    const response = await failing.request('/api/v1/feed')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

it('対象IDだけを一括集計し、1件と15件でDB往復を増やさず、空時は集計しない', async () => {
  const entry = await shelf(), times = await tailWindow(), cards = []
  // Same timestamp exercises the ID tie breaker while keeping all fixtures in a known tail.
  for (let i = 0; i < 16; i++) cards.push(await seed(entry, times[1]))
  cards.sort((a, b) => b.id.localeCompare(a.id))
  const target = cards[0]
  await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$3),($2,$3)', [owner.id, other.id, target.id])
  await fixture.client.query("INSERT INTO bookmark_replies (user_id,bookmark_id,content,deleted_at) VALUES ($1,$2,'1',null),($1,$2,'2',null),($1,$2,'3',null),($1,$2,'削除',now())", [other.id, target.id])
  for (const token of [null, anonymous.token, owner.token, other.token]) {
    const result = await page(`cursor=${before(times[0])}`, token)
    expect(result.items[0]).toMatchObject({ id: target.id, likeCount: 2, replyCount: 3, likedByMe: token === owner.token || token === other.token })
    expect(result.items.slice(1).every((card) => card.likeCount === 0 && card.replyCount === 0 && !card.likedByMe)).toBe(true)
  }
  const spy = vi.spyOn(Client.prototype, 'query'), reads: number[] = []
  try {
    for (const limit of [1, 15]) {
      spy.mockClear()
      expect((await page(`limit=${limit}&cursor=${before(times[0])}`, owner.token)).items).toHaveLength(limit)
      reads.push(spy.mock.calls.filter(([raw]) => {
        const query = raw as unknown as string | { text: string }
        return /^(select|with)\b/i.test(typeof query === 'string' ? query : query.text)
      }).length)
    }
    expect(reads).toEqual([3, 3])
    spy.mockClear()
    const empty = await page(`cursor=${cursors.encodeCursor(cards.at(-1)!)}`)
    expect(empty).toEqual({ items: [], nextCursor: null })
    expect(spy.mock.calls.some(([raw]) => /bookmark_likes|bookmark_replies/.test(typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text))).toBe(false)
  } finally { spy.mockRestore() }
})

it('実Workersで公開閲覧・likedByMe・降順カーソルとfollowingの検証順序が動作する', async () => {
  const entry = await shelf(), times = await tailWindow(), first = await seed(entry, times[1]), second = await seed(entry, times[2])
  await seed(entry, times[3], { visibility: 'private' })
  await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$2)', [owner.id, first.id])
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
    const url = `/api/v1/feed?limit=1&cursor=${before(times[0])}`, headers = { Authorization: `Bearer ${owner.token}` }
    const response = await worker.fetch(url, { headers })
    expect(response.status).toBe(200)
    const result = FeedPage.parse(await response.json())
    expect(result.items[0]).toMatchObject({ id: first.id, likedByMe: true })
    const next = FeedPage.parse(await (await worker.fetch(`/api/v1/feed?cursor=${result.nextCursor}`)).json())
    expect(next.items.map((card) => card.id)).toEqual([second.id])
    expect(next.items[0].likedByMe).toBe(false)
    expect(next.nextCursor).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    for (const [token, status] of [[null, 401], [anonymous.token, 403], [owner.token, 404]] as const) {
      expect((await worker.fetch('/api/v1/feed?scope=following&cursor=invalid!', { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status).toBe(status)
    }
    expect((await worker.fetch('/api/v1/feed?scope=following&cursor=', { headers })).status).toBe(400)
    expect((await worker.fetch('/api/v1/feed?limit=0', { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401)
  } finally {
    await worker?.stop()
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
  }
}, 60000)
