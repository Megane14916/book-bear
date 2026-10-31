import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import { createTestDatabase } from './helpers/database'
import { bookmarks, profiles, userBooks } from '../src/db/schema'
import { withDatabase } from '../src/db/client'
import app from '../src/index'

let fixture: Awaited<ReturnType<typeof createTestDatabase>>
const userId = randomUUID()
const secondUserId = randomUUID()
const bookId = randomUUID()
const shelfId = randomUUID()
const bookmarkId = randomUUID()

beforeAll(async () => {
  fixture = await createTestDatabase()
  const client = fixture.client
  await client.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [userId, secondUserId])
  await client.query('INSERT INTO profiles (id) VALUES ($1), ($2)', [userId, secondUserId])
  await client.query("INSERT INTO books (id, title, isbn13, source) VALUES ($1, 'テスト書籍', '9784101010014', 'google_books')", [bookId])
  await client.query('INSERT INTO user_books (id, user_id, book_id) VALUES ($1, $2, $3)', [shelfId, userId, bookId])
  await client.query("INSERT INTO bookmarks (id, user_book_id, content) VALUES ($1, $2, '感想')", [bookmarkId, shelfId])
}, 30000)
afterAll(async () => { await fixture?.close() })

describe('マイグレーション・Drizzle', () => {
  it('二度適用しても履歴・データを保持する', async () => {
    await fixture.apply()
    expect((await fixture.client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count).toBe(1)
    const db = drizzle(fixture.client)
    expect((await db.select().from(profiles).where(eq(profiles.id, userId)))[0].displayName).toBe('ゲスト')
    expect((await db.select().from(userBooks).where(eq(userBooks.id, shelfId)))[0]).toMatchObject({ currentPage: null, status: 'want_to_read' })
    const bookmark = (await db.select().from(bookmarks).where(eq(bookmarks.id, bookmarkId)))[0]
    expect(bookmark).toMatchObject({ pageNumber: null, visibility: 'private', isSpoiler: false, deletedAt: null })
    expect(bookmark.createdAt).toBeInstanceOf(Date)
  })
  it('設計した部分インデックスと本棚一意インデックスを持つ', async () => {
    const indexes = (await fixture.client.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'")).rows
    for (const name of ['idx_bookmarks_public_feed', 'idx_bookmarks_flow', 'idx_likes_bookmark', 'idx_replies_bookmark_created', 'idx_follows_following', 'ux_user_books_user_book']) {
      expect(indexes.find((index) => index.indexname === name)).toBeDefined()
    }
    expect(indexes.find((index) => index.indexname === 'idx_bookmarks_public_feed').indexdef).toMatch(/created_at DESC.*id DESC.*WHERE.*public.*deleted_at IS NULL/)
    expect(indexes.find((index) => index.indexname === 'idx_bookmarks_flow').indexdef).toMatch(/user_book_id, created_at, id.*WHERE.*deleted_at IS NULL/)
    expect(indexes.filter((index) => index.indexdef.includes('UNIQUE') && index.indexdef.includes('(user_id, book_id)'))).toHaveLength(1)
  })
})

describe('一意制約・外部キー', () => {
  it('ISBN・本棚・handle・フォロー・いいねの重複を拒否する', async () => {
    const client = fixture.client
    await expect(client.query("INSERT INTO books (title, isbn13, source) VALUES ('重複', '9784101010014', 'openbd')")).rejects.toMatchObject({ code: '23505' })
    await expect(client.query('INSERT INTO user_books (user_id, book_id) VALUES ($1, $2)', [userId, bookId])).rejects.toMatchObject({ code: '23505' })
    await client.query("UPDATE profiles SET handle='unique_reader' WHERE id=$1", [userId])
    await expect(client.query("UPDATE profiles SET handle='unique_reader' WHERE id=$1", [secondUserId])).rejects.toMatchObject({ code: '23505' })
    await client.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [userId, secondUserId])
    await expect(client.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [userId, secondUserId])).rejects.toMatchObject({ code: '23505' })
    await client.query('INSERT INTO bookmark_likes (user_id, bookmark_id) VALUES ($1, $2)', [userId, bookmarkId])
    await expect(client.query('INSERT INTO bookmark_likes (user_id, bookmark_id) VALUES ($1, $2)', [userId, bookmarkId])).rejects.toMatchObject({ code: '23505' })
  })
  it('ISBNなしの同名本・NULLのhandleを複数許可する', async () => {
    await fixture.client.query("INSERT INTO books (title, source) VALUES ('手製本', 'manual'), ('手製本', 'manual')")
    await fixture.client.query('UPDATE profiles SET handle=NULL WHERE id IN ($1,$2)', [userId, secondUserId])
  })
  it.each([
    ['profiles', 'INSERT INTO profiles (id) VALUES ($1)', () => [randomUUID()]],
    ['user_books.user_id', 'INSERT INTO user_books (user_id, book_id) VALUES ($1, $2)', () => [randomUUID(), bookId]],
    ['user_books.book_id', 'INSERT INTO user_books (user_id, book_id) VALUES ($1, $2)', () => [userId, randomUUID()]],
    ['bookmarks', "INSERT INTO bookmarks (user_book_id, content) VALUES ($1, '感想')", () => [randomUUID()]],
    ['follows', 'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', () => [userId, randomUUID()]],
    ['likes', 'INSERT INTO bookmark_likes (user_id, bookmark_id) VALUES ($1, $2)', () => [userId, randomUUID()]],
    ['replies', "INSERT INTO bookmark_replies (user_id, bookmark_id, content) VALUES ($1, $2, '返信')", () => [userId, randomUUID()]],
    ['preferences', 'INSERT INTO user_preferences (user_id) VALUES ($1)', () => [randomUUID()]],
  ] as const)('%sの存在しない参照先を拒否する', async (_name, sql, params) => {
    await expect(fixture.client.query(sql, [...params()])).rejects.toMatchObject({ code: '23503' })
  })
  it('栞がある本棚の物理削除を拒否し、共有書籍を維持する', async () => {
    await expect(fixture.client.query('DELETE FROM user_books WHERE id=$1', [shelfId])).rejects.toMatchObject({ code: '23503' })
    expect((await fixture.client.query('SELECT id FROM books WHERE id=$1', [bookId])).rowCount).toBe(1)
  })
})

