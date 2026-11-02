import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { BookmarkCard, FeedPage } from '../src/modules/bookmarks/schemas'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
type Actor = { id: string; token: string }
let anonymous: Actor, registered: Actor, stranger: Actor
function request(path: string, method = 'GET', body?: unknown, token: string | null = anonymous.token) {
  return app.request(`/api/v1${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, {
    SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString },
  })
}
async function actor(isAnonymous = true): Promise<Actor> {
  const id = randomUUID()
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  const token = await signing.sign({ sub: id, is_anonymous: isAnonymous, user_metadata: { sub: randomUUID(), is_anonymous: false } })
  expect((await request('/me', 'PUT', undefined, token)).status).toBe(200)
  return { id, token }
}
async function shelf(owner = anonymous) {
  const book = await request('/books/manual', 'POST', { title: `栞の本 ${randomUUID()}`, totalPages: 10 }, owner.token)
  expect(book.status).toBe(201)
  const response = await request('/me/books', 'POST', { bookId: (await book.json()).id, status: 'reading' }, owner.token)
  expect(response.status).toBe(201)
  return await response.json() as { id: string; book: { id: string } }
}
async function create(userBookId: string, owner = anonymous, extra: Record<string, unknown> = {}) {
  const response = await request('/bookmarks', 'POST', { userBookId, content: ' 読書の感想 ', ...extra }, owner.token)
  expect(response.status).toBe(201)
  return BookmarkCard.parse(await response.json())
}
const get = (id: string, token: string | null = anonymous.token) => request(`/bookmarks/${id}`, 'GET', undefined, token)
beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: (env, query) => withDatabase(env, async (db) => {
    await db.execute(sql`SET ROLE book_bear_api`)
    try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
  }) })
  anonymous = await actor()
  registered = await actor(false)
  stranger = await actor(false)
}, 30000)
afterAll(async () => { await fixture?.close() })

describe('栞CRUDの認証・所有権（実DB・署名済みJWT）', () => {
  it.each([
    ['/bookmarks', 'POST', { userBookId: randomUUID(), content: '感想' }],
    [`/bookmarks/${randomUUID()}`, 'PATCH', { content: '変更' }],
    [`/bookmarks/${randomUUID()}`, 'DELETE', undefined], ['/me/bookmarks', 'GET', undefined],
  ])('保護操作はJWTなし・不正・期限切れを401にする: %s %s', async (path, method, body) => {
    for (const token of [null, 'invalid', await signing.sign({ exp: 1 })]) {
      const response = await request(path, method, body, token)
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    }
  })
  it('匿名の非公開CRUDが動作し、既定値・本文trim・所属先と進捗を保持する', async () => {
    const entry = await shelf(), card = await create(entry.id)
    expect(card).toMatchObject({ content: '読書の感想', visibility: 'private', isSpoiler: false, pageNumber: null,
      author: { id: anonymous.id }, book: { id: entry.book.id }, likeCount: 0, replyCount: 0, likedByMe: false })
    expect(card).not.toHaveProperty('userBookId')
    expect(card.book).not.toHaveProperty('currentPage')
    expect(await (await get(card.id)).json()).toEqual(card)
    const patched = await request(`/bookmarks/${card.id}`, 'PATCH', { content: ' 後の感想 ', pageNumber: 2147483647, isSpoiler: true })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({ content: '後の感想', pageNumber: 2147483647, isSpoiler: true, visibility: 'private', createdAt: card.createdAt })
    expect(await (await request(`/bookmarks/${card.id}`, 'PATCH', { pageNumber: null, isSpoiler: false })).json()).toMatchObject({ pageNumber: null, isSpoiler: false, content: '後の感想' })
    expect((await fixture.client.query('SELECT status,current_page FROM user_books WHERE id=$1', [entry.id])).rows[0]).toEqual({ status: 'reading', current_page: null })
    const response = await request(`/bookmarks/${card.id}`, 'DELETE')
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    const row = (await fixture.client.query('SELECT created_at,deleted_at,updated_at FROM bookmarks WHERE id=$1', [card.id])).rows[0]
    expect(row.deleted_at).toEqual(row.updated_at)
    expect(row.created_at.toISOString()).toBe(new Date(card.createdAt).toISOString())
    expect((await request(`/me/books/${entry.id}`, 'DELETE')).status).toBe(409)
  })
  it('公開詳細は全員に返し、非公開詳細は本人だけ。任意JWTも検証する', async () => {
    const entry = await shelf(registered)
    const publicCard = await create(entry.id, registered, { visibility: 'public', isSpoiler: true })
    const privateCard = await create(entry.id, registered)
    for (const token of [null, anonymous.token, stranger.token, registered.token]) {
      const response = await get(publicCard.id, token)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ content: '読書の感想', isSpoiler: true })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect((await get(privateCard.id, token)).status).toBe(token === registered.token ? 200 : 404)
    }
    for (const token of ['invalid', await signing.sign({ exp: 1 })]) expect((await get(publicCard.id, token)).status).toBe(401)
  })
  it.each(['public', 'private'] as const)('他人の栞の変更・削除を404で拒否（%s）', async (visibility) => {
    const card = await create((await shelf(registered)).id, registered, { visibility })
    const before = (await fixture.client.query('SELECT * FROM bookmarks WHERE id=$1', [card.id])).rows[0]
    for (const token of [anonymous.token, stranger.token]) {
      for (const [method, body] of [['PATCH', { content: '他人の変更', visibility: 'public' }], ['DELETE', undefined]] as const) {
        const response = await request(`/bookmarks/${card.id}`, method, body, token)
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
      }
    }
    expect((await fixture.client.query('SELECT * FROM bookmarks WHERE id=$1', [card.id])).rows[0]).toEqual(before)
  })
  it('他人・存在しない本棚へ投稿できず、所有者・匿名状態のmetadata偽装も拒否する', async () => {
    const other = await shelf(registered)
    const before = (await fixture.client.query('SELECT count(*) FROM bookmarks')).rows[0]
    for (const userBookId of [other.id, randomUUID()]) {
      for (const visibility of ['public', 'private']) expect((await request('/bookmarks', 'POST', { userBookId, content: '不正', visibility })).status).toBe(404)
    }
    const own = await shelf()
    const forged = await signing.sign({ sub: anonymous.id, user_metadata: { sub: registered.id, is_anonymous: false } })
    expect((await request('/bookmarks', 'POST', { userBookId: own.id, content: '公開不可', visibility: 'public' }, forged)).status).toBe(403)
    expect((await request('/bookmarks', 'POST', { userBookId: own.id, content: '不正', userId: registered.id })).status).toBe(400)
    expect((await fixture.client.query('SELECT count(*) FROM bookmarks')).rows[0]).toEqual(before)
  })
  it('匿名は公開作成・公開化と公開のままの編集を403、同UIDの正式JWTなら公開できる', async () => {
    const entry = await shelf(), card = await create(entry.id)
    const before = (await fixture.client.query('SELECT * FROM bookmarks WHERE id=$1', [card.id])).rows[0]
    expect((await request('/bookmarks', 'POST', { userBookId: entry.id, content: '公開不可', visibility: 'public' })).status).toBe(403)
    expect((await request(`/bookmarks/${card.id}`, 'PATCH', { visibility: 'public', content: '失敗' })).status).toBe(403)
    expect((await fixture.client.query('SELECT * FROM bookmarks WHERE id=$1', [card.id])).rows[0]).toEqual(before)
    const promoted = await signing.sign({ sub: anonymous.id, is_anonymous: false })
    expect((await request(`/bookmarks/${card.id}`, 'PATCH', { visibility: 'public' }, promoted)).status).toBe(200)
    for (const patch of [{ content: '公開編集不可' }, { pageNumber: 3 }, { visibility: 'public' }]) {
      const response = await request(`/bookmarks/${card.id}`, 'PATCH', patch)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'REGISTRATION_REQUIRED' } })
    }
    expect((await request(`/bookmarks/${card.id}`, 'PATCH', { visibility: 'private', content: '非公開へ戻す' })).status).toBe(200)
    const published = await create(entry.id, { ...anonymous, token: promoted }, { visibility: 'public' })
    expect((await request(`/bookmarks/${published.id}`, 'DELETE')).status).toBe(204)
  })
  it('非公開化・論理削除は公開プロフィール件数と公開本一覧に反映し、関連行は保持する', async () => {
    const owner = await actor(false), entry = await shelf(owner), card = await create(entry.id, owner, { visibility: 'public' })
    const publicCount = async () => (await (await request(`/users/${owner.id}`, 'GET', undefined, null)).json()).publicBookmarkCount
    const publicBooks = async () => (await (await request(`/users/${owner.id}/books`, 'GET', undefined, null)).json()).items
    expect(await publicCount()).toBe(1)
    expect(await publicBooks()).toHaveLength(1)
    await request(`/bookmarks/${card.id}`, 'PATCH', { visibility: 'private' }, owner.token)
    expect(await publicCount()).toBe(0)
    expect(await publicBooks()).toEqual([])
    await request(`/bookmarks/${card.id}`, 'PATCH', { visibility: 'public' }, owner.token)
    await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$2)', [stranger.id, card.id])
    await fixture.client.query("INSERT INTO bookmark_replies (user_id,bookmark_id,content) VALUES ($1,$2,'返信')", [stranger.id, card.id])
    expect((await request(`/bookmarks/${card.id}`, 'DELETE', undefined, owner.token)).status).toBe(204)
    for (const token of [null, owner.token, stranger.token]) expect((await get(card.id, token)).status).toBe(404)
    expect((await request(`/bookmarks/${card.id}`, 'PATCH', { content: '復活不可' }, owner.token)).status).toBe(404)
    expect((await request(`/bookmarks/${card.id}`, 'DELETE', undefined, owner.token)).status).toBe(404)
    expect((await (await request('/me/bookmarks', 'GET', undefined, owner.token)).json()).items).toEqual([])
    expect(await publicCount()).toBe(0)
    expect(await publicBooks()).toEqual([])
    expect((await fixture.client.query('SELECT bookmark_id FROM bookmark_likes WHERE bookmark_id=$1', [card.id])).rowCount).toBe(1)
    expect((await fixture.client.query('SELECT bookmark_id FROM bookmark_replies WHERE bookmark_id=$1', [card.id])).rowCount).toBe(1)
    expect((await request(`/me/books/${entry.id}`, 'DELETE', undefined, owner.token)).status).toBe(409)
  })
})

describe('栞入力・応答・トランザクション', () => {
  it.each([
    { content: '' }, { content: '　' }, { content: 'あ'.repeat(2001) }, { pageNumber: 0 }, { pageNumber: -1 },
    { pageNumber: 2147483648 }, { pageNumber: 1.5 }, { pageNumber: '1' }, { isSpoiler: 'false' }, { visibility: 'friends' },
    { userBookId: 'invalid' }, { createdAt: '2000-01-01T00:00:00Z' },
  ])('不正作成入力を400にして書き込まない: %j', async (extra) => {
    const entry = await shelf()
    const response = await request('/bookmarks', 'POST', { userBookId: entry.id, content: '本文', ...extra })
    expect(response.status).toBe(400)
    expect((await fixture.client.query('SELECT id FROM bookmarks WHERE user_book_id=$1', [entry.id])).rowCount).toBe(0)
  })
  it.each([{}, { userBookId: randomUUID() }, { authorId: randomUUID() }, { content: null }, { pageNumber: 0 }, { pageNumber: 2147483648 }, { unknown: true }])('不正PATCHを400にして保持する: %j', async (patch) => {
    const card = await create((await shelf()).id)
    expect((await request(`/bookmarks/${card.id}`, 'PATCH', patch)).status).toBe(400)
    expect(await (await get(card.id)).json()).toEqual(card)
  })
  it('最大文字数・ページ・null、未初期化・不存在・不正JSONを扱う', async () => {
    const card = await create((await shelf()).id, anonymous, { content: 'あ'.repeat(2000), pageNumber: 2147483647 })
    expect(card.content).toHaveLength(2000)
    expect(card.pageNumber).toBe(2147483647)
    const id = randomUUID(), token = await signing.sign({ sub: id })
    await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
    expect((await request('/me/bookmarks', 'GET', undefined, token)).status).toBe(404)
    const empty = await actor()
    expect(await (await request('/me/bookmarks', 'GET', undefined, empty.token)).json()).toEqual({ items: [], nextCursor: null })
    for (const method of ['GET', 'PATCH', 'DELETE']) expect((await request(`/bookmarks/${randomUUID()}`, method, method === 'PATCH' ? { content: '変更' } : undefined)).status).toBe(404)
    expect((await get('invalid')).status).toBe(400)
    for (const token of [null, anonymous.token]) {
      const response = await app.request('/api/v1/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: '{' }, { SUPABASE_URL: supabaseUrl })
      expect(response.status).toBe(token ? 400 : 401)
    }
  })
  it('作成・PATCHの応答取得が失敗したらINSERTと更新をロールバックする', async () => {
    const entry = await shelf(), card = await create(entry.id)
    const before = (await fixture.client.query('SELECT * FROM bookmarks WHERE id=$1', [card.id])).rows[0]
    await fixture.client.query('REVOKE SELECT ON bookmark_likes FROM book_bear_api')
    try {
      const created = await request('/bookmarks', 'POST', { userBookId: entry.id, content: '残らない' })
      const patched = await request(`/bookmarks/${card.id}`, 'PATCH', { content: '取り消す' })
      for (const response of [created, patched]) {
        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
      }
      expect((await fixture.client.query('SELECT id FROM bookmarks WHERE user_book_id=$1', [entry.id])).rowCount).toBe(1)
      expect((await fixture.client.query('SELECT * FROM bookmarks WHERE id=$1', [card.id])).rows[0]).toEqual(before)
    } finally { await fixture.client.query('GRANT SELECT ON bookmark_likes TO book_bear_api') }
  })
  it('無関係なFK違反を404に変換しない', async () => {
    const entry = await shelf()
    await fixture.client.query(`CREATE FUNCTION public.test_unrelated_bookmark_fk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_book_id='${entry.id}'::uuid THEN RAISE EXCEPTION 'private detail' USING ERRCODE='23503', CONSTRAINT='unrelated_foreign_key'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_unrelated_bookmark_fk BEFORE INSERT ON bookmarks FOR EACH ROW EXECUTE FUNCTION public.test_unrelated_bookmark_fk();`)
    try {
      const response = await request('/bookmarks', 'POST', { userBookId: entry.id, content: '作成しない' })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
      expect((await fixture.client.query('SELECT id FROM bookmarks WHERE user_book_id=$1', [entry.id])).rowCount).toBe(0)
    } finally { await fixture.client.query('DROP TRIGGER test_unrelated_bookmark_fk ON bookmarks; DROP FUNCTION public.test_unrelated_bookmark_fk()') }
  })
})

describe('本人一覧・集計・カーソル', () => {
  it('15件・マイクロ秒・同一日時の順序と追加／境界行削除後の継続を保証する', async () => {
    const owner = await actor(), entries = [await shelf(owner), await shelf(owner)]
    const ids = Array.from({ length: 18 }, () => randomUUID()).sort()
    for (let i = 0; i < ids.length; i++) await fixture.client.query('INSERT INTO bookmarks (id,user_book_id,content,page_number,created_at) VALUES ($1,$2,$3,$4,$5)',
      [ids[i], entries[i % 2].id, '順序確認', i + 1, `2026-01-01T00:00:00.${String(900000 - i).padStart(6, '0')}Z`])
    const first = FeedPage.parse(await (await request('/me/bookmarks', 'GET', undefined, owner.token)).json())
    expect(first.items.map((card) => card.id)).toEqual(ids.slice(0, 15))
    expect(first.nextCursor).toBeTypeOf('string')
    await request(`/bookmarks/${ids[14]}`, 'DELETE', undefined, owner.token)
    await create(entries[0].id, owner)
    const second = FeedPage.parse(await (await request(`/me/bookmarks?cursor=${first.nextCursor}`, 'GET', undefined, owner.token)).json())
    expect(second.items.map((card) => card.id)).toEqual(ids.slice(15))
    expect(second.nextCursor).toBeNull()
    await fixture.client.query("UPDATE bookmarks SET created_at='2026-01-01T00:00:00.123456Z' WHERE user_book_id IN ($1,$2)", entries.map((entry) => entry.id))
    const expected = (await fixture.client.query('SELECT id FROM bookmarks WHERE user_book_id IN ($1,$2) AND deleted_at IS NULL ORDER BY created_at DESC,id DESC', entries.map((entry) => entry.id))).rows.map((row) => row.id)
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = FeedPage.parse(await (await request(`/me/bookmarks?limit=7${cursor ? `&cursor=${cursor}` : ''}`, 'GET', undefined, owner.token)).json())
      seen.push(...page.items.map((card) => card.id)); cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(expected)
  })
  it('本人の公開・非公開だけを返し、他人・削除済みを除外。境界変更でも認可を維持する', async () => {
    const owner = await actor(false), other = await actor(false)
    const ownShelf = await shelf(owner), otherShelf = await shelf(other)
    const publicCard = await create(ownShelf.id, owner, { visibility: 'public' }), privateCard = await create(ownShelf.id, owner)
    const deleted = await create(ownShelf.id, owner)
    await request(`/bookmarks/${deleted.id}`, 'DELETE', undefined, owner.token)
    await create(otherShelf.id, other, { visibility: 'public' })
    await create(otherShelf.id, other)
    const cursor = Buffer.from(JSON.stringify({ createdAt: '2099-01-01T00:00:00.000001Z', id: randomUUID() })).toString('base64url')
    const mine = FeedPage.parse(await (await request(`/me/bookmarks?cursor=${cursor}&limit=30`, 'GET', undefined, owner.token)).json())
    expect(mine.items.map((card) => card.id).sort()).toEqual([publicCard.id, privateCard.id].sort())
    const first = FeedPage.parse(await (await request('/me/bookmarks?limit=1', 'GET', undefined, owner.token)).json())
    const transferred = FeedPage.parse(await (await request(`/me/bookmarks?cursor=${first.nextCursor}`, 'GET', undefined, other.token)).json())
    expect(transferred.items.every((card) => card.author.id === other.id)).toBe(true)
    const library = await (await request('/me/books?limit=1', 'GET', undefined, owner.token)).json()
    // A valid cursor from another list is only a boundary, never authorization.
    const fromShelf = Buffer.from(JSON.stringify({ createdAt: library.items[0].createdAt, id: library.items[0].id })).toString('base64url')
    const page = FeedPage.parse(await (await request(`/me/bookmarks?cursor=${fromShelf}`, 'GET', undefined, owner.token)).json())
    expect(page.items.every((card) => card.author.id === owner.id)).toBe(true)
  })
  it.each(['invalid!', 'a', Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ createdAt: '2026-02-30T00:00:00.000000Z', id: randomUUID() })).toString('base64url'),
    Buffer.from(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000000Z', id: 'bad' })).toString('base64url'),
  ])('不正カーソルは400 INVALID_CURSOR: %s', async (cursor) => {
    const response = await request(`/me/bookmarks?cursor=${encodeURIComponent(cursor)}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } })
  })
  it('空カーソル・limit範囲外は400、30件まで取得する', async () => {
    for (const query of ['cursor=', 'limit=0', 'limit=31', 'limit=1.5']) expect((await request(`/me/bookmarks?${query}`)).status).toBe(400)
    const owner = await actor(), entry = await shelf(owner)
    await fixture.client.query("INSERT INTO bookmarks (user_book_id,content) SELECT $1,'件数確認' FROM generate_series(1,31)", [entry.id])
    const page = FeedPage.parse(await (await request('/me/bookmarks?limit=30', 'GET', undefined, owner.token)).json())
    expect(page.items).toHaveLength(30)
    expect(page.nextCursor).toBeTypeOf('string')
  })
  it('いいね・未削除返信を重複なく一括集計し、投稿数でDB往復数が増えない', async () => {
    const owner = await actor(false), entry = await shelf(owner)
    const cards = []
    for (let i = 0; i < 15; i++) cards.push(await create(entry.id, owner, { visibility: 'public' }))
    const target = cards[0]
    await fixture.client.query('INSERT INTO bookmark_likes (user_id,bookmark_id) VALUES ($1,$3),($2,$3)', [owner.id, stranger.id, target.id])
    await fixture.client.query("INSERT INTO bookmark_replies (user_id,bookmark_id,content,deleted_at) VALUES ($1,$2,'1',null),($1,$2,'2',null),($1,$2,'3',null),($1,$2,'削除済み',now())", [stranger.id, target.id])
    expect(await (await get(target.id, owner.token)).json()).toMatchObject({ likeCount: 2, replyCount: 3, likedByMe: true })
    expect(await (await get(target.id, null)).json()).toMatchObject({ likeCount: 2, replyCount: 3, likedByMe: false })
    const spy = vi.spyOn(Client.prototype, 'query')
    const reads: number[] = []
    try {
      for (const limit of [1, 15]) {
        spy.mockClear()
        const response = await request(`/me/bookmarks?limit=${limit}`, 'GET', undefined, owner.token)
        expect(response.status).toBe(200)
        const page = FeedPage.parse(await response.json())
        expect(page.items).toHaveLength(limit)
        for (const card of page.items) expect(card).toMatchObject({ likeCount: card.id === target.id ? 2 : 0, replyCount: card.id === target.id ? 3 : 0 })
        reads.push(spy.mock.calls.filter(([raw]) => {
          const query = raw as unknown as string | { text: string }
          return /^(select|with)\b/i.test(typeof query === 'string' ? query : query.text)
        }).length)
      }
    } finally { spy.mockRestore() }
    expect(reads).toEqual([4, 4])
  })
})

