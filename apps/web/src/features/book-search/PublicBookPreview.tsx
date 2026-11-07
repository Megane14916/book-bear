import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { BookPreview } from '../../components/books/BookPreview'
import { api } from '../../lib/api/client'
import { requireData } from '../../lib/api/result'
import { queryKeys } from '../../lib/query/keys'

export function PublicBookPreview({ userId }: { userId: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !container.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  // The public endpoint returns only books with public bookmarks, including
  // when the viewer is the owner. Never query /me/books for another reader.
  const books = useInfiniteQuery({
    queryKey: queryKeys.publicBooks(userId, 6), enabled: visible, staleTime: 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => requireData(() => api.GET('/api/v1/users/{userId}/books', {
      params: { path: { userId }, query: { limit: 6, cursor: pageParam } }, signal,
    })),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = books.data?.pages.flatMap((page) => page.items) ?? []
  return <div ref={container} className="mt-1 min-w-0 border-t border-[#e2e7e2] pt-2">
    <p className="mb-2 text-xs text-[#526356]">公開栞を投稿した本</p>
    {!visible ? <button type="button" className="ui-action text-xs text-forest underline" onClick={() => setVisible(true)}>公開した本を見る</button>
      : books.isPending ? <p role="status" className="text-xs">書籍を読み込み中…</p>
      : !books.data ? <button type="button" className="ui-action text-xs text-forest underline" disabled={books.isFetching} onClick={() => void books.refetch()}>書籍の取得を再試行</button>
      : items.length === 0 ? <p className="text-xs text-[#526356]">公開栞がある本はまだありません。</p>
      : <div aria-label="公開した本のプレビュー" tabIndex={0} className="flex gap-2 overflow-x-auto pb-1 focus-visible:outline-2 focus-visible:outline-forest">
        {items.map((book) => <Link key={book.id} to={`/books/${book.id}`} aria-label={`書籍詳細：${book.title}`} title={book.title}
          className="shrink-0 rounded p-1 text-ink focus-visible:outline-2 focus-visible:outline-forest"><BookPreview book={book} /></Link>)}
        {books.hasNextPage && <button type="button" className="ui-action shrink-0 px-3 text-xs text-forest underline" disabled={books.isFetchingNextPage}
          onClick={() => void books.fetchNextPage()}>{books.isFetchNextPageError ? '本の続きを再試行' : '本の続きを見る'}</button>}
      </div>}
  </div>
}
