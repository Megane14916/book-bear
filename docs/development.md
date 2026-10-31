# 開発・タスク管理書

## 1. 開発方針

- 2人開発。FrontendとBackendで担当を分ける。
- モノレポで管理するが、フロントからバックエンドのソースコードをimportしない。
- APIの入出力はOpenAPIで共有する。フロントは生成型とMSWモックで先行開発できるようにする。
- APIができた機能から接続・動作確認し、結合を最終日にまとめない。
- 実装はP0から進め、デモの安定性を優先する。

## 2. 役割分担

| 担当 | 主な作業 |
|---|---|
| Frontend | React画面、モバイルUI、画面遷移、Supabase Auth SDK、TanStack Query、MSW、API接続 |
| Backend | Hono API、OpenAPI生成、JWT検証・認可、Drizzle、DBマイグレーション、書籍API連携、APIテスト |
| 共同 | APIの変更確認、重要PRのレビュー、結合テスト、デプロイ、デモ・発表 |

## 3. リポジトリ構成

```text
shiori-sns/
├── apps/
│   ├── web/                  # React / Vite
│   │   └── src/
│   │       ├── features/
│   │       ├── pages/
│   │       ├── lib/api/      # APIクライアントと生成型
│   │       ├── lib/auth/
│   │       └── mocks/        # MSW
│   └── api/                  # Hono / Workers
│       ├── src/modules/
│       ├── src/middleware/
│       ├── src/db/
│       └── drizzle/
├── contracts/
│   ├── openapi-draft.yaml    # 実装前の仮契約
│   └── openapi.json          # APIから生成する正本
├── docs/
│   ├── overview.md
│   ├── requirements.md
│   ├── api.md
│   ├── database.md
│   ├── architecture.md
│   └── development.md
├── README.md
├── pnpm-workspace.yaml
└── package.json
```

`apps/web` と `apps/api` は独立して起動・デプロイする。

## 4. 実装順序と優先度

| 段階 | 内容 | 優先度 |
|---|---|---|
| 1. 基盤 | モノレポ、CI、DB、匿名認証、API契約、MSW | P0 |
| 2. 栞の基本体験 | 書籍検索・登録 → 本棚 → 非公開栞作成 → 自分の栞の流れ | P0 |
| 3. 公開機能 | Google連携、公開栞、全体フィード、プロフィール、表示設定 | P0 |
| 4. SNS機能 | フォロー・フォロー中フィード、いいね、返信、検索、外部共有 | P1 |
| 5. バーコード | スマホカメラでISBNを読み取り、書籍検索に渡す | P1 |
| 6. 拡張 | 自由リスト、推薦、画像投稿、通知、アプリ内リポスト | P2 |
| 7. 仕上げ | 結合テスト、スマホ実機確認、デプロイ、デモ | 必須 |

最初の共同到達点は「本を登録 → 非公開栞を保存 → 自分のプロフィールから投稿順の栞の流れを見る」。デザインは未完成でもよい。

### 主要機能の担当

| 機能 | Frontend | Backend |
|---|---|---|
| 本の検索・登録 | 検索画面・登録フォーム | 書籍API連携・本棚API |
| 匿名・Google認証 | 認証状態・連携UI | JWT検証・認可・プロフィール |
| 栞の投稿・流れ | 投稿画面・栞の流れ画面 | 栞CRUD・投稿日時ASCの取得API |
| フィード | 投稿カード・無限スクロール | 投稿日時DESC・15件カーソル・一括集計 |
| フォロー・いいね・返信 | ボタン・返信画面 | 対応APIと認可 |
| バーコード読み取り | カメラUI・ISBN抽出 | ISBN検索APIの再利用 |

## 5. タスク管理

GitHub Issuesを使う。必要ならGitHub Projectsで `Todo / In Progress / Review / Done` の4列を設ける。

各Issueには次を記載する。

```md
## 内容
実装する機能と対象範囲

## 完了条件
- [ ] 正常系が動く
- [ ] 必要な異常系・認可を確認した
- [ ] 型チェック・テストが通る
- [ ] API変更があれば契約とモックを更新した

担当: Frontend / Backend / Both
優先度: P0 / P1 / P2
依存: 関連Issue（あれば）
```

最初に作るIssueの例：基盤構築、DBスキーマ、認証、書籍API、書籍画面、栞CRUD、栞の流れAPI・画面、全体フィードAPI・画面、Google連携、フォロー、いいね・返信、バーコードカメラ、結合テスト。

1つのIssue・PRが大きくなりすぎたら分割する。

## 6. Git・PRルール

### ブランチとコミット

