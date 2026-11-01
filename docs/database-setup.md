# DB・Hyperdrive の初期設定（Issue #8）

この手順は新しく作る開発用環境が対象。コード・マイグレーション・テストは準備済みだが、Supabase／Cloudflare のアカウントやプロジェクト作成、本番への適用・デプロイは自動では行わない。

## 1. サービスを用意する前のローカル確認

リポジトリのルートで実行する。

既にWeb/APIの開発サーバーを起動している場合は、それぞれのターミナルで `Ctrl+C` を押して停止してから依存関係をインストールする。特にWindowsでは、Viteなどが使用中のネイティブモジュールを削除・置き換えできない。

```sh
pnpm install --frozen-lockfile
pnpm --filter api db:local
```

別ターミナルで実行する。

```powershell
Copy-Item apps/api/.env.example apps/api/.env.db.local
pnpm --filter api db:migrate
pnpm dev:api
```

`.env.db.local` が既にある場合は上書きせず、内容を確認して編集する。管理用接続はWranglerが通常読み込む `.env`／`.env.local` とは別ファイルに保存し、マイグレーションCLIだけが読み込む。既定のローカル接続先は `127.0.0.1:5433`。`GET http://localhost:8787/api/v1/health/db` が200と `{"status":"ok"}` を返せば、Workers → Hyperdrive ローカルbinding → pg → Drizzle → DB のクエリが成功している。設定不備・未マイグレーション・接続失敗時は内部情報を含まない503を返す。

ローカルDBはPGliteのPostgreSQLエンジンを利用し、`apps/api/.local-db/` に保存する。このディレクトリと `.env.db.local` はGit対象外。ローカルの `postgres:postgres` はテスト用の固定値で、TCP認証やTLSを提供しないため、サーバーはループバックにだけbindする。共有環境・本番には利用しない。

このローカルDBの `auth.users` は外部キー検証のためのidだけの代替テーブルで、Supabase Authそのものは提供しない。Supabaseを作成後に本物の認証と結合する。クラウド向けマイグレーションは `auth.users` を作成・変更しない。

### Windowsでインストールが失敗した場合

`EPERM ... unlink ... lightningcss...node` は、起動中のViteなどがそのファイルを使用している可能性がある。Book Bearの開発サーバーを停止してから、ルートで `pnpm install --frozen-lockfile` を再実行する。他のプロジェクトを含むNode.jsプロセスをまとめて終了しない。

失敗したインストールの後に `tsx` が見つからない場合は、依存関係の再インストールが途中で止まっている。インストールの成功を確認してから `pnpm --filter api exec tsx --version`、続けて `pnpm --filter api db:local` を実行する。`tsx` のグローバルインストールは不要。

pnpmストアは `pnpm-workspace.yaml` の `storeDir` で `.pnpm-store` に統一している。依存関係のインストールはリポジトリのルートで実行する。通常は `--store-dir` の追加指定や、ユーザー全体のpnpm設定の変更は不要。

## 2. Supabase の開発用プロジェクトを作る

1. Supabaseにログインし、開発用の新規プロジェクトを作成する。プロジェクト名の例は `book-bear-dev`。DBパスワードはパスワード管理ツールに保存する。
2. プロジェクトの **Connect** からPostgreSQLの接続情報を取得する。マイグレーションは管理用の `postgres` 接続を使い、Workers用接続とは分離する。
3. `apps/api/.env.db.local` の `MIGRATION_DATABASE_URL` を管理用接続文字列に置き換える。パスワードの特殊文字はURLエンコードする。TLSの証明書検証を有効にし、必要ならSupabaseが提供するCA証明書を取得して `sslrootcert` を指定する。
4. ローカル回線からDirect connectionへIPv6接続できない場合、管理用CLIにはConnect画面の **Session pooler（5432）** を使用できる。Transaction pooler（6543）はマイグレーションに使用しない。
5. 生成SQL `apps/api/drizzle/0000_initial_schema.sql` と `scripts/sql/` を確認してから、開発用接続先で次を実行する。

