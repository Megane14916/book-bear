import { NavLink } from 'react-router'

const navigation = [
  { path: '/', label: 'ホーム', symbol: '⌂' },
  { path: '/search', label: '検索', symbol: '⌕' },
  { path: '/create', label: '投稿', symbol: '＋' },
  { path: '/library', label: '本棚', symbol: '▤' },
  { path: '/me', label: 'マイページ', symbol: '◯' },
]

export default function BottomNav() {
  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-[#e2e7e2] bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-[740px] grid-cols-5">
        {navigation.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              [
                'flex min-h-[70px] flex-col items-center justify-center gap-1 px-0.5 py-2.5',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest',
                isActive ? 'font-extrabold text-forest' : 'text-[#929b93] hover:bg-[#f1f5f0]',
              ].join(' ')
            }
          >
            <span aria-hidden="true" className="text-[25px] leading-none">{item.symbol}</span>
            <span className="text-[10px]">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
