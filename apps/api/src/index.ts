import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { plannedRoutes } from './contracts/routes'

const app = new OpenAPIHono<{ Bindings: { CORS_ORIGIN?: string } }>()

app.use('/api/*', (c, next) =>
  cors({ origin: c.env?.CORS_ORIGIN || 'http://localhost:5173' })(c, next),
)

const healthRoute = createRoute({
  method: 'get',
  path: '/api/v1/health',
  operationId: 'getHealth',
  'x-implementation-status': 'implemented',
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
  info: {
    title: 'Book Bear API', version: '0.1.0',
    description: 'Hono/Zodから生成するAPI契約。x-implementation-status=plannedは設計済み・未実装で、実APIには未登録。implementedのみ稼働済み。',
  },
}

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
  description: 'Supabase Auth access token。署名・issuer・audience・expを検証し、subとis_anonymousで認可。契約定義のみでJWT検証実装は未提供。',
})
for (const route of plannedRoutes) app.openAPIRegistry.registerPath(route)

app.doc('/openapi.json', openApiConfig)

export default app