describe('CHECK制約', () => {
  it.each([
    ['書籍総ページ0', 'UPDATE books SET total_pages=0 WHERE id=$1', () => [bookId]],
    ['書籍総ページ負数', 'UPDATE books SET total_pages=-1 WHERE id=$1', () => [bookId]],
    ['空タイトル', "UPDATE books SET title=' ' WHERE id=$1", () => [bookId]],
    ['書籍source', "UPDATE books SET source='invalid' WHERE id=$1", () => [bookId]],
    ['ISBN形式', "UPDATE books SET isbn13='123' WHERE id=$1", () => [bookId]],
    ['読書状態', "UPDATE user_books SET status='invalid' WHERE id=$1", () => [shelfId]],
    ['進捗負数', 'UPDATE user_books SET current_page=-1 WHERE id=$1', () => [shelfId]],
    ['ページ0', 'UPDATE bookmarks SET page_number=0 WHERE id=$1', () => [bookmarkId]],
    ['ページ負数', 'UPDATE bookmarks SET page_number=-1 WHERE id=$1', () => [bookmarkId]],
    ['公開範囲', "UPDATE bookmarks SET visibility='invalid' WHERE id=$1", () => [bookmarkId]],
    ['空本文', "UPDATE bookmarks SET content='' WHERE id=$1", () => [bookmarkId]],
    ['空白本文', "UPDATE bookmarks SET content=E' \t\n' WHERE id=$1", () => [bookmarkId]],
    ['長すぎる栞本文', 'UPDATE bookmarks SET content=$1 WHERE id=$2', () => ['あ'.repeat(2001), bookmarkId]],
    ['空返信', "INSERT INTO bookmark_replies (user_id, bookmark_id, content) VALUES ($1, $2, '')", () => [userId, bookmarkId]],
    ['長すぎる返信', 'INSERT INTO bookmark_replies (user_id, bookmark_id, content) VALUES ($1,$2,$3)', () => [userId, bookmarkId, 'あ'.repeat(1001)]],
    ['自己フォロー', 'INSERT INTO follows (follower_id, following_id) VALUES ($1,$1)', () => [userId]],
    ['表示設定', "INSERT INTO user_preferences (user_id, feed_content_mode) VALUES ($1,'invalid')", () => [userId]],
    ['長すぎる自己紹介', 'UPDATE profiles SET bio=$1 WHERE id=$2', () => ['あ'.repeat(501), userId]],
  ] as const)('%sを拒否する', async (_name, sql, params) => {
    await expect(fixture.client.query(sql, [...params()])).rejects.toMatchObject({ code: '23514' })
  })
  it('境界値・null・既定値と投稿日時の保持を確認する', async () => {
    const before = (await fixture.client.query('SELECT created_at FROM bookmarks WHERE id=$1', [bookmarkId])).rows[0].created_at
    await fixture.client.query('UPDATE user_books SET current_page=0 WHERE id=$1', [shelfId])
    await fixture.client.query('UPDATE user_books SET current_page=99999 WHERE id=$1', [shelfId])
    await fixture.client.query('UPDATE bookmarks SET page_number=1, content=$1, updated_at=now() WHERE id=$2', ['あ'.repeat(2000), bookmarkId])
    await fixture.client.query('UPDATE bookmarks SET page_number=NULL WHERE id=$1', [bookmarkId])
    await fixture.client.query('INSERT INTO bookmark_replies (user_id, bookmark_id, content) VALUES ($1,$2,$3)', [userId, bookmarkId, 'あ'.repeat(1000)])
    await fixture.client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [userId])
    expect((await fixture.client.query('SELECT feed_content_mode FROM user_preferences WHERE user_id=$1', [userId])).rows[0].feed_content_mode).toBe('tap')
    expect((await fixture.client.query('SELECT created_at FROM bookmarks WHERE id=$1', [bookmarkId])).rows[0].created_at).toEqual(before)
  })
})

