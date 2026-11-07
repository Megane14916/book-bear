// Keys contain data identity, never JWTs. null consistently represents a guest.
// On auth changes, #36 must cancel requests and clear viewer-dependent caches,
// including same-UID anonymous -> registered transitions.
export const queryKeys = {
  health: () => ['health'] as const,
  bookSearch: (q: string, limit = 20) => ['books', 'search', { q: q.trim(), limit }] as const,
  book: (bookId: string) => ['books', 'detail', bookId] as const,
  bookmark: (bookmarkId: string, viewerId: string | null) => ['bookmarks', 'detail', bookmarkId, viewerId] as const,
  myBookmarks: (viewerId: string) => ['my-bookmarks', viewerId] as const,
  myBooks: (viewerId: string, limit = 15, selection?: { sort?: string; status?: string }) =>
    ['my-books', viewerId, { limit }, ...(selection ? [selection] : [])] as const,
  me: (viewerId: string | null) => ['me', viewerId] as const,
  publicProfile: (userId: string, viewerId: string | null) => ['public-profile', userId, viewerId] as const,
  publicBooks: (userId: string, limit = 15) => ['public-books', userId, { limit }] as const,
  feed: (scope: 'all' | 'following', viewerId: string | null, limit = 15) =>
    ['feed', scope, viewerId, { limit }] as const,
  bookmarkFlow: (userId: string, bookId: string, viewerId: string | null, limit = 15) =>
    ['bookmark-flow', userId, bookId, viewerId, { limit }] as const,
  searchPosts: (q: string, viewerId: string | null, limit = 15) =>
    ['search-posts', viewerId, { q: q.trim(), limit }] as const,
  searchUsers: (q: string, limit = 30) => ['search-users', { q: q.trim(), limit }] as const,
}

// Future infinite queries use these list keys and pass opaque cursors through
// pageParam unchanged. A non-infinite variant needs a distinct key suffix.
// Content display mode only changes rendering and does not belong in feed keys.
