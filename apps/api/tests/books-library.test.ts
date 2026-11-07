import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createApp } from '../src/index'
import { withDatabase } from '../src/db/client'
import { createTokenVerifier } from '../src/middleware/auth'
import { Book, BookSearchResult, PublicBookPage } from '../src/modules/books/schemas'
import { UserBook, UserBookPage } from '../src/modules/library/schemas'
import { createTestDatabase } from './helpers/database'
import { createSigningFixture, supabaseUrl } from './helpers/tokens'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let signing: Awaited<ReturnType<typeof createSigningFixture>>
let app: ReturnType<typeof createApp>
let anonymous: { id: string; token: string }, registered: { id: string; token: string }
let searchItems: unknown[] = []
let activeConnections = 0
const volumes = new Map<string, unknown>()
const isbn13 = '9784780802047'
const volume = (id: string, isbn: string | null = null) => ({ id, volumeInfo: { title: `外部書籍 ${id}`, ...(isbn ? { industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }] } : {}) } })
const fetcher = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input))
  if (url.hostname === 'api.openbd.jp') return Response.json([null])
  const id = decodeURIComponent(url.pathname.split('/').at(-1)!)
  if (id === 'volumes') return Response.json({ totalItems: searchItems.length, items: searchItems })
  return volumes.has(id) ? Response.json(volumes.get(id)) : new Response(null, { status: 404 })
})

