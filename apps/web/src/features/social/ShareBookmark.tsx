export function ShareBookmark({ bookmarkId, className }: { bookmarkId: string; className: string }) {
  const url = new URL(`/bookmarks/${bookmarkId}`, window.location.origin).href
  const intent = new URL('https://twitter.com/intent/tweet')
  intent.searchParams.set('url', url)
  return <a href={intent.href} target="_blank" rel="noopener noreferrer" className={className} aria-label="Xで共有" title="Xで共有">
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3m-4 4 4-4 4 4M6 11H4v9h16v-9h-2" />
    </svg>
  </a>
}
