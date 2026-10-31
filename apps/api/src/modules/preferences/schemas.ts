import { z } from '@hono/zod-openapi'

export const FeedContentMode = z.enum(['all', 'tap'])
export const Preferences = z.object({ feedContentMode: FeedContentMode }).openapi('Preferences')
export const PatchPreferences = z.object({ feedContentMode: FeedContentMode })
  .strict().openapi('PatchPreferences')
