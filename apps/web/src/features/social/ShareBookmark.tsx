import { useState } from 'react'

export function ShareBookmark({ bookmarkId }: { bookmarkId: string }) {
  const [copied, setCopied] = useState<boolean>()
  const url = new URL(`/bookmarks/${bookmarkId}`, window.location.origin).href
  const intent = new URL('https://twitter.com/intent/tweet')
  intent.searchParams.set('url', url)
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true) } catch { setCopied(false) }
  }

  return <div aria-label="栞を共有" role="group" className="flex flex-wrap items-center gap-3 text-sm">
    <button type="button" className="ui-action border border-forest px-3 font-bold text-forest" onClick={() => void copy()}>URLをコピー</button>
    <a href={intent.href} target="_blank" rel="noopener noreferrer" className="ui-action inline-flex border border-forest px-3 font-bold text-forest">Xで共有</a>
    {copied === true && <span role="status">URLをコピーしました。</span>}
    {copied === false && <label className="w-full text-red-700">URLをコピーできませんでした。以下のURLを選択してコピーしてください。
      <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-ink" readOnly value={url} onFocus={(event) => event.target.select()} />
    </label>}
  </div>
}
