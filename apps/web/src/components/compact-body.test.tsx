import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BookmarkBody } from './bookmarks/BookmarkBody'

afterEach(cleanup)
const content = '長い本文'.repeat(60)
const props = { bookmarkId: 'bookmark', viewerId: null, content, isSpoiler: false, mode: 'all' as const, compact: true }
it('previews long ordinary text, exposes full text on request and can collapse again', () => {
  render(<BookmarkBody {...props} />)
  expect(screen.queryByText(content)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '全文を読む' }))
  expect(screen.getByText(content)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '短く表示' }))
  expect(screen.queryByText(content)).toBeNull()
})
it('keeps spoilers out of the DOM even in all mode', () => {
  render(<BookmarkBody {...props} isSpoiler />)
  expect(screen.queryByText(/長い本文/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'ネタバレ本文を表示' }))
  fireEvent.click(screen.getByRole('button', { name: '全文を読む' }))
  expect(screen.getByText(content)).toBeTruthy()
})
it('hides ordinary content in tap mode and resets full text on viewer change', () => {
  const view = render(<BookmarkBody {...props} mode="tap" />)
  expect(screen.queryByText(/長い本文/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '本文を表示' }))
  fireEvent.click(screen.getByRole('button', { name: '全文を読む' }))
  view.rerender(<BookmarkBody {...props} viewerId="next" mode="tap" />)
  expect(screen.queryByText(/長い本文/)).toBeNull()
})
