# 書籍・本棚API 設計書（Issue #10）

状態: 指定方針を反映し、API・テストを実装する。

関連: [Issue #10](https://github.com/Megane14916/book-bear/issues/10) / 基準: main `f99e05e` / 2026-11-03（日本時間）

## 1. 目的・範囲

書籍を検索・取得・登録し、匿名を含む認証ユーザーが自分の本棚と読書進捗を管理できるようにする。READMEと `docs/` の全10文書を確認し、既存のHono/Zod契約、Drizzle定義、認証・DBテスト、CIを基準とする。

対象は以下の9操作。パスは `/api/v1` 以下。栞CRUD・栞の流れ・フィード・SNS操作とフロントUIは後続Issueの範囲とする。

| 操作 | 認証 | 成功時の動作 |
|---|---|---|
| `GET /books/search` | Public | DBと外部APIの候補を `BookSearchResult` で返す |
| `GET /books/{bookId}` | Public | 登録済みの `Book` を返す |
| `POST /books/import` | AnyAuth | 外部候補を再取得。201新規／200同一ISBN再利用 |
| `POST /books/manual` | AnyAuth | ISBNなしの共有書籍を作成し201 |
| `GET /me/books` | Owner | 本人の `UserBookPage` を返す |
| `POST /me/books` | AnyAuth | 本人の本棚へ登録。201新規／200既存再利用 |
| `PATCH /me/books/{userBookId}` | Owner | 読書状態・現在ページを更新し200 |
| `DELETE /me/books/{userBookId}` | Owner | 栞の参照がなければ削除し204 |
| `GET /users/{userId}/books` | Public | 公開中の栞がある本だけ `PublicBookPage` で返す |

## 2. 機能設計

### 2.1 書籍検索・取得

1. 既存の `SearchQuery` で空白のみのqを拒否し、limitは既定20・最大30とする。
2. ISBN検索は空白・ハイフンを除いてISBN-13の接頭辞・桁数・チェックディジットを検証する。ISBN形式の入力が不正なら400。ISBN-10からの変換は今回追加しない。
3. DBはISBNの完全一致、またはタイトル・著者の部分一致で検索する。SQLはパラメーター化し、部分一致の `%`・`_` は検索文字としてエスケープする。
4. 書名・著者検索にはGoogle Booksを使う。ISBNはDBに一致があればその本を返し、なければopenBD、該当なしならGoogle BooksのISBN検索を行う。
5. DB候補を優先し、外部候補のISBNが登録済みならDBの情報と `localBookId` を使う。この照合は候補のISBN集合で一括取得する。ISBNで重複排除し、ISBNなしの外部候補はproviderとproviderIdでまとめ、全体でlimit件まで返す。ISBNなしの別の手動登録本は統合しない。DB候補の順序はタイトル・ID、外部候補はproviderの返却順とする。
6. 検索でDBへ保存しない。該当なしは200と空配列。書籍詳細はDBだけを参照し、存在しなければ404。

外部APIは固定HTTPS originを使用する。Google BooksのIDはURLの単一path要素としてエンコードし、任意URL・redirect先へアクセスしない。各リクエストは5秒で打ち切り、自動リトライは行わない。

外部レスポンスは必要な項目だけ検証・正規化する。ISBNは有効なISBN-13のみ採用し、取得できなければnull。著者・出版社・書影・正整数の総ページ数は欠損を許容する。書影はHTTP(S)のURLだけを返し、API側で画像を取得・複製しない。タイトルや候補IDがない検索要素は除外し、外部応答全体の形式不正は外部API障害として扱う。DBに検索候補がある場合はその候補を200で返し、DBにも候補がなければ502とする。

### 2.2 取り込み・手動登録

- 書き込みの前提は有効なSupabase JWTと `PUT /me` によるプロフィール初期化。未初期化は404とし、各APIでプロフィールを暗黙作成しない。
- importは `provider` と `providerId` だけを受け付け、指定providerから再取得して検証する。取得ID／ISBNと要求の対応を確認し、クライアントの書誌情報は保存しない。再取得した候補に必須情報がなければ502、外部に該当する本がなければ404。
- 有効なISBNがあれば `ux_books_isbn13` を競合判定に使い、`INSERT ... ON CONFLICT DO NOTHING` と既存行の取得で重複を防ぐ。並行要求でも1行だけ作成し、新規は201、既存は200。既存の書誌情報を上書きしない。
- ISBNなしのimport・手動登録は重複を許容し、それぞれ新規作成する。新しいUNIQUE制約・マイグレーションは追加しない。sourceとsourceIdは出所の追跡に使い、タイトルやproviderIdを理由に共有マスタを自動統合しない。
- manualは既存の `ManualBookRequest` を再利用する。タイトルはtrim後必須、authorとtotalPagesは任意。ISBN・所有者ID等の未知フィールドは400。`isbn13=null`、`source=manual`、作成者はJWTのsubを保存する。
- 手動登録のレート制限は今後の課題とする。今回は実装・テスト・完了条件に含めず、advisory lockや管理テーブルも追加しない。
- 書籍登録と本棚登録は別リクエスト。前者が成功して後者が失敗しても共有書籍は保持し、本棚登録を再試行できる。

### 2.3 本棚・公開本一覧

- `/me/books` の所有者は検証済みJWTのsubだけで決定する。一覧・更新・削除のSQLすべてに `user_id = sub` を含める。他人のuserBookIdと存在しないIDは同じ404にする。
- 本棚登録は `(user_id, book_id)` のUNIQUE制約で競合処理する。再登録は既存の状態・進捗・作成更新日時を変更せず200。新規時のstatus省略はDB既定値 `want_to_read`、currentPageはnull。存在しないbookIdは404。
- PATCHはstatusとcurrentPageだけを受け付ける。空PATCH・未知フィールド・不正な列挙値を拒否。currentPageはPostgreSQL INTEGERの範囲内の0以上の整数またはnullで、総ページ数を上限にしない。省略は保持、nullは解除。createdAtは保持する。
- DELETEは所有者条件付きで削除する。栞へのFK違反は、該当する制約を確認して409 `HAS_BOOKMARKS` に変換する。事前SELECTだけに依存せず、並行して栞が作成されてもDBのFKで保護する。共有のbooks行は削除しない。
- **論理削除済みの栞も行が残っていれば409とする。** 既存FKはdeletedAtによらず参照を保護する。DB設計書の「栞を削除後に削除」は論理削除との関係が曖昧なため、本Issueでは栞・返信・いいねの物理削除やCASCADEを導入しない。実装時にDB/API設計書へこの制約を追記する。
- 公開本一覧は対象プロフィールの存在を確認し、存在しなければ404、存在して対象本がなければ200と空配列。`EXISTS (visibility='public' AND deleted_at IS NULL)` を使い、本ごとに1件を返す。本人からの要求でも公開本だけとし、私有本棚は `/me/books` を使う。
- 公開本一覧は `BookSummary` の項目だけを返す。読書状態・進捗・userBookId・非公開栞の本文／件数は返さない。匿名による共有書籍の登録は許可されるが、栞の公開権限は付与されない。

### 2.4 一覧カーソル

本棚と公開本一覧は `user_books.created_at DESC, id DESC`、既定15・最大30件。limit+1件を取得し、続きがある場合だけ最終返却行からnextCursorを生成する。日時はDBの精度を保持し、同時刻・ミリ秒未満の差でも欠落や重複を防ぐ。

カーソルはDB精度の境界日時とUUIDを含むJSONをBase64URL化する。HMAC署名・有効期限・追加Secretは使わない。形式・日時・UUIDが不正なら400 `INVALID_CURSOR`。日時はPostgreSQLからUTC・小数6桁の文字列として取得し、JavaScript Dateを介さずSQLのtimestamptz境界へ渡す。カーソルは認可の根拠にせず、ユーザーを切り替えたり境界を変更してもSQLの所有者・公開条件を毎回適用する。

## 3. 例外処理・認可

| 状況 | 応答・制約 |
|---|---|
| 入力不正・不正JSON・整数範囲外 | 400 `VALIDATION_ERROR`。共有count/positivePageを変更する場合も必要なDB整数上限だけ追加 |
| 必須JWTなし・不正・期限切れ | 401 `UNAUTHORIZED`。DB・外部APIアクセス前に拒否 |
| 他人の本棚／対象なし／プロフィール未初期化 | 404 `NOT_FOUND`。他人の本棚の存在や栞の有無を明かさない |
| 本棚に栞の参照が残る | 409 `HAS_BOOKMARKS` |
| 外部通信失敗・timeout・上流429/5xx・不正応答 | 検索ではDB候補があれば既存の形式で200、DB候補もなければ502 `BOOK_PROVIDER_UNAVAILABLE`。importの障害は502 |
| 外部検索で正常に0件／openBDの該当なし | 空結果として扱う。import時の該当なしは404 |
| 認証基盤の設定不備 | 503 `INTERNAL_ERROR` |
| その他のDB・内部エラー | 500 `INTERNAL_ERROR`。SQL・接続情報・上流本文・キーを公開しない |

JWT検証は既存の `authentication` を再利用する。Publicの3操作は既存契約どおり認証に依存せず、本人用分岐を設けない。その他は匿名・正式の両方を許可する。認証付きAPIと公開本一覧は成功・失敗とも `Cache-Control: no-store`。Hyperdriveのクエリキャッシュ無効、Data API不使用、既存RLS・アプリ専用DBロールを維持する。

## 4. 実装構成・設計判断

| 判断 | 理由・比較 |
|---|---|
| `books`・`library` にroutes/http/service、外部通信は `integrations` | 既存usersの構成を踏襲し、HTTP・業務/DB処理・provider変換を分ける。単純CRUDにRepository用の抽象クラスを追加しない |
| DBのUNIQUE・FKとAPI認可を併用 | 事前存在確認だけでは並行要求を防げない。RLSは利用者JWTの文脈を持たないため、所有者条件をAPIでも必須にする |
| 公開本一覧はEXISTS | JOINで栞の件数分だけ本が重複することを避け、公開条件をSQL内で完結させる |
| 単純なBase64URLのkeysetカーソル | OFFSETの位置ずれを避け、境界行の削除後も継続できる。署名・期限管理を省き、認可は常にSQL条件で保証する |
| 外部通信は標準fetchと小さな変換関数 | SDK・汎用providerフレームワークを増やさず、fetchをテストへ注入して障害を再現できる |
| 既存DB構造を利用 | books・user_books・bookmarksに必要な列と制約がある。追加マイグレーションは予定しない。新規インデックスは実測で必要な場合のみ検討 |

Google Booksの公開書誌取得にはアプリ用APIキーを使う。`GOOGLE_BOOKS_API_KEY` をWorker Secretとして扱い、ユーザーのGoogle OAuth権限を追加しない。ローカル例と設定手順を追加し、リモート設定CLIがSecretをvarsへコピーしないことを維持する。[Google公式の認証・API説明](https://developers.google.com/books/docs/v1/using)

openBDはISBN取得に使い、未収録・項目欠損・書影なしを許容する。公式には代替書誌への切替と書影収録範囲の縮小が案内されている。外部データは書籍紹介目的で利用し、書影は提供URLを参照する。[openBD仕様・利用条件](https://openbd.jp/)、[代替書誌のお知らせ](https://openbd.jp/news/20230829.html)

## 5. 契約とテスト

### 契約の維持

- 既存Zodスキーマ・パス・operationId・JSON形状を再利用する。対象9操作だけをplannedRoutesから実ルートへ移し、二重登録を防ぐ。
- 実装後に対象を `implemented` とし、説明・必要な404/503等を実挙動へ合わせる。全36操作（主要34＋health2）とoperationIdの一意性、初期ドラフトの操作網羅チェックを維持する。planned件数は28→19へ更新し、未実装操作の404検証を残す。
- `pnpm generate:openapi` で `contracts/openapi.json` とWeb生成型を更新する。手編集せず、生成型の型テスト・`pnpm check:openapi` を維持する。共通スキーマを変更した場合は他操作への生成差分も確認する。
- MSWは現在未導入。新しいモック基盤は追加せず、導入済みになっていれば関連する既存ハンドラーだけ更新する。

### 追加するテスト

既存の署名鍵fixtureと使い捨てPGlite／CI PostgreSQL 17、アプリ専用ロールを使い、HonoへのHTTP要求からDBの結果まで検証する。外部HTTPだけをfixture化し、認可やDB更新をモックだけで保証しない。

| 対象 | 必須確認 |
|---|---|
| 書籍 | DB／外部検索、既定・上限limit、ISBNの正規化・不正値、候補重複・既存localBookId、書影・著者・ページ数欠損、空結果・詳細404 |
| 保存 | import再取得・要求IDとの対応、ISBN重複と並行取り込み、200/201、ISBNなし複数行、manual未知フィールド拒否、作成者追跡・失敗時のDB不変 |
| 本棚 | 匿名／正式による登録→取得→更新→削除、再登録と並行登録の冪等性、null解除・省略保持・作成日時保持、総ページ超過の許可 |
| 認証・所有者 | JWTなし／不正で全保護操作401、本文やmetadataからの所有者偽装拒否、他人の本棚が一覧に混ざらずPATCH/DELETEも404、失敗時にDBが変化しない |
| 削除 | 公開・非公開・論理削除済みの栞を持つ本人の本棚は409、他人なら404。共有書籍保持。CI PostgreSQLで登録競合と削除／栞挿入の参照整合性も検証 |
| 非公開情報 | 公開栞あり・非公開のみ・削除済み公開のみ・栞なしを混在させ、公開本一覧に許可した本だけが一度ずつ現れる。状態・進捗・栞本文／件数が漏れないことを全ページで確認 |
| カーソル | 15件境界・同一日時・高精度日時・次ページ・空末尾、途中の追加／削除、形式・日時・UUID不正の400、境界変更・別ユーザー／別一覧への転用でも認可条件を維持、ページ間で公開条件を再評価 |
| 障害・契約 | 外部404・429・5xx・通信失敗・timeout・不正JSON、DB候補ありの200／候補なしの502、必須設定欠落、秘密情報の非露出、レスポンスのZod適合、認証／公開本一覧のno-store |

**栞APIの認可に関する区切り**: 既存の `requireRegistered` が検証済み匿名JWTを403で拒否するテストは継続実行する。本Issueでは匿名ユーザーへ栞公開機能を追加せず、未実装の栞APIの404チェックも残す。ただし、この404やガード単体テストを「実際の公開操作を403で拒否できた」証拠にはしない。他人の非公開栞への直リンク404、匿名による公開作成・非公開→公開の403、他人の本棚を指定した栞作成拒否は、後続の栞CRUD実装で実APIとDBを使う必須テストとする。今回の非公開情報の保護は公開本一覧の実APIで検証する。

完了時は `pnpm typecheck`、`pnpm test`、`pnpm check:openapi`、`pnpm build` を実行する。DB構造を変更した場合は `db:generate`／`db:check` と生成差分も確認する。lintは未導入のため実行できたとは記載しない。

## 6. 作業の進め方

作業ブランチは `feat/api-books-library-issue-10`。方針修正をコミット後、書籍API・テスト、本棚／公開本一覧API・認可テスト、契約・ドキュメントの順で意味のある単位にコミットする。

実装と検証完了後にpushし、目的・変更点・確認結果・関連Issue・API／DB差分を記載したPRを作成する。レビューリクエストは送らない。
