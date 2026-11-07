import { useState } from 'react'
import { PageBack } from '../../components/PageBack'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { useContentPreference } from '../feed/useContentPreference'

export default function SettingsPage() {
  const { control } = useContentPreference()
  const auth = useAuth()
  const [signOutFailed, setSignOutFailed] = useState(false)
  async function signOut() {
    setSignOutFailed(false)
    try { await auth.signOut() } catch { setSignOutFailed(true) }
  }
  return <section className="space-y-5">
    <PageBack fallback="/me" />
    <h1 className="text-3xl font-bold">設定</h1>
    {control}
    <h2 className="text-xl font-bold">アカウント</h2>
    <GoogleAction />
    {auth.userId && !auth.isAnonymous && <button type="button" className="ui-action border border-forest px-4 text-sm font-bold text-forest"
      disabled={auth.status === 'signing-out'} onClick={() => void signOut()}>ログアウト</button>}
    {signOutFailed && <p role="alert" className="text-sm text-red-700">ログアウトできませんでした。もう一度お試しください。</p>}
  </section>
}
