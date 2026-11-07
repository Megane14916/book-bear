import type { ComponentProps } from 'react'
import { BookmarkCard } from '../../components/bookmarks/BookmarkCard'
import { api } from '../../lib/api/client'
import { requestData } from '../../lib/api/result'
import { refreshBookmarkSocial, useSocialMutation } from './mutations'
import { SocialAction } from './SocialAction'

type Props = ComponentProps<typeof BookmarkCard>

export function SocialBookmarkCard(props: Props) {
  const { bookmark } = props
  return <BookmarkCard {...props}
    authorHref={props.variant === 'flow' ? undefined : props.authorHref ?? `/users/${props.bookmark.author.id}`}
    bookHref={props.variant === 'flow' ? undefined : props.bookHref ?? `/books/${props.bookmark.book.id}`}
    likeAction={bookmark.visibility === 'public' ? <LikeControl bookmarkId={bookmark.id} count={bookmark.likeCount} liked={bookmark.likedByMe} /> : undefined} />
}

function LikeControl({ bookmarkId, count, liked }: { bookmarkId: string; count: number; liked: boolean }) {
  const change = useSocialMutation(['like', bookmarkId], (remove: boolean, signal) => {
    const params = { path: { bookmarkId } }
    return requestData(() => remove ? api.DELETE('/api/v1/bookmarks/{bookmarkId}/like', { params, signal }) :
      api.PUT('/api/v1/bookmarks/{bookmarkId}/like', { params, signal }))
  }, (client) => refreshBookmarkSocial(client, bookmarkId))
  return <SocialAction label={liked ? `いいねを解除（${count}）` : `いいね（${count}）`} pressed={liked} pending={change.pending}
    error={change.error} onClick={() => change.mutate(liked)} />
}
