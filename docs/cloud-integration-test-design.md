# 開発用クラウド結合テスト 設計書（Issue #29）

状態: 実装中。実クラウド検証は未実施。

関連: [Issue #29](https://github.com/Megane14916/book-bear/issues/29) / 基準: main `1fd8c1b` / 更新: 2026-11-04（日本時間）

## 1. 目的と対象範囲

開発用の配信済み **Cloudflare Workers → 実Hyperdrive → Supabase PostgreSQL** の接続と、既存APIによる書籍作成・取得、本棚の作成・更新・取得・削除がDBへ正しく反映されることを確認する。

正式な専用ユーザー1人と、実行ごとに作るISBNなし書籍1冊・本棚1件を使い、第4節の手順だけを実施する。書籍は共有データとして保持され、本棚から削除した後も残ることを正常とする。栞は作成しないため、本棚は通常のDELETE APIで削除できる前提とする。

仕様は [生成OpenAPI](../contracts/openapi.json)、[書籍・本棚API設計](books-library-design.md)、[DB・Hyperdrive設定](database-setup.md) に従う。既存のローカル・CIテストを網羅し直さず、通常の `pnpm test`・PR CIに実サービス依存を追加しない。API・Web・DBスキーマ・マイグレーション・認可設定の変更は不要。

## 2. 実行前の環境確認

実行者は**毎回、書き込み開始前に**Cloudflare DashboardとSupabase Dashboardで以下の実配信構成を確認する。確認日時・確認者・承認した対象・配信バージョンを、秘密値を含まない手元の確認メモに残す。

| 確認対象 | 手動で確認する内容 |
|---|---|
| Worker | テスト対象として承認した開発用Workerの名前・HTTPS origin・配信バージョン。実際の配信設定の `HYPERDRIVE` bindingのIDと `SUPABASE_URL` |
| Hyperdrive | bindingと同じIDであり、接続先が開発用SupabaseのDirect connection、DBロールが既存の `book_bear_api`、`caching.disabled=true` であること |
| Supabase | 承認した開発用project refとWorkerの認証先・Hyperdriveの接続先の対応。DB照合用接続のホスト・ポート・DB名・ユーザー名も同じプロジェクトのConnect表示と照合 |
| 移行・権限 | `0000_initial_schema.sql`・`0001_registration_confirmation.sql` と既存アプリロールの必要な権限の適用を管理画面で確認。CLIへ管理者接続やAuth・移行履歴の読み取り権限を追加しない |

`run` 開始時には、今回の実配信構成を手動確認済みであることの明示確認と、確認メモの承認済みWorker origin・project refの入力を求め、ローカル設定との完全一致を確認する。本番、未承認、確認不能、不一致、設定不足の場合は書き込まず終了する。HTTPのリダイレクトは追従しない。

`CLOUD_TEST_ENVIRONMENT=development` という指定や、ローカル設定と確認メモの一致だけでは、実配信構成の検証済みとは扱わない。Dashboardでの確認を必須の手動前提とする。healthの200だけでもbinding・接続先・移行・権限は確定できない。管理API連携や環境作成・デプロイ・設定変更をCLIに追加しない。

## 3. テストユーザーと設定

通常のSupabase Authの認証フローで発行された、正式なテスト専用ユーザー1人の有効なaccess tokenを使用する。AuthユーザーをSQLで作成せず、`service_role`・管理者権限を使用しない。専用ユーザーは実行中に他の操作へ使用しない。

CLI用のGit対象外ファイル `apps/api/.env.cloud-test.local` に、必要な設定だけを保持する。

| 設定 | 用途 |
|---|---|
| `CLOUD_TEST_ENVIRONMENT` | `development` のみ許可。手動確認と組み合わせる補助条件 |
| `CLOUD_TEST_API_ORIGIN` | 承認した配信済みWorkerのHTTPS origin。loopback・資格情報・path・query・fragmentを許可しない |
| `SUPABASE_URL`・`CLOUD_TEST_SUPABASE_PROJECT_REF` | 認証先と承認プロジェクトの一致確認 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase Authの通常のユーザー確認に使用 |
| `CLOUD_TEST_USER_ID`・`CLOUD_TEST_ACCESS_TOKEN` | 期待する専用UIDと実JWT |
| `CLOUD_TEST_DATABASE_URL` | 同じ開発用DBへアプリ専用ロールで接続する照合専用URL |

`run` は書き込み前に、設定したSupabaseの通常の `GET /auth/v1/user` でJWTが受理され、期待UID・正式ユーザーであることを確認する。JWT decodeだけで本人を確定しない。DB照合接続も先に確立し、承認済み接続先との一致、`current_user=book_bear_api`、TLS証明書検証、読み取り可能なことを確認する。

JWT・DBパスワード・接続文字列はログやGitへ出さず、コマンド引数・Workerへも渡さない。`TEST_DATABASE_URL` と管理用URLは流用せず、既存の `tests/helpers/database.ts` も利用しない。

## 4. 接続確認とCRUDテストの手順

環境・JWT・DB接続の事前確認後、次を直列実行する。health確認に失敗した場合も書き込みは開始しない。実行ごとに新しいUUIDのrun IDを使い、書籍タイトルを `cloud-test-<run ID>` とする。

最初にWorkerの `GET /api/v1/health` と `GET /api/v1/health/db` がともに200・`status=ok` を返すことを確認する。その後、同じJWTで以下を実行する。

| 順序 | 操作 | 確認内容 |
|---|---|---|
| 1 | 実Supabase AuthのJWTを使用 | 第3節で確認した専用ユーザーのJWTをBearerで送る |
| 2 | `PUT /api/v1/me` | 200。返却UIDが専用UIDと一致し、プロフィールが初期化される |
| 3 | `POST /api/v1/books/manual` | run ID付きタイトルのISBNなし書籍を作成。201と `bookId` を記録 |
| 4 | `GET /api/v1/books/{bookId}` | 200。作成したID・タイトル・`isbn13=null` が一致 |
| 5 | `POST /api/v1/me/books` | 作成したbookIdを登録。201と `userBookId`、専用UID・bookIdの対応を確認 |
| 6 | `PATCH /api/v1/me/books/{userBookId}` | 例として `status=reading`・`currentPage=10` を送信し、200と更新値を確認 |
| 7 | `GET /api/v1/me/books` | 対象userBookIdが見つかるまでnextCursorで必要なページを取得し、`item.book.id`・状態・現在ページが更新結果と一致 |
| 8 | `DELETE /api/v1/me/books/{userBookId}` | 204。本実行で作成した本棚だけを削除 |
| 9 | `GET /api/v1/me/books` | nextCursor=nullまで取得し、全ページに対象userBookIdがないことを確認 |

各APIのHTTP statusと必要な応答項目を既存契約に照らして確認する。本棚一覧は既定15件で先頭から読み、nextCursorをそのまま次の要求へ渡す。書籍IDは `item.book.id` で照合する。存在確認で末尾まで見つからない場合、不在確認で対象が現れた場合、同じカーソルの反復や取得失敗は失敗とし、確認できたことにしない。ページングは対象IDを追跡するためだけに使用し、境界値・並行更新の試験は追加しない。最終的な削除はDBのSELECTでも確認する。

## 5. DB照合と後片付け

DB照合はAPI処理と別の `pg` 接続で `BEGIN READ ONLY` を使い、IDをパラメーター化したSELECTだけで行う。既存アプリロールとTLS証明書検証を維持する。対象環境のCAを使用し、`sslmode=verify-full` とCA指定は [共有CAの手順](../apps/api/certs/README.md) に従う。Authテーブル・マイグレーション履歴は読まない。

| 照合時点 | Supabase PostgreSQLで確認する内容 |
|---|---|
| 書籍・本棚の作成後 | bookIdに対応する書籍のタイトル・ISBNと、userBookIdに対応する本棚の専用UID・bookIdが一致 |
| 本棚の更新後 | 同じuserBookIdの状態・現在ページがAPIで指定した値に更新されている |
| 本棚の削除後 | 同じuserBookIdの行がなく、bookIdの書籍行は残っている |

照合ごとに短い読み取り専用トランザクションを開始・終了し、API書き込みの間は保持しない。**WorkersからHyperdrive経由で行うAPI操作**と、**確認用の直接DB接続**は結果に分けて記録する。直接接続の成功をHyperdrive通過の証拠にはしない。

生成されたbookId・userBookIdは、run ID・対象環境・専用UID・最後に完了した操作とともに、小さなGit対象外の実行記録へ都度保存する。トークンや接続文字列は保存しない。途中失敗時も記録したIDと所有者・bookIdをDBで照合し、本実行の本棚と確認できる場合だけ既存DELETE APIによる後片付けを試みる。

書籍、専用プロフィール・Authユーザーは保持する。本棚削除に失敗した場合は、残存ID・失敗段階・秘密値を除いた原因を記録する。書籍を削除するAPIや管理SQLによる自動削除は追加しない。他人のデータや過去のrunのデータを更新・削除しない。

再実行は新しいrun IDで開始する。POSTの応答が途絶えて生成IDが不明なら自動再送せず、専用UID・run ID付きタイトル・関連IDを読み取りで確認する。一意に特定できなければ自動削除せず、結果不明・要確認として記録する。残存本棚を手動で片付ける場合も、対象環境・UID・IDを確認して既存APIを使う。

## 6. CLIの構成

操作は次の2つだけとし、リポジトリルートから明示実行する。

```sh
pnpm --filter api test:cloud check
pnpm --filter api test:cloud run
```

- `check`: ローカル設定の必須項目・形式・URL間の整合性だけを検査する。ネットワーク接続・DB書き込みは行わず、実環境確認済みとは表示しない。
- `run`: 手動確認の入力 → 設定・JWT・DB接続・healthの確認 → 第4節の操作とDB照合 → 必要な後片付け → 結果記録の順に実行する。

入口は `apps/api/scripts/cloud-test.ts` とし、既存の `pg`・標準fetchを使う小規模な構成にする。追加のサブコマンド・汎用テストフレームワーク・シナリオ管理機構は設けない。通常テストと分離することで、実サービスの資格情報や可用性をPR CIへ持ち込まずに確認できる。

HTTP／DBの待機にはタイムアウトを設け、自動リトライは行わない。予期しない応答・DB照合不一致では後続の通常操作を止め、安全に可能な後片付けだけを試みる。失敗と片付け結果を両方残し、必要な確認が終わらなければ終了コードは非0とする。

結果には実行日時、run ID、ソースcommit、対象環境・配信バージョン、手動確認結果、各操作の成否、DB照合結果、残存データだけを記録する。生のHTTP本文・ヘッダー・DB例外や接続設定は出力しない。小さな実行記録で必要なIDを追跡し、複雑な復旧機構を持たずに誤操作を避ける。

## 7. 完了条件

- 承認済み開発環境について、実配信Worker・Hyperdrive・Supabaseの対応、キャッシュ無効、必要な移行・権限を手動確認し、記録している。
- health 2操作と第4節の操作が成功し、作成・更新・削除がSupabase PostgreSQLへ反映され、共有書籍が保持されることをDBで確認している。
- 本実行の本棚の削除と残存データを記録し、秘密値の露出や他人のデータへの更新・削除がない。
- `check` と `run` の設定・手動前提・実行方法を再現でき、未実施・確認不能な項目を成功扱いしていない。
- 既存の型チェック・テスト・OpenAPI整合性チェック・ビルドを維持する。実サービス未実施の場合は未検証と記録する。