```sh
pnpm --filter api db:migrate
```

実行順はアプリロールの準備 → Drizzleマイグレーション → 権限設定。再実行は適用済み履歴を保持し、既存データを初期化しない。DDL・ロール作成・権限設定を行うため、管理用アカウントでのみ実行する。本番への適用はSQL確認後に別途判断する。

失敗時は秘密情報を含まない処理段階と認識済みエラーコードを表示する。`connection [28P01]` はパスワード認証失敗。プロジェクト作成時のDBパスワード（Dashboardログイン用とは別）と、URIのパスワード部分のURLエンコードを確認する。必要ならSupabase Database SettingsでDBパスワードをリセットして `.env.db.local` を更新する。Session poolerを使う場合、ユーザー名・ホストはConnectの表示をそのまま使い、ポートは5432とする。エラー調査のために秘密値をチャットへ送る必要はない。

### アプリ専用ロール

`book_bear_api` は初期状態では **NOLOGIN**。8テーブルへのSELECT/INSERT/UPDATE/DELETEだけを付与し、Authテーブル・マイグレーション履歴へのアクセス、スキーマ／ロール／DBの作成、RLSのバイパスは付与しない。強い権限や他ロールのメンバーシップを持つ同名ロールが既にある場合、セットアップは拒否する。

Supabase SQL Editorで以下のパスワードを自分の強いランダム値に置き換えて実行し、ログインを有効化する。秘密値入りのSQLはリポジトリやチャットに貼らない。psqlを利用できる場合は `ALTER ROLE book_bear_api LOGIN;` と `\password book_bear_api` でパスワードを対話入力してもよい。

```sql
ALTER ROLE book_bear_api LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_RANDOM_PASSWORD';
```

アプリ用接続は次の形になる。`postgres` 管理ユーザーをHyperdriveに渡さない。

```text
postgresql://book_bear_api:ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
```

全アプリテーブルはRLSが有効で、`book_bear_api` 専用のポリシーだけを作成する。`anon`／`authenticated`／PUBLICのテーブル権限は明示的に取り消す。`public` スキーマのCREATE権限もPUBLICから取り消すため、他アプリと共用せずBook Bear専用プロジェクトに適用する。Supabase SDKでAuthを使うことには影響しない。

アプリロールのポリシーはバックエンド全体のアクセスを許可するもので、利用者ごとの認可を代行しない。JWTの検証・所有者・公開範囲の判定は後続のHono実装で必ず行う。Supabase Data APIから本棚・非公開栞へ直接アクセスさせるポリシーは作らない。

## 3. Cloudflare Hyperdrive を作る

1. Cloudflareアカウントを用意し、Hyperdriveで開発用設定（例 `book-bear-dev`）を作成する。
2. 接続先はSupabaseの **Direct connection**（`db.PROJECT_REF.supabase.co:5432`）。ユーザーは `book_bear_api`、パスワードは前節で設定した値、DB名は通常 `postgres`。Hyperdrive自身が接続プールを提供するため、Supavisorのpooler接続先は使用しない。
3. **Query cachingを無効**にする。CLIで作成する場合は `--caching-disabled` を指定する。既存設定は次のコマンドで無効化できる。

```sh
pnpm --filter api exec wrangler login
pnpm --filter api exec wrangler hyperdrive update YOUR_HYPERDRIVE_ID --caching-disabled
```

4. Dashboardまたは `wrangler hyperdrive get YOUR_HYPERDRIVE_ID` で **`caching.disabled = true`** を確認する。これはHyperdrive側の設定であり、`wrangler.jsonc` だけでは無効化できない。キャッシュを残すと非公開化した投稿の古い公開データを返すおそれがある。
5. `apps/api/.env.deploy.example` を `.env.deploy.local` にコピーし、`HYPERDRIVE_ID` に実際のIDを設定する。ファイルが既にあれば上書きせず編集する。

