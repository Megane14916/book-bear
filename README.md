# Book Bear

本の好きなページや章に、感想を「栞」として残して共有できる読書 SNS です。本棚で読書の進捗を管理し、「栞の流れ」で同じ本への感想を投稿順に振り返れます。

- [プロジェクト概要](docs/overview.md)
- [アーキテクチャ設計書](docs/architecture.md)

## 使用技術

| 領域 | 技術 |
| --- | --- |
| フロントエンド | React、TypeScript、Vite、React Router |
| UI・データ取得 | Tailwind CSS、TanStack Query、openapi-fetch |
| バックエンド | Hono、Zod OpenAPI |
| データベース | Supabase PostgreSQL、Drizzle ORM、Cloudflare Hyperdrive |
| 認証 | Supabase Auth（匿名認証・Google 連携） |
| 書籍情報 | openBD、Google Books API |
| テスト・CI | Vitest、Playwright、GitHub Actions |
| デプロイ | Cloudflare Pages、Cloudflare Workers |

## システム構成

Web（`apps/web`）と API（`apps/api`）を pnpm のモノレポで管理します。ブラウザは Supabase Auth で認証し、アプリのデータは Hono API を通じて読み書きします。

```text
[ブラウザ] ──認証──⇄ [Supabase Auth] ⇄ [Google]
   ⇅ 画面配信
[React / Cloudflare Pages]

[ブラウザ] ──HTTP / OpenAPI──⇄ [Hono API / Cloudflare Workers]
                                  ├─ Hyperdrive 経由 ──⇄ [Supabase PostgreSQL]
                                  └─ 書籍情報の取得 ──⇄ [openBD / Google Books API]
```

## 開発環境構築

Node.js 22.12 以上と pnpm 10.28.2 を使用します。リポジトリ直下で依存関係をインストールし、設定ファイルがない場合はサンプルをコピーします（PowerShell）。

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
```

macOS / Linux では `Copy-Item` を `cp` に置き換えます。

環境変数を設定し、[DB・Hyperdrive 初期設定](docs/database-setup.md)に沿って DB を準備します。Web と API は別々のターミナルで起動します。

```powershell
pnpm dev:web # http://localhost:5173
pnpm dev:api # http://localhost:8787
```

## 環境変数

| 設定ファイル | 主な項目 |
| --- | --- |
| [Web の設定例](apps/web/.env.example) | `VITE_API_BASE_URL`（ローカルでは `http://localhost:8787`）、`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` |
| [API の設定例](apps/api/.dev.vars.example) | `SUPABASE_URL`、`CORS_ORIGIN`（ローカルでは `http://localhost:5173`）、`GOOGLE_BOOKS_API_KEY`（任意） |

Web と API には同じ Supabase プロジェクトの URL を設定します。認証の設定は [Supabase 匿名認証](docs/auth-setup.md)と [Google OIDC](docs/google-oidc-setup.md)を参照してください。

## テスト

```powershell
pnpm typecheck
pnpm test
pnpm check:openapi
```

## デプロイ

Web は `pnpm --filter web build` で生成した `apps/web/dist` を Cloudflare Pages に配信します。ビルド時に Web の環境変数を設定し、`VITE_API_BASE_URL` に公開 API の URL を指定します。

API は [デプロイ用の設定例](apps/api/.env.deploy.example)をもとに `apps/api/.env.deploy.local` を作成し、`CORS_ORIGIN` に公開 Web のオリジンを設定してから `pnpm --filter api deploy:worker` で Cloudflare Workers にデプロイします。
