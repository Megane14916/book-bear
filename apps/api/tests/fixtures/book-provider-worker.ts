// Replace only the provider destination. Real workerd fetch must validate init.
// Production never reads TEST_PROVIDER_URL or uses this entry point.
import { createBookProvider } from '../../src/integrations/books'
import { ApiError } from '../../src/shared/errors'

export default {
  async fetch(request: Request, env: { TEST_PROVIDER_URL: string }) {
    const provider = createBookProvider((input, init) => {
      const original = new URL(String(input)), target = new URL(original.pathname + original.search, env.TEST_PROVIDER_URL)
      return fetch(target, init)
    }, 'test-key')
    try {
      const action = new URL(request.url).pathname
      const result = action === '/google' ? await provider.find('google_books', 'volume-1')
        : action === '/openbd' ? await provider.find('openbd', '9784780802047') : await provider.search('本', 20)
      return Response.json(result)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    }
  },
}
