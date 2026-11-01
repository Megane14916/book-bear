import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTPayload } from 'jose'
import type { DatabaseBindings } from '../db/client'
import { ApiError, authUnavailable, unauthorized } from '../shared/errors'
import { uuid } from '../shared/schemas'

export type Identity = { id: string; isAnonymous: boolean }
export type AuthBindings = { SUPABASE_URL?: string }
export type AppEnv = {
  Bindings: DatabaseBindings & AuthBindings & { CORS_ORIGIN?: string }
  Variables: { identity: Identity | undefined }
}
export type TokenVerifier = (token: string, env: AuthBindings) => Promise<Identity>

// Only deployment configuration chooses the issuer and JWKS endpoint. JWT
// headers (including jku/x5u) and unverified payloads never choose a URL.
export function supabaseIssuer(value: string | undefined): string {
  try {
    const url = new URL(value ?? '')
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error()
    return `${url.origin}/auth/v1`
  } catch { throw authUnavailable() }
}

function identityFromClaims(payload: JWTPayload): Identity {
  const subject = uuid.safeParse(payload.sub)
  if (!subject.success || payload.role !== 'authenticated' || typeof payload.is_anonymous !== 'boolean'
    || !uuid.safeParse(payload.session_id).success || typeof payload.iat !== 'number'
    || payload.iat > Date.now() / 1000 + 5) throw unauthorized()
  return { id: subject.data, isAnonymous: payload.is_anonymous }
}

export function createTokenVerifier(fetcher?: typeof fetch): TokenVerifier {
  // A bounded cache per app instance; key rotation is handled by jose. An
  // unknown kid triggers refresh after the cooldown, never a static key pin.
  let cached: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined
  return async (token, env) => {
    const issuer = supabaseIssuer(env.SUPABASE_URL)
    if (cached?.issuer !== issuer) {
      cached = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30_000, timeoutDuration: 5000,
        ...(fetcher ? { [customFetch]: fetcher } : {}),
      }) }
    }
    const keys = cached.keys
    try {
      const { payload } = await jwtVerify(token, async (header, jwt) => {
        try { return await keys(header, jwt) } catch (error) {
          if (error instanceof errors.JWKSNoMatchingKey) throw error
          throw authUnavailable()
        }
      }, {
        issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'role', 'is_anonymous', 'session_id'],
      })
      return identityFromClaims(payload)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw unauthorized()
    }
  }
}

export function authentication(verify: TokenVerifier) {
  const middleware = (required: boolean) => createMiddleware<AppEnv>(async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const header = c.req.header('Authorization')
    if (header === undefined) {
      if (required) throw unauthorized()
      c.set('identity', undefined)
    } else {
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)
      if (!match || match[1].length > 16384) throw unauthorized()
      c.set('identity', await verify(match[1], c.env ?? {}))
    }
    await next()
  })
  return { required: middleware(true), optional: middleware(false) }
}

// Reuse for later public posting/social APIs. Missing claims cannot accidentally
// promote an anonymous user; identity has already passed strict verification.
export const requireRegistered = createMiddleware<AppEnv>(async (c, next) => {
  const identity = c.get('identity')
  if (!identity) throw unauthorized()
  if (identity.isAnonymous) throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
  await next()
})
