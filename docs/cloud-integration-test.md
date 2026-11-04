# 開発用クラウド接続・書籍／本棚CRUDの実行手順（Issue #29）

[設計書](cloud-integration-test-design.md) の接続確認と基本操作だけを実行する。配信済み開発用Worker・実Hyperdrive・開発用Supabase、正式な専用ユーザー1人を使用する。本番には実行しない。

## 1. 設定と手動確認

Node.js 22.12以上・pnpm 10.28.2と既存依存関係を使用する。リポジトリルートで設定例をコピーする。既存の接続設定は上書きしない。

```powershell
if (!(Test-Path -LiteralPath apps/api/.env.cloud-test.local)) {
    Copy-Item apps/api/.env.cloud-test.example apps/api/.env.cloud-test.local
}
notepad apps/api/.env.cloud-test.local
```

- `CLOUD_TEST_API_ORIGIN`: 開発用の配信済みWorkerのHTTPS origin。末尾のAPIパスは含めない。
- `CLOUD_TEST_SUPABASE_PROJECT_REF` と `SUPABASE_URL`: 同じ開発用プロジェクト。URLは `https://PROJECT_REF.supabase.co`。
- `SUPABASE_PUBLISHABLE_KEY`: そのプロジェクトのPublishable key。
- `CLOUD_TEST_USER_ID` と `CLOUD_TEST_ACCESS_TOKEN`: 正式な専用ユーザーのUIDと新しいSupabase access token。実行中はそのユーザーで他の操作をしない。
- `CLOUD_TEST_DATABASE_URL`: 照合用の `book_bear_api` 接続。Direct connectionかSession poolerの5432を使用し、`sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt` を指定する。Session poolerのユーザー名は `book_bear_api.PROJECT_REF`。パスワードはURLエンコードする。

JWTは、既存の認証クライアントで通常ログインして取得したSupabaseセッションの `access_token` を使用する。自作JWTやPublishable keyを代用しない。既存の `auth:google` 確認CLIはトークンを表示・保存しないので、その出力からJWTを取得することはできない。トークンを取得できる通常の認証クライアントと専用セッションが準備できるまで `run` は実行しない。

`.env.cloud-test.local` はGit対象外。JWT・パスワード・接続文字列をシェル引数、チャット、PR、ログに貼らない。CAは [共有CAの手順](../apps/api/certs/README.md) に従い、証明書検証を無効にしない。設定値はWorkerへ転送されない。

実行の直前にCloudflare／Supabase Dashboardで以下を確認し、確認日時・確認者とともに手元にメモする。

| 確認 | 手元に記録する内容 |
|---|---|
| 承認済み開発用Worker | 名前、HTTPS origin、実配信バージョンID |
| 実配信設定 | `HYPERDRIVE` bindingのID、`SUPABASE_URL`。ローカル設定の確認で代替しない |
| 同じHyperdrive | 接続先が開発用SupabaseのDirect connection、ロールが `book_bear_api`、`caching.disabled=true` |
| Supabaseの対応 | project ref、照合用DBのConnect表示（host・port・DB・ユーザー）と設定の一致 |
| 移行・権限 | `0000_initial_schema.sql` と `0001_registration_confirmation.sql`、既存アプリロールの権限の適用済みを確認 |

生のHyperdrive設定出力は接続情報を含み得るため転載しない。`development` の指定・設定同士の一致・healthの200だけでは実配信構成を確認済みとはしない。不明・不一致なら書き込みを開始しない。CLIは移行・デプロイ・権限変更を実行しない。

## 2. 実行

```sh
pnpm --filter api test:cloud check
pnpm --filter api test:cloud run
```

`check` は必須項目・形式・URLの整合性・CAファイルだけを検査し、ネットワークに接続しない。成功しても実配信設定やJWTの有効性の確認にはならない。シェルの同名環境変数はファイルより優先されるため、別環境の値が残っていないことも確認する。

`run` は対話ターミナル専用。確認メモのorigin・project ref・Worker名・配信バージョンID・Hyperdrive IDを入力し、全項目を実際のDashboardで確認した場合だけ `development verified` を入力する。確認省略用フラグはない。

