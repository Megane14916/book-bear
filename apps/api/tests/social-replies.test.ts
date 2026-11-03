import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { Reply, ReplyPage } from '../src/modules/replies/schemas'
import { FeedPage } from '../src/modules/bookmarks/schemas'
import { UserPage } from '../src/modules/users/schemas'
import { encodeCursor } from '../src/shared/cursor'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
type Actor = { id: string; token: string }
let owner: Actor, other: Actor, anonymous: Actor
const env = () => ({ SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString } })
function request(path: string, token: string | null = null, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env())
}
async function actor(isAnonymous = false, initialize = true): Promise<Actor> {
  const id = randomUUID()
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  const token = await signing.sign({ sub: id, is_anonymous: isAnonymous })
  if (initialize) expect((await request('/me', token, 'PUT')).status).toBe(200)
  return { id, token }
}
async function bookmark(user = owner, visibility = 'public') {
  const created = await request('/books/manual', user.token, 'POST', { title: `SNS ${randomUUID()}` })
  expect(created.status).toBe(201)
  const entry = await request('/me/books', user.token, 'POST', { bookId: (await created.json()).id })
  expect(entry.status).toBe(201)
  const response = await request('/bookmarks', user.token, 'POST', { userBookId: (await entry.json()).id, content: '元栞', visibility })
  expect(response.status).toBe(201)
  return await response.json() as { id: string; createdAt: string }
}
async function reply(bookmarkId: string, user = other, input: Record<string, unknown> = {}) {
  const response = await request(`/bookmarks/${bookmarkId}/replies`, user.token, 'POST', { content: ' 返信 ', ...input })
  expect(response.status, await response.clone().text()).toBe(201)
  return Reply.parse(await response.json())
}
async function list(bookmarkId: string, token: string | null = null, query = '') {
  const response = await request(`/bookmarks/${bookmarkId}/replies${query ? `?${query}` : ''}`, token)
  expect(response.status, await response.clone().text()).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const raw = await response.json()
  expect(Object.keys(raw).sort()).toEqual(['items', 'nextCursor'])
  for (const item of raw.items) {
    expect(Object.keys(item).sort()).toEqual(['id', 'author', 'content', 'isSpoiler', 'createdAt', 'updatedAt'].sort())
    expect(Object.keys(item.author).sort()).toEqual(['id', 'displayName', 'avatarUrl'].sort())
  }
  return ReplyPage.parse(raw)
}
beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  app = createApp({ verifyToken: createTokenVerifier(signing.fetcher), database: (bindings, query) => withDatabase(bindings, async (db) => {
    await db.execute(sql`SET ROLE book_bear_api`)
    try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
  }) })
  owner = await actor(); other = await actor(); anonymous = await actor(true)
}, 30000)
afterAll(async () => { await fixture?.close() })

describe('正式登録の確認日時', () => {
  it('正式PUT /meだけで初回記録し、古いプロフィール日時・内容・設定・UIDを保持する', async () => {
    const user = await actor(true)
    await request('/me', user.token, 'PATCH', { displayName: '既存の名前', bio: '既存の自己紹介' })
    await request('/me/preferences', user.token, 'PATCH', { feedContentMode: 'all' })
    await fixture.client.query("UPDATE profiles SET created_at='2020-01-01T00:00:00.123456Z',updated_at='2021-02-03T04:05:06.654321Z' WHERE id=$1", [user.id])
    const read = async () => (await fixture.client.query('SELECT * FROM profiles WHERE id=$1', [user.id])).rows[0]
    const before = await read(), preferences = await (await request('/me/preferences', user.token)).json()
    expect(before.registration_confirmed_at).toBeNull()
    await request('/me', user.token, 'PUT')
    expect(await read()).toEqual(before)
    const formal = await signing.sign({ sub: user.id, is_anonymous: false })
    // Reading or using a formal JWT is not itself a registration-confirmation write.
    expect((await request('/me', formal)).status).toBe(200)
    expect((await read()).registration_confirmed_at).toBeNull()
    expect((await request(`/users/${user.id}/follow`, owner.token, 'PUT')).status).toBe(404)
    const response = await request('/me', formal, 'PUT')
    expect(response.status).toBe(200)
    const confirmed = await read()
    expect(confirmed.registration_confirmed_at).toBeInstanceOf(Date)
    expect({ ...confirmed, registration_confirmed_at: null }).toEqual(before)
    const raw = await response.json()
    expect(raw).toMatchObject({ id: user.id, displayName: '既存の名前', isAnonymous: false })
    expect(JSON.stringify(raw)).not.toMatch(/registration|confirmed/i)
    await Promise.all([request('/me', formal, 'PUT'), request('/me', formal, 'PUT')])
    await request('/me', user.token, 'PUT')
    expect(await read()).toEqual(confirmed)
    expect(await (await request('/me/preferences', formal)).json()).toEqual(preferences)
    expect((await request(`/users/${user.id}/follow`, owner.token, 'PUT')).status).toBe(204)
    expect((await request(`/users/${owner.id}/follow`, user.token, 'PUT')).status).toBe(403)
    expect(JSON.stringify(await (await request(`/users/${user.id}`)).json())).not.toMatch(/registration|confirmed/i)
  })
})

