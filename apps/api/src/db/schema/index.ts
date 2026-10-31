import { sql } from 'drizzle-orm'
import {
  boolean, check, index, integer, pgPolicy, pgRole, pgTable,
  primaryKey, text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core'
import { authUsers } from '../auth'

// Provisioned by scripts/sql/bootstrap.sql before applying migrations.
const apiRole = pgRole('book_bear_api').existing()
const apiAccess = () => pgPolicy('backend_access', {
  for: 'all', to: apiRole, using: sql`true`, withCheck: sql`true`,
})
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  .$onUpdate(() => sql`now()`)

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  handle: text('handle'),
  displayName: varchar('display_name', { length: 50 }).notNull().default('ゲスト'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('ux_profiles_handle').on(table.handle),
  check('profiles_display_name_nonempty', sql`length(btrim(${table.displayName})) > 0`),
  check('profiles_bio_length', sql`${table.bio} IS NULL OR char_length(${table.bio}) <= 500`),
  apiAccess(),
]).enableRLS()

export const books = pgTable('books', {
  id: uuid('id').primaryKey().defaultRandom(),
  isbn13: varchar('isbn13', { length: 13 }),
  title: text('title').notNull(), author: text('author'), publisher: text('publisher'),
  totalPages: integer('total_pages'), coverUrl: text('cover_url'),
  source: text('source', { enum: ['google_books', 'openbd', 'manual'] }).notNull(),
  sourceId: text('source_id'),
  createdByUserId: uuid('created_by_user_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('ux_books_isbn13').on(table.isbn13),
  check('books_title_nonempty', sql`length(btrim(${table.title})) > 0`),
  check('books_isbn13_format', sql`${table.isbn13} IS NULL OR ${table.isbn13} ~ '^97[89][0-9]{10}$'`),
  check('books_total_pages_positive', sql`${table.totalPages} IS NULL OR ${table.totalPages} > 0`),
  check('books_source_valid', sql`${table.source} IN ('google_books', 'openbd', 'manual')`),
  apiAccess(),
]).enableRLS()

export const userBooks = pgTable('user_books', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id),
  bookId: uuid('book_id').notNull().references(() => books.id),
  status: text('status', { enum: ['want_to_read', 'reading', 'completed'] }).notNull().default('want_to_read'),
  currentPage: integer('current_page'), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('ux_user_books_user_book').on(table.userId, table.bookId),
  check('user_books_status_valid', sql`${table.status} IN ('want_to_read', 'reading', 'completed')`),
  check('user_books_current_page_nonnegative', sql`${table.currentPage} IS NULL OR ${table.currentPage} >= 0`),
  apiAccess(),
]).enableRLS()

export const bookmarks = pgTable('bookmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userBookId: uuid('user_book_id').notNull().references(() => userBooks.id),
  pageNumber: integer('page_number'), content: text('content').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('private'),
  isSpoiler: boolean('is_spoiler').notNull().default(false),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  check('bookmarks_page_number_positive', sql`${table.pageNumber} IS NULL OR ${table.pageNumber} > 0`),
  check('bookmarks_content_length', sql`char_length(${table.content}) BETWEEN 1 AND 2000 AND ${table.content} !~ '^[[:space:]]*$'`),
  check('bookmarks_visibility_valid', sql`${table.visibility} IN ('public', 'private')`),
  index('idx_bookmarks_public_feed').on(table.createdAt.desc(), table.id.desc())
    .where(sql`${table.visibility} = 'public' AND ${table.deletedAt} IS NULL`),
  index('idx_bookmarks_flow').on(table.userBookId, table.createdAt.asc(), table.id.asc())
    .where(sql`${table.deletedAt} IS NULL`),
  apiAccess(),
]).enableRLS()

export const follows = pgTable('follows', {
  followerId: uuid('follower_id').notNull().references(() => profiles.id),
  followingId: uuid('following_id').notNull().references(() => profiles.id),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.followerId, table.followingId] }),
  check('follows_no_self_follow', sql`${table.followerId} <> ${table.followingId}`),
  index('idx_follows_following').on(table.followingId),
  apiAccess(),
]).enableRLS()

export const bookmarkLikes = pgTable('bookmark_likes', {
  userId: uuid('user_id').notNull().references(() => profiles.id),
  bookmarkId: uuid('bookmark_id').notNull().references(() => bookmarks.id),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.bookmarkId] }),
  index('idx_likes_bookmark').on(table.bookmarkId),
  apiAccess(),
]).enableRLS()

export const bookmarkReplies = pgTable('bookmark_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => profiles.id),
  bookmarkId: uuid('bookmark_id').notNull().references(() => bookmarks.id),
  content: text('content').notNull(), isSpoiler: boolean('is_spoiler').notNull().default(false),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  check('bookmark_replies_content_length', sql`char_length(${table.content}) BETWEEN 1 AND 1000 AND ${table.content} !~ '^[[:space:]]*$'`),
  index('idx_replies_bookmark_created').on(table.bookmarkId, table.createdAt.asc(), table.id.asc())
    .where(sql`${table.deletedAt} IS NULL`),
  apiAccess(),
]).enableRLS()

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  feedContentMode: text('feed_content_mode', { enum: ['all', 'tap'] }).notNull().default('tap'),
  updatedAt: updatedAt(),
}, (table) => [
  check('user_preferences_content_mode_valid', sql`${table.feedContentMode} IN ('all', 'tap')`),
  apiAccess(),
]).enableRLS()
