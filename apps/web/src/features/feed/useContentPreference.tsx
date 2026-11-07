import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ContentModeSwitch } from '../../components/bookmarks/ContentModeSwitch'
import type { FeedContentMode } from '../../components/bookmarks/BookmarkBody'
import { ErrorState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { requestData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'

const storageKey = 'book-bear:guest-feed-content-mode'

function readGuestMode(): FeedContentMode {
  try { return localStorage.getItem(storageKey) === 'all' ? 'all' : 'tap' } catch { return 'tap' }
}

export function useContentPreference({ enabled = true } = {}) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [guestMode, setGuestMode] = useState(readGuestMode)
  const [storageError, setStorageError] = useState(false)
  const preferenceKey = ['preferences', auth.userId] as const
  const preferences = useQuery({
    queryKey: preferenceKey,
    enabled: enabled && auth.canReadPrivate && !!auth.userId,
    queryFn: async ({ signal }) => {
      const data = await requestData(() => api.GET('/api/v1/me/preferences', { signal }))
      if (!data) throw new Error('設定の応答がありません。')
      return data
    },
  })
  const update = useMutation({
    mutationFn: (mode: FeedContentMode) => auth.runAuthenticatedWrite(async ({ signal, userId }) => {
      if (userId !== auth.userId) throw new Error('認証状態が変更されました。')
      const data = await requestData(() => api.PATCH('/api/v1/me/preferences', { signal, body: { feedContentMode: mode } }))
      if (!data) throw new Error('設定の応答がありません。')
      return data
    }),
    onSuccess: (data) => queryClient.setQueryData(preferenceKey, data),
  })
  const isGuest = !auth.userId && (auth.status === 'guest' || auth.status === 'unconfigured')
  const mode = isGuest ? guestMode : preferences.data?.feedContentMode ?? 'tap'

  function changeMode(value: FeedContentMode) {
    if (isGuest) {
      setGuestMode(value)
      try { localStorage.setItem(storageKey, value); setStorageError(false) } catch { setStorageError(true) }
    } else if (auth.canReadPrivate) {
      update.mutate(value)
    }
  }

  const control = <div className="mb-4 rounded-2xl border border-[#e2e7e2] bg-white px-4 py-3">
    <div aria-busy={update.isPending}>
      <fieldset disabled={(!isGuest && (!auth.canReadPrivate || !preferences.data)) || update.isPending}>
        <ContentModeSwitch value={mode} onChange={changeMode} />
      </fieldset>
    </div>
    {preferences.isError && auth.canReadPrivate && <ErrorState description="表示設定を取得できませんでした。" onRetry={() => void preferences.refetch()} />}
    {update.isError && <p role="alert" className="text-sm text-red-700">表示設定を保存できませんでした。もう一度お試しください。</p>}
    {storageError && <p role="alert" className="text-sm text-red-700">端末に設定を保存できませんでした。</p>}
  </div>
  return { mode, control }
}
