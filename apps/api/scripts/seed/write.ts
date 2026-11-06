import type { Client } from 'pg'
import { check, type Dataset } from './dataset'

const epoch = '2025-01-01T00:00:00.000Z'
type Row = Record<string, string | number | boolean | null>
type Table = 'auth.users' | 'public.profiles' | 'public.user_preferences' | 'public.books' | 'public.user_books'
  | 'public.bookmarks' | 'public.follows' | 'public.bookmark_likes' | 'public.bookmark_replies'

async function insertMissing(client: Client, table: Table, keys: string[], rows: Row[]) {
  if (rows.length === 0) return { added: 0, skipped: 0 }
  // Column names and conflict targets come from the mappings below; all data is bound.
  const columns = Object.keys(rows[0])
  const source = `jsonb_populate_recordset(NULL::${table}, $1::jsonb)`
  const values = [JSON.stringify(rows)]
  const result = await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM ${source}
     ON CONFLICT (${keys.join(', ')}) DO NOTHING`, values)
  const match = keys.map((key) => `actual.${key} = expected.${key}`).join(' AND ')
  const actual = columns.map((column) => `actual.${column}`).join(', ')
  const expected = columns.map((column) => `expected.${column}`).join(', ')
  const mismatch = await client.query(
    `SELECT ${keys.map((key) => `expected.${key}`).join(', ')}
       FROM ${source} expected LEFT JOIN ${table} actual ON ${match}
      WHERE ROW(${actual}) IS DISTINCT FROM ROW(${expected}) LIMIT 1`, values)
  check(mismatch.rowCount === 0, `Seed row differs in ${table}: ${Object.values(mismatch.rows[0] ?? {}).join('/')}`)
  const added = result.rowCount ?? 0
  return { added, skipped: rows.length - added }
}

export async function writeSeed(client: Client, data: Dataset, target: { local: boolean; uids: Map<string, string> }) {
  const uid = (key: string) => {
    const value = target.uids.get(key)
    check(value, `Missing UID for ${key}`)
    return value
  }
  const books = new Map(data.books.map((book) => [book.key, book.id]))
  const shelves = new Map(data.shelves.map((shelf) => [shelf.key, shelf.id]))
  const bookmarkDates = new Map(data.bookmarks.map((bookmark) => [bookmark.id, bookmark.createdAt]))
  const results: Record<string, { added: number; skipped: number }> = {}
  const insert = async (table: Table, keys: string[], rows: Row[]) => {
    results[table] = await insertMissing(client, table, keys, rows)
  }
  await client.query('BEGIN')
  try {
    if (target.local) {
      const { rows } = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name='users'")
      check(rows.length === 1 && rows[0].column_name === 'id', 'Local Auth substitute is required')
      await insert('auth.users', ['id'], data.users.map((user) => ({ id: uid(user.key) })))
      await insert('public.profiles', ['id'], data.users.map((user) => ({
        id: uid(user.key), display_name: user.displayName, handle: user.handle, bio: user.bio,
        registration_confirmed_at: user.anonymous ? null : epoch, created_at: epoch, updated_at: epoch,
      })))
      await insert('public.user_preferences', ['user_id'], data.users.map((user) => ({
        user_id: uid(user.key), feed_content_mode: 'tap', updated_at: epoch,
      })))
    } else {
      const role = await client.query<{ current_user: string }>('SELECT current_user')
      check(role.rows[0]?.current_user === 'book_bear_api', 'Development connection must use book_bear_api')
      for (const user of data.users) {
        const { rows: [profile] } = await client.query(
          `SELECT p.display_name, p.handle, p.bio, p.registration_confirmed_at IS NOT NULL AS confirmed
             FROM public.profiles p JOIN public.user_preferences pref ON pref.user_id = p.id
            WHERE p.id = $1 FOR SHARE OF p, pref`, [uid(user.key)])
        check(profile?.display_name === user.displayName && profile.handle === user.handle && profile.bio === user.bio
          && profile.confirmed === !user.anonymous, `Prepare the development profile before seeding: ${user.key}`)
      }
    }
    await insert('public.books', ['id'], data.books.map((book) => ({
      id: book.id, title: book.title, author: book.author, total_pages: book.totalPages, cover_url: book.coverUrl,
      source: 'manual', isbn13: null, publisher: null, source_id: null, created_by_user_id: null, created_at: epoch,
    })))
    await insert('public.user_books', ['id'], data.shelves.map((shelf) => ({
      id: shelf.id, user_id: uid(shelf.user), book_id: books.get(shelf.book)!, status: shelf.status,
      current_page: shelf.currentPage, created_at: epoch, updated_at: epoch,
    })))
    await insert('public.bookmarks', ['id'], data.bookmarks.map((bookmark) => ({
      id: bookmark.id, user_book_id: shelves.get(bookmark.shelf)!, content: bookmark.content,
      visibility: bookmark.visibility, page_number: bookmark.pageNumber, is_spoiler: bookmark.isSpoiler,
      created_at: bookmark.createdAt, updated_at: bookmark.createdAt, deleted_at: null,
    })))
    await insert('public.follows', ['follower_id', 'following_id'], data.follows.map((follow) => ({
      follower_id: uid(follow.follower), following_id: uid(follow.following), created_at: epoch,
    })))
    await insert('public.bookmark_likes', ['user_id', 'bookmark_id'], data.likes.map((like) => ({
      user_id: uid(like.user), bookmark_id: like.bookmark, created_at: bookmarkDates.get(like.bookmark)!,
    })))
    await insert('public.bookmark_replies', ['id'], data.replies.map((reply) => ({
      id: reply.id, user_id: uid(reply.user), bookmark_id: reply.bookmark, content: reply.content,
      is_spoiler: reply.isSpoiler, created_at: bookmarkDates.get(reply.bookmark)!,
      updated_at: bookmarkDates.get(reply.bookmark)!, deleted_at: null,
    })))
    await client.query('COMMIT')
    return results
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
