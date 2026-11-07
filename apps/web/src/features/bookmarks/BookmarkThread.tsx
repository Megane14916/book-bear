import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
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
  const flow = useInfiniteQuery(bookmarkFlowOptions(author.id, book.id, viewerId))
  const { fetchNextPage, hasNextPage, isFetching, isFetchNextPageError } = flow
  const items = flow.data?.pages.flatMap((page) => page.items) ?? []
  const currentIndex = items.findIndex((item) => item.id === bookmark.id)
  const before = currentIndex < 0 ? [] : items.slice(0, currentIndex)
  const after = currentIndex < 0 ? [] : items.slice(currentIndex + 1)
  const needsContext = after.length === 0
  const scroller = useRef<HTMLDivElement>(null)
  const earlier = useRef<HTMLDivElement>(null)
  const aligned = useRef(false)

  // The flow API pages from oldest to newest. Load through the current post and its next neighbor.
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
      <ThreadEntry above={hasEarlier} below={after.length > 0} current>
        <SocialBookmarkCard bookmark={bookmark} viewerId={viewerId} mode={mode} appearance="timeline" inThread actions={actions} />
        {feedback && <div className="ml-11 pb-4">{feedback}</div>}
        {bookmark.visibility === 'public' && <div className="pb-4 pl-11">
          <Replies bookmarkId={bookmark.id} mode={mode} />
        </div>}
      </ThreadEntry>
      {after.map((item, index) => <ThreadEntry key={item.id} above below={index < after.length - 1}>
        <SocialBookmarkCard bookmark={{ ...item, author, book }} viewerId={viewerId} mode={mode}
          appearance="timeline" inThread detailHref={`/bookmarks/${item.id}`} />
      </ThreadEntry>)}
      <div className="ml-11 pt-2">
        {flow.isError && !flow.data ? <ErrorState description="前後の栞を取得できませんでした。"
          onRetry={() => void flow.refetch()} isRetrying={flow.isFetching} /> :
          flow.isPending || (needsContext && hasNextPage && !isFetchNextPageError) ?
          <p role="status" className="py-2 text-sm text-[#526356]">前後の栞を読み込み中…</p> : <LoadMore query={flow} />}
        <Link className="ui-action inline-flex text-sm font-semibold text-forest hover:underline"
          to={`/users/${author.id}/books/${book.id}/bookmarks`}>この本の栞の流れ</Link>
      </div>
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
