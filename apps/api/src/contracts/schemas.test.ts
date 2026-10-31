import { describe, expect, it } from 'vitest'
import { z } from '@hono/zod-openapi'
import { BookmarkIdParams, ErrorSchema, PaginationQuery, SearchQuery } from '../shared/schemas'
import { PatchProfile, Profile, PublicProfile } from '../modules/users/schemas'
import { PatchPreferences } from '../modules/preferences/schemas'
import { BookSearchItem, ImportBookRequest, Isbn13, ManualBookRequest } from '../modules/books/schemas'
import { PatchUserBookRequest } from '../modules/library/schemas'
import { BookmarkFlowPage, BookmarkContent, CreateBookmarkRequest, PatchBookmarkRequest } from '../modules/bookmarks/schemas'
import { FeedQuery } from '../modules/feed/schemas'
import { CreateReplyRequest, PatchReplyRequest, ReplyContent } from '../modules/replies/schemas'

const id = 'a0000000-0000-4000-8000-000000000001'

describe('本文とPATCH', () => {
  it.each([[BookmarkContent, 2000], [ReplyContent, 1000]] as const)('空白除去後の文字数制限を検証する', (schema, max) => {
    expect(schema.parse('  感想  ')).toBe('感想')
    expect(schema.safeParse(' \n\t　').success).toBe(false)
    expect(schema.safeParse('あ'.repeat(max)).success).toBe(true)
    expect(schema.safeParse('あ'.repeat(max + 1)).success).toBe(false)
  })

  it.each([PatchProfile, PatchUserBookRequest, PatchBookmarkRequest, PatchReplyRequest])('空・未知・所有者フィールドのPATCHを拒否する', (schema) => {
    for (const input of [{}, { unknown: true }, { userId: id }, { createdAt: '2026-10-31T00:00:00Z' }]) {
      expect(schema.safeParse(input).success).toBe(false)
    }
  })

  it('PATCHの省略・null・false・0を区別し、既定値で上書きしない', () => {
    expect(PatchBookmarkRequest.parse({ content: '感想' })).toEqual({ content: '感想' })
    expect(PatchBookmarkRequest.parse({ pageNumber: null, isSpoiler: false })).toEqual({ pageNumber: null, isSpoiler: false })
    expect(PatchReplyRequest.parse({ isSpoiler: false })).toEqual({ isSpoiler: false })
    expect(PatchUserBookRequest.parse({ currentPage: 0 })).toEqual({ currentPage: 0 })
    expect(PatchProfile.parse({ bio: null, handle: null })).toEqual({ bio: null, handle: null })
    expect(PatchBookmarkRequest.safeParse({ content: undefined }).success).toBe(false)
    expect(PatchBookmarkRequest.safeParse({ content: '感想', userBookId: id }).success).toBe(false)
  })

  it('プロフィールの表示名50文字・自己紹介500文字を検証する', () => {
    expect(PatchProfile.safeParse({ displayName: '名'.repeat(50), bio: '文'.repeat(500) }).success).toBe(true)
    for (const input of [{ displayName: '' }, { displayName: '　' }, { displayName: '名'.repeat(51) }, { bio: '文'.repeat(501) }]) {
      expect(PatchProfile.safeParse(input).success).toBe(false)
    }
  })
})

describe('作成時の既定値と厳格なJSON入力', () => {
  const input = { userBookId: id, content: '感想' }
  it('匿名でも安全なprivate・ネタバレfalseを既定にする', () => {
    expect(CreateBookmarkRequest.parse(input)).toEqual({ ...input, visibility: 'private', isSpoiler: false })
    expect(CreateReplyRequest.parse({ content: '返信' })).toEqual({ content: '返信', isSpoiler: false })
    expect(CreateBookmarkRequest.safeParse({ ...input, visibility: 'public' }).success).toBe(true)
    // Registered/owner authorization requires verified JWT and belongs to the future handler.
  })
  it('栞のページは正整数またはnull、進捗は0以上で総ページ数を上限にしない', () => {
    for (const pageNumber of [1, 99999, null]) expect(CreateBookmarkRequest.safeParse({ ...input, pageNumber }).success).toBe(true)
    for (const pageNumber of [0, -1, 1.5, '1']) expect(CreateBookmarkRequest.safeParse({ ...input, pageNumber }).success).toBe(false)
    expect(PatchUserBookRequest.safeParse({ currentPage: 99999 }).success).toBe(true)
    for (const currentPage of [-1, 0.5, '1']) expect(PatchUserBookRequest.safeParse({ currentPage }).success).toBe(false)
  })
  it('boolean文字列・不正な列挙値・ID・読み取り専用フィールドを拒否する', () => {
    for (const extra of [{ isSpoiler: 'false' }, { visibility: 'friends' }, { userBookId: 'invalid' }, { userId: id }]) {
      expect(CreateBookmarkRequest.safeParse({ ...input, ...extra }).success).toBe(false)
    }
    expect(PatchUserBookRequest.safeParse({ status: 'done' }).success).toBe(false)
    expect(PatchPreferences.safeParse({ feedContentMode: 'all' }).success).toBe(true)
    expect(PatchPreferences.safeParse({ feedContentMode: 'hidden' }).success).toBe(false)
    expect(PatchPreferences.safeParse({}).success).toBe(false)
  })
})

