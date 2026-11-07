import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { BookCard } from './books/BookCard'
import { BookCover } from './books/BookCover'
import { BookmarkCard } from './bookmarks/BookmarkCard'
import { BookmarkBody, type FeedContentMode } from './bookmarks/BookmarkBody'
import { ContentModeSwitch } from './bookmarks/ContentModeSwitch'
import { EmptyState, ErrorState, LoadingState } from './states/ScreenStates'
import type { components } from '../lib/api/generated'

afterEach(cleanup)
const book: components['schemas']['BookSummary'] = { id: 'book', title: '長い書名', author: null, coverUrl: null, isbn13: null }
const bookmark: components['schemas']['BookmarkFlowItem'] = { id: 'post', pageNumber: null, content: '<img src=x onerror=alert(1)>',
  visibility: 'private', isSpoiler: false, likeCount: 0, replyCount: 0, likedByMe: false,
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z' }

describe('body visibility', () => {
  it.each([
    ['all', false, true], ['tap', false, false], ['all', true, false], ['tap', true, false],
  ] as const)('%s / spoiler=%s has correct initial visibility', (mode, isSpoiler, visible) => {
    render(<BookmarkBody bookmarkId="post" viewerId={null} content="本文" mode={mode} isSpoiler={isSpoiler} />)
    expect(screen.queryByText('本文') !== null).toBe(visible)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe(String(visible))
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull()
    fireEvent.click(button)
    expect(screen.queryByText('本文') !== null).toBe(!visible)
  })

  it.each(['bookmarkId', 'viewerId', 'mode', 'isSpoiler', 'content'] as const)('resets disclosure when %s changes', (field) => {
    const props = { bookmarkId: 'one', viewerId: null as string | null, mode: 'tap' as FeedContentMode, isSpoiler: true, content: '本文' }
    const view = render(<BookmarkBody {...props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('本文')).toBeTruthy()
    const changes = { bookmarkId: 'two', viewerId: 'another', mode: 'all', isSpoiler: false, content: '更新本文' }
    view.rerender(<BookmarkBody {...props} {...{ [field]: changes[field] }} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(field === 'content' ? '更新本文' : '本文')).toBeNull()
  })

  it('renders text safely instead of interpreting HTML', () => {
    const { container } = render(<BookmarkBody bookmarkId="post" viewerId={null} content={bookmark.content} mode="all" isSpoiler={false} />)
    expect(screen.getByText(bookmark.content)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('cards and screen states', () => {
  it('supports nullable book fields, external candidates and caller actions', () => {
    const onSelect = vi.fn()
    render(<BookCard book={{ ...book, localBookId: null, provider: 'google_books', providerId: 'external', totalPages: null }}
      actions={<button onClick={onSelect}>本棚に追加</button>} />)
    expect(screen.getByText('著者情報なし')).toBeTruthy()
    expect(screen.getByRole('img', { name: '書影なし' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('falls back on image failure and retries a different cover source', () => {
    const view = render(<BookCover src="/one.png" />)
    fireEvent.error(view.container.querySelector('img')!)
    expect(screen.getByRole('img', { name: '書影なし' })).toBeTruthy()
    view.rerender(<BookCover src="/two.png" />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/two.png')
  })

  it('shows full cards and flow cards without duplicating the author or book', () => {
    const view = render(<MemoryRouter><BookmarkCard bookmark={{ ...bookmark, author: { id: 'user', displayName: '読者', avatarUrl: null }, book }}
      mode="all" viewerId={null} bookHref="/books/book" /></MemoryRouter>)
    expect(screen.getByText('読者')).toBeTruthy()
    expect(screen.getByRole('link', { name: book.title })).toBeTruthy()
    expect(screen.getByText('非公開')).toBeTruthy()
    expect(screen.queryByText(/ページ$/)).toBeNull()
    view.rerender(<MemoryRouter><BookmarkCard variant="flow" bookmark={{ ...bookmark, pageNumber: 12 }} mode="all" viewerId="user" /></MemoryRouter>)
    expect(screen.queryByText('読者')).toBeNull()
    expect(screen.queryByText(book.title)).toBeNull()
    expect(screen.getByText('12ページ')).toBeTruthy()
  })

  it('offers labeled, controlled display modes', () => {
    const onChange = vi.fn()
    render(<ContentModeSwitch value="tap" onChange={onChange} />)
    expect((screen.getByLabelText('タップして表示') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('すべて表示'))
    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('provides next actions and retry with duplicate prevention', () => {
    const next = vi.fn(), retry = vi.fn()
    const view = render(<><EmptyState title="本がありません" description="本を探しましょう" action={<button onClick={next}>検索へ</button>} />
      <ErrorState description="通信環境を確認してください" onRetry={retry} /></>)
    fireEvent.click(screen.getByRole('button', { name: '検索へ' }))
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(next).toHaveBeenCalledOnce()
    expect(retry).toHaveBeenCalledOnce()
    view.rerender(<ErrorState description="再試行しています" onRetry={retry} isRetrying />)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('distinguishes initial skeletons from loading more without replacing existing content', () => {
    const view = render(<LoadingState />)
    expect(screen.getByRole('status').textContent).toContain('読み込み中…')
    expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    view.rerender(<><p>既存の栞</p><LoadingState variant="more" /></>)
    expect(screen.getByText('既存の栞')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('さらに読み込み中…')
    expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
