export function HeartIcon({ filled = false }: { filled?: boolean }) {
  return <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
    <path d="M12 20.5 4.6 13.1a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5L12 20.5Z" />
  </svg>
}

export function ReplyIcon() {
  return <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
    <path d="M6 5h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 3v-3a3 3 0 0 1-2-3V8a3 3 0 0 1 3-3Z" />
  </svg>
}
