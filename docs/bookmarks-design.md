# 栞CRUD API 設計書（Issue #11）

状態: 設計案。今回は本書の作成・コミットで中断し、API実装・新規テスト・PR作成は行わない。

関連: [Issue #11](https://github.com/Megane14916/book-bear/issues/11) / 基準: main `82f9c29`（PR #20マージ後） / 2026-11-03（日本時間）

## 1. 目的・範囲

匿名ユーザーが本人の本棚へ非公開の栞を保存し、正式ユーザーが公開投稿できるようにする。既存の要件・API/DB・認証・開発ドキュメントと、Issue #10の実装・生成契約を基準とする。

対象は以下の5操作。パスは `/api/v1` 以下。栞の流れ、フィード、いいね・返信・フォロー操作、検索、フロントUIは後続Issueとし、今回新設しない。

| 操作 | 認証・権限 | 成功応答 |
|---|---|---|
| `POST /bookmarks` | 匿名・正式。本人の本棚のみ。公開は正式のみ | 201 `BookmarkCard` |
| `GET /bookmarks/{bookmarkId}` | JWT任意。公開または本人の非公開のみ | 200 `BookmarkCard` |
| `PATCH /bookmarks/{bookmarkId}` | 本人のみ。更新後が公開なら正式のみ | 200 `BookmarkCard` |
| `DELETE /bookmarks/{bookmarkId}` | 本人のみ | 204（本文なし） |
| `GET /me/bookmarks` | 匿名・正式。本人のみ | 200 `FeedPage`（公開・非公開を含む） |

## 2. 機能設計

### 入力・作成

- 既存の `CreateBookmarkRequest`／`PatchBookmarkRequest` を使う。本文はtrim後1〜2,000文字。pageNumberはnullまたは1〜2,147,483,647の整数で、総ページ数を上限にしない。DB整数上限は栞の入力スキーマだけへ追加する。
- 作成時のvisibility省略は `private`、isSpoiler省略はfalse、pageNumber省略はnull。タイトル・著者・所有者・日時等を入力から指定することはできない。未知フィールド・不正JSON・不正な型は400。
- JWTのsubと `user_books.user_id` を照合して本人のuserBookIdを確認する。他人の本棚・存在しない本棚は同じ404。プロフィール／本棚を暗黙作成せず、進捗も自動更新しない。
- 所有者確認後、匿名の `visibility=public` は403 `REGISTRATION_REQUIRED`。正式なら公開・非公開とも作成できる。同一内容の再投稿は別の栞として作成する。
- 作成と応答取得は同一トランザクション。対象本棚を所有者条件付きで読み、参照を保護する行ロック（KEY SHARE）を取ってからINSERTする。並行削除は既存FKでも保護し、対象本棚の消失による該当FK違反だけを404へ変換する。

### 読み取り・所有者判定

- 所有者は `bookmarks → user_books.user_id` から求め、リクエスト本文・metadataのIDや匿名状態を信用しない。JWTは既存の検証を再利用し、詳細取得にJWTが送られた場合も必ず検証する。
- 詳細SQLは `deleted_at IS NULL AND (visibility='public' OR user_books.user_id=viewerId)`。未認証は公開のみ。本人以外の非公開・削除済み・存在しないIDはすべて404とし、本文・所有者・件数を返さない。
- 自分の一覧は `user_books.user_id=jwt.sub AND deleted_at IS NULL`。本人の公開・非公開だけを返し、未初期化プロフィールは404、初期化済みで栞なしは空配列。認可・削除条件はSQLで毎回適用する。
- `BookmarkCard` のauthorとbookは既存の `UserSummary`／`BookSummary`。本棚の進捗・状態やuserBookIdは返さない。公開本文はisSpoilerや閲覧設定にかかわらず返し、初期非表示はフロントの責務とする。
- likeCount・replyCount・likedByMeは既存DBから実数を返す。返信数は未削除のみ、未認証のlikedByMeはfalse。未実装の操作があることを理由に0固定にはしない。私有化しても既存のいいね・返信は消去しない。
- 詳細・一覧とも成功／失敗を含め `Cache-Control: no-store`。Hyperdriveのキャッシュ無効・Data API不使用・既存RLSとアプリ専用ロールを維持する。

### 編集・論理削除

- 編集はcontent・pageNumber・visibility・isSpoilerだけを受け付け、空PATCHを拒否する。省略は保持、pageNumberのnullは解除。userBookId・所有者・createdAtは変更できない。
- 編集は同一トランザクション内で、所有者・未削除条件を満たす栞の行をUPDATEロックしてから判定する。更新後のvisibilityがpublicなら匿名は403。visibility省略で既存の公開栞を編集する場合も同様とし、匿名が公開状態のまま編集する抜け道を作らない。本人の公開→非公開への変更と削除は匿名JWTでも許可する。
- 所有者・未削除の確認を403判定より先に行い、他人の公開／非公開栞へのPATCHはどちらも404。UPDATE／DELETEのSQLにも所有者・未削除条件を残し、事前判定だけに依存しない。
- DELETEは物理削除せず、deletedAtとupdatedAtを同じDB時刻で更新する。本文・関連いいね・返信は内部に保持し、返却しない。削除済みへのGET／PATCH／再DELETEは本人も404。createdAtは保持する。
- 既存の公開プロフィール件数・公開本一覧は公開中かつ未削除の栞だけを参照するため、非公開化・削除後は対象から外れる。本棚は残す。論理削除済み栞を参照する本棚の削除は、Issue #10どおり409 `HAS_BOOKMARKS` のままとする。

### 一覧と集計

- 自分の一覧は `bookmarks.created_at DESC, id DESC`。既定15・最大30件でlimit+1件を取得し、続きがある場合のみ最終返却行からnextCursorを作る。ページ番号は順序に使わない。
- 既存の `shared/cursor.ts` の日時・IDのBase64URL形式を再利用する。署名・有効期限・追加Secretは導入しない。SQLからUTC・小数6桁の日時文字列を取り、JavaScript Dateへ変換せず境界比較へ渡す。
- 不正な形式・日時・UUIDは400 `INVALID_CURSOR`（空文字は既存入力スキーマの400 `VALIDATION_ERROR`）。別ユーザーや本棚のカーソルを渡しても、本人・未削除条件を毎回SQLで適用する。
- 一覧は先に本人の栞をlimit+1件へ絞り、返却する最大limit件について書籍・著者をJOINし、いいね／未削除返信を対象ID集合でそれぞれ一括集計する。詳細も同じ集計処理を使う。件数が多重JOINで膨らまないよう、いいねと返信を直接掛け合わせない。1件ごとのDB往復は作らず、返却データのSQLにも所有者・削除条件を適用する。

## 3. 例外処理

| 状況 | 応答・DBへの影響 |
|---|---|
| 入力・JSON・UUID・整数範囲の不正 | 400 `VALIDATION_ERROR`、書き込みなし |
| 必須JWTなし・不正・期限切れ／任意JWTが不正 | 401 `UNAUTHORIZED`。保護操作は本文検証・DB処理より先に拒否 |
| 本人の対象に対する匿名の公開作成・公開状態への編集 | 403 `REGISTRATION_REQUIRED`、書き込みなし |
| 他人の本棚への投稿・他人の栞の変更・非公開の閲覧・削除済み・対象なし | 404 `NOT_FOUND`、存在の違いを公開しない |
| 認証設定不備・JWKS取得障害 | 503 `INTERNAL_ERROR` |
| その他のDB・内部障害 | 500 `INTERNAL_ERROR`。トランザクションを取り消し、SQL・トークン・内部情報を返さない |

## 4. 設計判断・変更範囲

| 判断 | 理由・他の選択肢との比較 |
|---|---|
| `modules/bookmarks` にroutes/http/serviceを追加 | 既存構成に合わせ、認証・入出力・所有者判定とDB操作を整理する。新しいRepository基盤や汎用認可フレームワークは追加しない |
| APIのJWT検証とSQLの所有者・公開条件を併用 | UIや利用者JWTの文脈を持たないRLSだけでは認可を保証できない。他人の非公開対象は403ではなく404に統一する |
| 更新後の公開範囲と行ロックで判定 | 入力の `visibility=public` だけを見る方式では、省略PATCHや並行更新で判定がずれる。既存の署名済みisAnonymousを使い、metadataによる昇格は許可しない |
| 論理削除と既存カーソル・集計の再利用 | 関連データを壊さず、日時精度・JSON契約を維持する。物理削除・署名管理・追加キャッシュは導入しない |

DB列・FK・インデックス・UNIQUE制約・マイグレーション・依存ライブラリの変更は予定しない。レート制限は今後の課題とし、今回の実装・テスト・完了条件に含めない。DB処理は既存withDatabaseの範囲で行い、外部書籍APIや認証サービスへのHTTP待機をDBトランザクションへ持ち込まない。

既存5操作だけをplannedRoutesから実ルートへ移し、`implemented` に変更する。operationId・パス・JSON形状・既定値は維持し、必要な入力上限・エラー説明・カーソル説明だけを実装へ合わせる。全36操作の一意性、初期契約の網羅、未実装操作の404検証を残し、planned件数は19→14へ更新する。生成契約とWeb型は既存コマンドで再生成し、手編集しない。MSWは現在未導入のため、新規モック基盤は作らない。

## 5. 検証方針・完了条件

署名鍵fixtureと使い捨てDB、アプリ専用ロールを使い、HonoへのHTTP要求から実際のDB状態まで検証する。認可ガード単体や未実装APIの404を、栞CRUDの認可検証の代わりにしない。

| 項目 | 必須確認 |
|---|---|
| 正常系・入力 | 匿名の非公開CRUD／正式の公開・非公開CRUD、既定値・trim・文字数境界、ページnull・最大整数・総ページ超過、空／未知PATCH・所属先変更・不正JSONの拒否、作成日時保持 |
| 認証・認可 | 全保護操作のJWTなし・不正・期限切れ401、任意JWT不正401、未認証／匿名／他の正式ユーザーの非公開詳細404、他人の公開・非公開栞の変更404、他人の本棚へ投稿404。失敗時のDB不変も確認 |
| 匿名の公開操作 | 公開作成・private→publicを実APIで403、既存公開栞へのvisibility省略PATCHも403、public→privateと削除は可。metadata偽装で回避できず、同UIDの正式JWTへ切替後は公開可 |
| 削除・既存API連携 | 削除後の本人／第三者のGET・PATCH・再DELETEは404、本人一覧から消失、非公開化・削除で公開プロフィール件数／公開本一覧から除外。関連行は保持し、本棚削除の409を維持 |
| 一覧・集計 | 公開／非公開／他人／削除済みの混在、既定15・上限30・空結果、同時刻とマイクロ秒の境界、ページ番号逆順、追加・境界行削除後の継続、別人／別一覧のカーソルでも漏えいなし。不正カーソル400 |
| 応答・性能・障害 | likeCount・replyCountの複数件と削除返信除外、JWT有無によるlikedByMe、Zod応答適合・余分な私有項目なし・no-store、SQL往復数が投稿数に比例しないこと、DB障害で内部情報非露出・ロールバック |
| 並行処理・契約 | CI PostgreSQLで作成と本棚削除、編集と削除／公開範囲変更の競合を確認。共有DBのfixture ID等を独立させる。既存の書籍検索・DB接続解放・認証・契約テストを維持 |

実装完了時に `pnpm typecheck`、`pnpm test`、`pnpm check:openapi`、`pnpm build` を実行し、設計書・実装・生成契約を照合する。DB変更が必要になった場合だけ理由を明記して生成・整合性確認を追加する。lintは未導入のため実行済みとは記載しない。

## 6. 作業手順

ブランチは `feat/api-bookmarks-issue-11`。本設計書をコミットした時点で中断する。再開後はAPIと認可・DBテスト、契約・生成型・関連ドキュメントを意味のある単位でコミットする。実装と検証完了後にPRを作成し、目的・関連Issue・動作確認・API／DB差分を記載する。レビューリクエストは送らない。
