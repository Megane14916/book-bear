import { useLayoutEffect } from 'react'
import { Route, Routes, Link, matchPath, useLocation } from 'react-router'
import BottomNav from './components/BottomNav'
import bearPaw from './assets/bear-paw.svg'
import BookSearchPage from './pages/BookSearchPage'
import BookDetailPage from './pages/BookDetailPage'
import ManualBookPage from './pages/ManualBookPage'
import HomePage from './pages/HomePage'
import NotFoundPage from './pages/NotFoundPage'
import LibraryPage from './features/library/LibraryPage'
import BookmarkCreatePage from './features/bookmarks/BookmarkCreatePage'
import BookmarkDetailPage from './features/bookmarks/BookmarkDetailPage'
import BookmarkFlowPage from './features/bookmark-flow/BookmarkFlowPage'
import MyProfilePage, { EditProfilePage } from './features/profile/MyProfilePage'
import PublicProfilePage from './features/profile/PublicProfilePage'
import SettingsPage from './features/profile/SettingsPage'
import GoogleCallbackPage from './lib/auth/GoogleCallbackPage'
import { GoogleAction } from './lib/auth/GoogleAction'
import { googleCallbackPath } from './lib/auth/google'
import RelationshipsPage from './features/social/RelationshipsPage'

export default function App() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const isTimelinePage = isHome || !!matchPath('/bookmarks/:bookmarkId', pathname)
  const isProfilePage = pathname === '/me' || !!matchPath('/users/:userId', pathname)
  const isViewportPage = isTimelinePage || pathname === '/search' || pathname === '/library' || isProfilePage
  useLayoutEffect(() => {
    if (isHome && (window.scrollY || window.scrollX)) window.scrollTo(0, 0)
  }, [isHome])
  return (
    <div data-home={isHome ? '' : undefined}
      className={`text-ink ${isHome ? 'h-dvh overflow-clip' : 'min-h-screen'} ${isTimelinePage ? 'bg-white' : 'bg-paper'}`}>
      <header className="h-(--app-header-height) border-b border-[#e7e9e4] bg-white">
        <div className="mx-auto flex h-full max-w-[740px] items-center justify-between gap-3 px-4 sm:px-5">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
            aria-label="Book Bear ホーム"
          >
            <img src={bearPaw} alt="" aria-hidden="true" className="size-6 shrink-0" />
            <span className="brand-wordmark text-xl leading-none font-semibold tracking-[0.04em] text-[#493326]">Book Bear</span>
          </Link>
          <GoogleAction placement="header" />
        </div>
      </header>

      <main id="main-content" className={isViewportPage
        ? 'mx-auto h-[calc(100dvh-var(--app-header-height)-var(--app-nav-height)-env(safe-area-inset-bottom))] w-full max-w-[740px]'
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
          <Route path="/me/edit" element={<EditProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path={googleCallbackPath} element={<GoogleCallbackPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <BottomNav />
    </div>
  )
}