describe('PostgreSQLでの並行処理', () => {
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('本人確認後の本棚消失は該当FK違反を404へ変換する', async () => {
    const owner = await actor(), entry = await shelf(owner)
    const original = Client.prototype.query
    await fixture.client.query("SET statement_timeout='2s'")
    const spy = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args)
      const query = args[0] as string | { text: string }
      const text = typeof query === 'string' ? query : query.text
      if (/^select "id" from "user_books"/i.test(text) && Array.isArray(args[1]) && args[1].includes(entry.id)) {
        return Promise.resolve(result).then(async (rows) => {
          await fixture.client.query('DELETE FROM user_books WHERE id=$1', [entry.id])
          return rows
        })
      }
      return result
    } as typeof original)
    try {
      const response = await request('/bookmarks', 'POST', { userBookId: entry.id, content: '保存できない' }, owner.token)
      expect(response.status).toBe(404)
      expect((await fixture.client.query('SELECT id FROM bookmarks WHERE user_book_id=$1', [entry.id])).rowCount).toBe(0)
    } finally { spy.mockRestore(); await fixture.client.query('SET statement_timeout=0') }
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL)).each(['public', 'deleted'] as const)('PATCHはロック後の最新状態で判定する: %s', async (change) => {
    const owner = await actor(), card = await create((await shelf(owner)).id, owner)
    await fixture.client.query('BEGIN')
    let pending: Promise<Response> | undefined
    try {
      await fixture.client.query(change === 'public' ? "UPDATE bookmarks SET visibility='public' WHERE id=$1" : 'UPDATE bookmarks SET deleted_at=now() WHERE id=$1', [card.id])
      pending = Promise.resolve(request(`/bookmarks/${card.id}`, 'PATCH', { content: '書き換え不可' }, owner.token))
      let blocked = false
      for (let i = 0; i < 100; i++) {
        await fixture.client.query('SELECT pg_stat_clear_snapshot()')
        const waiting = await fixture.client.query("SELECT 1 FROM pg_stat_activity WHERE usename='book_bear_api' AND wait_event_type='Lock'")
        if (waiting.rowCount) { blocked = true; break }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(blocked).toBe(true)
      await fixture.client.query('COMMIT')
      const response = await pending
      expect(response.status).toBe(change === 'public' ? 403 : 404)
      expect((await fixture.client.query('SELECT content FROM bookmarks WHERE id=$1', [card.id])).rows[0].content).toBe('読書の感想')
    } finally { await fixture.client.query('ROLLBACK'); await pending }
  })
})

it('実Workersでも栞の作成・取得・公開拒否・論理削除が動作する', async () => {
  const entry = await shelf()
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
    const headers = { Authorization: `Bearer ${anonymous.token}`, 'Content-Type': 'application/json' }
    const created = await worker.fetch('/api/v1/bookmarks', { method: 'POST', headers, body: JSON.stringify({ userBookId: entry.id, content: 'Workersで保存' }) })
    expect(created.status).toBe(201)
    const card = BookmarkCard.parse(await created.json())
    expect((await worker.fetch(`/api/v1/bookmarks/${card.id}`, { headers })).status).toBe(200)
    expect((await worker.fetch(`/api/v1/bookmarks/${card.id}`)).status).toBe(404)
    expect((await worker.fetch(`/api/v1/bookmarks/${card.id}`, { method: 'PATCH', headers, body: '{"visibility":"public"}' })).status).toBe(403)
    expect((await worker.fetch(`/api/v1/bookmarks/${card.id}`, { method: 'DELETE', headers })).status).toBe(204)
  } finally {
    await worker?.stop()
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
  }
}, 60000)
