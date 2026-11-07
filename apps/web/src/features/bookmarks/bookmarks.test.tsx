import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { HttpError } from '../../lib/api/errors'
import { queryKeys } from '../../lib/query/keys'
import { BookmarkForm } from './BookmarkForm'
import { bookmarkError, bookmarkInput, registrationMessage, validateBookmark } from './validation'
import { refreshBookmarkCaches } from './queries'
import type { Bookmark } from './api'

afterEach(cleanup)
const bookmark: Bookmark = {
  id: 'bookmark', author: { id: 'owner', displayName: '読者', avatarUrl: null },
  book: { id: 'book', title: '本', author: null, coverUrl: null, isbn13: null },
  pageNumber: null, content: '更新後の本文', visibility: 'private', isSpoiler: false,
  likeCount: 0, replyCount: 0, likedByMe: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

it.each(['', ' \n\t ', 'あ'.repeat(2001)])('rejects empty or overlong content', (content) => {
  expect(validateBookmark(content, '')).toBeTruthy()
})
it.each(['0', '-1', '1.5', '2147483648', '1e2', 'Infinity', 'NaN'])('rejects invalid page %s', (page) => {
  expect(validateBookmark('本文', page)).toBeTruthy()
})
it.each(['', '1', '2147483647'])('accepts optional positive page %s', (page) => {
  expect(validateBookmark('あ'.repeat(2000), page)).toBeNull()
})
it('normalizes only editable fields, including clearing a page', () => {
  expect(bookmarkInput(' 本文 \n', '', 'private', true)).toEqual({ content: '本文', pageNumber: null, visibility: 'private', isSpoiler: true })
})
it('maps the API registration error to the same local guidance', () => {
  expect(bookmarkError(new HttpError(403, { error: { code: 'REGISTRATION_REQUIRED' } }))).toBe(registrationMessage)
})
it('keeps inputs on validation/network failures and blocks anonymous public writes', () => {
  const onSave = vi.fn()
  const view = render(<BookmarkForm pending={false} error={null} canPublish={false} onSave={onSave} />)
  const content = screen.getByRole('textbox', { name: /本文/ })
  fireEvent.change(content, { target: { value: '下書き' } })
  fireEvent.change(screen.getByLabelText('公開範囲'), { target: { value: 'public' } })
  fireEvent.click(screen.getByRole('button', { name: '栞を保存' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe(registrationMessage)
  fireEvent.change(screen.getByLabelText('公開範囲'), { target: { value: 'private' } })
  fireEvent.click(screen.getByRole('button', { name: '栞を保存' }))
  expect(onSave).toHaveBeenCalledWith({ content: '下書き', pageNumber: null, visibility: 'private', isSpoiler: false })
  view.rerender(<BookmarkForm pending={false} error={new Error('通信失敗')} canPublish={false} onSave={onSave} />)
  expect((content as HTMLTextAreaElement).value).toBe('下書き')
  expect(screen.getByRole('alert').textContent).toBe('通信失敗')
})
it('allows a registered reader to change visibility, page and spoiler, and disables pending submissions', () => {
  const onSave = vi.fn()
  const view = render(<BookmarkForm initial={bookmark} pending={false} error={null} canPublish onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('公開範囲'), { target: { value: 'public' } })
  fireEvent.change(screen.getByLabelText('ページ番号（任意）'), { target: { value: '20' } })
  fireEvent.click(screen.getByLabelText('ネタバレを含む'))
  fireEvent.click(screen.getByRole('button', { name: '栞を保存' }))
  expect(onSave).toHaveBeenCalledWith({ content: bookmark.content, pageNumber: 20, visibility: 'public', isSpoiler: true })
  view.rerender(<BookmarkForm initial={bookmark} pending error={null} canPublish onSave={onSave} />)
  fireEvent.submit(screen.getByRole('button', { name: '保存中…' }).closest('form')!)
  expect(onSave).toHaveBeenCalledTimes(1)
})
it('clears inactive public/list/other-viewer caches rather than leaving stale private text, preserving book metadata', async () => {
  const client = new QueryClient()
  const keys = [queryKeys.feed('all', null), queryKeys.bookmarkFlow('owner', 'book', null), queryKeys.myBookmarks('owner'),
    queryKeys.searchPosts('q', null), ['public-profile', 'owner'], queryKeys.bookmark('bookmark', null)]
  for (const key of keys) client.setQueryData(key, { content: '古い公開本文' })
  const library = queryKeys.myBooks('owner'), otherLibrary = queryKeys.myBooks('other')
  const libraryPages = { pages: [{ items: [], nextCursor: null }], pageParams: [undefined] }
  client.setQueryData(library, libraryPages)
  client.setQueryData(otherLibrary, libraryPages)
  client.setQueryData(queryKeys.book('book'), { title: '本' })
  client.setQueryData(queryKeys.bookmark('bookmark', 'owner'), { ...bookmark, content: '旧本文' })
  await refreshBookmarkCaches(client, bookmark, 'owner', new AbortController().signal)
  for (const key of keys) expect(client.getQueryData(key)).toBeUndefined()
  expect(client.getQueryData(queryKeys.bookmark('bookmark', 'owner'))).toEqual(bookmark)
  expect(client.getQueryData(queryKeys.book('book'))).toEqual({ title: '本' })
  expect(client.getQueryData(library)).toEqual(libraryPages)
  expect(client.getQueryState(library)?.isInvalidated).toBe(true)
  expect(client.getQueryState(otherLibrary)?.isInvalidated).toBe(false)
  client.clear()
})