- `main`：常にビルド・デモ可能な状態にする。原則として直接pushしない。
- 機能ごとに短命ブランチを作る。例：`feat/web-feed`、`feat/api-bookmark-flow`、`fix/auth-link`。
- フロント専用・バック専用の長期ブランチは作らない。
- コミット例：`feat(api): add bookmark flow`、`fix(web): hide spoiler`、`docs: update API contract`。

### Pull Request

1. Issueからブランチを作成する。
2. 実装後にlint・型チェック・テスト・ビルドを実行する。
3. PRに目的、変更点、動作確認、関連Issue、API・DB変更の有無を書く。
4. レビューリクエストは、ユーザーから明示的に指示された場合のみ送る。PR作成の依頼だけではレビューリクエストを送らない。API契約、認可、DBマイグレーションなどの確認点はPR本文に記載する。
5. CI通過後に原則 `Squash and merge` し、ブランチを削除する。

APIやDBに変更があれば、対応するスキーマ・契約・ドキュメントを同じPRで更新する。

### CIと秘密情報

- GitHub Actionsでlint、TypeScriptの型チェック、テスト、ビルドを実行する。
- `.env.local`、`.dev.vars`、DBパスワード、秘密鍵はコミットしない。
- `VITE_` で始まる変数はブラウザへ公開され得るので、秘密情報を入れない。
- DBマイグレーションはレビューし、本番適用前に確認する。

## 7. API契約・モック

1. APIのリクエスト・レスポンスをOpenAPIで定義する。
2. BackendはHono + Zodから `contracts/openapi.json` を生成する。
3. Frontendは `openapi-typescript` で型を生成し、`openapi-fetch` で通信する。
4. Backend完成前はMSWで同じエンドポイント・レスポンスをモックする。
5. APIが完成したらMSWを無効にし、実APIで結合テストする。

変更の際は、パス・JSON名・型・エラー・認可への影響を相手へ知らせる。生成された型を手動編集しない。

### 認証モック

| モード | Auth | API | 用途 |
|---|---|---|---|
| UI開発 | 本物のSupabase AuthまたはMockAuth | MSW | フロントの独立開発 |
| 結合開発 | 本物のSupabase Auth | ローカル・検証API | 認証とAPIの結合 |
| デモ・本番 | 本物のSupabase Auth | デプロイ済みAPI | 実動作確認 |

原則は「本物のSupabase Auth + MSW」。MockAuthを使う場合は疑似トークンが本物のAPIでは通らないため、MSWと組み合わせる。

## 8. 開発環境

Frontendの主な環境変数：

```dotenv
VITE_API_BASE_URL=http://localhost:8787
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
VITE_USE_MOCK_API=true
VITE_USE_MOCK_AUTH=false
```

Backendの主な設定：`HYPERDRIVE`（DB接続binding）、`SUPABASE_URL`、JWT検証用設定、CORS許可origin、必要に応じて書籍APIキー。秘密値はWorkers Secretsなどで管理する。

ローカル起動用のnpm scriptsを用意する。

```bash
pnpm install
pnpm --filter web dev
pnpm --filter api dev
pnpm lint && pnpm typecheck && pnpm test
```

上記は予定するコマンド名。実際の `package.json` に合わせて確定する。

## 9. テスト・完了条件

優先する確認項目：

- 匿名ユーザーは非公開栞を保存できるが、公開・いいね・返信・フォローは403になる。
- 他人の非公開栞はフィード・プロフィール・直リンクから取得できない。
- 栞の流れはページ番号に関係なく投稿日時ASC、通常フィードはDESCで表示される。
- フィードと栞の流れは15件ずつ取得し、次カーソルで重複なく追加表示できる。
- 同じISBNは重複登録されず、ISBNなしの本は手動登録できる。
- 匿名→Google連携後にユーザーIDと既存データが維持される。
- `tap` モードとネタバレ指定が正しく初期非表示になる。
- いいね・返信の集計が正しく、N+1が発生しない。
- スマホ幅・通信エラー・空データ・書影なしのケースで画面が操作できる。

完了の定義：Issueの受け入れ条件を満たし、関連テストと型チェックが通り、API契約と実装が一致し、PRをレビューして `main` へマージした状態。

## 10. デモ・リリース

- 開発中から本物のAPIに随時接続し、最後にまとめて結合しない。
- デモ用の本・栞・ユーザーを用意し、モバイル端末で確認する。
- 最終段階は新機能追加を止め、動作修正と発表準備を優先する。
- P0が未完成ならP2には着手しない。P1もデモの完成度に応じて調整する。
- 発表では「本を登録 → 栞を残す → 投稿順の栞の流れを見る」を必ず見せる。
