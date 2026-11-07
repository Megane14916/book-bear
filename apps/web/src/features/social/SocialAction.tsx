import { useState } from 'react'
import { useAuth } from '../../lib/auth/AuthProvider'
import { GoogleAction } from '../../lib/auth/GoogleAction'
import { socialError } from './mutations'

export function SocialAction({ label, pressed, pending, error, onClick }: {
  label: string; pressed: boolean; pending: boolean; error: unknown; onClick: () => void
}) {
  const auth = useAuth()
  const [prompt, setPrompt] = useState(false)
  const registered = auth.status === 'ready' && !auth.isAnonymous
  return <div className="space-y-2">
    <button type="button" aria-pressed={pressed} disabled={pending || ['loading', 'preparing', 'signing-out'].includes(auth.status)}
      className="ui-action border border-forest px-3 font-bold text-forest" onClick={() => registered ? onClick() : setPrompt(true)}>{label}</button>
    {prompt && !registered && <div className="space-y-2">
      <p role="status" className="text-sm">この操作にはGoogleでの登録とログインが必要です。</p>
      <GoogleAction />
    </div>}
    {Boolean(error) && <p role="alert" className="text-sm text-red-700">{socialError(error)}</p>}
  </div>
}
