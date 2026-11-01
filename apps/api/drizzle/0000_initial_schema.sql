CREATE TABLE "bookmark_likes" (
	"user_id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmark_likes_user_id_bookmark_id_pk" PRIMARY KEY("user_id","bookmark_id")
);
--> statement-breakpoint
ALTER TABLE "bookmark_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookmark_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bookmark_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_spoiler" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bookmark_replies_content_length" CHECK (char_length("bookmark_replies"."content") BETWEEN 1 AND 1000 AND "bookmark_replies"."content" !~ '^[[:space:]]*$')
);
--> statement-breakpoint
ALTER TABLE "bookmark_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_book_id" uuid NOT NULL,
	"page_number" integer,
	"content" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"is_spoiler" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bookmarks_page_number_positive" CHECK ("bookmarks"."page_number" IS NULL OR "bookmarks"."page_number" > 0),
	CONSTRAINT "bookmarks_content_length" CHECK (char_length("bookmarks"."content") BETWEEN 1 AND 2000 AND "bookmarks"."content" !~ '^[[:space:]]*$'),
	CONSTRAINT "bookmarks_visibility_valid" CHECK ("bookmarks"."visibility" IN ('public', 'private'))
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isbn13" varchar(13),
	"title" text NOT NULL,
	"author" text,
	"publisher" text,
	"total_pages" integer,
	"cover_url" text,
	"source" text NOT NULL,
	"source_id" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_title_nonempty" CHECK (length(btrim("books"."title")) > 0),
	CONSTRAINT "books_isbn13_format" CHECK ("books"."isbn13" IS NULL OR "books"."isbn13" ~ '^97[89][0-9]{10}$'),
	CONSTRAINT "books_total_pages_positive" CHECK ("books"."total_pages" IS NULL OR "books"."total_pages" > 0),
	CONSTRAINT "books_source_valid" CHECK ("books"."source" IN ('google_books', 'openbd', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id"),
	CONSTRAINT "follows_no_self_follow" CHECK ("follows"."follower_id" <> "follows"."following_id")
);
--> statement-breakpoint
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handle" text,
	"display_name" varchar(50) DEFAULT 'ゲスト' NOT NULL,
	"bio" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_display_name_nonempty" CHECK (length(btrim("profiles"."display_name")) > 0),
	CONSTRAINT "profiles_bio_length" CHECK ("profiles"."bio" IS NULL OR char_length("profiles"."bio") <= 500)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"status" text DEFAULT 'want_to_read' NOT NULL,
	"current_page" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_books_status_valid" CHECK ("user_books"."status" IN ('want_to_read', 'reading', 'completed')),
	CONSTRAINT "user_books_current_page_nonnegative" CHECK ("user_books"."current_page" IS NULL OR "user_books"."current_page" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"feed_content_mode" text DEFAULT 'tap' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_content_mode_valid" CHECK ("user_preferences"."feed_content_mode" IN ('all', 'tap'))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bookmark_likes" ADD CONSTRAINT "bookmark_likes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmark_likes" ADD CONSTRAINT "bookmark_likes_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmark_replies" ADD CONSTRAINT "bookmark_replies_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmark_replies" ADD CONSTRAINT "bookmark_replies_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_book_id_user_books_id_fk" FOREIGN KEY ("user_book_id") REFERENCES "public"."user_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_profiles_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_profiles_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_books" ADD CONSTRAINT "user_books_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_books" ADD CONSTRAINT "user_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_likes_bookmark" ON "bookmark_likes" USING btree ("bookmark_id");--> statement-breakpoint
CREATE INDEX "idx_replies_bookmark_created" ON "bookmark_replies" USING btree ("bookmark_id","created_at","id") WHERE "bookmark_replies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_bookmarks_public_feed" ON "bookmarks" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "bookmarks"."visibility" = 'public' AND "bookmarks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_bookmarks_flow" ON "bookmarks" USING btree ("user_book_id","created_at","id") WHERE "bookmarks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_books_isbn13" ON "books" USING btree ("isbn13");--> statement-breakpoint
CREATE INDEX "idx_follows_following" ON "follows" USING btree ("following_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_profiles_handle" ON "profiles" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_books_user_book" ON "user_books" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE POLICY "backend_access" ON "bookmark_likes" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "bookmark_replies" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "bookmarks" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "books" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "follows" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "profiles" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "user_books" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "backend_access" ON "user_preferences" AS PERMISSIVE FOR ALL TO "book_bear_api" USING (true) WITH CHECK (true);