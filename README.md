# book-bear

## 開発環境

Node.js 22.12以上とpnpm 10.28.2を使用します。

依存関係をインストールし直す前に、起動中のWeb/API開発サーバーを `Ctrl+C` で停止してください。特にWindowsでは使用中のネイティブモジュールがインストールを妨げることがあります。pnpmストアはリポジトリ内の `.pnpm-store` を使用します。

```sh
pnpm install
pnpm dev:api # http://localhost:8787
pnpm dev:web # http://localhost:5173
pnpm typecheck
pnpm test
pnpm build
```

DBを使う場合は [Supabase・Hyperdrive初期設定](docs/database-setup.md) を参照してください。外部サービスの作成前でも `pnpm --filter api db:local` と `pnpm --filter api db:migrate` でローカル確認できます。

実際のHyperdrive IDは `apps/api/.env.deploy.local` の `HYPERDRIVE_ID` で管理し、`wrangler.jsonc` には書き込みません。リモートでの接続確認は `pnpm --filter api dev:remote`、デプロイは `pnpm --filter api deploy:worker` を使用します。設定例は `apps/api/.env.deploy.example` にあります。

認証・プロフィールAPIの利用には [Supabase匿名認証の設定](docs/auth-setup.md) を参照してください。Supabaseの匿名サインインとES256/RS256署名キーを確認し、APIに `SUPABASE_URL` を設定します。リモートコマンドは `.env.deploy.local`、ローカルWranglerは `.dev.vars` を使います。

Google Custom OIDCと認証・データアクセスの責務は [認証機能 Design Doc](docs/auth-design.md) に記載しています。フロントは後続タスクでSupabase SDKを認証専用に導入し、Data APIは使用せず、アプリデータはHono API経由で扱います。Issue #18は設計段階です。

WebのAPI接続先は `apps/web/.env.example` を参考に `apps/web/.env.local` の `VITE_API_BASE_URL` で変更できます。APIのCORS許可元は既定で `http://localhost:5173` です。環境ごとにWorkersの `CORS_ORIGIN` を設定してください。

## OpenAPI契約

`pnpm generate:openapi` はAPIのHono/Zod定義から `contracts/openapi.json` を生成し、続けてWeb用の型を生成します。生成物はコミットし、変更後は `pnpm check:openapi` で差分がないことを確認します。APIは同じ仕様を `/openapi.json` でも公開します。

生成契約にはプロフィール、書籍・本棚、栞、フィード、フォロー・いいね・返信、検索の34操作と2種類のhealthが含まれます。各操作の **`x-implementation-status`** を確認してください。

- `implemented`：health、DB接続確認、`GET/PUT/PATCH /api/v1/me`、`GET/PATCH /api/v1/me/preferences`、`GET /api/v1/users/{userId}`。DB・認証の設定が必要です。
- `planned`：Zodで契約を定義済み、ハンドラーは未実装。実APIは現在404を返します。先行するUI開発では生成型とMSWを利用してください。

スキーマは `apps/api/src/modules/*/schemas.ts`、共通項目は `src/shared/schemas.ts`、未実装操作は `src/contracts/routes.ts`、実装済みプロフィール操作は `src/modules/users/routes.ts` にあります。JWT検証・プロフィールのDB操作は実装済みです。その他の操作・カーソルの署名や照合は後続実装です。`contracts/openapi-draft.yaml` は初期設計の履歴として残し、生成には利用しません。詳しくは [API設計書](docs/api.md) を参照してください。

`pnpm test` でVitestによるスキーマ境界値・契約・実APIへの未登録の検証を実行します。GitHub Actionsでも型チェック・テスト・契約整合性・ビルドを確認します。現在lintスクリプトは未導入です。
