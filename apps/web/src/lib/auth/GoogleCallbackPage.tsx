import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ErrorState, LoadingState } from '../../components/states/ScreenStates'
import { useAuth } from './AuthProvider'
import { GoogleAction } from './GoogleAction'
import { googleCallbackPath, takeGoogleAttempt } from './google'

type Result = { returnTo: string; userId?: string; error?: string }

export default function GoogleCallbackPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useAuth()
  const exchange = auth.exchangeGoogle
  const flight = useRef<Promise<Result> | null>(null)
  const [result, setResult] = useState<Result>()
  useEffect(() => {
    flight.current ??= Promise.resolve().then(async () => {
      const params = new URLSearchParams(location.search)
      const fragment = new URLSearchParams(location.hash.slice(1))
      // Remove codes and provider errors before any network requests or links.
      window.history.replaceState(window.history.state, '', googleCallbackPath)
      const attempt = takeGoogleAttempt()
      const returnTo = attempt?.returnTo ?? '/me'
      const providerError = params.get('error_code') ?? fragment.get('error_code') ?? params.get('error') ?? fragment.get('error')
      if (providerError) return { returnTo, error: providerError === 'identity_already_exists'
        ? 'このGoogleアカウントはすでに別のアカウントに連携されています。別のGoogleアカウントでお試しください。'
        : 'Google認証がキャンセルされたか、完了できませんでした。もう一度お試しください。' }
      const code = params.get('code')
      if (!attempt || !code) return { returnTo, error: 'Google認証を開始したタブで、もう一度お試しください。' }
      try { return { returnTo, userId: await exchange(code, attempt.flowId, attempt.linkedUserId) } }
      catch { return { returnTo, error: 'Google認証を完了できませんでした。もう一度お試しください。' } }
    })
    let active = true
    void flight.current.then((value) => { if (active) setResult(value) })
    return () => { active = false }
  }, [exchange, location.hash, location.search])

  const ready = !!result?.userId && auth.status === 'ready' && auth.userId === result.userId && !auth.isAnonymous
  useEffect(() => { if (ready && result) void navigate(result.returnTo, { replace: true }) }, [ready, result, navigate])

  return <section className="space-y-4">
    <h1 className="text-2xl font-bold">Google認証</h1>
    {result?.error ? <>
      <p role="alert" className="text-red-700">{result.error}</p>
      <GoogleAction returnTo={result.returnTo} />
      <Link className="ui-action inline-flex text-forest underline" to={result.returnTo} replace>アプリに戻る</Link>
    </> : result?.userId && auth.status === 'error' ?
      <ErrorState description="プロフィールの準備に失敗しました。" onRetry={() => void auth.retrySession().catch(() => {})} /> :
      <LoadingState label="ログインとプロフィールを確認しています…" />}
  </section>
}
