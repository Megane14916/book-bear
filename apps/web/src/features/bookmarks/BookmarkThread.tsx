import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { FeedContentMode } from '../../components/bookmarks/BookmarkBody'
import { LoadMore } from '../../components/states/LoadMore'
import { ErrorState } from '../../components/states/ScreenStates'
import { bookmarkFlowOptions } from '../bookmark-flow/queries'
import { Replies } from '../social/Replies'
import { SocialBookmarkCard } from '../social/SocialBookmarkCard'
import type { Bookmark } from './api'

export function BookmarkThread({ bookmark, viewerId, mode, actions, feedback }: {
  bookmark: Bookmark; viewerId: string | null; mode: FeedContentMode; actions?: ReactNode; feedback?: ReactNode
}) {
  const { author, book } = bookmark
  const [showAfter, setShowAfter] = useState(false)
  const flow = useInfiniteQuery(bookmarkFlowOptions(author.id, book.id, viewerId))
  const { fetchNextPage, hasNextPage, isFetching, isFetchNextPageError } = flow
  const items = flow.data?.pages.flatMap((page) => page.items) ?? []
  const currentIndex = items.findIndex((item) => item.id === bookmark.id)
  const before = currentIndex < 0 ? [] : items.slice(0, currentIndex)
  const after = currentIndex < 0 ? [] : items.slice(currentIndex + 1)
  const hasFollowing = currentIndex >= 0 && (after.length > 0 || hasNextPage)
  const needsContext = currentIndex < 0 || (showAfter && after.length === 0)
  const scroller = useRef<HTMLDivElement>(null)
  const earlier = useRef<HTMLDivElement>(null)
  const aligned = useRef(false)

  // Find the focused post in the oldest-first list. Fetch its following page when expanded.
  useEffect(() => {
    if (needsContext && hasNextPage && !isFetching && !isFetchNextPageError) {
      void fetchNextPage({ cancelRefetch: false })
    }
  }, [needsContext, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  const hasEarlier = before.length > 0
  useLayoutEffect(() => {
    if (aligned.current || !scroller.current || !earlier.current) return
    // Keep the open post at the same position when the earlier posts are inserted above it.
    scroller.current.scrollTop += earlier.current.offsetHeight
    aligned.current = true
  }, [hasEarlier])

  return <div ref={scroller} role="region" aria-label="前後の栞と返信" tabIndex={0}
    className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [overflow-anchor:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest">
    {hasEarlier && <div ref={earlier} className="px-4 sm:px-6">
      {before.map((item, index) => <ThreadEntry key={item.id} above={index > 0} below>
        <SocialBookmarkCard bookmark={{ ...item, author, book }} viewerId={viewerId} mode={mode}
          appearance="timeline" inThread detailHref={`/bookmarks/${item.id}`} />
      </ThreadEntry>)}
    </div>}
    <div className="min-h-full px-4 pb-8 sm:px-6">
      <ThreadEntry above={hasEarlier} below={hasFollowing} current>
        <SocialBookmarkCard bookmark={bookmark} viewerId={viewerId} mode={mode} appearance="timeline" inThread actions={actions} />
        {feedback && <div className="ml-11 pb-4">{feedback}</div>}
      </ThreadEntry>
      {hasFollowing && <div className="relative pl-11">
        <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-[15px] border-l-2 border-[#9eb9a2] ${showAfter ? '' : 'border-dashed'}`} />
        <button type="button" className="ui-action inline-flex gap-1.5 rounded-full px-3 text-sm font-bold text-forest hover:bg-mist"
          aria-expanded={showAfter} aria-controls="following-bookmarks" onClick={() => setShowAfter((value) => !value)}>
          {showAfter ? '後の栞を閉じる' : 'もっと見る'}
        </button>
      </div>}
      <div id="following-bookmarks" role="region" aria-label="後の栞" hidden={!showAfter}>
        {showAfter && after.map((item, index) => <ThreadEntry key={item.id} above below={index < after.length - 1}>
          <SocialBookmarkCard bookmark={{ ...item, author, book }} viewerId={viewerId} mode={mode}
            appearance="timeline" inThread detailHref={`/bookmarks/${item.id}`} />
        </ThreadEntry>)}
        {showAfter && hasNextPage && <div className="ml-11"><LoadMore query={flow} /></div>}
      </div>
      {currentIndex < 0 && <div className="ml-11">
        {flow.isError && !flow.data ? <ErrorState description="前後の栞を取得できませんでした。"
          onRetry={() => void flow.refetch()} isRetrying={flow.isFetching} /> :
          isFetchNextPageError ? <LoadMore query={flow} /> :
          (flow.isPending || hasNextPage) && <p role="status" className="py-2 text-sm text-[#526356]">前後の栞を読み込み中…</p>}
      </div>}
      {bookmark.visibility === 'public' && <Replies bookmarkId={bookmark.id} mode={mode} />}
    </div>
  </div>
}

function ThreadEntry({ above, below, current, children }: { above: boolean; below: boolean; current?: boolean; children: ReactNode }) {
  return <div aria-current={current ? 'true' : undefined} className="relative">
    {(above || below) && <span aria-hidden="true"
      className={`pointer-events-none absolute left-[15px] w-0.5 bg-[#d6e4d8] ${above ? 'top-0' : 'top-8'} ${below ? 'bottom-0' : 'h-8'}`} />}
    {children}
  </div>
}
