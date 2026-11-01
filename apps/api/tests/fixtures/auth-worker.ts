// Test-only entry point. JWKS HTTP transport is replaced, but the same jose
// signature/claims checks and pg/Hyperdrive handlers run inside real workerd.
// Production uses src/index.ts and never reads TEST_JWKS.
import { createApp } from '../../src/index'
import { createTokenVerifier, type AppEnv } from '../../src/middleware/auth'

export default {
  fetch(request: Request, env: AppEnv['Bindings'] & { TEST_JWKS: string }) {
    const verifyToken = createTokenVerifier(async () => Response.json(JSON.parse(env.TEST_JWKS)))
    return createApp({ verifyToken }).fetch(request, { ...env, SUPABASE_URL: 'https://book-bear-test.supabase.co' })
  },
}
