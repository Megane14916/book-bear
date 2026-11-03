# 全体フィードAPI 設計書（Issue #13）

状態: 実装前の設計。基準: main `2f70a55`（PR #22マージ後）／2026-11-03（日本時間）。

関連: [Issue #13](https://github.com/Megane14916/book-bear/issues/13)、[API設計書・タイムライン](api.md#24-タイムライン)、[要件書](requirements.md)、[DB設計書・全体フィード](database.md#62-全体フィード)。

入力は [FeedQuery](../apps/api/src/modules/feed/schemas.ts)、応答は [FeedPage／BookmarkCard](../apps/api/src/modules/bookmarks/schemas.ts) を正本とし、フィールド定義は複製しない。

## 1. 目的・範囲

`GET /api/v1/feed` のscope省略時および `scope=all` で、公開中の栞を投稿日時の新しい順に取得する。投稿者・書籍情報といいね／返信数をまとめて返し、既定15件ずつ続きを読めるようにする。

フォロー中フィード・フォロー／いいね／返信の操作は [Issue #14](https://github.com/Megane14916/book-bear/issues/14) の範囲。UI、投稿検索、新しいDB構造、キャッシュ基盤は含めない。

### scope=followingとの境界

既存の `scope: all | following` と既定値allを維持する。followingの暫定応答は下記の検証順序に従い、未認証は401 `UNAUTHORIZED`、匿名JWTは403 `REGISTRATION_REQUIRED`、正式JWTは404 `NOT_FOUND` とする。DBへは接続しない。正式JWTへの404は **Issue #14までの一時的な未実装応答**であり、フォロー対象の不存在やフォロー件数を意味しない。Issue #14で実際の取得処理へ置き換える。

実装時にOpenAPIではGET /feed全体が `implemented` となるため、操作の説明に **scope=allのみ実装済み、followingはIssue #14まで未実装**と明記し、API設計書にも反映する。フロントエンドはIssue #14完了までフォロー中フィードを利用可能な機能として扱わず、暫定404を「フォロー対象なし」と表示しない。全体結果や成功した空結果へ代替しない。scopeの列挙値と既存生成型を保ち、新しいエラーコードや未実装機能のための共通基盤は追加しない。

## 2. 業務ルール・認証・認可

| 条件 | 動作 |
|---|---|
| allを未認証・匿名・正式ユーザーで閲覧 | 全員に公開中かつ未削除の栞だけを返す |
| 自分の非公開栞・他人の非公開栞・削除済み栞 | 全体フィードには含めない。件数やnextCursorの根拠にもしない |
| 閲覧できる栞がない／カーソルより古い栞がない | 200 `{ items: [], nextCursor: null }` |
| JWTを提示したが不正・期限切れ | 401 `UNAUTHORIZED`。DB接続前に拒否 |
| 認証設定不備・JWKS取得障害 | 既存認証と同じ503 `INTERNAL_ERROR` |
| DB・その他の内部障害 | 500 `INTERNAL_ERROR`。SQL・接続情報・トークンは返さない |

- JWTは既存の `authentication.optional` で検証する。allの閲覧にプロフィール初期化や正式登録は不要。有効なJWTの閲覧者UIDはlikedByMeの判定にだけ用い、公開条件を緩めない。UID・匿名状態をmetadataやクエリ値から取得しない。
- 応答は既存の `FeedPage`。各itemに `BookmarkCard` の公開プロフィール要約と書籍要約を含める。栞の流れのような共通ヘッダーへは変更しない。本棚ID・読書状態・進捗・設定・返信本文を取得／返却しない。
- 公開本文はisSpoiler・閲覧者の表示設定によらず返す。初期非表示はUIの責務であり、本文表示モードの取得や外部書籍API呼び出しは不要。
- 成功・失敗とも `Cache-Control: no-store`。Hyperdriveのクエリキャッシュ無効、Data API不使用、アプリ専用DBロールと既存RLSを維持する。利用者のJWT文脈はDBへ自動適用されないため、公開・未削除条件は必ずSQLへ含める。

## 3. 処理の流れと集計

1. 既存の任意認証で、提示されたJWTを検証する。不正・期限切れなら入力検証より先に401。JWTがなければ未認証として次へ進む。
2. 既存ZodスキーマFeedQueryでscope・limit・空カーソルなどを検証する。失敗はscopeによらず400 `VALIDATION_ERROR`。この段階ではカーソル内容をdecodeしない。
3. `scope=following` なら検証済みの認証・登録状態に応じて401／403／404で終了する。非空文字列としては有効でも内容が不正なカーソルに対し、followingガードを優先する。decodeCursorもDB接続も実行しない。
4. `scope=all` の場合だけ既存 `decodeCursor()` でカーソル内容を検証する。不正なら400 `INVALID_CURSOR` とし、SQL検索へ進まない。
5. bookmarksを `visibility='public' AND deleted_at IS NULL` と降順の境界で絞り、`created_at DESC, id DESC` で最大limit+1件の候補IDを選ぶ。非公開行を取得後に除外する方式は使わない。
6. 候補IDをCTEで限定した後、user_books → profiles／booksをJOINする。既存のカード用射影と高精度日時を使い、同じ降順を最終SELECTにも指定する。最終SELECTにも公開・未削除条件を保持する。最大31件に限定されたJOINとし、投稿全件へのJOIN・集計を避ける。
7. 先読み1件を除いた最大limit件へ、既存の `withCounts<T extends { id: string }>` をそのまま再利用する。いいねと未削除返信は対象ID集合で各1回の一括集計とし、likedByMeは検証済みUID、未認証はfalse。空結果では集計しない。
8. 閲覧可能な候補がlimit件を超えるときだけ、最後に返すカードの日時・IDからnextCursorを作る。結果とcursorをFeedPageで返す。

参照は既存FKで保護され、JOIN対象はいずれも各栞から1件に決まる。いいねと返信を直接多重JOINして件数を増やさない。取得SQL1回＋集計SQL2回を基本とし、投稿数によってDB往復数を増やさない。読み取りに明示トランザクション・行ロックは追加せず、短いwithDatabaseの範囲で完結させる。

## 4. 降順カーソルと変更時の振る舞い

- 既定15・最大30件。並びは投稿日時とIDだけで決め、pageNumber・updatedAt・本棚登録日時は使わない。
- [既存カーソル処理](../apps/api/src/shared/cursor.ts) のencodeCursor／decodeCursor／olderThan／preciseTimestampを再利用する。次ページは **`(created_at, id) < (lastCreatedAt, lastId)`**。OFFSETや独自のカーソル形式を導入しない。
- 日時とUUIDのJSONをBase64URL化し、署名・有効期限・追加Secretは設けない。日時はPostgreSQLのUTC・小数6桁文字列を保持し、JavaScript Dateでミリ秒に切り捨てずtimestamptz比較へ渡す。
- allのカーソル内容の不正（形式・日時・UUID）は400 `INVALID_CURSOR`。空カーソル・不正scope・limit範囲外は既存Zodで400 `VALIDATION_ERROR`。followingの内容不正カーソルは前節のガードを優先し、既存形式の検証は緩めない。
- 別一覧や別閲覧者の妥当なカーソルも境界値にすぎず、毎回SQLで公開・未削除条件を適用する。非公開行や存在しない行を境界に指定しても、本文・件数・本棚の情報を返さない。
- ページ間の非公開化・論理削除は次回取得で反映する。境界行が消えても続きは読め、新しい投稿は境界より新しければ先頭の再取得で表示する。createdAtは編集で変えず、固定スナップショット・変更履歴の管理は行わない。

## 5. 実装構成・設計判断

| 判断 | 理由・比較 |
|---|---|
| feedにroutes/http、栞取得は既存bookmarks/serviceへ小さな全体取得関数を追加 | FeedQueryの責務を保ちつつ、既存カード射影・withCountsを同じモジュールで使える。集計のコピー、汎用Repository、単に呼び出すだけのservice層を増やさない |
| 候補IDのCTEでlimit+1件に絞ってから関連情報をJOIN | 本人一覧の既存方式を踏襲し、全件JOINを避ける。先読み1件分の関連情報取得を許容してSQLとDB往復を単純に保ち、集計は返却分だけに限定する |
| 全体フィードには本人の非公開も混ぜない | 公開フィードの要件と公開向け部分インデックスの条件を守る。本人の非公開閲覧は既存の本人一覧・栞の流れ・詳細を使う |
| 既存の高精度カーソル・集計を再利用 | 同一日時の境界とN+1を既存方式で扱える。署名管理・カウンタ列・キャッシュ・過剰な共通化は不要 |
| followingはIssue #14へ残し、契約を保って一時404 | 全体フィードの実装範囲を守り、未実装のフォロー結果を成功として返さない。認証と匿名の制限は最初から適用する |

`idx_bookmarks_public_feed` の公開・未削除の部分インデックス、既存のFKと集計用インデックスを利用する方針とする。新しい列・インデックス・マイグレーション・依存ライブラリは追加しない。大規模データでのクエリ計画は必要時にEXPLAIN ANALYZEで検証し、非正規化・キャッシュカウンタ等は実測後に検討する。公開APIのレート制限は今後の課題とし、今回は実装・テスト・完了条件へ含めない。

## 6. 契約と検証方針

実装時にgetFeedの1操作だけをplannedRoutesから実ルートへ移す。既存パス・operationId・入力の既定値・JSON形状を維持し、all実装済み／following未実装、カーソル、401/403/404/500/503を実挙動に合わせて記載する。未実装テンプレートの429は今回の稼働仕様には持ち込まない。全36操作の一意性と初期ドラフトの網羅、未実装操作の404検証を残し、planned件数は13→12にする（followingの実装待ちは別途明記）。

OpenAPIとWeb生成型は既存コマンドで再生成し、[契約検証](../apps/api/src/contracts/openapi.test.ts) と [生成型チェック](../apps/web/src/lib/api/generated.type-test.ts) を維持する。MSWは現時点で未導入のため、新しいモック基盤は作らない。

| 対象 | 実装時の必須確認 |
|---|---|
| 公開範囲・認可 | 未認証・匿名・正式・投稿者本人で公開行だけを返す。他人と本人の非公開、削除済みを全ページから除外。metadata偽装・別一覧カーソルでも条件不変。既存の匿名公開操作403・他人の本棚拒否も回帰確認 |
| 認証・scope | all省略と明示が同じ。プロフィール未初期化でもall閲覧可。下表の優先順位を組み合わせて検証し、followingでdecodeCursor・DB接続が実行されないことを確認。OpenAPIのimplementedだけでfollowing利用可と判断しない説明も確認 |
| 順序・境界 | 複数ユーザー／書籍、pageNumber逆順・null、同一日時・マイクロ秒差、15件既定・30件上限・最終ページ。全ページで重複／欠落なし。編集、先頭追加、境界削除後も正しい順序 |
| 公開変更・カーソル | allでページ間の非公開化・削除を反映し、非公開／削除済みだけでhasMoreを立てない。内容不正はINVALID_CURSOR、空文字・limit不正はVALIDATION_ERROR。境界行が消えても継続可能 |
| 集計・応答・障害 | 複数いいね×複数返信でも実数、削除返信除外、ゼロ件、閲覧者別likedByMe。1件と15件でDB往復数が一定、空時の集計なし。生JSONの私有項目非露出、FeedPage適合、no-store、安全な500/503 |
| 実行環境・回帰 | 署名済みJWT＋使い捨てDB＋アプリ専用ロールでHTTPから検証。実Workersで認証・DB・ページングを確認し、既存CRUD・本人一覧・栞の流れのテストと契約チェックを維持 |

### 入力と暫定ガードの優先順位

| 入力・認証状態 | 期待する応答 |
|---|---|
| 提示JWTが不正・期限切れ（不正クエリとの併存を含む） | 401 `UNAUTHORIZED` |
| JWTなし／有効JWTで、空カーソル・不正scope・不正limit | all／followingとも400 `VALIDATION_ERROR` |
| Zodを通るfollowing（カーソルなし・正常内容・内容不正の各ケース） | 未認証401 `UNAUTHORIZED`／匿名403 `REGISTRATION_REQUIRED`／正式404 `NOT_FOUND`。decodeCursor・DB接続なし |
| Zodを通るallでカーソル内容が不正 | 400 `INVALID_CURSOR`。検索SQLなし |

### テストデータ管理

[createTestDatabase()](../apps/api/tests/helpers/database.ts) は、TEST_DATABASE_URLなしでは独立したPGliteを作り、CIでは同じPostgreSQL DBを利用する。close()はCIの既存データを消さない。現行の [テストコマンド](../apps/api/package.json) は `--no-file-parallelism` だが、同じDBを使う別プロセスや明示的な並行操作による追加まで防ぐものではない。

- 他テストの公開栞が存在する前提で、固定のテスト専用投稿日時とfixture IDで対象を追跡する。現在時刻や実行速度に依存して「最新」「最古」と決めず、他の行が混在しても対象fixtureの順序・重複・公開条件を確認できるようにする。
- 必要に応じて既存公開行を含む基準集合を取得し、既知のfixtureと合わせて期待値を作る。全件一致の比較は書き込みを制御できる区間で行い、取得後に並行追加され得る基準集合を固定した正解として扱わない。
- 完全なページ列の検証は既存の直列実行で行い、同じテストDBを使う別のテストプロセスと同時実行しない。並行追加の検証では自テストから投稿日時と追加タイミングを制御し、カーソル境界との関係、対象fixtureの継続・重複なし・非公開除外を確認する。
- 他テストのデータを削除・書き換えず、DB全体の件数を固定値で断定しない。空結果も検証対象のカーソル境界と基準集合から判断し、DB全体が空であることを前提にしない。

既存fixtureとテスト内の小さなデータ準備で対応し、新しいテスト用共通基盤やスキーマ分離機構は追加しない。

実装完了時は [開発ルール](development.md) に従い、型チェック・全テスト・OpenAPI整合性・ビルドを実行する。本書の作成段階ではAPI・テスト・生成契約を変更しない。
