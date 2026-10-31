import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'

const app = new OpenAPIHono<{ Bindings: { CORS_ORIGIN?: string } }>()

app.use('/api/*', (c, next) =>
  cors({ origin: c.env?.CORS_ORIGIN || 'http://localhost:5173' })(c, next),
)

const healthRoute = createRoute({
  method: 'get',
  path: '/api/v1/health',
  operationId: 'getHealth',
  responses: {
    200: {
      description: 'API is available',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
})

app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200))

export const openApiConfig = {
  openapi: '3.0.0',
  info: { title: 'Book Bear API', version: '0.1.0' },
}

export default app
