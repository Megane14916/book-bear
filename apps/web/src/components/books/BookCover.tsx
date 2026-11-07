import { useState } from 'react'

export function BookCover({ src, size = 'default' }: { src: string | null; size?: 'default' | 'small' | 'tiny' }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const dimensions = size === 'tiny' ? 'h-16 w-11' : size === 'small' ? 'h-20 w-14' : 'h-28 w-20'
  return src && src !== failedSource ? (
    <img key={src} src={src} alt="" loading="lazy" onError={() => setFailedSource(src)}
      className={`${dimensions} shrink-0 rounded object-contain`} />
  ) : (
    <span role="img" aria-label="書影なし" className={`grid ${dimensions} shrink-0 place-items-center rounded bg-mist ${size === 'default' ? 'text-3xl' : 'text-xl'} text-forest`}>▤</span>
  )
}
