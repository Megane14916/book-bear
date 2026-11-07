export const googleCallbackPath = '/auth/callback'
const attemptKey = 'book-bear:google-attempt'

export function safeReturnTo(value: unknown, origin = window.location.origin): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/me'
  try {
    const target = new URL(value, origin)
    if (target.origin === origin && !target.pathname.startsWith('//') && !/^\/auth\/callback\/*$/i.test(target.pathname)) {
      return target.pathname + target.search + target.hash
    }
  } catch { /* Invalid URL. */ }
  return '/me'
}

export function storeGoogleAttempt(attempt: { flowId: string; linkedUserId: string | null; returnTo: string }) {
  sessionStorage.setItem(attemptKey, JSON.stringify(attempt))
}

export function takeGoogleAttempt() {
  try {
    const raw = sessionStorage.getItem(attemptKey)
    sessionStorage.removeItem(attemptKey)
    const value = JSON.parse(raw ?? 'null') as { flowId?: unknown; linkedUserId?: unknown; returnTo?: unknown } | null
    if (typeof value?.flowId === 'string' && (value.linkedUserId === null || typeof value.linkedUserId === 'string')) {
      return { flowId: value.flowId, linkedUserId: value.linkedUserId, returnTo: safeReturnTo(value.returnTo) }
    }
  } catch { /* A disabled or invalid storage entry cannot resume the flow. */ }
  return null
}
