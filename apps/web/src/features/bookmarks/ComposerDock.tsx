import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Keep controls above the visual viewport's keyboard edge. ResizeObserver
 * reserves their actual height so the last form field can scroll clear. */
export function ComposerDock({ children }: { children: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(220)
  const [bottom, setBottom] = useState<number | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    let largestHeight = window.innerHeight
    let previousBottom = window.innerHeight
    let frame = 0
    const update = (event?: Event) => {
      const focused = document.activeElement?.matches('textarea, input:not([type=checkbox])')
      largestHeight = Math.max(largestHeight, window.innerHeight)
      const visibleBottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0)
      const keyboard = focused && largestHeight - (viewport?.height ?? window.innerHeight) > 120
      const nav = document.querySelector('nav[aria-label="メインメニュー"]')?.getBoundingClientRect()
      // Some browsers resize the layout viewport (including the navigation),
      // others only shrink visualViewport. Respect either navigation position.
      const navigationVisible = nav && nav.bottom <= visibleBottom + 1
      setBottom(keyboard ? Math.max(window.innerHeight - visibleBottom + 8,
        navigationVisible ? window.innerHeight - nav.top + 8 : 0) : null)
      const active = document.activeElement
      const availableBottom = keyboard ? visibleBottom - (dock.current?.getBoundingClientRect().height ?? 0) - 8
        : dock.current?.getBoundingClientRect().top ?? visibleBottom
      if (focused && (event?.type === 'focusin' || (keyboard && previousBottom !== visibleBottom)) && active instanceof HTMLElement
        && active.getBoundingClientRect().bottom > availableBottom) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => active.scrollIntoView({ block: 'start', behavior: 'auto' }))
      }
      previousBottom = visibleBottom
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (dock.current) setHeight(dock.current.getBoundingClientRect().height)
    })
    if (dock.current) {
      setHeight(dock.current.getBoundingClientRect().height)
      observer?.observe(dock.current)
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return <>
    <div aria-hidden="true" style={{ height }} />
    <div ref={dock} role="group" aria-label="投稿操作" style={bottom === null ? undefined : { bottom }}
      className="fixed inset-x-0 bottom-[calc(78px+env(safe-area-inset-bottom))] z-20 mx-auto max-w-[740px] rounded-t-2xl border border-[#d6ded6] bg-white px-3 py-2 shadow-lg">
      {children}
    </div>
  </>
}
