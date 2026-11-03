import { z } from '@hono/zod-openapi'
import { sql, type AnyColumn } from 'drizzle-orm'
import { ApiError } from './errors'
import { uuid } from './schemas'

const boundarySchema = z.object({
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine((value) => {
    const milliseconds = value.slice(0, 23) + 'Z'
    const date = new Date(milliseconds)
    return Number.isFinite(date.getTime()) && date.toISOString() === milliseconds
  }),
  id: uuid,
}).strict()
type Boundary = z.infer<typeof boundarySchema>

export function encodeCursor(boundary: Boundary) {
  return btoa(JSON.stringify(boundary)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decodeCursor(value?: string): Boundary | undefined {
  if (value === undefined) return
  try {
    if (value.length > 512 || !/^[\w-]+$/.test(value)) throw new Error()
    const boundary = boundarySchema.parse(JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))))
    if (encodeCursor(boundary) !== value) throw new Error()
    return boundary
  } catch { throw new ApiError(400, 'INVALID_CURSOR', 'カーソルを確認し、一覧を再取得してください') }
}
// pg's Date parser truncates microseconds. Keep the keyset boundary as SQL text.
export const preciseTimestamp = (column: AnyColumn) => sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
export function olderThan(createdAt: AnyColumn, id: AnyColumn, boundary?: Boundary) {
  return boundary ? sql`(${createdAt}, ${id}) < (${boundary.createdAt}::timestamptz, ${boundary.id}::uuid)` : undefined
}
export function newerThan(createdAt: AnyColumn, id: AnyColumn, boundary?: Boundary) {
  return boundary ? sql`(${createdAt}, ${id}) > (${boundary.createdAt}::timestamptz, ${boundary.id}::uuid)` : undefined
}
