import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import { vi } from 'vitest'

export const supabaseUrl = 'https://book-bear-test.supabase.co'
export const issuer = `${supabaseUrl}/auth/v1`

export async function createSigningFixture(alg = 'ES256') {
  const { publicKey, privateKey } = await generateKeyPair(alg)
  const kid = randomUUID()
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid, alg, use: 'sig' }] }
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(jwks))
  const sign = (overrides: JWTPayload = {}, header: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({ iss: issuer, aud: 'authenticated', exp: now + 3600, iat: now,
      sub: randomUUID(), role: 'authenticated', is_anonymous: true, session_id: randomUUID(), ...overrides,
    }).setProtectedHeader({ alg, kid, ...header }).sign(privateKey)
  }
  return { sign, jwks, fetcher }
}