CLIは書き込み前に実Authのユーザー照合、読み取り専用DB接続・アプリロール、health 2操作を確認する。その後、プロフィール初期化 → run ID付きISBNなし書籍作成・取得 → 本棚追加 → 状態・現在ページの更新 → 一覧で存在確認 → 本棚削除 → 一覧で不在確認を行う。存在確認は発見まで、不在確認は `nextCursor=null` までページを取得し、書籍IDは `item.book.id` を使う。

DBは作成・更新・削除の各段階を生成IDで照合し、本棚削除後も書籍が残ることを確認する。各照合は短い `BEGIN READ ONLY` のSELECTだけで、Auth・移行履歴は読まない。結果はAPIのHyperdrive経由操作とDB直接照合を分けて保存する。

## 3. 記録・失敗時の対応

実行記録はGit対象外の `apps/api/.cloud-test-results/<run ID>.json`。生成IDを受け取る都度、一時ファイルから置き換えて保存する。`steps`、`failure`、`cleanup`、残るbookId／userBookId、手動確認情報が含まれ、JWT・接続文字列・生の応答やDB例外は含めない。すべて確認できた場合だけ終了コード0、失敗・確認不能は非0になる。

| 状況 | 確認・対応 |
|---|---|
| `config` | 設定例と照合し、同じproject ref・アプリロール・5432・TLS／CA・専用UID／JWT形式を確認 |
| `manual-confirmation` | 対話ターミナルで、実配信構成を確認し直す。別環境を入力して通過させない |
| `auth-user` | その開発用プロジェクトの正式な専用UIDと、有効な新しいSupabase access tokenを確認 |
| `db-preflight`／health失敗 | 接続先・CA・アプリロール・実binding・移行／権限を確認。書き込みは開始されない |
| 操作／DB照合失敗 | `failure.stage` と生成IDを確認。通常操作は停止し、本実行の本棚とDBで確認できた場合だけ既存DELETE APIで片付ける |
| `cleanup=failed`／`uncertainWrite=true` | 残存IDと失敗段階を確認。POSTは自動再送しない。run ID付きタイトル・作成者UID・bookId・userBookIdの対応が一意に確認できる場合だけ既存APIで手動整理する |

通信断や強制終了では、最後の実行記録とDB状態が異なる可能性がある。自動削除を繰り返さず、対象環境・専用UID・本実行のIDの対応を読み取りで確認する。IDや所有者を確定できなければ要確認として残す。手動削除には、同じ専用JWTで既存の `DELETE /api/v1/me/books/{userBookId}` を使用し、一覧の末尾までの不在とDBのSELECTで削除を確認する。

書籍・専用プロフィール・Authユーザーは残してよい。本棚削除が失敗した場合は残存IDと理由を記録する。書籍の削除APIや管理SQLによる自動削除は追加しない。次のテストは新しいrun IDで開始し、過去のrunや他人のデータを変更しない。

## 4. 検証記録

実クラウド: **未実施**。開発用接続設定との利用者報告はあるが、実配信構成の全項目確認と、このCLI用の有効な専用JWT・承認済み配信先の確認情報は未提供。実サービスの成功とは扱わない。

2026-11-04（日本時間）のローカル確認: `pnpm typecheck`、`pnpm test`（17ファイル・466件成功、PostgreSQL専用17件はCI対象）、`pnpm check:openapi`、`pnpm build` が成功。追加26件はモックHTTP／DBでページ追跡・設定拒否・生成ID限定の片付け・読み取り専用SQL等を検証した。CLIの `check` と、非対話での `run` 拒否も架空設定で確認した。最初の全テスト実行はサンドボックスのloopback接続拒否で失敗し、ローカル通信を許可した再実行で通過した。実サービスには接続していない。

実施後はローカルJSONを確認し、以下の秘密値を含まない要約を記録する。

```text
実行日時（日本時間／UTC）・run ID・ソースcommit:
対象開発環境・配信バージョン・手動確認日時:
health 2操作・書籍／本棚操作・全ページ確認の結果:
DB直接照合（作成／更新／削除・書籍保持）の結果:
片付け結果・残存ID・未確認事項:
```

実クラウドの確認が終わるまでIssueの実環境検証項目は未完了とする。
