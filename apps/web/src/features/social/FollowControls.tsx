import { Link } from 'react-router'
import { api } from '../../lib/api/client'
import type { components } from '../../lib/api/generated'
import { requestData } from '../../lib/api/result'
import { useAuth } from '../../lib/auth/AuthProvider'
import { SocialAction } from './SocialAction'
import { useSocialMutation } from './mutations'

export function FollowControls({ profile }: { profile: components['schemas']['PublicProfile'] }) {
  const auth = useAuth()
  const { id: userId, followedByMe, followersCount, followingCount } = profile
  const change = useSocialMutation(['follow', userId], (remove: boolean, signal) => {
    const params = { path: { userId } }
    return requestData(() => remove ? api.DELETE('/api/v1/users/{userId}/follow', { params, signal }) :
      api.PUT('/api/v1/users/{userId}/follow', { params, signal }))
  }, (client) => client.invalidateQueries({ predicate: ({ queryKey: [group, target] }) =>
    group === 'relationships' || (group === 'feed' && target === 'following') ||
    (group === 'public-profile' && (target === userId || target === auth.userId)) || (group === 'me' && target === auth.userId),
  }))
  return <div className="space-y-2 text-sm">
    <div className="flex flex-wrap gap-3">
      <Link className="ui-action inline-flex text-forest underline" to={`/users/${userId}/followers`}>フォロワー {followersCount}人</Link>
      <Link className="ui-action inline-flex text-forest underline" to={`/users/${userId}/following`}>フォロー中 {followingCount}人</Link>
    </div>
    {auth.userId !== userId && <SocialAction label={followedByMe ? 'フォロー解除' : 'フォローする'} pressed={followedByMe}
      pending={change.pending} error={change.error} onClick={() => change.mutate(followedByMe)} />}
  </div>
}
