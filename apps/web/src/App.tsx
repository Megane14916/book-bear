import { Route, Routes, Link, useLocation } from 'react-router'
import BottomNav from './components/BottomNav'
import BookSearchPage from './pages/BookSearchPage'
import BookDetailPage from './pages/BookDetailPage'
import ManualBookPage from './pages/ManualBookPage'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'
import LibraryPage from './features/library/LibraryPage'
import BookmarkCreatePage from './features/bookmarks/BookmarkCreatePage'
import BookmarkDetailPage from './features/bookmarks/BookmarkDetailPage'
import BookmarkFlowPage from './features/bookmark-flow/BookmarkFlowPage'
import MyProfilePage from './features/profile/MyProfilePage'
import PublicProfilePage from './features/profile/PublicProfilePage'
import SettingsPage from './features/profile/SettingsPage'
import GoogleCallbackPage from './lib/auth/GoogleCallbackPage'
import { googleCallbackPath } from './lib/auth/google'
import RelationshipsPage from './features/social/RelationshipsPage'

export default function App() {
  const { pathname } = useLocation()
  const isViewportPage = pathname === '/' || pathname === '/search'
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

      <main id="main-content" className={isViewportPage
        ? 'mx-auto h-[calc(100dvh-138px-env(safe-area-inset-bottom))] w-full max-w-[740px]'
        : 'mx-auto w-full max-w-[740px] px-5 pt-8 pb-32 md:pt-12'}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/search"
            element={<BookSearchPage />}
          />
          <Route path="/books/manual" element={<ManualBookPage />} />
          <Route path="/books/:bookId" element={<BookDetailPage />} />
          <Route
            path="/create"
            element={<BookmarkCreatePage />}
          />
          <Route path="/bookmarks/:bookmarkId" element={<BookmarkDetailPage />} />
          <Route path="/bookmarks/:bookmarkId/edit" element={<BookmarkDetailPage edit />} />
          <Route path="/users/:userId/books/:bookId/bookmarks" element={<BookmarkFlowPage />} />
          <Route path="/users/:userId" element={<PublicProfilePage />} />
          <Route path="/users/:userId/followers" element={<RelationshipsPage kind="followers" />} />
          <Route path="/users/:userId/following" element={<RelationshipsPage kind="following" />} />
          <Route
            path="/library"
            element={<LibraryPage />}
          />
          <Route path="/me" element={<MyProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path={googleCallbackPath} element={<GoogleCallbackPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <BottomNav />
    </div>
  )
}
