import { defineConfig } from 'drizzle-kit'

// Generation needs no credentials. Applying migrations uses a separate,
// explicitly configured administrative connection in scripts/migrate.ts.
export default defineConfig({
  dialect: 'postgresql', schema: './src/db/schema/index.ts', out: './drizzle',
  schemaFilter: ['public'], strict: true,
})