describe('フォロー・いいね・Registered操作の認可', () => {
  it.each(['follow', 'unfollow', 'like', 'unlike', 'reply'])('JWT→Zod→正式登録の順をDB接続前に保証する: %s', async (operation) => {
    const database = vi.fn(async () => { throw new Error('DB must not be called') })
    const guarded = createApp({ database, verifyToken: createTokenVerifier(signing.fetcher) })
    const isReply = operation === 'reply', isFollow = operation.includes('follow')
    const method = isReply ? 'POST' : operation.startsWith('un') ? 'DELETE' : 'PUT'
    for (const invalid of [false, true]) for (const token of [null, 'invalid', await signing.sign({ exp: 1 }), anonymous.token, owner.token]) {
      const id = invalid ? 'invalid' : randomUUID()
      const path = isFollow ? `/users/${id}/follow` : `/bookmarks/${id}/${isReply ? 'replies' : 'like'}`
      const response = await guarded.request(`/api/v1${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(isReply ? { 'Content-Type': 'application/json' } : {}) },
        ...(isReply ? { body: JSON.stringify({ content: invalid ? '' : '感想' }) } : {}) }, env())
      // Formal, valid input intentionally reaches the failing DB.
      const status = token === anonymous.token ? invalid ? 400 : 403 : token === owner.token ? invalid ? 400 : 500 : 401
      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(database).toHaveBeenCalledTimes(1)
    const forged = await signing.sign({ sub: anonymous.id, user_metadata: { is_anonymous: false, sub: owner.id } })
    const path = isFollow ? `/users/${owner.id}/follow` : `/bookmarks/${randomUUID()}/${isReply ? 'replies' : 'like'}`
    expect((await guarded.request(`/api/v1${path}`, { method, headers: { Authorization: `Bearer ${forged}`, ...(isReply ? { 'Content-Type': 'application/json' } : {}) }, ...(isReply ? { body: '{"content":"感想"}' } : {}) }, env())).status).toBe(403)
    expect(database).toHaveBeenCalledTimes(1)
  })
  it('フォローの重複・解除は冪等で、自己指定・未確認・不存在を拒否し、他人の関係を変えない', async () => {
    const user = await actor(), target = await actor(), unrelated = await actor(), uninitialized = await actor(false, false)
    for (const id of [anonymous.id, randomUUID()]) expect((await request(`/users/${id}/follow`, user.token, 'PUT')).status).toBe(404)
    for (const method of ['PUT', 'DELETE']) {
      expect((await request(`/users/${user.id}/follow`, user.token, method)).status).toBe(400)
      expect((await request(`/users/${randomUUID()}/follow`, user.token, method)).status).toBe(404)
      expect((await request(`/users/${target.id}/follow`, uninitialized.token, method)).status).toBe(404)
    }
    const path = `/users/${target.id}/follow`
    expect((await request(path, user.token, 'PUT')).status).toBe(204)
    const first = (await fixture.client.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [user.id, target.id])).rows
    expect((await request(path, user.token, 'PUT')).status).toBe(204)
    expect((await fixture.client.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [user.id, target.id])).rows).toEqual(first)
    await request(path, unrelated.token, 'PUT')
    expect(await (await request(`/users/${target.id}`, user.token)).json()).toMatchObject({ followersCount: 2, followedByMe: true })
    expect(await (await request('/me', user.token)).json()).toMatchObject({ followingCount: 1 })
    for (let i = 0; i < 2; i++) {
      const response = await request(path, user.token, 'DELETE')
      expect(response.status).toBe(204); expect(await response.text()).toBe('')
    }
    expect(await (await request(`/users/${target.id}`, user.token)).json()).toMatchObject({ followersCount: 1, followedByMe: false })
    expect((await fixture.client.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [unrelated.id, target.id])).rowCount).toBe(1)
  })
  it('いいねを本人の複合PKで管理し、非公開・削除済みは本人にも404にする', async () => {
    const card = await bookmark(), path = `/bookmarks/${card.id}/like`
    for (let i = 0; i < 2; i++) expect((await request(path, other.token, 'PUT')).status).toBe(204)
    await request(path, owner.token, 'PUT')
    expect(await (await request(`/bookmarks/${card.id}`, other.token)).json()).toMatchObject({ likeCount: 2, likedByMe: true })
    expect(await (await request(`/bookmarks/${card.id}`)).json()).toMatchObject({ likeCount: 2, likedByMe: false })
    for (let i = 0; i < 2; i++) expect((await request(path, other.token, 'DELETE')).status).toBe(204)
    expect(await (await request(`/bookmarks/${card.id}`, other.token)).json()).toMatchObject({ likeCount: 1, likedByMe: false })
    await request(`/bookmarks/${card.id}`, owner.token, 'PATCH', { visibility: 'private' })
    for (const user of [owner, other]) for (const method of ['PUT', 'DELETE']) expect((await request(path, user.token, method)).status).toBe(404)
    expect((await fixture.client.query('SELECT * FROM bookmark_likes WHERE bookmark_id=$1', [card.id])).rowCount).toBe(1)
    await request(`/bookmarks/${card.id}`, owner.token, 'DELETE')
    expect((await request(path, owner.token, 'PUT')).status).toBe(404)
    expect((await request(`/bookmarks/${randomUUID()}/like`, other.token, 'DELETE')).status).toBe(404)
  })
})

describe('返信一覧・所有権・親の公開範囲', () => {
  it('可読親の返信0件・削除済みのみ・カーソル後0件は200、読めない親は404', async () => {
    const card = await bookmark()
    expect(await list(card.id)).toEqual({ items: [], nextCursor: null })
    const created = await reply(card.id)
    expect(created).toMatchObject({ author: { id: other.id }, content: '返信', isSpoiler: false })
    expect((await list(card.id)).items).toEqual([created])
    expect(await list(card.id, null, `cursor=${encodeCursor({ createdAt: created.createdAt, id: created.id })}`)).toEqual({ items: [], nextCursor: null })
    await request(`/replies/${created.id}`, other.token, 'DELETE')
    expect(await list(card.id)).toEqual({ items: [], nextCursor: null })
    await request(`/bookmarks/${card.id}`, owner.token, 'PATCH', { visibility: 'private' })
    for (const token of [null, anonymous.token, other.token]) expect((await request(`/bookmarks/${card.id}/replies`, token)).status).toBe(404)
    expect(await list(card.id, owner.token)).toEqual({ items: [], nextCursor: null })
    await request(`/bookmarks/${card.id}`, owner.token, 'DELETE')
    expect((await request(`/bookmarks/${card.id}/replies`, owner.token)).status).toBe(404)
    expect((await request(`/bookmarks/${randomUUID()}/replies`)).status).toBe(404)
    expect((await request(`/bookmarks/${card.id}/replies`, 'invalid')).status).toBe(401)
  })
  it('PATCHは本人かつ可読親を要求し、公開編集は匿名403、非公開の自分の親なら匿名でも編集可', async () => {
    const card = await bookmark(), created = await reply(card.id), own = await reply(card.id, owner)
    expect((await request(`/replies/${created.id}`, owner.token, 'PATCH', { content: '他人' })).status).toBe(404)
    const anonymousOther = await signing.sign({ sub: other.id, is_anonymous: true })
    expect((await request(`/replies/${created.id}`, anonymousOther, 'PATCH', { content: '公開編集' })).status).toBe(403)
    const changed = await request(`/replies/${created.id}`, other.token, 'PATCH', { content: ' 更新 ', isSpoiler: true })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ content: '更新', isSpoiler: true, createdAt: created.createdAt })
    await request(`/bookmarks/${card.id}`, owner.token, 'PATCH', { visibility: 'private' })
    expect((await request(`/replies/${created.id}`, other.token, 'PATCH', { content: '不可' })).status).toBe(404)
    expect((await request(`/bookmarks/${card.id}/replies`, other.token)).status).toBe(404)
    const anonOwner = await signing.sign({ sub: owner.id })
    expect((await request(`/replies/${own.id}`, anonOwner, 'PATCH', { content: '非公開編集' })).status).toBe(200)
    await request(`/bookmarks/${card.id}`, owner.token, 'DELETE')
    expect((await request(`/replies/${own.id}`, owner.token, 'PATCH', { content: '削除後' })).status).toBe(404)
  })
  it.each(['public', 'private', 'deleted'])('DELETEは元栞の状態によらず匿名・正式の本人だけ許可: %s', async (state) => {
    const card = await bookmark(), replies = [await reply(card.id), await reply(card.id)]
    if (state === 'private') await request(`/bookmarks/${card.id}`, owner.token, 'PATCH', { visibility: 'private' })
    if (state === 'deleted') await request(`/bookmarks/${card.id}`, owner.token, 'DELETE')
    const tokens = [other.token, await signing.sign({ sub: other.id })]
    for (let i = 0; i < replies.length; i++) {
      const path = `/replies/${replies[i].id}`
      expect((await request(path, owner.token, 'DELETE')).status).toBe(404)
      const spy = vi.spyOn(Client.prototype, 'query')
      let response: Response
      try {
        response = await request(path, tokens[i], 'DELETE')
        const statements = spy.mock.calls.map(([raw]) => typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text)
        expect(statements.some((query) => /\b(bookmarks|user_books)\b|for share|for update/i.test(query))).toBe(false)
      } finally { spy.mockRestore() }
      expect(response!.status).toBe(204); expect(await response!.text()).toBe('')
      expect((await request(path, tokens[i], 'DELETE')).status).toBe(404)
      const row = (await fixture.client.query('SELECT deleted_at,updated_at,created_at FROM bookmark_replies WHERE id=$1', [replies[i].id])).rows[0]
      expect(row.deleted_at).toEqual(row.updated_at)
      expect(row.created_at.toISOString()).toBe(new Date(replies[i].createdAt).toISOString())
    }
    expect((await request(`/replies/${randomUUID()}`, other.token, 'DELETE')).status).toBe(404)
    if (state !== 'deleted') expect(await (await request(`/bookmarks/${card.id}`, owner.token)).json()).toMatchObject({ replyCount: 0 })
  })
  it.each([{ content: '' }, { content: 'あ'.repeat(1001) }, { isSpoiler: 'false' }, { bookmarkId: randomUUID() }])('POST入力不正は400・書き込みなし: %j', async (input) => {
    const card = await bookmark()
    for (const user of [other, anonymous]) expect((await request(`/bookmarks/${card.id}/replies`, user.token, 'POST', { content: '返信', ...input })).status).toBe(400)
    expect((await list(card.id)).items).toEqual([])
  })
  it('上限文字数・空PATCH・所有者偽装・未認証と非公開POSTを扱う', async () => {
    const card = await bookmark(), created = await reply(card.id, other, { content: 'あ'.repeat(1000), isSpoiler: true })
    for (const body of [{}, { userId: owner.id }, { createdAt: created.createdAt }, { content: null }]) expect((await request(`/replies/${created.id}`, other.token, 'PATCH', body)).status).toBe(400)
    for (const token of [null, 'invalid', await signing.sign({ exp: 1 })]) for (const method of ['PATCH', 'DELETE']) {
      expect((await request(`/replies/${created.id}`, token, method, method === 'PATCH' ? { content: '変更' } : undefined)).status).toBe(401)
    }
    await request(`/bookmarks/${card.id}`, owner.token, 'PATCH', { visibility: 'private' })
    for (const user of [owner, other]) expect((await request(`/bookmarks/${card.id}/replies`, user.token, 'POST', { content: '不可' })).status).toBe(404)
  })
  it('作成とPATCHの応答取得失敗はトランザクションをロールバックする', async () => {
    const card = await bookmark(), created = await reply(card.id)
    const original = Client.prototype.query
    const spy = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client, ...args: unknown[]) {
      const query = args[0] as string | { text: string }, text = typeof query === 'string' ? query : query.text
      if (/^select.*from "bookmark_replies".*inner join "profiles"/i.test(text)) return Promise.reject(new Error('private response failure'))
      return Reflect.apply(original, this, args)
    } as typeof original)
    try {
      for (const response of [await request(`/bookmarks/${card.id}/replies`, other.token, 'POST', { content: '残らない' }), await request(`/replies/${created.id}`, other.token, 'PATCH', { content: '残らない' })]) {
        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
      }
    } finally { spy.mockRestore() }
    expect((await list(card.id)).items).toEqual([created])
  })
})

describe('一覧・関係・followingのカーソルと一括取得', () => {
  it('返信は15／30件、同一日時とマイクロ秒の昇順、境界削除後も継続する', async () => {
    const card = await bookmark(), ids: string[] = Array.from({ length: 33 }, () => randomUUID()).sort()
    for (let i = 0; i < ids.length; i++) await fixture.client.query('INSERT INTO bookmark_replies (id,user_id,bookmark_id,content,created_at) VALUES ($1,$2,$3,$4,$5)',
      [ids[i], other.id, card.id, `返信${i}`, `2020-01-01T00:00:00.${i < 17 ? '123456' : String(123456 + i)}Z`])
    const first = await list(card.id)
    expect(first.items.map((row) => row.id)).toEqual(ids.slice(0, 15))
    expect(first.items[0].createdAt).toBe('2020-01-01T00:00:00.123456Z')
    await request(`/replies/${ids[14]}`, other.token, 'DELETE')
    const second = await list(card.id, null, `cursor=${first.nextCursor}`)
    const third = await list(card.id, null, `cursor=${second.nextCursor}`)
    expect([...second.items, ...third.items].map((row) => row.id)).toEqual(ids.slice(15))
    expect(third.nextCursor).toBeNull()
    expect((await list(card.id, null, 'limit=30')).items).toHaveLength(30)
    const spy = vi.spyOn(Client.prototype, 'query'), reads: number[] = []
    try {
      for (const limit of [1, 15]) {
        spy.mockClear(); await list(card.id, null, `limit=${limit}`)
        reads.push(spy.mock.calls.filter(([raw]) => /^(select|with)\b/i.test(typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text)).length)
      }
    } finally { spy.mockRestore() }
    expect(reads).toEqual([1, 1])
  })
  it('関係一覧は公開UserSummaryだけを向き・対象UID・関係日時で制限する', async () => {
    const user = await actor(), peers = []
    for (let i = 0; i < 17; i++) { const peer = await actor(); peers.push(peer); await request(`/users/${peer.id}/follow`, user.token, 'PUT') }
    await request(`/users/${user.id}/follow`, owner.token, 'PUT')
    await fixture.client.query("UPDATE follows SET created_at='2020-01-01T00:00:00.123456Z' WHERE follower_id=$1", [user.id])
    const expected = peers.map((peer) => peer.id).sort().reverse()
    const firstResponse = await request(`/users/${user.id}/following`)
    expect(firstResponse.headers.get('Cache-Control')).toBe('no-store')
    const first = UserPage.parse(await firstResponse.json())
    expect(first.items.map((peer) => peer.id)).toEqual(expected.slice(0, 15))
    for (const peer of first.items) expect(Object.keys(peer).sort()).toEqual(['id', 'displayName', 'avatarUrl'].sort())
    const second = UserPage.parse(await (await request(`/users/${user.id}/following?cursor=${first.nextCursor}`)).json())
    expect(second.items.map((peer) => peer.id)).toEqual(expected.slice(15))
    expect(second.nextCursor).toBeNull()
    expect(UserPage.parse(await (await request(`/users/${user.id}/followers`)).json()).items.map((peer) => peer.id)).toEqual([owner.id])
    expect(UserPage.parse(await (await request(`/users/${peers[0].id}/following`)).json())).toEqual({ items: [], nextCursor: null })
    expect((await request(`/users/${randomUUID()}/followers`)).status).toBe(404)
  })
  it('followingはフォロー先の公開のみを返し、カーソル転用・解除・非公開化でも漏えいしない', async () => {
    const viewer = await actor(), author = await actor(), stranger = await actor()
    const cards = [await bookmark(author), await bookmark(author), await bookmark(author)]
    await bookmark(author, 'private'); await bookmark(stranger); await bookmark(viewer)
    await request(`/users/${author.id}/follow`, viewer.token, 'PUT')
    for (let i = 0; i < cards.length; i++) await fixture.client.query('UPDATE bookmarks SET created_at=$1 WHERE id=$2', [`2020-01-01T00:00:00.${String(123456 + i)}Z`, cards[i].id])
    const first = FeedPage.parse(await (await request('/feed?scope=following&limit=1', viewer.token)).json())
    expect(first.items.map((card) => card.id)).toEqual([cards[2].id])
    await request(`/bookmarks/${cards[1].id}`, author.token, 'PATCH', { visibility: 'private' })
    const next = FeedPage.parse(await (await request(`/feed?scope=following&cursor=${first.nextCursor}`, viewer.token)).json())
    expect(next.items.map((card) => card.id)).toEqual([cards[0].id]); expect(next.nextCursor).toBeNull()
    expect(FeedPage.parse(await (await request(`/feed?scope=following&cursor=${first.nextCursor}`, stranger.token)).json())).toEqual({ items: [], nextCursor: null })
    await request(`/users/${author.id}/follow`, viewer.token, 'DELETE')
    expect(FeedPage.parse(await (await request('/feed?scope=following', viewer.token)).json())).toEqual({ items: [], nextCursor: null })
    expect((await request('/feed?scope=following&cursor=invalid!', viewer.token)).status).toBe(400)
    expect((await request('/feed?scope=following', (await actor(false, false)).token)).status).toBe(404)
  })
  it('followingも既定15・上限30、同一日時とマイクロ秒の境界で重複・欠落なく続く', async () => {
    const viewer = await actor(), author = await actor(), card = await bookmark(author)
    const shelfId = (await fixture.client.query('SELECT user_book_id FROM bookmarks WHERE id=$1', [card.id])).rows[0].user_book_id
    await request(`/bookmarks/${card.id}`, author.token, 'PATCH', { visibility: 'private' })
    await request(`/users/${author.id}/follow`, viewer.token, 'PUT')
    const ids: string[] = Array.from({ length: 33 }, () => randomUUID()).sort().reverse()
    for (let i = 0; i < ids.length; i++) await fixture.client.query("INSERT INTO bookmarks (id,user_book_id,content,visibility,created_at) VALUES ($1,$2,'following境界','public',$3)",
      [ids[i], shelfId, `2020-01-01T00:00:00.${i < 17 ? '123456' : String(123456 - i)}Z`])
    let cursor: string | null = null
    const seen: string[] = []
    do {
      const result = FeedPage.parse(await (await request(`/feed?scope=following${cursor ? `&cursor=${cursor}` : ''}`, viewer.token)).json())
      expect(result.items.map((item) => item.id)).toEqual(ids.slice(seen.length, seen.length + 15))
      seen.push(...result.items.map((item) => item.id)); cursor = result.nextCursor
    } while (cursor)
    expect(seen).toEqual(ids)
    expect(new Set(seen).size).toBe(33)
    expect(FeedPage.parse(await (await request('/feed?scope=following&limit=30', viewer.token)).json()).items.map((item) => item.id)).toEqual(ids.slice(0, 30))
  })
  it.each(['invalid!', encodeCursor({ createdAt: '2020-02-30T00:00:00.000000Z', id: randomUUID() }), encodeCursor({ createdAt: '2020-01-01T00:00:00.000000Z', id: 'bad' })])('各一覧で不正カーソルを拒否: %s', async (cursor) => {
    const card = await bookmark()
    for (const path of [`/users/${owner.id}/followers`, `/users/${owner.id}/following`, `/bookmarks/${card.id}/replies`, '/feed?scope=following']) {
      const response = await request(`${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`, owner.token)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } })
    }
  })
})

describe('PostgreSQLでの競合とロック', () => {
  async function waitForLock() {
    for (let i = 0; i < 100; i++) {
      await fixture.client.query('SELECT pg_stat_clear_snapshot()')
      if ((await fixture.client.query("SELECT 1 FROM pg_stat_activity WHERE usename='book_bear_api' AND wait_event_type='Lock'")).rowCount) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Expected the API to wait for the parent/reply row lock')
  }
  it.runIf(Boolean(process.env.TEST_DATABASE_URL)).each(
    ['likePut', 'likeDelete', 'replyPost', 'replyPatch'].flatMap((operation) => ['private', 'deleted'].map((change) => ({ operation, change }))),
  )('公開確認のFOR SHAREは親の最新状態で拒否する: $operation / $change', async ({ operation, change }) => {
    const card = await bookmark(), created = operation === 'replyPatch' ? await reply(card.id) : undefined
    if (operation === 'likeDelete') await request(`/bookmarks/${card.id}/like`, other.token, 'PUT')
    const path = operation === 'replyPatch' ? `/replies/${created!.id}` : `/bookmarks/${card.id}/${operation === 'replyPost' ? 'replies' : 'like'}`
    const method = operation === 'replyPatch' ? 'PATCH' : operation === 'replyPost' ? 'POST' : operation === 'likePut' ? 'PUT' : 'DELETE'
    let pending: Promise<Response> | undefined
    await fixture.client.query('BEGIN')
    try {
      await fixture.client.query(change === 'private' ? "UPDATE bookmarks SET visibility='private' WHERE id=$1" : 'UPDATE bookmarks SET deleted_at=now() WHERE id=$1', [card.id])
      pending = Promise.resolve(request(path, other.token, method, operation.startsWith('reply') ? { content: '変更させない' } : undefined))
      await waitForLock()
      await fixture.client.query('COMMIT')
      expect((await pending).status).toBe(404)
      expect((await fixture.client.query('SELECT * FROM bookmark_likes WHERE bookmark_id=$1', [card.id])).rowCount).toBe(operation === 'likeDelete' ? 1 : 0)
      const rows = (await fixture.client.query('SELECT content FROM bookmark_replies WHERE bookmark_id=$1', [card.id])).rows
      expect(rows).toEqual(created ? [{ content: '返信' }] : [])
    } finally { await fixture.client.query('ROLLBACK'); await pending }
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('PATCHは親FOR SHAREの後に返信FOR UPDATEを取り、並行削除を再評価する', async () => {
    const card = await bookmark(), created = await reply(card.id)
    let pending: Promise<Response> | undefined
    const spy = vi.spyOn(Client.prototype, 'query')
    await fixture.client.query('BEGIN')
    try {
      await fixture.client.query('UPDATE bookmark_replies SET deleted_at=now() WHERE id=$1', [created.id])
      pending = Promise.resolve(request(`/replies/${created.id}`, other.token, 'PATCH', { content: '復活させない' }))
      await waitForLock()
      const statements = spy.mock.calls.map(([raw]) => typeof raw === 'string' ? raw : (raw as unknown as { text: string }).text)
      const locks = statements.filter((query) => /for (share|update)/i.test(query))
      expect(locks).toHaveLength(2)
      expect(locks[0]).toMatch(/for share of "bookmarks"/i)
      expect(locks[1]).toMatch(/for update of "bookmark_replies"/i)
      await fixture.client.query('COMMIT')
      expect((await pending).status).toBe(404)
    } finally { spy.mockRestore(); await fixture.client.query('ROLLBACK'); await pending }
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('自分の返信DELETEは親の更新ロックを待たずに成功する', async () => {
    const card = await bookmark(), created = await reply(card.id)
    await fixture.client.query('BEGIN')
    let pending: Promise<Response> | undefined
    try {
      await fixture.client.query("UPDATE bookmarks SET visibility='private' WHERE id=$1", [card.id])
      pending = Promise.resolve(request(`/replies/${created.id}`, other.token, 'DELETE'))
      const response = await Promise.race([pending, new Promise<undefined>((resolve) => setTimeout(resolve, 2000))])
      expect(response?.status).toBe(204)
    } finally { await fixture.client.query('ROLLBACK'); await pending }
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('並行PUTでもフォロー・いいねは1行、登録確認日時は一度だけ記録する', async () => {
    const viewer = await actor(), target = await actor(), card = await bookmark(), old = await actor(true)
    for (const path of [`/users/${target.id}/follow`, `/bookmarks/${card.id}/like`]) {
      const responses = await Promise.all([request(path, viewer.token, 'PUT'), request(path, viewer.token, 'PUT')])
      expect(responses.map((response) => response.status)).toEqual([204, 204])
    }
    expect((await fixture.client.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [viewer.id, target.id])).rowCount).toBe(1)
    expect((await fixture.client.query('SELECT * FROM bookmark_likes WHERE user_id=$1 AND bookmark_id=$2', [viewer.id, card.id])).rowCount).toBe(1)
    const formal = await signing.sign({ sub: old.id, is_anonymous: false })
    const before = (await fixture.client.query('SELECT * FROM profiles WHERE id=$1', [old.id])).rows[0]
    expect((await Promise.all([request('/me', formal, 'PUT'), request('/me', formal, 'PUT')])).map((response) => response.status)).toEqual([200, 200])
    const after = (await fixture.client.query('SELECT * FROM profiles WHERE id=$1', [old.id])).rows[0]
    expect(after.registration_confirmed_at).not.toBeNull()
    expect({ ...after, registration_confirmed_at: null }).toEqual(before)
  })
})

it('対象プロフィール消失の該当FKだけを404にし、無関係なDBエラーは500にする', async () => {
  const viewer = await actor(), target = await actor(), original = Client.prototype.query
  const spy = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args)
    const query = args[0] as string | { text: string }, text = typeof query === 'string' ? query : query.text
    if (/^select "id" from "profiles"/i.test(text) && Array.isArray(args[1]) && args[1].includes(target.id)) return Promise.resolve(result).then(async (rows) => {
      await fixture.client.query('DELETE FROM profiles WHERE id=$1', [target.id]); return rows
    })
    return result
  } as typeof original)
  try { expect((await request(`/users/${target.id}/follow`, viewer.token, 'PUT')).status).toBe(404) } finally { spy.mockRestore() }
  const unrelated = await actor()
  await fixture.client.query(`CREATE FUNCTION public.test_social_fk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.following_id='${unrelated.id}'::uuid THEN RAISE EXCEPTION 'private detail' USING ERRCODE='23503', CONSTRAINT='unrelated_foreign_key'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_social_fk BEFORE INSERT ON follows FOR EACH ROW EXECUTE FUNCTION public.test_social_fk();`)
  try {
    const response = await request(`/users/${unrelated.id}/follow`, viewer.token, 'PUT')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: '処理を完了できませんでした' } })
    expect((await fixture.client.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [viewer.id, unrelated.id])).rowCount).toBe(0)
  } finally { await fixture.client.query('DROP TRIGGER test_social_fk ON follows; DROP FUNCTION public.test_social_fk()') }
})

it('実Workersで登録確認・フォロー・いいね・返信・followingが接続できる', async () => {
  const viewer = await actor(), author = await actor(), card = await bookmark(author)
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
    const headers = { Authorization: `Bearer ${viewer.token}`, 'Content-Type': 'application/json' }
    expect((await worker.fetch('/api/v1/me', { method: 'PUT', headers })).status).toBe(200)
    expect((await worker.fetch(`/api/v1/users/${author.id}/follow`, { method: 'PUT', headers })).status).toBe(204)
    expect((await worker.fetch(`/api/v1/bookmarks/${card.id}/like`, { method: 'PUT', headers })).status).toBe(204)
    const created = await worker.fetch(`/api/v1/bookmarks/${card.id}/replies`, { method: 'POST', headers, body: '{"content":"Workers返信"}' })
    expect(created.status).toBe(201)
    const result = Reply.parse(await created.json())
    expect(ReplyPage.parse(await (await worker.fetch(`/api/v1/bookmarks/${card.id}/replies`)).json()).items.map((row) => row.id)).toEqual([result.id])
    const feed = FeedPage.parse(await (await worker.fetch('/api/v1/feed?scope=following', { headers })).json())
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({ id: card.id, likeCount: 1, replyCount: 1, likedByMe: true })
    await request(`/bookmarks/${card.id}`, author.token, 'DELETE')
    const deleted = await worker.fetch(`/api/v1/replies/${result.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await signing.sign({ sub: viewer.id })}` } })
    expect(deleted.status).toBe(204); expect(await deleted.text()).toBe('')
    expect((await worker.fetch(`/api/v1/users/${author.id}/follow`, { method: 'PUT', headers: { Authorization: `Bearer ${anonymous.token}` } })).status).toBe(403)
  } finally {
    await worker?.stop()
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
  }
}, 60000)
