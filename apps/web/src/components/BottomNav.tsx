import { useLayoutEffect, useRef, type MouseEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'

const navigation = [
  { path: '/', label: 'ホーム', icon: 'm3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6' },
  { path: '/search', label: '検索', icon: 'M16 16l4.5 4.5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z' },
  { path: '/create', label: '投稿', icon: 'M12 5v14 M5 12h14' },
  { path: '/library', label: '本棚', icon: 'M6 4v15 M10 4v15 M14 5l4-1 4 14-4 1z M3 20h19' },
  { path: '/me', label: 'マイページ', icon: 'M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const finishUpdate = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    // BrowserRouter may commit asynchronously. Capture the new view after the route renders.
    finishUpdate.current?.()
    finishUpdate.current = null
  }, [location.key])

  function transitionTo(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      location.pathname === path || !document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    event.preventDefault()
    const transition = document.startViewTransition(() => new Promise<void>((resolve) => {
      finishUpdate.current?.()
      finishUpdate.current = resolve
      void navigate(path)
    }))
    void transition.ready.catch(() => {})
  }

  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-10 h-[calc(var(--app-nav-height)+env(safe-area-inset-bottom))] border-t border-[#e2e7e2] bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-full max-w-[740px] grid-cols-5">
        {navigation.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={(event) => transitionTo(event, item.path)}
            className="group flex flex-col items-center justify-center gap-1 px-0.5 text-[#58685e] hover:text-forest focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest aria-[current=page]:font-bold aria-[current=page]:text-forest"
          >
            <span aria-hidden="true" className={`grid h-8 w-12 place-items-center rounded-full ${item.path === '/create'
              ? 'bg-forest text-white group-hover:bg-forest-dark group-aria-[current=page]:bg-forest-dark'
              : 'group-hover:bg-paper group-aria-[current=page]:bg-mist'}`}>
              <svg className="size-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
            </span>
            <span className="text-[10px]">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
