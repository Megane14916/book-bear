import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from 'react'

export function ScrollableTabs<Value extends string>({ tabs, value, onChange, label, scrollLabel, panelClassName, children }: {
  tabs: readonly { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
  label: string
  scrollLabel: string
  panelClassName: string
  children: ReactNode
}) {
  const id = useId()
  const scrollArea = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)
  const [hidden, setHidden] = useState(false)

  function updateTabs({ currentTarget }: UIEvent<HTMLDivElement>) {
    const top = Math.max(0, currentTarget.scrollTop)
    const delta = top - lastScrollTop.current
    if (top > 0 && Math.abs(delta) < 8) return
    setHidden(top > 0 && delta > 0)
    lastScrollTop.current = top
  }

  function selectTab(next: Value) {
    onChange(next)
    setHidden(false)
    lastScrollTop.current = 0
    if (scrollArea.current) scrollArea.current.scrollTop = 0
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowLeft': nextIndex = (index + tabs.length - 1) % tabs.length; break
      case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = tabs.length - 1; break
      default: return
    }
    event.preventDefault()
    selectTab(tabs[nextIndex].value)
    event.currentTarget.parentElement?.querySelectorAll('button')[nextIndex]?.focus()
  }

  return <div ref={scrollArea} role="region" aria-label={scrollLabel} tabIndex={0} onScroll={updateTabs}
    className="h-full overflow-y-auto overscroll-y-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest">
    <div className={`sticky top-0 z-20 border-b border-[#e2e7e2] bg-white/95 backdrop-blur-sm motion-safe:transition-transform has-[:focus-visible]:translate-y-0 ${hidden ? '-translate-y-full' : ''}`}>
      <div role="tablist" aria-label={label} className="grid auto-cols-fr grid-flow-col">
        {tabs.map((tab, index) => <button key={tab.value} id={`${id}-tab-${tab.value}`} type="button" role="tab"
          aria-selected={value === tab.value} aria-controls={`${id}-panel`} tabIndex={value === tab.value ? 0 : -1}
          className="ui-action group grid min-h-13 place-items-center rounded-none p-0 text-sm font-medium text-[#526356] hover:bg-forest/5 focus-visible:-outline-offset-2 aria-selected:font-bold aria-selected:text-ink"
          onClick={() => selectTab(tab.value)} onKeyDown={(event) => onTabKeyDown(event, index)}>
          <span className="relative grid h-full items-center after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:rounded-full group-aria-selected:after:bg-forest">{tab.label}</span>
        </button>)}
      </div>
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`} className={panelClassName}>
      {children}
    </div>
  </div>
}
