import { pgSchema, uuid } from 'drizzle-orm/pg-core'

// Supabase owns auth.users. Reference its primary key, but never export this
// table from the schema entry point used by drizzle-kit (no Auth DDL).
export const authUsers = pgSchema('auth').table('users', { id: uuid('id').primaryKey() })
