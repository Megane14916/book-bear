import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link } from 'react-router'
import { BookCard } from '../../src/components/books/BookCard'
import { BookmarkCard } from '../../src/components/bookmarks/BookmarkCard'
import { ContentModeSwitch } from '../../src/components/bookmarks/ContentModeSwitch'
import type { FeedContentMode } from '../../src/components/bookmarks/BookmarkBody'
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states/ScreenStates'
import BottomNav from '../../src/components/BottomNav'
import '../../src/styles.css'

function Fixture() {
  const [mode, setMode] = useState<FeedContentMode>('tap')
  const [retried, setRetried] = useState(false)
  const [selected, setSelected] = useState(false)
  const book = { id: 'book', title: '長い書名'.repeat(30), author: 'VeryLongAuthorName'.repeat(15), coverUrl: null, isbn13: null }
  const bookmark = { id: 'post', content: 'ネタバレの本文\n' + 'https://example.test/'.repeat(40), pageNumber: null, visibility: 'private' as const,
    isSpoiler: true, likeCount: 0, replyCount: 0, likedByMe: false, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z' }
  return <BrowserRouter><main className="mx-auto max-w-[740px] space-y-6 px-5 pt-4 pb-[calc(8rem+env(safe-area-inset-bottom))]">
    <h1 className="text-2xl font-bold">共通UIテスト</h1>
    <ContentModeSwitch value={mode} onChange={setMode} />
    <BookCard book={book} titleHref="#book" actions={<button type="button" className="ui-action border px-3" onClick={() => setSelected(true)}>本棚に追加</button>} />
    {selected && <p>書籍操作を受け付けました</p>}
    <BookmarkCard bookmark={{ ...bookmark, author: { id: 'user', displayName: '読者', avatarUrl: null }, book }} viewerId={null} mode={mode} />
    <BookmarkCard variant="flow" bookmark={{ ...bookmark, id: 'normal', isSpoiler: false, content: '通常の本文', pageNumber: 100 }} viewerId={null} mode={mode} />
    <LoadingState /><LoadingState variant="more" />
    <ErrorState description={retried ? '再試行を受け付けました' : '一時的な取得失敗'} onRetry={() => setRetried(true)} />
    <EmptyState title="本がありません" description="次の本を探しましょう" action={<Link className="ui-action inline-flex border px-4" to="#search">本を探す</Link>} />
  </main><BottomNav /></BrowserRouter>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