describe('書籍', () => {
  it('ISBNの接頭辞とチェックディジットを検証する', () => {
    expect(Isbn13.safeParse('9784101010014').success).toBe(true)
    for (const isbn of ['9784101010015', '978-4101010014', '1234567890128', '4101010013']) {
      expect(Isbn13.safeParse(isbn).success).toBe(false)
    }
  })
  it('手動登録はISBN・作成者を受け取らず、書影・ページ数の欠落を許容する', () => {
    expect(ManualBookRequest.parse({ title: ' 手製本 ' })).toEqual({ title: '手製本' })
    expect(ManualBookRequest.safeParse({ title: '本', author: null, totalPages: null }).success).toBe(true)
    for (const extra of [{ isbn13: '9784101010014' }, { createdByUserId: id }, { totalPages: 0 }]) {
      expect(ManualBookRequest.safeParse({ title: '本', ...extra }).success).toBe(false)
    }
  })
  it('インポートは外部識別子のみを受け取り、openBDはISBNを必須とする', () => {
    expect(ImportBookRequest.safeParse({ provider: 'openbd', providerId: '9784101010014' }).success).toBe(true)
    expect(ImportBookRequest.safeParse({ provider: 'google_books', providerId: 'volume-id' }).success).toBe(true)
    for (const input of [{ provider: 'openbd', providerId: 'invalid' }, { provider: 'manual', providerId: 'id' }, { provider: 'google_books', providerId: ' ' }, { provider: 'google_books', providerId: 'id', title: '偽の情報' }]) {
      expect(ImportBookRequest.safeParse(input).success).toBe(false)
    }
  })
  it('ローカルIDのない検索候補は外部識別子を持つ', () => {
    const candidate = { localBookId: null, provider: null, providerId: null, isbn13: null, title: '本', author: null, totalPages: null, coverUrl: null }
    expect(BookSearchItem.safeParse(candidate).success).toBe(false)
    expect(BookSearchItem.safeParse({ ...candidate, localBookId: id }).success).toBe(true)
    expect(BookSearchItem.safeParse({ ...candidate, provider: 'google_books', providerId: 'id' }).success).toBe(true)
  })
})

describe('クエリ・共通レスポンス', () => {
  it('15件既定・30件上限、検索20件既定、scope=all既定', () => {
    expect(PaginationQuery.parse({})).toEqual({ limit: 15 })
    expect(PaginationQuery.parse({ limit: '30', cursor: 'opaque' })).toEqual({ limit: 30, cursor: 'opaque' })
    expect(SearchQuery.parse({ q: ' 本 ' })).toEqual({ q: '本', limit: 20 })
    expect(FeedQuery.parse({})).toEqual({ limit: 15, scope: 'all' })
    expect(FeedQuery.safeParse({ scope: 'following' }).success).toBe(true)
    for (const limit of ['', '0', '-1', '31', '1.5', 'NaN', 'Infinity']) expect(PaginationQuery.safeParse({ limit }).success).toBe(false)
    expect(PaginationQuery.safeParse({ cursor: '' }).success).toBe(false)
    expect(SearchQuery.safeParse({ q: '　' }).success).toBe(false)
    expect(FeedQuery.safeParse({ scope: 'private' }).success).toBe(false)
    expect(BookmarkIdParams.safeParse({ bookmarkId: 'bad' }).success).toBe(false)
  })
  it('栞の流れは共通ヘッダー・nullカーソル・UTC日時を持ち、カードに著者・本を繰り返さない', () => {
    const author = { id, displayName: '読者', avatarUrl: null }
    const book = { id, title: '本', isbn13: null, author: null, coverUrl: null }
    const item = { id, pageNumber: null, content: '感想', visibility: 'private', isSpoiler: false, likeCount: 0, replyCount: 0, likedByMe: false, createdAt: '2026-10-31T08:00:00Z', updatedAt: '2026-10-31T09:00:00Z' }
    const page = { author, book, items: [item], nextCursor: null }
    expect(BookmarkFlowPage.parse(page)).toEqual(page)
    expect(BookmarkFlowPage.safeParse({ ...page, items: [], nextCursor: null }).success).toBe(true)
    expect(BookmarkFlowPage.safeParse({ ...page, items: [{ ...item, createdAt: '2026-10-31' }] }).success).toBe(false)
    expect(BookmarkFlowPage.safeParse({ ...page, items: [{ ...item, likeCount: -1 }] }).success).toBe(false)
    expect(BookmarkFlowPage.safeParse({ ...page, nextCursor: undefined }).success).toBe(false)
    expect(Profile.safeParse({ ...author, handle: null, bio: null, followersCount: 0, followingCount: 0, isAnonymous: true }).success).toBe(true)
    expect(PublicProfile.safeParse({ ...author, handle: null, bio: null, followersCount: 0, followingCount: 0, publicBookmarkCount: 0, followedByMe: false }).success).toBe(true)
  })
  it('共通エラーはcode/message必須、detailsは任意', () => {
    expect(ErrorSchema.safeParse({ error: { code: 'REGISTRATION_REQUIRED', message: '登録が必要です' } }).success).toBe(true)
    expect(ErrorSchema.safeParse({ error: { code: 'VALIDATION_ERROR', message: '入力不正', details: { field: 'content' } } }).success).toBe(true)
    expect(ErrorSchema.safeParse({ error: { code: 'INVALID_CURSOR' } }).success).toBe(false)
    expect(ErrorSchema.safeParse({ error: { code: 'UNKNOWN', message: '不明' } }).success).toBe(false)
  })
})
