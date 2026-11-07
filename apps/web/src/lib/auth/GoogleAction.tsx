import { useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from './AuthProvider'
import { googleCallbackPath, safeReturnTo, storeGoogleAttempt } from './google'

export function GoogleAction({ returnTo, placement = 'inline' }: { returnTo?: string; placement?: 'inline' | 'header' } = {}) {
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

  const inHeader = placement === 'header'
  return <div className={inHeader ? 'relative shrink-0' : 'space-y-2'}>
    <button type="button" className={`ui-action border px-4 font-bold text-forest ${inHeader
      ? 'rounded-full border-[#d6e0d5] text-xs hover:bg-mist' : 'border-forest text-sm'}`} disabled={pending}
      onClick={() => void start()}>{pending ? 'Googleに接続中…' : inHeader ? 'ログイン' : link ? 'Googleアカウントを連携' : 'Googleでログイン'}</button>
    {failed && <p role="alert" className={`text-sm text-red-700 ${inHeader
      ? 'absolute top-full right-0 z-40 mt-2 w-56 rounded-lg border border-[#e7e9e4] bg-white p-3 shadow-md' : ''}`}>
      Google認証を開始できませんでした。もう一度お試しください。
    </p>}
  </div>
}
