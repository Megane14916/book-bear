import { useNavigate } from 'react-router'

export function PageBack({ fallback }: { fallback: string }) {
  const navigate = useNavigate()
  function goBack() {
    // BrowserRouter starts its own history index at zero on a direct visit.
    if (window.history.state?.idx > 0) void navigate(-1)
    else void navigate(fallback, { replace: true })
  }
  return <button type="button" className="ui-action inline-flex gap-2 px-3 text-sm font-bold text-forest hover:bg-mist" onClick={goBack}>
    <span aria-hidden="true">←</span>戻る
  </button>
}
