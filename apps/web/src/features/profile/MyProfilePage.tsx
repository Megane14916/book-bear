import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router'
import { PageBack } from '../../components/PageBack'
import { EmptyState, ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import type { components } from '../../lib/api/generated'
import { requireData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { queryKeys } from '../../lib/query/keys'
import { PublicProfile } from './PublicProfilePage'

type Profile = components['schemas']['Profile']
type PatchProfile = components['schemas']['PatchProfile']
const fieldClass = 'mt-1 min-h-11 w-full rounded-lg border border-[#d6ded6] bg-white px-3 py-2'

export default function MyProfilePage() {
  const auth = useAuth()
  if (auth.canReadPrivate && auth.userId) return <PublicProfile userId={auth.userId} />
  return <section className="space-y-5">
    <h1 className="text-3xl font-bold">マイページ</h1>
    <Link to="/settings" className="ui-action inline-flex text-sm font-bold text-forest underline">設定</Link>
    <GoogleAction />
    {auth.status === 'error' ? <ErrorState description={auth.error?.message ?? 'ログイン状態を確認できませんでした。'}
      onRetry={() => void auth.retrySession().catch(() => {})} /> :
      auth.status === 'guest' || auth.status === 'unconfigured' ? <EmptyState title="プロフィールの保存にはアカウントが必要です"
        description="本棚に本を追加すると、匿名アカウントでもプロフィールを保存できます。"
        action={<Link to="/search" className="ui-action inline-flex text-forest underline">本を探す</Link>} /> : <LoadingState />}
  </section>
}

export function EditProfilePage() {
  const auth = useAuth()
  const me = useQuery({
    queryKey: queryKeys.me(auth.userId), enabled: auth.canReadPrivate,
    queryFn: ({ signal }) => requireData(() => api.GET('/api/v1/me', { signal })),
  })
  if (auth.status === 'guest' || auth.status === 'unconfigured') return <Navigate to="/me" replace />
  return <section className="space-y-5">
    <PageBack fallback="/me" />
    <h1 className="text-3xl font-bold">プロフィールを編集</h1>
    {auth.status === 'error' ? <ErrorState description={auth.error?.message ?? 'ログイン状態を確認できませんでした。'}
      onRetry={() => void auth.retrySession().catch(() => {})} /> : !auth.canReadPrivate || me.isPending ? <LoadingState /> :
      !me.data ? <ErrorState description="プロフィールを取得できませんでした。" onRetry={() => void me.refetch()} isRetrying={me.isFetching} /> :
      <ProfileForm key={me.data.id} profile={me.data} />}
  </section>
}

function ProfileForm({ profile }: { profile: Profile }) {
  const auth = useAuth()
  const client = useQueryClient()
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio ?? '')
  const [handle, setHandle] = useState(profile.handle ?? '')
  const [validation, setValidation] = useState('')
  const save = useMutation({
    mutationFn: (body: PatchProfile) => auth.runAuthenticatedWrite(({ signal, userId }) => {
      if (userId !== profile.id) throw new Error('ログイン状態が変わりました。')
      return requireData(() => api.PATCH('/api/v1/me', { body, signal }))
    }),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.me(saved.id), saved)
      void client.invalidateQueries({ queryKey: ['public-profile', saved.id] })
      setDisplayName(saved.displayName); setBio(saved.bio ?? ''); setHandle(saved.handle ?? '')
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    save.reset()
    setValidation('')
    const name = displayName.trim()
    const slug = handle.trim()
    if (!name || name.length > 50 || bio.length > 500) {
      setValidation('表示名は1〜50文字、自己紹介は500文字以内で入力してください。')
      return
    }
    if (slug && !/^[a-z0-9_]{3,30}$/.test(slug)) {
      setValidation('ハンドルは半角小文字英数字と _ の3〜30文字で入力してください。')
      return
    }
    save.mutate({ displayName: name, bio: bio || null, handle: slug || null })
  }
  const error = validation || (save.error instanceof HttpError && save.error.status === 409 ? 'このハンドルは既に使用されています。' :
    save.isError ? 'プロフィールを保存できませんでした。もう一度お試しください。' : '')
  return <form onSubmit={submit} className="rounded-2xl border border-[#e2e7e2] bg-white p-4">
    <fieldset disabled={save.isPending} className="space-y-4">
      <label className="block text-sm font-bold">表示名
        <input className={fieldClass} required maxLength={50} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="block text-sm font-bold">自己紹介
        <textarea className={fieldClass} rows={4} maxLength={500} value={bio} onChange={(event) => setBio(event.target.value)} />
      </label>
      <label className="block text-sm font-bold">ハンドル（任意）
        <input className={fieldClass} autoCapitalize="none" maxLength={30} value={handle} onChange={(event) => setHandle(event.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-forest">プロフィールを保存しました。</p>}
      <button className="ui-action bg-forest px-5 text-sm font-bold text-white">{save.isPending ? '保存中…' : 'プロフィールを保存'}</button>
    </fieldset>
  </form>
}
