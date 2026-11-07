import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { LoadMore } from '../../components/states/LoadMore'
import { bookmarkFlowOptions } from '../bookmark-flow/queries'

const postedAt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })

export function BookmarkHistory({ bookId, userId }: { bookId: string; userId: string }) {
  const [open, setOpen] = useState(false)
  const history = useInfiniteQuery(bookmarkFlowOptions(userId, bookId, userId))
  const items = history.data?.pages.flatMap((page) => page.items) ?? []
  if (!history.data && history.isError) return <button type="button" className="ui-action text-sm text-forest underline"
    disabled={history.isFetching} onClick={() => void history.refetch()}>栞の履歴を読み込み直す</button>
  if (!items.length) return null

  return <details className="group border-y border-[#d6ded6]" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="ui-action flex cursor-pointer list-none justify-between px-2 text-sm font-bold text-forest [&::-webkit-details-marker]:hidden">
      しおりの流れを見る
      <svg aria-hidden="true" className="size-5 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </summary>
    {open && <div className="px-2 pb-3">
      <ol className="divide-y divide-[#d6ded6] border-t border-[#d6ded6]">
        {items.map((item) => <li key={item.id} className="space-y-1 py-3">
          <time className="block text-xs text-[#526356]" dateTime={item.createdAt}>{postedAt.format(new Date(item.createdAt))}</time>
          <p className="text-sm leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.content}</p>
        </li>)}
      </ol>
      <LoadMore query={history} />
    </div>}
  </details>
}
