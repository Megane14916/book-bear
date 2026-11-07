import { useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './AuthProvider'
import { api } from '../api/client'
import { requestData } from '../api/result'
import { ApiError, isAbortError } from '../api/errors'

// Development-only harness: exercises auth/PUT /me, never creates books/posts.
export function AuthCheck() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const cacheCount = useSyncExternalStore((listener) => {
    const stopQueries = queryClient.getQueryCache().subscribe(listener)
    const stopMutations = queryClient.getMutationCache().subscribe(listener)
    return () => { stopQueries(); stopMutations() }
  }, () => queryClient.getQueryCache().getAll().length + queryClient.getMutationCache().getAll().length)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('認証情報・トークンは表示しません。')
  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true)
    try { await action(); setMessage(success) }
    catch (error) {
      setMessage(isAbortError(error) ? '認証状態の変更により中断しました。'
        : error instanceof ApiError ? error.message : '確認に失敗しました。再試行してください。')
    } finally { setPending(false) }
  }
  return (
    <aside aria-label="開発用認証確認" className="fixed right-2 bottom-24 z-20 max-w-sm rounded-xl border bg-white p-4 text-sm text-ink shadow">
      <p className="font-bold">開発用認証確認</p>
      <p className="mt-2">状態：{auth.status} ／ {auth.userId ? (auth.isAnonymous ? '匿名' : '正式') : 'セッションなし'}</p>
      <p>本人データ取得：{auth.canReadPrivate ? '許可' : '停止'}</p>
      <p>検証キャッシュ件数：{cacheCount}</p>
      <p role="status" className="mt-2">{auth.error?.message ?? message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending || auth.status === 'loading' || auth.status === 'signing-out'}
          className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          onClick={() => void run(() => auth.runAuthenticatedWrite(async ({ signal, userId }) => {
            const me = await requestData(() => api.GET('/api/v1/me', { signal }))
            if (me?.id !== userId) throw new ApiError('auth', '本人確認に失敗しました。')
          }), '保存前の認証・初期化・認証付きGET /meが成功しました。')}>
          保存前処理を確認
        </button>
        <button type="button" disabled={pending} className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          onClick={() => void run(auth.retrySession, 'セッションを再確認しました。')}>セッション再確認</button>
        <button type="button" disabled={pending || !auth.userId} className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          onClick={() => void run(auth.signOut, 'このブラウザからサインアウトしました。')}>サインアウト</button>
        <button type="button" disabled={pending || !auth.canReadPrivate} className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          onClick={() => void run(async () => {
            await auth.refreshSession()
            await auth.runAuthenticatedWrite(({ signal }) => requestData(() => api.GET('/api/v1/me', { signal })))
          }, 'JWT更新後の本人確認が成功しました。')}>JWT更新を確認</button>
        <button type="button" disabled={pending || !auth.canReadPrivate} className="min-h-11 rounded-lg border px-3 disabled:opacity-50"
          onClick={() => void run(async () => {
            queryClient.setQueryData(['my-books', auth.userId], { owner: auth.userId })
            queryClient.setQueryData(['feed', 'all', auth.userId], { likedByMe: true })
            await queryClient.getMutationCache().build(queryClient, { mutationFn: async () => ({ owner: auth.userId }) }).execute(undefined)
          }, '検証用キャッシュを作成しました。APIへの書き込みはありません。')}>検証キャッシュを作成</button>
      </div>
      <p className="mt-2 text-xs">匿名でサインアウトすると、再ログインして記録を復元できません。</p>
    </aside>
  )
}
