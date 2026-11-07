import { useState } from 'react'

export function BookCover({ src }: { src: string | null }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return src && src !== failedSource ? (
    <img key={src} src={src} alt="" loading="lazy" onError={() => setFailedSource(src)}
      className="h-28 w-20 shrink-0 rounded object-contain" />
  ) : (
    <span role="img" aria-label="書影なし" className="grid h-28 w-20 shrink-0 place-items-center rounded bg-mist text-3xl text-forest">▤</span>
  )
}
