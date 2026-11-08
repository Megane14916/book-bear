import { useEffect, useRef } from 'react'
import { ErrorState, LoadingState } from './ScreenStates'

export function LoadMore({ query, automatic = false }: { automatic?: boolean; query: {
  hasNextPage: boolean
  isFetching?: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: (options?: { cancelRefetch?: boolean }) => Promise<unknown>
} }) {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const isFetching = query.isFetching ?? isFetchingNextPage
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = end.current
    if (!automatic || !target || !hasNextPage || isFetching || isFetchNextPageError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect()
        void fetchNextPage({ cancelRefetch: false })
      }
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [automatic, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  const load = () => void fetchNextPage()
  if (isFetchNextPageError) return <ErrorState description="続きを取得できませんでした。" onRetry={load} isRetrying={isFetchingNextPage} />
  if (isFetchingNextPage) return <LoadingState variant="more" />
  if (!hasNextPage) return null
  if (automatic) return <div ref={end} className="h-px" aria-hidden="true" />
  return <button type="button" className="ui-action w-full border border-forest text-sm font-bold text-forest" onClick={load}>もっと見る</button>
}
