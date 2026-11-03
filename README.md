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

Google Custom OIDCと認証・データアクセスの責務は [認証機能 Design Doc](docs/auth-design.md) に記載しています。[Google OIDC設定・手動確認](docs/google-oidc-setup.md) に沿って、`pnpm --filter api auth:google link`／`login` でご自身のブラウザから確認できます。CLIは実際の認可scopeを検査し、UID・既存プロフィール・設定の保持を確認します。2026-11-02に利用者による実Googleログイン・匿名連携・再ログイン・追加メタデータ等の確認が完了しました。[検証結果](docs/google-oidc-setup.md#11-実サービスの検証記録) を参照してください。

フロントは後続タスクでSupabase SDKを認証専用に導入し、Data APIは使用せず、アプリデータはHono API経由で扱います。今回のバックエンド対応ではフロントのSDK・UIを追加していません。

WebのAPI接続先は `apps/web/.env.example` を参考に `apps/web/.env.local` の `VITE_API_BASE_URL` で変更できます。APIのCORS許可元は既定で `http://localhost:5173` です。環境ごとにWorkersの `CORS_ORIGIN` を設定してください。

書籍・本棚APIの設計とGoogle Books APIキーの設定は [書籍・本棚API設計書](docs/books-library-design.md) を参照してください。ISBNなしの重複は許容し、手動登録のレート制限は今後の課題です。外部検索が失敗してもDB候補があれば200で返します。

栞CRUD・本人一覧の認可とトランザクションは [栞CRUD API設計書](docs/bookmarks-design.md) を参照してください。作成は所有者確認から応答取得まで同一トランザクションで行い、匿名の公開操作と第三者による非公開栞の取得を拒否します。

投稿順で読む栞の流れは [栞の流れAPI設計書](docs/bookmark-flow-design.md) を参照してください。本人には公開・非公開、第三者には公開のみを返し、author・bookはヘッダーに1回だけ含めます。

公開栞を新しい順に読むフィードは [全体フィードAPI設計書](docs/feed-design.md) を参照してください。GET /feedはallと、正式ユーザー本人のフォロー先だけを返すfollowingに対応しています。

フォロー・いいね・返信の認可と登録確認の移行は [SNS API設計書](docs/social-design.md) を参照してください。DBの登録確認列マイグレーション適用後、ログイン・匿名昇格後にも新しい正式JWTでPUT /meを呼ぶことが必要です。既存ユーザーも実行するまでフォロー対象として未確認となります。自分の返信DELETEは元栞の非公開化・削除後も可能です。

## OpenAPI契約

`pnpm generate:openapi` はAPIのHono/Zod定義から `contracts/openapi.json` を生成し、続けてWeb用の型を生成します。生成物はコミットし、変更後は `pnpm check:openapi` で差分がないことを確認します。APIは同じ仕様を `/openapi.json` でも公開します。

生成契約にはプロフィール、書籍・本棚、栞、フィード、フォロー・いいね・返信、検索の34操作と2種類のhealthが含まれます。各操作の **`x-implementation-status`** を確認してください。

- `implemented`：health、DB接続確認、プロフィール／設定6操作、書籍・本棚9操作、栞CRUD・本人一覧5操作、栞の流れ1操作、all／followingフィード1操作、フォロー・いいね・返信10操作。DB・認証の設定が必要です。
- `planned`：Zodで契約を定義済み、ハンドラーは未実装。実APIは現在404を返します。先行するUI開発では生成型とMSWを利用してください。

スキーマは `apps/api/src/modules/*/schemas.ts`、共通項目は `src/shared/schemas.ts`、未実装操作は `src/contracts/routes.ts`、実装済み操作は `src/modules/{users,books,library,bookmarks,feed,social,replies}/routes.ts` にあります。一覧は日時・IDのBase64URLカーソルを使い、日時のマイクロ秒精度を維持します。署名・期限は設けず、認可はSQL条件で毎回確認します。未実装は投稿／ユーザー検索の2操作です。`contracts/openapi-draft.yaml` は初期設計の履歴として残し、生成には利用しません。詳しくは [API設計書](docs/api.md) を参照してください。

`pnpm test` でVitestによるスキーマ境界値・契約・実APIへの未登録の検証を実行します。GitHub Actionsでも型チェック・テスト・契約整合性・ビルドを確認します。現在lintスクリプトは未導入です。
