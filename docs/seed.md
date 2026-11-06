# 開発用seedの実行

固定データは [data.json](../apps/api/scripts/seed/data.json)、推薦評価ケースは [evaluation.json](../apps/api/scripts/seed/evaluation.json) にある。データを変更するときは両ファイルの版と参照キーをそろえ、例文・判定理由をレビューする。通常の投入にAI APIは不要。[設計書](seed-design.md)

版2は書籍30冊、ユーザー12人、栞178件。書影ありの5冊には、外部通信なしで表示できる架空のSVG書影を収録する。既存の論理キーとUUIDは維持し、栞本文や一部の本棚の状態を更新した。

## ローカル

[ローカルDB手順](database-setup.md) に従い、`pnpm --filter api db:local` でPGliteを起動し、別ターミナルでローカルに `pnpm --filter api db:migrate` を実行する。

```sh
pnpm --filter api db:seed
```

出力の版と追加・スキップ件数を確認する。同じ版を再実行すると全行スキップになる。既存行の編集や変更版との衝突で停止した場合は、[設計書の再投入手順](seed-design.md#json変更後の再投入) に従ってDBを退避してから新規投入する。

版1から版2へ切り替える場合は、`db:local` を停止して `apps/api/.local-db/` をリポジトリ外の未使用パスへ退避する。PGliteを起動し直し、マイグレーション先が `127.0.0.1:5433` であることを確認してから `db:migrate` と `db:seed` を実行する。開発用Supabaseでは、版2は別の承認済みの空の開発環境で投入する。版1の開発DBやAuthユーザーは保持する。

## 開発用Supabase

1. ダッシュボードで開発用プロジェクトのref、DB接続先、利用する開発Workerの認証先とHyperdriveの接続先を確認する。本番プロジェクトには実行しない。
2. JSONのユーザーごとに専用アカウントを用意する。本人のJWTで開発APIの `PUT /api/v1/me` を実行し、`PATCH /api/v1/me` にJSONの `displayName`、`handle`、`bio` を渡す。匿名・正式の区分はJSONにそろえる。
3. `apps/api/.env.seed.local` に `SEED_DEVELOPMENT_PROJECT_REF`、`SEED_SUPABASE_URL`（末尾スラッシュなし）、`SEED_SUPABASE_PUBLISHABLE_KEY`、`SEED_DATABASE_URL`、`SEED_ACCOUNTS_FILE` を設定する。DB URLは開発用の `book_bear_api` 接続を指定し、クエリパラメータは付けない。CLIが共有CAとTLS証明書検証を設定する。アカウントファイルはリポジトリ外に置き、ユーザー論理キーをキーとする `{"growth-a":{"uid":"<UUID>","token":"<access token>"}}` 形式で全員分を用意する。
4. `pnpm --filter api db:seed --development <確認済みのproject ref>` を実行する。seedはAuthとプロフィールを照合し、書籍・本棚・栞・SNSデータを投入する。認証情報を共有したりGitへ追加したりしない。
5. 開発APIへ専用ユーザーでログインし、フィード、プロフィール、本棚、栞詳細・返信を確認する。匿名ユーザーで本棚が空の画面と、自分の非公開栞を確認する。別ユーザーから同じ非公開栞を取得できないことを確認する。
