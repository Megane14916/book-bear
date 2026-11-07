import type { AuthState } from './controller'

export function canReadPublic(status: AuthState['status']) {
  return status === 'ready' || status === 'guest' || status === 'unconfigured'
}
