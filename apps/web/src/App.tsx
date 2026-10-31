import { Route, Routes, Link } from 'react-router'
import BottomNav from './components/BottomNav'
import HomePage from './pages/HomePage'
import PlaceholderPage from './pages/PlaceholderPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex h-[68px] items-center gap-2.5 border-b border-[#e7e9e4] bg-white px-6">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
          aria-label="Book Bear ホーム"
        >
          <span className="-rotate-12 text-[22px] text-forest" aria-hidden="true">▮</span>
          <span className="text-lg font-extrabold tracking-wide">Book Bear</span>
        </Link>
        <span className="ml-auto text-[11px] text-[#89938b]">読書の足あと</span>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[740px] px-5 pt-8 pb-32 md:pt-12">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/search"
            element={<PlaceholderPage title="本を探す" description="書名やISBNから本を探す画面を、次に実装します。" />}
          />
          <Route
            path="/create"
            element={<PlaceholderPage title="栞を残す" description="読んだページや感想を記録する投稿画面を、これから作ります。" />}
          />
          <Route
            path="/library"
            element={<PlaceholderPage title="自分の本棚" description="登録した本や読書の進み具合を、ここで確認できるようにします。" />}
          />
          <Route
            path="/me"
            element={<PlaceholderPage title="マイページ" description="プロフィールと、これまでに残した栞を表示する予定です。" />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <BottomNav />
    </div>
  )
}