describe('最小権限・RLS・接続', () => {
  it('アプリロールはDML可能だがAuth・DDL・マイグレーション履歴へアクセスできない', async () => {
    const client = fixture.client
    await client.query('SET ROLE book_bear_api')
    try {
      expect((await client.query('SELECT id FROM profiles WHERE id=$1', [userId])).rowCount).toBe(1)
      await client.query("UPDATE profiles SET bio='API role' WHERE id=$1", [userId])
      await expect(client.query('SELECT * FROM auth.users')).rejects.toMatchObject({ code: '42501' })
      await expect(client.query('CREATE TABLE public.forbidden (id int)')).rejects.toMatchObject({ code: '42501' })
      await expect(client.query('SELECT * FROM drizzle.__drizzle_migrations')).rejects.toMatchObject({ code: '42501' })
    } finally { await client.query('RESET ROLE') }
  })
  it.each(['anon', 'authenticated'])('%sにはテーブル権限を与えず、誤ってSELECTを付与してもRLSで秘匿する', async (role) => {
    const client = fixture.client
    await client.query(`SET ROLE ${role}`)
    try { await expect(client.query('SELECT * FROM bookmarks')).rejects.toMatchObject({ code: '42501' }) }
    finally { await client.query('RESET ROLE') }
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`)
    await client.query(`GRANT SELECT ON bookmarks TO ${role}`)
    await client.query(`SET ROLE ${role}`)
    try { expect((await client.query('SELECT * FROM bookmarks')).rowCount).toBe(0) }
    finally { await client.query('RESET ROLE'); await client.query(`REVOKE SELECT ON bookmarks FROM ${role}`) }
  })
  it('全テーブルにRLSが有効で、アプリロールには昇格権限がない', async () => {
    const tables = (await fixture.client.query("SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")).rows
    expect(tables).toHaveLength(8)
    expect(tables.every((table) => table.relrowsecurity)).toBe(true)
    const role = (await fixture.client.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname='book_bear_api'")).rows[0]
    expect(Object.values(role).every((value) => value === false)).toBe(true)
  })
  it('Hyperdrive互換bindingからpg/Drizzleでクエリし、失敗後も接続を閉じる', async () => {
    const env = { HYPERDRIVE: { connectionString: fixture.apiConnectionString } }
    const rows = await withDatabase(env, (db) => db.select().from(profiles).where(eq(profiles.id, userId)))
    expect(rows[0].id).toBe(userId)
    if (process.env.TEST_DATABASE_URL) {
      const result = await withDatabase(env, (db) => db.execute(sql`select current_user`))
      expect(result.rows[0].current_user).toBe('book_bear_api')
    }
    await expect(withDatabase(env, async () => { throw new Error('expected failure') })).rejects.toThrow('expected failure')
    expect((await app.request('/api/v1/health/db', undefined, env)).status).toBe(200)
  })
  it('実際のWorkersランタイムとHyperdriveローカルbindingからDBクエリが成功する', async () => {
    const names = ['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE', 'WRANGLER_LOG_PATH', 'WRANGLER_SEND_METRICS'] as const
    const previous = names.map((name) => process.env[name])
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = fixture.apiConnectionString
    process.env.WRANGLER_LOG_PATH = resolve('.wrangler/logs')
    process.env.WRANGLER_SEND_METRICS = 'false'
    const { unstable_dev } = await import('wrangler')
    let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined
    try {
      worker = await unstable_dev('src/index.ts', {
        config: 'wrangler.jsonc', local: true, ip: '127.0.0.1', port: 0,
        inspectorPort: 0, persist: false, logLevel: 'error',
        experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
      })
      const response = await worker.fetch('/api/v1/health/db')
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ status: 'ok' })
    } finally {
      await worker?.stop()
      names.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name]
        else process.env[name] = previous[index]
      })
    }
  }, 60000)
})
