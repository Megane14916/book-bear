import type { ReactElement } from 'react'

export function LoadingState({ variant = 'initial', label }: { variant?: 'initial' | 'more'; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="min-w-0 py-4">
      <p className="text-center text-sm text-[#526356]">{label ?? (variant === 'initial' ? '読み込み中…' : 'さらに読み込み中…')}</p>
      {variant === 'initial' && <div aria-hidden="true" className="mt-4 space-y-3 motion-safe:animate-pulse">
        {[0, 1].map((index) => <div key={index} className="flex gap-4 rounded-2xl border border-[#e2e7e2] bg-white p-4">
          <div className="h-28 w-20 shrink-0 rounded bg-mist" />
          <div className="min-w-0 flex-1 space-y-3 py-2"><div className="h-4 rounded bg-mist" /><div className="h-4 w-2/3 rounded bg-mist" /></div>
        </div>)}
      </div>}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action: ReactElement }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-[#e2e7e2] bg-white p-6 text-center [overflow-wrap:anywhere]">
      <p className="font-bold">{title}</p>
      <p className="mt-2 text-sm leading-7 text-[#526356]">{description}</p>
      <div className="mt-4">{action}</div>
    </section>
  )
}

export function ErrorState({ title = '読み込めませんでした', description, onRetry, isRetrying = false }: {
  title?: string; description: string; onRetry: () => void; isRetrying?: boolean
}) {
  return (
    <div role="alert" className="min-w-0 rounded-2xl border border-[#e2e7e2] bg-white p-6 text-center [overflow-wrap:anywhere]">
      <p className="font-bold">{title}</p>
      <p className="mt-2 text-sm leading-7 text-[#526356]">{description}</p>
      <button type="button" className="ui-action mt-4 border border-forest px-5 text-sm font-bold text-forest"
        onClick={onRetry} disabled={isRetrying}>{isRetrying ? '再試行中…' : 'もう一度試す'}</button>
    </div>
  )
}
