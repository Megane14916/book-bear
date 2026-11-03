# Supabase接続用CA証明書

`prod-ca-2021.crt` は開発用Supabaseのサーバー証明書検証に使う公開CA証明書。秘密鍵は含まない。

`pnpm dev:api` と `pnpm --filter api db:migrate` は `apps/api` で実行されるため、接続文字列に `sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt` を指定する。

更新時は [SupabaseのDatabase Settings](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl) から対象環境のCAを確認し、差し替えをレビューする。接続パスワード・APIキーは環境変数ファイルで別途設定する。
