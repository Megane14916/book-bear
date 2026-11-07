import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { BookmarkBody } from '../../components/bookmarks/BookmarkBody'
import { LoadMore } from '../../components/states/LoadMore'
import { bookmarkFlowOptions } from '../bookmark-flow/queries'
import { useContentPreference } from '../feed/useContentPreference'

const postedAt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

export function BookmarkHistory({ bookId, userId }: { bookId: string; userId: string }) {
  const [open, setOpen] = useState(false)
  const history = useInfiniteQuery(bookmarkFlowOptions(userId, bookId, userId))
  const { mode } = useContentPreference({ enabled: open })
  const items = history.data?.pages.flatMap((page) => page.items) ?? []
  if (!history.data && history.isError) return <button type="button" className="ui-action text-sm text-forest underline"
    disabled={history.isFetching} onClick={() => void history.refetch()}>栞の履歴を読み込み直す</button>
  if (!items.length) return null

  return <details className="group border-y border-[#d6ded6]" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="ui-action flex cursor-pointer list-none justify-between px-2 text-sm font-bold text-forest [&::-webkit-details-marker]:hidden">
      しおりの流れを見る <span aria-hidden="true" className="group-open:rotate-180">∨</span>
    </summary>
    {open && <div className="px-2 pb-3">
      <ol className="divide-y divide-[#d6ded6] border-t border-[#d6ded6]">
        {items.map((item) => <li key={item.id} className="space-y-1 py-3">
          <time className="block text-xs text-[#526356]" dateTime={item.createdAt}>{postedAt.format(new Date(item.createdAt))}</time>
          <BookmarkBody bookmarkId={item.id} viewerId={userId} content={item.content} isSpoiler={item.isSpoiler} mode={mode} hideClose />
        </li>)}
      </ol>
      <LoadMore query={history} />
    </div>}
  </details>
}
