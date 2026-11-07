import { useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from './AuthProvider'
import { googleCallbackPath, safeReturnTo, storeGoogleAttempt } from './google'

export function GoogleAction({ returnTo }: { returnTo?: string } = {}) {
  const auth = useAuth()
  const location = useLocation()
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const link = auth.status === 'ready' && auth.isAnonymous
  if (!link && auth.status !== 'guest') return null

  async function start() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setFailed(false)
    try {
      const { url, flowId, linkedUserId } = await auth.startGoogle(new URL(googleCallbackPath, window.location.origin).href)
      storeGoogleAttempt({ flowId, linkedUserId, returnTo: safeReturnTo(returnTo ?? location.pathname + location.search + location.hash) })
      window.location.assign(url)
    } catch {
      busy.current = false
      setPending(false)
      setFailed(true)
    }
  }

  return <div className="space-y-2">
    <button type="button" className="ui-action border border-forest px-4 text-sm font-bold text-forest" disabled={pending}
      onClick={() => void start()}>{pending ? 'Googleに接続中…' : link ? 'Googleアカウントを連携' : 'Googleでログイン'}</button>
    {failed && <p role="alert" className="text-sm text-red-700">Google認証を開始できませんでした。もう一度お試しください。</p>}
  </div>
}
