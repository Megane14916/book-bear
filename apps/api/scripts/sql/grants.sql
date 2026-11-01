-- Grants cover only Book Bear's tables, never auth.users or migration metadata.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $book_bear$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO book_bear_api', current_database());
END
$book_bear$;
GRANT USAGE ON SCHEMA public TO book_bear_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.profiles, public.books, public.user_books, public.bookmarks,
  public.follows, public.bookmark_likes, public.bookmark_replies, public.user_preferences
TO book_bear_api;

REVOKE ALL ON TABLE
  public.profiles, public.books, public.user_books, public.bookmarks,
  public.follows, public.bookmark_likes, public.bookmark_replies, public.user_preferences
FROM PUBLIC;

DO $book_bear$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.profiles, public.books, public.user_books, public.bookmarks, public.follows, public.bookmark_likes, public.bookmark_replies, public.user_preferences FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$book_bear$;
