import { useLayoutEffect, useRef } from 'react'

export function useAutoGrowTextarea(content: string, enabled = true) {
  const textarea = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const input = textarea.current
    if (!enabled || !input) return
    const resize = () => {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [enabled, content])

  return textarea
}