```powershell
if (!(Test-Path -LiteralPath apps/api/.env.deploy.local)) {
    Copy-Item apps/api/.env.deploy.example apps/api/.env.deploy.local
}
notepad apps/api/.env.deploy.local
```

```dotenv
HYPERDRIVE_ID=YOUR_32_CHARACTER_HYPERDRIVE_ID
```

ID自体はDBパスワードではないが、環境ごとの設定としてGit対象外のファイルで管理する。`wrangler.jsonc` のゼロのIDはローカル検証専用で、書き換えない。`HYPERDRIVE_ID` は実行時のWorkers変数ではなく、リモート起動／デプロイ用CLIが読み取る設定。シェルやCIの環境変数で同名の値を設定することもできる。

`dev:remote`／`deploy:worker` は環境変数のIDを反映した一時設定をAPIディレクトリ内に生成し、Wranglerに `--config` で渡す。生成ファイル `wrangler.remote.*.json` はGit対象外で、通常のコマンド終了時に削除する。ベース設定や相対パスは維持し、IDが未設定・不正・ゼロの場合はリモート操作を開始しない。ローカルの `pnpm dev:api` とビルドはID未設定でも利用できる。

DBパスワードはHyperdriveの接続設定で保持する。Workersはbindingの `connectionString` を利用し、管理用接続文字列は持たない。フロントの `VITE_` 変数にDB情報を入れない。`nodejs_compat` は設定済み。

## 4. 実サービスとの接続確認

まずローカルWorkersからSupabaseを確認する場合、管理用ではなく `book_bear_api` の接続文字列を、シェルの環境変数 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` に設定して `pnpm dev:api` を起動する。TLSを有効にした接続を使う。秘密値はコミットしない。

`GET /api/v1/health/db` が200ならDB接続とprofilesの読み取り権限を確認できる。ただし `wrangler dev` はDirect connectionを使い、実際のHyperdriveプール／キャッシュは通らない。

Hyperdrive経由の検証には、前節の `.env.deploy.local` またはシェル環境変数に開発用Hyperdrive IDを設定したうえで次を実行する。

```sh
pnpm --filter api dev:remote
```

同じ `/api/v1/health/db` の200を確認し、Dashboardでもクエリキャッシュ無効を再確認する。デプロイする場合は対象環境のIDを確認して `pnpm --filter api deploy:worker` を実行する。`pnpm --filter api deploy:worker --dry-run` ならアップロードせずに設定とビルドを検証できる。CORS許可元はWebの開発・公開originに合わせて `CORS_ORIGIN` を設定する。

Supabase・Cloudflareのリソースがまだないため、今回の作業で検証するのはローカルWorkersとCIまで。実クラウド上の200確認は、この設定完了後に実施する。

## 5. テストと変更時の作業

```sh
pnpm --filter api db:generate
pnpm --filter api db:check
pnpm typecheck
pnpm test
pnpm check:openapi
pnpm build
```

通常のDBテストは毎回一時的なPGliteに生成SQLを適用し、実際のpg TCP接続でFK・UNIQUE・CHECK・RLS・権限とWorkers接続を検証する。CIではPostgreSQL 17の使い捨てサービスに同じテストを実行する。`TEST_DATABASE_URL` はローカルの `book_bear_test` DBにだけ許可し、Supabaseへテスト用Authテーブルを作らない。

`src/db/schema/index.ts` を変更したらマイグレーションを生成し、SQLとsnapshotをコミットする。CIで再生成の差分も検出する。DB本文長・ISBN形式の制約に加え、API側でもtrim・ISBNチェックディジット・入力・認可を検証する。

参考：[Supabase接続](https://supabase.com/docs/guides/database/connecting-to-postgres)、[HyperdriveとSupabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)、[Hyperdriveキャッシュ](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)、[ローカル開発](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)。
