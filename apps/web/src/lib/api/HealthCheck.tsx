import { useQuery } from '@tanstack/react-query'
import { healthQueryOptions } from './health'
import { isAbortError } from './errors'

// Mounted only by main.tsx in development with ?api-check=1. No product route.
export function HealthCheck() {
  const query = useQuery(healthQueryOptions())
  return (
    <aside aria-label="開発用API接続確認" className="fixed top-2 right-2 z-20 max-w-sm rounded-xl border bg-white p-4 text-sm text-ink shadow">
      <p className="font-bold">開発用API接続確認</p>
      <p role="status" className="mt-2">
        {query.fetchStatus === 'paused' ? 'オフラインです。接続を待っています。'
          : query.isFetching ? 'APIに接続しています…'
          : query.isError ? (isAbortError(query.error) ? '接続確認を中断しました。' : query.error.message)
          : query.isSuccess ? `接続成功：${query.data.status}` : '接続確認を待っています。'}
      </p>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}
        className="mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 focus-visible:outline-forest disabled:opacity-50">
        再確認
      </button>
    </aside>
  )
}