function request(path: string, method = 'GET', body?: unknown, token: string | null = anonymous.token, key: string | undefined = 'fixture-key') {
  return app.request(`/api/v1${path}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, {
    SUPABASE_URL: supabaseUrl, HYPERDRIVE: { connectionString: fixture.apiConnectionString }, GOOGLE_BOOKS_API_KEY: key,
  })
}
async function actor(isAnonymous = true) {
  const id = randomUUID()
  await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
  const token = await signing.sign({ sub: id, is_anonymous: isAnonymous, user_metadata: { sub: randomUUID(), is_anonymous: false } })
  expect((await request('/me', 'PUT', undefined, token)).status).toBe(200)
  return { id, token }
}
async function manual(title = `本 ${randomUUID()}`, token = anonymous.token) {
  const response = await request('/books/manual', 'POST', { title }, token)
  expect(response.status).toBe(201)
  return Book.parse(await response.json())
}
async function shelf(bookId: string, token = anonymous.token) {
  const response = await request('/me/books', 'POST', { bookId }, token)
  expect(response.status).toBe(201)
  return UserBook.parse(await response.json())
}
beforeAll(async () => {
  fixture = await createTestDatabase()
  signing = await createSigningFixture()
  app = createApp({ bookFetch: fetcher, verifyToken: createTokenVerifier(signing.fetcher), database: async (env, query) => {
    activeConnections++
    try {
      return await withDatabase(env, async (db) => {
        await db.execute(sql`SET ROLE book_bear_api`)
        try { return await query(db) } finally { await db.execute(sql`RESET ROLE`) }
      })
    } finally { activeConnections-- } // withDatabase has finished client.end().
  } })
  anonymous = await actor()
  registered = await actor(false)
}, 30000)
afterEach(() => { fetcher.mockClear(); searchItems = [] })
afterAll(async () => { await fixture?.close() })

describe('書籍API（実DB・JWT・最小権限）', () => {
  it.each([
    ['/books/import', 'POST', { provider: 'google_books', providerId: 'a' }], ['/books/manual', 'POST', { title: '本' }],
    ['/me/books', 'GET', undefined], ['/me/books', 'POST', { bookId: randomUUID() }],
    [`/me/books/${randomUUID()}`, 'PATCH', { status: 'reading' }], [`/me/books/${randomUUID()}`, 'DELETE', undefined],
  ])('全保護操作がJWT未提示・不正で401: %s %s', async (path, method, body) => {
    for (const token of [null, 'invalid', await signing.sign({ exp: 1 })]) {
      const response = await request(path, method, body, token)
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('プロフィール未初期化は404で、外部取得も暗黙作成もしない', async () => {
    const id = randomUUID(), token = await signing.sign({ sub: id })
    await fixture.client.query('INSERT INTO auth.users (id) VALUES ($1)', [id])
    for (const [path, method, body] of [
      ['/books/manual', 'POST', { title: '作成しない' }], ['/books/import', 'POST', { provider: 'google_books', providerId: 'a' }],
      ['/me/books', 'GET', undefined], ['/me/books', 'POST', { bookId: randomUUID() }],
    ] as const) expect((await request(path, method, body, token)).status).toBe(404)
    expect((await fixture.client.query('SELECT id FROM profiles WHERE id=$1', [id])).rowCount).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('匿名・正式ユーザーがISBNなしを重複登録でき、作成者をJWTで追跡する', async () => {
    const title = `重複手製本 ${randomUUID()}`
    const first = await manual(` ${title} `), second = await manual(title, registered.token)
    expect(first).toMatchObject({ title, isbn13: null, source: 'manual', totalPages: null, author: null, coverUrl: null })
    expect(second.id).not.toBe(first.id)
    const rows = (await fixture.client.query('SELECT created_by_user_id FROM books WHERE title=$1', [title])).rows
    expect(rows.map((row) => row.created_by_user_id).sort()).toEqual([anonymous.id, registered.id].sort())
    const response = await request(`/books/${first.id}`, 'GET', undefined, null)
    expect(response.status).toBe(200)
    expect(Book.parse(await response.json())).toEqual(first)
    expect((await request(`/books/${randomUUID()}`, 'GET', undefined, null)).status).toBe(404)
  })
  it.each([
    { title: '　' }, { title: '本', isbn13 }, { title: '本', createdByUserId: randomUUID() },
    { title: '本', totalPages: 0 }, { title: '本', totalPages: 2147483648 }, { title: '本', totalPages: '20' },
  ])('手動入力の不正を400で拒否: %j', async (body) => {
    const before = (await fixture.client.query('SELECT count(*) FROM books')).rows[0]
    expect((await request('/books/manual', 'POST', body)).status).toBe(400)
    expect((await fixture.client.query('SELECT count(*) FROM books')).rows[0]).toEqual(before)
  })
  it('importは外部を再取得し、同一ISBNなら同じIDを返して上書きしない', async () => {
    volumes.set('isbn-first', volume('isbn-first', isbn13))
    const firstResponse = await request('/books/import', 'POST', { provider: 'google_books', providerId: 'isbn-first' })
    expect(firstResponse.status).toBe(201)
    const first = Book.parse(await firstResponse.json())
    volumes.set('isbn-second', volume('isbn-second', isbn13))
    const reused = await request('/books/import', 'POST', { provider: 'google_books', providerId: 'isbn-second' }, registered.token)
    expect(reused.status).toBe(200)
    expect(await reused.json()).toEqual(first)
    expect((await fixture.client.query('SELECT id FROM books WHERE isbn13=$1', [isbn13])).rowCount).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect((await request('/books/import', 'POST', { provider: 'google_books', providerId: 'isbn-first', title: '偽の情報' })).status).toBe(400)
  })
  it('ISBNなしの同じ外部候補を何度importしても新しい行を作る', async () => {
    volumes.set('no-isbn', volume('no-isbn'))
    const ids = []
    for (let i = 0; i < 2; i++) {
      const response = await request('/books/import', 'POST', { provider: 'google_books', providerId: 'no-isbn' })
      expect(response.status).toBe(201)
      ids.push(Book.parse(await response.json()).id)
    }
    expect(new Set(ids).size).toBe(2)
    expect((await fixture.client.query("SELECT id FROM books WHERE source='google_books' AND source_id='no-isbn'")).rowCount).toBe(2)
  })
  it('importの未発見は404、再取得内容の不正・不一致は502で書き込まない', async () => {
    volumes.set('broken', { id: 'broken', volumeInfo: {} })
    volumes.set('mismatch', volume('different-id'))
    const before = (await fixture.client.query('SELECT count(*) FROM books')).rows[0]
    for (const [id, status] of [['missing', 404], ['broken', 502], ['mismatch', 502]] as const) {
      expect((await request('/books/import', 'POST', { provider: 'google_books', providerId: id })).status).toBe(status)
    }
    expect((await fixture.client.query('SELECT count(*) FROM books')).rows[0]).toEqual(before)
  })
  it('検索はDB優先・ISBN照合と重複排除、ISBNなしの登録本は統合しない', async () => {
    const q = `候補検索 ${randomUUID()}`
    const local = await manual(q)
    const duplicate = await manual(q)
    searchItems = [volume('remote-local-isbn', isbn13), volume('another-volume', isbn13), volume('new'), volume('new'), { id: 'no-title', volumeInfo: {} }]
    const response = await request(`/books/search?q=${encodeURIComponent(q)}`, 'GET', undefined, null)
    expect(response.status).toBe(200)
    const result = BookSearchResult.parse(await response.json())
    expect(result.items.slice(0, 2).map((item) => item.localBookId).sort()).toEqual([local.id, duplicate.id].sort())
    expect(result.items).toHaveLength(4)
    expect(result.items[2]).toMatchObject({ localBookId: expect.any(String), isbn13, title: '外部書籍 isbn-first' })
    expect(result.items[3]).toMatchObject({ localBookId: null, providerId: 'new' })
    expect((await request(`/books/search?q=${encodeURIComponent(q)}&limit=1`, 'GET', undefined, null)).status).toBe(200)
    const isbnResponse = await request('/books/search?q=978-4-7808-0204-7', 'GET', undefined, null)
    expect((await isbnResponse.json()).items).toHaveLength(1)
  })
  it.each([1, 20, 30])('DB候補がlimit=%i件に達していれば外部APIを呼ばず返す', async (limit) => {
    const title = `DBだけの検索 ${randomUUID()}`
    const expected = []
    for (let i = 0; i < limit; i++) expected.push(await manual(`${title} ${String(i).padStart(2, '0')}`))
    // limit=20 also exercises the default, with a configured provider available.
    const response = await request(`/books/search?q=${encodeURIComponent(title)}${limit === 20 ? '' : `&limit=${limit}`}`, 'GET', undefined, null)
    expect(response.status).toBe(200)
    const result = BookSearchResult.parse(await response.json())
    expect(result.items.map((book) => book.localBookId)).toEqual(expected.map((book) => book.id))
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['search', 'import'] as const)('外部HTTPの応答本文を待つ間はDB接続を保持しない: %s', async (operation) => {
    const title = `接続解放 ${randomUUID()}`
    const local = await manual(title)
    let release!: () => void, started!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { started = resolve })
    const id = `slow-${randomUUID()}`
    const responseBody = operation === 'search'
      ? { totalItems: 1, items: [volume(id, isbn13)] }
      : volume(id)
    // Return the headers immediately but hold the JSON body until the test
    // observes the connection count. This covers the entire HTTP response wait.
    fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({
      async start(controller) {
        started()
        await waiting
        controller.enqueue(new TextEncoder().encode(JSON.stringify(responseBody)))
        controller.close()
      },
    })))
    const pending = operation === 'search'
      ? request(`/books/search?q=${encodeURIComponent(title)}`, 'GET', undefined, null)
      : request('/books/import', 'POST', { provider: 'google_books', providerId: id })
    let connectionsWhileWaiting: number
    try { await entered; connectionsWhileWaiting = activeConnections } finally { release() }
    const response = await pending
    expect(connectionsWhileWaiting).toBe(0)
    expect(activeConnections).toBe(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    if (operation === 'search') {
      expect(response.status).toBe(200)
      const result = BookSearchResult.parse(await response.json())
      expect(result.items[0].localBookId).toBe(local.id)
      // The post-HTTP database lookup still reuses a registered ISBN.
      expect(result.items[1]).toMatchObject({ isbn13, localBookId: expect.any(String), title: '外部書籍 isbn-first' })
    } else {
      expect(response.status).toBe(201)
      const book = Book.parse(await response.json())
      expect(book.title).toBe(`外部書籍 ${id}`)
      expect((await fixture.client.query('SELECT id FROM books WHERE id=$1', [book.id])).rowCount).toBe(1)
    }
  })
  it.each(['status', 'network', 'json', 'missing-key'])('外部障害でもDB候補があれば200、なければ502: %s', async (kind) => {
    const title = `障害時の本 ${randomUUID()}`
    const book = await manual(title)
    const fail = async () => {
      if (kind === 'network') throw new Error('private upstream detail')
      return kind === 'json' ? new Response('{') : new Response('private upstream detail', { status: 429 })
    }
    if (kind !== 'missing-key') fetcher.mockImplementationOnce(fail)
    const response = await request(`/books/search?q=${encodeURIComponent(title)}`, 'GET', undefined, null, kind === 'missing-key' ? '' : 'key')
    expect(response.status).toBe(200)
    expect(BookSearchResult.parse(await response.json()).items.map((item) => item.localBookId)).toEqual([book.id])
    if (kind !== 'missing-key') fetcher.mockImplementationOnce(fail)
    const empty = await request(`/books/search?q=${randomUUID()}`, 'GET', undefined, null, kind === 'missing-key' ? '' : 'key')
    expect(empty.status).toBe(502)
    expect(await empty.json()).toEqual({ error: { code: 'BOOK_PROVIDER_UNAVAILABLE', message: '書籍情報サービスを利用できません' } })
  })
  it('正常な0候補、文字としてのLIKE記号、不正ISBN・query・IDを扱う', async () => {
    expect(await (await request(`/books/search?q=${randomUUID()}`, 'GET', undefined, null)).json()).toEqual({ items: [] })
    const title = `escape%_\\${randomUUID()}`
    const book = await manual(title)
    expect((await (await request(`/books/search?q=${encodeURIComponent(title)}`, 'GET', undefined, null)).json()).items[0].localBookId).toBe(book.id)
    for (const suffix of ['?q=', '?q=9784780802048', '?q=4101010013', '?q=book&limit=0', '?q=book&limit=31', '?q=book&limit=1.5']) {
      expect((await request(`/books/search${suffix}`, 'GET', undefined, null)).status).toBe(400)
    }
    expect((await request('/books/invalid', 'GET', undefined, null)).status).toBe(400)
  })
})

describe('本棚の所有権・変更・削除', () => {
  it('匿名／正式ユーザーの登録・取得・更新と再登録の不変性', async () => {
    for (const owner of [anonymous, registered]) {
      const book = await manual(), entry = await shelf(book.id, owner.token)
      expect(entry).toMatchObject({ userId: owner.id, currentPage: null, status: 'want_to_read' })
      const path = `/me/books/${entry.id}`
      const updated = await request(path, 'PATCH', { status: 'reading', currentPage: 99999 }, owner.token)
      expect(updated.status).toBe(200)
      const saved = UserBook.parse(await updated.json())
      expect(saved).toMatchObject({ id: entry.id, currentPage: 99999, status: 'reading', createdAt: entry.createdAt })
      const repeated = await request('/me/books', 'POST', { bookId: book.id, status: 'completed' }, owner.token)
      expect(repeated.status).toBe(200)
      expect(await repeated.json()).toEqual(saved)
      expect(await (await request(path, 'PATCH', { currentPage: null }, owner.token)).json()).toMatchObject({ currentPage: null, status: 'reading' })
      expect(await (await request(path, 'PATCH', { currentPage: 0 }, owner.token)).json()).toMatchObject({ currentPage: 0 })
      const deleted = await request(path, 'DELETE', undefined, owner.token)
      expect(deleted.status).toBe(204)
      expect(await deleted.text()).toBe('')
      expect((await request(`/books/${book.id}`, 'GET', undefined, null)).status).toBe(200)
      expect((await request(path, 'DELETE', undefined, owner.token)).status).toBe(404)
    }
  })
  it('他人の本棚の一覧・更新・削除と所有者偽装を拒否し、DBを変更しない', async () => {
    const book = await manual(), entry = await shelf(book.id, registered.token)
    await fixture.client.query("INSERT INTO bookmarks (user_book_id,content) VALUES ($1,'他人の秘密')", [entry.id])
    const before = (await fixture.client.query('SELECT * FROM user_books WHERE id=$1', [entry.id])).rows[0]
    for (const [method, body] of [['PATCH', { status: 'completed' }], ['DELETE', undefined]] as const) {
      const response = await request(`/me/books/${entry.id}`, method, body)
      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    const page = UserBookPage.parse(await (await request('/me/books')).json())
    expect(page.items.every((item) => item.userId === anonymous.id)).toBe(true)
    expect(page.items.map((item) => item.id)).not.toContain(entry.id)
    expect((await request('/me/books', 'POST', { bookId: book.id, userId: registered.id })).status).toBe(400)
    expect((await request(`/me/books/${entry.id}`, 'PATCH', { userId: anonymous.id })).status).toBe(400)
    expect((await fixture.client.query('SELECT * FROM user_books WHERE id=$1', [entry.id])).rows[0]).toEqual(before)
  })
  it.each([
    {}, { status: 'done' }, { currentPage: -1 }, { currentPage: 0.5 }, { currentPage: '1' }, { currentPage: 2147483648 }, { bookId: randomUUID() }, { createdAt: '2000-01-01T00:00:00Z' },
  ])('不正PATCHを400で拒否: %j', async (body) => {
    const entry = await shelf((await manual()).id)
    expect((await request(`/me/books/${entry.id}`, 'PATCH', body)).status).toBe(400)
    expect((await fixture.client.query('SELECT status,current_page FROM user_books WHERE id=$1', [entry.id])).rows[0]).toEqual({ status: 'want_to_read', current_page: null })
  })
  it('未知の本・本棚は404、不正JSONは400、総ページ数より大きな進捗も許可する', async () => {
    expect((await request('/me/books', 'POST', { bookId: randomUUID() })).status).toBe(404)
    expect((await request(`/me/books/${randomUUID()}`, 'PATCH', { status: 'reading' })).status).toBe(404)
    const book = await manual()
    await fixture.client.query('UPDATE books SET total_pages=10 WHERE id=$1', [book.id])
    const entry = await shelf(book.id)
    expect((await request(`/me/books/${entry.id}`, 'PATCH', { currentPage: 2147483647 })).status).toBe(200)
    const response = await app.request('/api/v1/books/manual', { method: 'POST', headers: { Authorization: `Bearer ${anonymous.token}`, 'Content-Type': 'application/json' }, body: '{' }, { SUPABASE_URL: supabaseUrl })
    expect(response.status).toBe(400)
  })
  it.each([['public', false], ['private', false], ['public', true], ['private', true]] as const)('栞が参照する本棚の削除は409（%s、論理削除=%s）', async (visibility, deleted) => {
    const entry = await shelf((await manual()).id)
    await fixture.client.query('INSERT INTO bookmarks (user_book_id,content,visibility,deleted_at) VALUES ($1,$2,$3,$4)', [entry.id, '保持する栞', visibility, deleted ? new Date() : null])
    const response = await request(`/me/books/${entry.id}`, 'DELETE')
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'HAS_BOOKMARKS' } })
    expect((await fixture.client.query('SELECT id FROM user_books WHERE id=$1', [entry.id])).rowCount).toBe(1)
  })
})

describe('本棚・公開本一覧のページ境界と非公開情報', () => {
  async function entries(owner: { id: string; token: string }, count: number) {
    const result = []
    for (let i = 0; i < count; i++) result.push(await shelf((await manual()).id, owner.token))
    return result
  }
  it('本棚全体を読書状態で絞り込み、最新の栞または登録日時でカーソル順に並べる', async () => {
    const owner = await actor()
    const [oldRead, unread, recentRead, deletedOnly] = await entries(owner, 4)
    for (const [index, entry] of [oldRead, unread, recentRead, deletedOnly].entries()) {
      await fixture.client.query('UPDATE user_books SET created_at=$1,status=$2 WHERE id=$3', [
        `2026-01-0${index + 1}T00:00:00Z`, index % 2 === 0 ? 'reading' : 'want_to_read', entry.id,
      ])
    }
    await fixture.client.query(`INSERT INTO bookmarks (user_book_id,content,page_number,created_at,deleted_at) VALUES
      ($1,'以前',70,'2026-02-01T00:00:00.000001Z',NULL),
      ($2,'最近',NULL,'2026-02-01T00:00:00.000002Z',NULL),
      ($1,'削除済み',80,'2026-03-01T00:00:00Z',now()),
      ($3,'削除済み',90,'2026-03-01T00:00:00Z',now())`, [oldRead.id, recentRead.id, deletedOnly.id])

    async function orderedIds(sort: string, status?: string) {
      const ids: string[] = []
      let cursor: string | null = null
      do {
        const query = new URLSearchParams({ sort, limit: '1' })
        if (status) query.set('status', status)
        if (cursor) query.set('cursor', cursor)
        const response = await request(`/me/books?${query}`, 'GET', undefined, owner.token)
        expect(response.status).toBe(200)
        const page = UserBookPage.parse(await response.json())
        ids.push(...page.items.map((item) => item.id))
        cursor = page.nextCursor
      } while (cursor)
      return ids
    }

    expect(await orderedIds('read_recent')).toEqual([recentRead.id, oldRead.id, deletedOnly.id, unread.id])
    expect(await orderedIds('read_oldest')).toEqual([unread.id, deletedOnly.id, oldRead.id, recentRead.id])
    expect(await orderedIds('added_recent')).toEqual([deletedOnly.id, recentRead.id, unread.id, oldRead.id])
    expect(await orderedIds('added_oldest')).toEqual([oldRead.id, unread.id, recentRead.id, deletedOnly.id])
    expect(await orderedIds('read_recent', 'reading')).toEqual([recentRead.id, oldRead.id])
    for (const query of ['status=unknown', 'sort=unknown']) {
      expect((await request(`/me/books?${query}`, 'GET', undefined, owner.token)).status).toBe(400)
    }
  })
  it('既定15件、同一時刻とmicrosecondsの境界でも漏れ・重複なし、境界行の削除後も継続', async () => {
    const owner = await actor(), rows = await entries(owner, 18)
    // Opposite UUID order across sub-millisecond boundaries catches Date truncation.
    const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id))
    for (let i = 0; i < ordered.length; i++) await fixture.client.query('UPDATE user_books SET created_at=$1 WHERE id=$2', [`2026-01-01T00:00:00.${String(900000 - i).padStart(6, '0')}Z`, ordered[i].id])
    const first = UserBookPage.parse(await (await request('/me/books', 'GET', undefined, owner.token)).json())
    expect(first.items.map((item) => item.id)).toEqual(ordered.slice(0, 15).map((item) => item.id))
    expect(first.nextCursor).toBeTypeOf('string')
    await request(`/me/books/${first.items.at(-1)!.id}`, 'DELETE', undefined, owner.token)
    await shelf((await manual()).id, owner.token) // newer rows do not shift the next page
    const second = UserBookPage.parse(await (await request(`/me/books?cursor=${first.nextCursor}`, 'GET', undefined, owner.token)).json())
    expect(second.items.map((item) => item.id)).toEqual(ordered.slice(15).map((item) => item.id))
    expect(second.nextCursor).toBeNull()
    await fixture.client.query('UPDATE user_books SET created_at=$1 WHERE user_id=$2', ['2026-01-01T00:00:00.123456Z', owner.id])
    const seen = [], expected = (await fixture.client.query('SELECT id FROM user_books WHERE user_id=$1 ORDER BY created_at DESC,id DESC', [owner.id])).rows.map((row) => row.id)
    let cursor: string | null = null
    do {
      const page = UserBookPage.parse(await (await request(`/me/books?limit=7${cursor ? `&cursor=${cursor}` : ''}`, 'GET', undefined, owner.token)).json())
      seen.push(...page.items.map((item) => item.id)); cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(expected)
  })
  it('公開本一覧は公開中の栞がある本だけを返し、本人にも進捗・非公開本文を公開しない', async () => {
    const owner = await actor(false), rows = await entries(owner, 5)
    const [publicOne, privateOne, deletedOne, noBookmarks, publicTwo] = rows
    for (const [entry, visibility, deleted] of [[publicOne, 'public', false], [publicOne, 'public', false], [publicOne, 'private', false], [privateOne, 'private', false], [deletedOne, 'public', true], [publicTwo, 'public', false]] as const) {
      await fixture.client.query('INSERT INTO bookmarks (user_book_id,content,visibility,deleted_at) VALUES ($1,$2,$3,$4)', [entry.id, '非公開を含む秘密の本文', visibility, deleted ? new Date() : null])
    }
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const response = await request(`/users/${owner.id}/books?limit=1${cursor ? `&cursor=${cursor}` : ''}`, 'GET', undefined, null)
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      const page = PublicBookPage.parse(await response.json())
      for (const item of page.items) expect(Object.keys(item).sort()).toEqual(['id', 'isbn13', 'title', 'author', 'coverUrl'].sort())
      ids.push(...page.items.map((book) => book.id)); cursor = page.nextCursor
    } while (cursor)
    expect(ids.sort()).toEqual([publicOne.book.id, publicTwo.book.id].sort())
    const self = await request(`/users/${owner.id}/books`, 'GET', undefined, owner.token)
    expect((await self.json()).items.map((book: { id: string }) => book.id).sort()).toEqual(ids)
    for (const id of [privateOne.book.id, deletedOne.book.id, noBookmarks.book.id]) expect(ids).not.toContain(id)
    const empty = await actor()
    expect(await (await request(`/users/${empty.id}/books`, 'GET', undefined, null)).json()).toEqual({ items: [], nextCursor: null })
    expect((await request(`/users/${randomUUID()}/books`, 'GET', undefined, null)).status).toBe(404)
  })
  it('別人のカーソル・境界変更でも本人以外のデータを返さず、公開条件を毎回評価', async () => {
    const owner = await actor(false), other = await actor(), rows = await entries(owner, 3)
    for (const row of rows) await fixture.client.query("INSERT INTO bookmarks (user_book_id,content,visibility) VALUES ($1,'公開','public')", [row.id])
    const first = UserBookPage.parse(await (await request('/me/books?limit=1', 'GET', undefined, owner.token)).json())
    const otherPage = UserBookPage.parse(await (await request(`/me/books?cursor=${first.nextCursor}`, 'GET', undefined, other.token)).json())
    expect(otherPage.items).toEqual([])
    const publicFirst = PublicBookPage.parse(await (await request(`/users/${owner.id}/books?limit=1`, 'GET', undefined, null)).json())
    await fixture.client.query("UPDATE bookmarks SET visibility='private' WHERE user_book_id IN (SELECT id FROM user_books WHERE user_id=$1)", [owner.id])
    expect(await (await request(`/users/${owner.id}/books?cursor=${publicFirst.nextCursor}`, 'GET', undefined, null)).json()).toEqual({ items: [], nextCursor: null })
    const changed = Buffer.from(JSON.stringify({ createdAt: '2099-01-01T00:00:00.000001Z', id: randomUUID() })).toString('base64url')
    const forged = UserBookPage.parse(await (await request(`/me/books?cursor=${changed}`, 'GET', undefined, other.token)).json())
    expect(forged.items).toEqual([])
    expect(await (await request(`/users/${owner.id}/books?cursor=${changed}`, 'GET', undefined, null)).json()).toEqual({ items: [], nextCursor: null })
  })
  it.each([
    'invalid!', 'a', Buffer.from('{}').toString('base64url'),
    ...['2026-02-30T00:00:00.000000Z', '2026-01-01T24:00:00.000000Z', '2026-01-01', 'infinity'].map((createdAt) => Buffer.from(JSON.stringify({ createdAt, id: randomUUID() })).toString('base64url')),
    Buffer.from(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000000Z', id: 'not-uuid' })).toString('base64url'),
  ])('不正カーソルを両一覧で400 INVALID_CURSORにする: %s', async (cursor) => {
    for (const path of ['/me/books', `/users/${registered.id}/books`]) {
      const response = await request(`${path}?cursor=${encodeURIComponent(cursor)}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } })
    }
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('並行import・本棚登録がUNIQUE制約で1件になる（PostgreSQL）', async () => {
    const owner = await actor()
    // CI files share one database and may run in any order. Do not reuse an
    // ISBN belonging to another fixture (including database.test.ts).
    const prefix = `979${String(randomInt(1_000_000_000)).padStart(9, '0')}`
    const checksum = (10 - [...prefix].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10
    const concurrentIsbn = `${prefix}${checksum}`
    volumes.set('concurrent', volume('concurrent', concurrentIsbn))
    const imports = await Promise.all(Array.from({ length: 4 }, () => request('/books/import', 'POST', { provider: 'google_books', providerId: 'concurrent' }, owner.token)))
    expect(imports.map((response) => response.status).sort()).toEqual([200, 200, 200, 201])
    const ids = await Promise.all(imports.map(async (response) => Book.parse(await response.json()).id))
    expect(new Set(ids).size).toBe(1)
    expect((await fixture.client.query('SELECT id FROM books WHERE isbn13=$1', [concurrentIsbn])).rowCount).toBe(1)
    const added = await Promise.all(Array.from({ length: 4 }, () => request('/me/books', 'POST', { bookId: ids[0] }, owner.token)))
    expect(added.map((response) => response.status).sort()).toEqual([200, 200, 200, 201])
    expect((await fixture.client.query('SELECT id FROM user_books WHERE user_id=$1 AND book_id=$2', [owner.id, ids[0]])).rowCount).toBe(1)
  })
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('本棚削除と栞挿入が競合しても参照が壊れない（PostgreSQL）', async () => {
    const owner = await actor(), entry = await shelf((await manual()).id, owner.token)
    const [deletion, insertion] = await Promise.allSettled([
      request(`/me/books/${entry.id}`, 'DELETE', undefined, owner.token),
      fixture.client.query("INSERT INTO bookmarks (user_book_id,content) VALUES ($1,'並行作成')", [entry.id]),
    ])
    expect(deletion.status).toBe('fulfilled')
    if (deletion.status !== 'fulfilled') return
    if (deletion.value.status === 204) {
      expect(insertion.status).toBe('rejected')
      if (insertion.status === 'rejected') expect(insertion.reason.code).toBe('23503')
      expect((await fixture.client.query('SELECT id FROM bookmarks WHERE user_book_id=$1', [entry.id])).rowCount).toBe(0)
    } else {
      expect(deletion.value.status).toBe(409)
      expect(insertion.status).toBe('fulfilled')
      expect((await fixture.client.query('SELECT id FROM user_books WHERE id=$1', [entry.id])).rowCount).toBe(1)
    }
  })
})
