-- Run with the migration/administrative connection before migrations.
-- No password is stored here. Enable login and set a password separately.
DO $book_bear$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'book_bear_api') THEN
    CREATE ROLE book_bear_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'book_bear_api'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'book_bear_api must be an unprivileged application role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'book_bear_api')
  ) THEN
    RAISE EXCEPTION 'book_bear_api must not be a member of other roles';
  END IF;
END
$book_bear$;
