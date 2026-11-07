import type { ComponentProps } from 'react'
import { Link, useLocation } from 'react-router'
import { BookmarkCard } from '../../components/bookmarks/BookmarkCard'
import { HeartIcon, ReplyIcon } from '../../components/bookmarks/ReactionIcons'
import { api } from '../../lib/api/client'
import { requestData } from '../../lib/api/result'
import { refreshBookmarkSocial, useSocialMutation } from './mutations'
import { SocialAction } from './SocialAction'

type Props = ComponentProps<typeof BookmarkCard>
const reactionClass = 'ui-action inline-flex min-w-11 gap-1.5 px-2 text-sm font-medium hover:bg-mist hover:text-forest'

export function SocialBookmarkCard(props: Props) {
  const { bookmark } = props
  const { pathname } = useLocation()
  const detailPath = `/bookmarks/${bookmark.id}`
  const isPublic = bookmark.visibility === 'public'
  return <BookmarkCard {...props}
    authorHref={props.variant === 'flow' ? undefined : props.authorHref ?? `/users/${props.bookmark.author.id}`}
    bookHref={props.variant === 'flow' ? undefined : props.bookHref ?? `/books/${props.bookmark.book.id}`}
    likeAction={isPublic ? <LikeControl bookmarkId={bookmark.id} count={bookmark.likeCount} liked={bookmark.likedByMe} /> : undefined}
    replyAction={isPublic ? <Link to={`${detailPath}#replies`} replace={pathname === detailPath} className={reactionClass}
      aria-label={`返信（${bookmark.replyCount}）`}><ReplyIcon />{bookmark.replyCount}</Link> : undefined} />
}

function LikeControl({ bookmarkId, count, liked }: { bookmarkId: string; count: number; liked: boolean }) {
  const change = useSocialMutation(['like', bookmarkId], (remove: boolean, signal) => {
    const params = { path: { bookmarkId } }
    return requestData(() => remove ? api.DELETE('/api/v1/bookmarks/{bookmarkId}/like', { params, signal }) :
      api.PUT('/api/v1/bookmarks/{bookmarkId}/like', { params, signal }))
  }, (client) => refreshBookmarkSocial(client, bookmarkId))
  return <SocialAction label={liked ? `いいねを解除（${count}）` : `いいね（${count}）`} pressed={liked} pending={change.pending}
    error={change.error} onClick={() => change.mutate(liked)} className={`${reactionClass} aria-pressed:text-forest`}>
    <HeartIcon filled={liked} />{count}
  </SocialAction>
}
