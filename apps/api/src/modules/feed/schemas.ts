import { z } from '@hono/zod-openapi'
import { PaginationQuery } from '../../shared/schemas'

export const FeedQuery = PaginationQuery.extend({ scope: z.enum(['all', 'following']).default('all') })
