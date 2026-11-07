import { ErrorState, LoadingState } from './ScreenStates'

export function LoadMore({ query }: { query: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => Promise<unknown>
} }) {
  const load = () => void query.fetchNextPage()
  if (query.isFetchNextPageError) return <ErrorState description="続きを取得できませんでした。" onRetry={load} isRetrying={query.isFetchingNextPage} />
  if (query.isFetchingNextPage) return <LoadingState variant="more" />
  if (!query.hasNextPage) return null
  return <button type="button" className="ui-action w-full border border-forest text-sm font-bold text-forest" onClick={load}>もっと見る</button>
}
