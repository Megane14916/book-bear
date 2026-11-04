# 開発用クラウド結合テスト 設計書（Issue #29）

状態: 設計のみ。実装・実クラウド検証は未着手。

関連: [Issue #29](https://github.com/Megane14916/book-bear/issues/29) / 基準: main `1fd8c1b` / 2026-11-04（日本時間）

## 1. 目的・変更範囲

開発用の配信済みWorkersへHTTP要求を送り、実際の **Workers → HYPERDRIVE binding → Hyperdrive → Supabase PostgreSQL** を通す結合テストを追加する。既存のローカルWorkers・PGlite・CI PostgreSQLテストを補完する。

README、既存の `docs/` 全16文書、CA証明書のREADMEを確認した。仕様の正本は [生成OpenAPI](../contracts/openapi.json) と既存Hono/Zod定義、DBはDrizzleスキーマ・マイグレーションとする。初期OpenAPIドラフトは履歴資料として扱う。

追加対象は明示実行のTypeScript CLI、秘密値を含まない設定例、実行・調査手順、結果記録。API・Web・DBスキーマ・マイグレーション・認可・Workerの権限は変更しない。通常の `pnpm test` とPR CIに実サービス依存を追加しない。

## 2. 実行条件・認証データ

### 環境確認

テスト前に設定担当者がCloudflare／Supabaseの管理画面または読み取り専用CLIで次を確認し、確認日時と証跡の参照先を記録する。CLIはその記録と指定した対象の一致を確認してから書き込む。

- 開発用Workerの名前・HTTPS origin・配信バージョン・ソースcommit、実際に配信された `HYPERDRIVE` bindingのID。
- そのHyperdriveの接続先が対象SupabaseのDirect connectionで、DBユーザーが既存の `book_bear_api`、`caching.disabled=true` であること。生の設定出力は接続情報を含み得るため保存・転載しない。
- Workerの `SUPABASE_URL` と認証用プロジェクトの一致、Data API無効、既存RLS・権限の維持。
- `0000_initial_schema.sql` と `0001_registration_confirmation.sql` の適用履歴。管理画面で履歴のhashをリポジトリと照合し、結果だけを記録する。アプリロールへ履歴／Authの読み取り権限を追加しない。

環境記録はGit対象外のローカルファイルへ置き、実行ごとに確認する。HTTPS originの完全一致を要求し、loopback、任意のURLへの転送、設定不足・不一致では実行しない。既存の `dev:remote` も実Hyperdriveを通るが、今回の標準対象は配信済みWorkerとする。ローカルの `pnpm dev:api` による直接DB接続は別結果にする。

`/health/db` の200だけではbindingのID・接続先・全マイグレーションを証明できない。配信設定の確認と、後述のHTTP書き込み／DB照合を組み合わせて経路を記録する。設定証跡がなければ「実Hyperdrive経由を確認済み」としない。[Cloudflareのローカル／リモート接続仕様](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)

### テストユーザー

| 主体 | 用途・準備 |
|---|---|
| 正式ユーザーA・B | 専用の異なる2アカウント。通常のGoogle Custom OIDCログインでSupabaseセッションを取得する |
| 匿名ユーザーC | 通常の匿名サインインで取得した専用セッション。匿名の非公開CRUD・公開操作拒否に使う |
| JWTなし／不正JWT | 未認証閲覧・保護操作401、実JWTの署名部分を改変したトークンの拒否に使う |

固定した期待UIDと、A・B・Cの有効なaccess tokenを入力する。Supabase Authの通常の `/auth/v1/user` とHonoの応答でUID・匿名状態・プロジェクトを照合し、単なるJWT decodeで本人を確定しない。A・Bは異なる正式UID、Cは匿名であることを必須にする。匿名Cのセッションを失った場合は新規の専用ユーザーとして登録し直し、旧データを引き継がない。

AuthユーザーをSQLや管理APIで作らず、service_role・Secret key・自作署名JWTを使用しない。認証準備手順には通常フローによるトークン取得、CAPTCHAが必要な場合の入力、期限切れ時の再取得を記載する。既存の [Google OIDC手順](google-oidc-setup.md) とCLIの認証部品を参考にし、トークン表示・scope追加・認可迂回は行わない。

設定は新設の `apps/api/.env.cloud-test.example` とGit対象外の `.env.cloud-test.local` で管理する。主な入力は `CLOUD_TEST_ENVIRONMENT=development`、API origin、Supabase URL・Publishable key、期待UID・access token、環境記録のパス、DB照合専用の `CLOUD_TEST_DATABASE_URL`。接続URLはアプリロールとTLS検証を必須とし、管理用URLや `TEST_DATABASE_URL` を流用しない。Workerへこれらを転送しない。実装時に `.gitignore` へ設定例だけの追跡許可と台帳ディレクトリの除外を追加する。

## 3. 処理の流れ・対象シナリオ

1. 設定・環境証跡・認証を確認し、health 2操作とDB照合接続を確認する。前提不足ならfixture作成前に終了する。
2. 実行ごとにUUIDのrun IDを発行。A・B・Cで `PUT /me` → `GET /me` を行い、再PUTの冪等性と既存プロフィール・設定の保持を確認する。正式PUTによる登録確認後にSNS・ユーザー検索へ進む。
3. 専用の書籍・本棚・栞をAPI経由で準備し、以下を直列実行する。返却IDと操作段階を都度ローカル台帳へ保存する。
4. 各変更をHTTP再取得と対象IDに限定したDBのSELECTで照合する。
5. 成否にかかわらず後片付けを試み、シナリオ結果と片付け結果を別々に記録する。

| 対象 | 操作・期待結果 |
|---|---|
| 接続 | `GET /health`・`GET /health/db` が200、`status=ok`。後者のno-storeも確認 |
| 書籍・本棚 | run ID付きのISBNなし手動書籍を201で登録し詳細取得。本棚を201で作成、再登録200で同じID・値を保持。一覧取得・進捗PATCH・栞なしの別本棚DELETE 204を確認。栞あり／論理削除済み栞ありの本棚DELETEは409 `HAS_BOOKMARKS`。共有books行は保持 |
| 栞CRUD | Aの公開／非公開、Cの非公開を作成・取得・編集・論理削除。内容・既定値・createdAt保持・本人一覧を照合。削除後は本人もGET／PATCH／再DELETEが404 |
| 所有者 | Bの本棚一覧にAの本棚が混ざらず、BによるAの本棚PATCH／DELETE・その本棚への栞作成、Aの栞PATCH／DELETEは404。B・JWTなしにはAの非公開／削除済み栞の詳細404。拒否後も対象行が不変 |
| 匿名・JWT | Cの公開栞作成・非公開→公開、フォロー・いいね・返信POST・following取得は妥当な入力で403。JWTなしの保護操作、不正JWTの保護／OptionalAuth操作は401。Public操作には不正JWT拒否を要求しない |
| フォロー・いいね・返信 | B→Aのフォローと重複PUT、followingへの出現、解除。Aの公開栞へBがいいね・重複PUT・解除し件数／likedByMeを確認。返信POST・一覧・PATCH・DELETEと件数を確認 |
| 検索・栞の流れ | 固有語で公開栞を検索し非公開を除外。A・Bの表示名へ一時的な固有語を設定し、登録確認済み検索・handleを含む4項目だけの応答を確認後、元へ戻す。栞の流れは本人と第三者の公開範囲、ページ番号に依存しない投稿順を確認 |

パスは `/api/v1` 以下。成功・エラーのHTTP status、共通error code、既存Zodの応答スキーマ、私有項目の非露出、契約上必要なno-storeを検証する。全APIの境界値や並行ロック試験は既存テストに委ね、クラウドでは代表シナリオを検証する。

### 公開変更直後の非露出（必須）

Aの公開栞を異なる専用書籍に1件ずつ用意し、B・JWTなしの双方で詳細、allフィード、投稿検索、公開本一覧、栞の流れから取得できることを先に確認する。BはAをフォローし、followingも取得する。その後、1件を非公開化、もう1件を公開のまま論理削除する。

各変更の成功応答後、待機・成功待ちリトライ・キャッシュ破棄・cache-busterなしで、**変更前と同じURL・クエリ・閲覧者**で再取得する。詳細404、栞一覧に対象栞IDなし、公開本一覧に対象bookIdなし、非公開は本人のみ可読、削除済みは本人にも不可を確認する。非公開化後の返信GET／PATCHはBに404、B自身の返信DELETEは204も確認する。いいねは変更前に解除する。

一覧は固有語・対象ユーザー／本で分離し、必要な全ページを確認する。全体フィードには他人の投稿が混在するため固定件数や先頭1ページだけで不在を判定しない。追跡上限・同じカーソルの反復等で確認しきれなければ未検証とする。ページングには小さいlimitを指定し、重複なしと順序も確認する。

キャッシュ設定の確認と挙動検証は両方必要。Hyperdriveのクエリキャッシュは書き込みによる無効化を前提にせず、無効を維持する。[Cloudflareのキャッシュ仕様](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)

### DB反映と外部書籍サービス

DB照合は別の `pg` 接続で `BEGIN READ ONLY` を使い、専用ユーザー・台帳のIDをパラメーター化してSELECTする。接続ロールが `book_bear_api` で強い権限を持たないこと、対象プロジェクトとの対応も確認する。プロフィール／設定、本棚、栞のvisibility・deleted_at、フォロー／いいねの一意性、返信の更新・論理削除を照合し、拒否操作の前後も比較する。Authテーブル・移行履歴は読まない。この直接接続は結果照合専用で、APIのHyperdrive通過の証拠と混同しない。

主要シナリオは手動書籍で完結させる。Google Books／openBDの検索・importは `--providers` を付けた別グループで実行し、取得可能な候補の契約・保存／ISBN再利用を確認する。外部0件は正常応答として記録し、import未実施を合格にしない。502・制限等は外部グループの失敗／未検証として分け、クラウドDB経路の結果を上書きしない。

## 4. fixture・再実行・後片付け

- 専用UIDの許可リストとrun ID付きのタイトル／本文、APIが返したfixture IDで識別する。更新・削除はその実行で作ったIDだけに限定し、名前検索から他人のデータを削除しない。既存プロフィールは一時更新前の値を保存して復元する。
- ローカル台帳はGit対象外に保存し、対象環境・UID・生成ID・処理段階・復元対象値を保持する。JWT・接続文字列・Auth応答は保存しない。台帳の改変・環境／UID不一致・所有確認失敗では片付けを拒否する。
- 後片付けは公開中のいいね解除 → 自分の返信を論理削除 → フォロー解除 → 自分の栞を論理削除 → 栞の参照がない本棚だけ削除 → プロフィール復元の順。隠れた元栞へのいいね解除404や、論理削除済み栞を持つ本棚の409は残存データとして記録する。
- books、論理削除済み栞・返信、FKで削除できない本棚、専用プロフィール・Authユーザーは残る。通常APIに物理削除を追加せず、管理SQLによる自動掃除やAuthユーザー自動削除もしない。残存ID・理由・量を記録し、必要な物理整理は別の運用作業とする。
- 再実行は新しいrun IDを使う。片付けだけの再実行は台帳を読み、既に削除済みの対象をDBの読み取りで確認して継続する。通信断でPOST結果が不明なら自動再POSTせず、固有語と専用UIDで照合する。IDを回収できなければ「結果不明・要調査」と記録する。

## 5. 実装構成・例外処理・結果記録

`apps/api/scripts/cloud-test.ts` を入口とし、設定・HTTP／DB照合・シナリオを必要な小さいファイルへ分ける。既存Zodと `pg`、標準fetchを利用し、新しいテストランナーは導入しない。`tests/helpers/database.ts` はimportせず、Auth stub作成やマイグレーション適用を実行しない。

追加予定のコマンド（リポジトリルートで実行）:

```sh
pnpm --filter api test:cloud check
pnpm --filter api test:cloud run
pnpm --filter api test:cloud run --providers
pnpm --filter api test:cloud cleanup --run-id <UUID>
```

`check` は設定形式だけを確認し、ネットワーク・書き込みなし。`run` は開発用指定と全前提確認を必須にする。Workerのデプロイ、環境作成、マイグレーション・権限変更は自動実行しない。

HTTP／DBにタイムアウトを設け、自動リトライは行わない。予期しない401・403・404・409、429、500／503、スキーマ不一致、DB照合不一致は失敗とする。トークン期限切れ・通信断も成功扱いせず、依存する後続は未実施、独立した後片付けは可能な範囲で継続する。片付け失敗で元の失敗を隠さない。全必須シナリオと片付けの確認が完了した場合のみ終了コード0とし、仕様どおりの残存行は明示して許容する。

ログは許可した項目（シナリオ名・status・既知のerror code・所要時間・fixture ID）だけを出し、生の例外・HTTP本文／ヘッダー・SQL・JWT・接続文字列・個人情報を出さない。HTTPはリダイレクトを追従せず、Bearerを別originへ転送しない。

実装時に実行手順書と結果記録を追加し、実行日時（日本時間とUTC）、run ID、ソースcommit、対象環境の別名・配信バージョン、設定確認の成否、各シナリオの成功／失敗／未検証、外部グループ、片付け・残存データを記載する。実Hyperdrive ID等の環境固有値はローカル記録に保持し、Gitへは別名と照合結果を載せる。設計やローカル検証を実クラウドの合格記録に置き換えない。

調査順は、health → binding／接続先／キャッシュ → JWTのプロジェクト・期限・署名方式 → 正式PUT /me → 移行・ロール権限 → fixture ID限定のDB照合とする。環境設定不足などの未検証理由も記録し、秘密値の提示を求めない。

## 6. 設計判断・実装後の確認

| 判断 | 理由・他の選択肢との比較 |
|---|---|
| 通常テストから独立した明示実行CLI | 外部障害・認証・共有データに依存するため。PR CIに組み込む方式では再現性と通常開発を損なう |
| 配信設定の証跡＋HTTP＋読み取り専用DB照合 | healthだけでは実Hyperdrive経路と保存結果を確定できない。診断API新設やWorkerへの管理者接続は不要 |
| 正式2ユーザー＋匿名1ユーザー | 所有者／第三者と匿名公開禁止を実JWTで区別する。claim偽装やAuthテーブル直接作成では認証経路を検証できない |
| APIでfixture作成・可能な範囲の片付け | 本物の認可と制約を通す。全件初期化・物理削除なら本棚FKや論理削除の仕様を隠してしまう |
| 外部書籍APIを別グループ化 | Hyperdrive・DB経路の不具合と、Google Books／openBDの可用性・収録差を分けて判断できる |

CLIの誤環境拒否・ログへの秘密値非露出・片付け対象の限定・失敗時の終了コードはモックHTTP等で通常テストに追加し、実サービスなしで検証する。実装後は `pnpm typecheck`、`pnpm test`、`pnpm check:openapi`、`pnpm build` を実行する。lintは未導入。実クラウドの必須シナリオと証跡が揃うまでIssue完了とはしない。

作業ブランチは `feat/api-cloud-integration-issue-29`。設計をコミットした時点で中断する。実装再開後はCLI・テスト・実行手順／検証記録を意味のある単位でコミットし、検証後にpush・PR作成する。PRには目的・変更点・確認結果・未検証範囲・関連Issue・API／DB変更なしを記載し、レビューリクエストは送らない。
