# 投稿検索・ユーザー検索API 設計書（Issue #25）

状態: 設計レビュー待ち・API未実装。基準: main `bb46743`（PR #24マージ後）／2026-11-03（日本時間）。

関連: [Issue #25](https://github.com/Megane14916/book-bear/issues/25)、[要件書（F-17）](requirements.md)、[API設計書・検索](api.md#26-検索)、[DB設計書](database.md)、[認証設計](auth-design.md#7-honoのjwt検証と認可)、[全体フィード設計](feed-design.md)。

入力の正本は [既存の検索ルート定義](../apps/api/src/contracts/routes.ts) と [共通Zodスキーマ](../apps/api/src/shared/schemas.ts)。投稿検索の応答は [FeedPage／BookmarkCard](../apps/api/src/modules/bookmarks/schemas.ts) を維持し、ユーザー検索の応答は [usersのスキーマ](../apps/api/src/modules/users/schemas.ts) に検索専用のSearchUserItem／SearchUserPageを追加する。現行契約のUserPageからの差分は第5節に整理する。

## 1. 目的・範囲

公開栞の本文と、他の読者の発見・プロフィール閲覧・フォローにつなげるための登録確認済みユーザーの表示名・handleをDB内で検索できるようにする。既存2操作のパス・operationId・入力を維持し、変更する成功レスポンスのJSON契約はGET /search/usersだけとする。

| 操作 | 認証 | 結果・順序 |
|---|---|---|
| `GET /api/v1/search/posts`（getSearchPosts） | OptionalAuth | FeedPage。投稿日時・IDの降順、既定15件・最大30件、カーソルあり |
| `GET /api/v1/search/users`（getSearchUsers） | Public | SearchUserPage。登録確認済みのみ、表示名・IDの昇順、既定20件・最大30件、nextCursorは常にnull |

書籍検索、返信本文・bio・書名による投稿検索、UI、外部API、検索ランキングは対象外。DB構造・索引・マイグレーション・依存ライブラリ・追加Secretは変更しない。

## 2. 機能・認証・公開範囲

### 共通の検索条件

- qは既存Zodでtrim後1文字以上。前後の半角／全角空白を除き、内部の空白は維持する。語分割・AND検索・全角半角変換・かな変換は行わず、検索語全体の部分一致とする。既存契約にない文字数上限は追加しない。
- PostgreSQLのILIKEを使い、英字の大小文字を区別しない。比較はDBの照合順序に従い、読み仮名順や日本語の高度な正規化を保証しない。
- [書籍検索](../apps/api/src/modules/books/service.ts) と同様に、検索語中のバックスラッシュ・`%`・`_` をエスケープした上で前後に `%` を付ける。値はDrizzleでバインドし、検索語をSQL文字列へ埋め込まない。利用者の `%`・`_` を任意のワイルドカードとして解釈しない。
- 一致0件は200 `{ items: [], nextCursor: null }`。検索に一致しないことを404にはしない。成功・失敗とも `Cache-Control: no-store` とする。

### 投稿検索

- SQLで `visibility='public' AND deleted_at IS NULL` と本文一致を必須にする。未認証・匿名・正式・投稿者本人とも検索対象は同じで、本人の非公開栞も含めない。非公開／削除済み行は件数やnextCursorの根拠にも使わない。
- 既存 `authentication.optional` を使い、提示JWTを必ず検証する。検証済みsubをlikedByMeにだけ利用し、metadataやクエリによるUID指定は使わない。正式登録ガード・閲覧者のプロフィール初期化確認は不要で、有効なJWTならプロフィール未初期化でも閲覧可能。
- 既存BookmarkCardの投稿者・書籍の要約と、いいね数・未削除返信数を返す。未認証のlikedByMeはfalse、JWTがあればそのUIDのいいね状態を返す。返信本文や本棚ID・読書進捗・設定は含めない。
- 公開栞の本文とisSpoilerは既存カード契約どおり返す。ネタバレ本文・抜粋の初期非表示はUIの責務とし、APIの表示設定参照・本文削除・新しい抜粋フィールドは追加しない。

### ユーザー検索

- SQLの必須条件を `profiles.registration_confirmed_at IS NOT NULL AND (profiles.display_name ILIKE pattern OR profiles.handle ILIKE pattern)` とする。OR全体を括弧で囲み、表示名・handleのどちらに一致しても登録確認を要求する。確認条件をORDER BY・LIMITより前に適用し、対象外のプロフィールで返却枠を消費しない。handleがNULLでも表示名の一致で取得し、両方一致してもプロフィールは1回だけ返す。
- Public契約（security=[]）を維持し、認証ミドルウェアを付けない。Authorizationヘッダーを送っても参照・検証せず、不正JWTを理由に401にしない。個人別の応答やfollowedByMeは追加しない。
- [フォローPUT](../apps/api/src/modules/social/service.ts) の対象条件と同じく、registration_confirmed_atが非NULLのプロフィールに限定する。匿名のままのプロフィール、正式ユーザーでも正式JWTでPUT /meを行っていない未確認プロフィールは除外する。検索する側はPublicのままで、未認証・匿名の閲覧者も登録確認済みユーザーを検索できる。
- registration_confirmed_atは厳密な登録日や現在のAuth状態ではなく、正式JWTによるPUT /meの初回確認履歴。[既存の記録処理](../apps/api/src/modules/users/service.ts) は匿名JWTでは記録・消去・上書きせず、正式JWTの再実行でも確認日時を変えない。匿名から昇格したユーザーは正式JWTでPUT /meを実行した後に検索対象になる。ログイン・昇格後のPUT /meという既存の接続条件を維持し、検索での暗黙記録・Authテーブル照会・Auth管理API・追加権限は導入しない。
- DBから `id`・`displayName`・`avatarUrl`・`handle` の4項目だけを射影し、SearchUserItemとして返す。handleは既存のnullableなhandleスキーマを再利用し、未設定なら必ずnull。email・Authメタデータ・匿名状態・登録確認日時・本棚・栞・設定は返さず、確認日時はSQLの絞り込みにだけ使う。
- この絞り込みはGET /search/usersだけの検索条件。既存GET /users/{userId}の閲覧権限・応答、フォロー／フォロワー一覧の認可・応答は変更しない。検索に出ないことを公開プロフィールの閲覧禁止へ結び付けない。
- `ORDER BY profiles.display_name ASC, profiles.id ASC LIMIT limit`。表示名が同じ場合はUUIDで順序を確定し、関連度・handle一致を優先しない。DBの照合順序に従うため、異なる環境間の日本語の並び順までは保証しない。
- カーソル入力のない既存SearchQueryを維持し、nextCursorは常にnull。31件以上の登録確認済みプロフィールが一致しても最大30件だけを返し、limitを超える候補は追加取得できない。これはMVPで既存入力契約を維持する意図的な制限で、カーソルページング・関連度ランキングは今回の対象外。limit+1の取得や全件数の集計は不要。未知クエリ項目の扱いも既存Zodを維持し、cursorを送ってもページングには使わない。

## 3. 処理の流れ・例外

### 投稿検索

1. `/api/v1/search/posts` に登録したauth.optionalでJWTを検証する。JWT不正は入力検証より先に401。JWT未提示はそのまま進む。
2. 既存 `PaginationQuery.extend({ q: nonEmptyText() })` と等価なZod定義でq・limit・空カーソルを検証する。失敗時は400 VALIDATION_ERROR。
3. handler内で既存decodeCursorを呼び、内容不正なら400 INVALID_CURSOR。ここまでDBに接続しない。
4. withDatabase内で、本文一致・公開・未削除・カーソル境界を満たす候補IDをCTEで最大limit+1件に絞る。`created_at DESC, id DESC` を使う。
5. 既存listPublicBookmarksのカード取得を利用し、候補とuser_books・profiles・booksをJOINする。最終SELECTにも本文一致・公開・未削除条件を適用し、同じ降順を指定する。FKによる参照整合性を維持し、所有者の特定のための本棚JOINから私有項目を返さない。
6. 返却するlimit件だけに既存 `withCounts<T extends { id: string }>` を適用する。いいねと未削除返信をそれぞれ対象ID集合で一括集計する。空配列なら集計しない。
7. limitを超える閲覧可能な一致行がある場合だけ、最後の返却行の投稿日時・IDからnextCursorを生成する。FeedPageを200で返す。

取得1回＋集計2回を基本とし、カード件数に比例する問い合わせを増やさない。likesとrepliesの無条件な多重JOINは行わない。読み取りに明示トランザクション・行ロックを追加せず、既存withDatabaseで接続を解放する。

### ユーザー検索

no-storeを設定するルート固有ミドルウェア → SearchQueryによる入力検証 → withDatabase内でprofilesの登録確認済み条件と部分一致をANDで適用 → 表示名・ID昇順でlimit件をSELECT → 4項目のitemsとnextCursor=nullをSearchUserPageで200返却する。DB検索は1回で、JWT検証・閲覧者の初期化確認・関係集計は不要。検索対象の登録確認は取得後のフィルターで代用しない。

### エラーの優先順位

| 条件 | 応答・DB接続 |
|---|---|
| 投稿検索で提示JWTが不正・期限切れ（不正入力と同時でも） | 401 UNAUTHORIZED。DB未接続 |
| 投稿検索でJWT検証用設定不備・JWKS取得障害 | 既存認証の503 INTERNAL_ERROR。DB未接続 |
| JWT未提示／有効JWTの投稿検索、またはユーザー検索でq未指定・空白のみ・不正limit・投稿検索の空カーソル | 400 VALIDATION_ERROR。DB未接続 |
| 投稿検索でZod通過後のカーソル形式・日時・UUIDが不正 | 400 INVALID_CURSOR。DB未接続 |
| ユーザー検索で不正JWTと不正入力が同時にある | JWTは参照せず400 VALIDATION_ERROR。DB未接続 |
| 有効な検索で一致0件／投稿検索の境界より古い一致行なし | 200空配列、nextCursor=null |
| DB未設定・接続／クエリ失敗・その他内部障害 | 既存共通処理で500 INTERNAL_ERROR。SQL・接続情報・JWTを返さない |

認証とエラー変換は [既存ミドルウェア](../apps/api/src/middleware/auth.ts) と [アプリ共通処理](../apps/api/src/index.ts) を使う。両検索に403・404を新設せず、未実装テンプレート由来の429も実装へ持ち込まない。レート制限は将来課題とし、今回の実装・テスト・完了条件に含めない。

## 4. カーソル・変更時の振る舞い

- 投稿検索は [既存カーソル処理](../apps/api/src/shared/cursor.ts) のencodeCursor／decodeCursor／olderThan／preciseTimestampを再利用し、次ページ条件を `(created_at, id) < (lastCreatedAt, lastId)` とする。OFFSET・独自形式・署名・有効期限は追加しない。
- DB日時は小数6桁のUTC文字列で取得し、そのままtimestamptz比較へ渡す。JavaScript Dateでミリ秒へ丸めず、同一日時の行はID降順で取りこぼしを防ぐ。
- カーソルに検索語や閲覧者を埋め込まず、権限の証明として使わない。別検索語・別一覧・存在しない行由来の妥当なカーソルも単なる境界として扱い、そのリクエストの検索条件・公開条件をSQLで毎回適用する。
- フロントは同じtrim後のq・limitで続きを取得し、q変更時は先頭から再取得する。投稿検索のクライアントキャッシュは検索語と閲覧者UIDを分け、ログアウト／ユーザー切替時に既存の個人別キャッシュ方針を適用する。
- ページ間の編集で本文の一致条件が変わる場合や非公開化・論理削除は次回SELECTに反映する。境界行が非公開化／削除されても続行できる。新規行が境界より新しければ先頭再取得で確認する。投稿日時は編集で変えず、固定スナップショットは保証しない。
- 同時更新については既存一覧と同じSQL実行時の可視性に従う。取得後から応答までの公開変更を排他制御する仕組みは追加しない。

## 5. 実装構成・設計判断・契約

| 判断 | 理由・他の選択肢との比較 |
|---|---|
| searchにroutes.ts／http.tsを追加 | 検索HTTP契約と登録をまとめ、users/schemasの検索専用応答を参照する。DB処理を呼ぶだけのsearch/serviceや汎用Repositoryは不要 |
| bookmarks/serviceのlistPublicBookmarksへ任意のqを追加 | q指定時だけ本文ILIKE条件を候補CTEと最終SELECTへ追加し、既存カード射影・カーソル・内部withCountsをそのまま使う。別の検索SQL・集計処理を複製せず、フィードのall／followingはq未指定で挙動を維持する |
| users/serviceへ小さなsearchUsers関数を追加 | 登録確認済み条件と4項目のSELECTを既存プロフィールモジュールへ置く。取得後のフィルターで返却枠を減らすことやAuth照会を避ける |
| 検索専用SearchUserItem／SearchUserPage | handleによる一致を画面で確認できるようにし、共有UserSummaryの変更によるフォロー一覧・投稿カードへの波及を避ける |
| フォローPUTと同じ登録確認履歴で絞る | 発見した読者をフォローにつなげる用途に合わせる。Authの追加照会や公開プロフィール全体の閲覧制限を増やさない |
| ILIKEによるリテラル部分一致 | 現行要件と既存書籍検索に合わせ、外部サービス・専門検索エンジン・ランキング用データを増やさない |
| ユーザー一覧は安定した昇順・カーソルなし | 現行SearchQueryとnextCursor=nullを維持する。取得上限を超える全候補の閲覧やランキングは将来の契約変更として検討する |

### 検索専用スキーマの配置

実装時は既存 `modules/users/schemas.ts` に次の2スキーマを追加する。同ファイル内の既存handle定義（trim後3〜30文字、小文字英数字・`_`、nullable）をそのまま再利用する。DBのprofiles.handleはnullable TEXT・UNIQUEであり、文字種・長さは既存API側の検証を踏襲し、DB制約やマイグレーションは追加しない。

```ts
export const SearchUserItem = UserSummary.extend({ handle }).openapi('SearchUserItem')
export const SearchUserPage = cursorPage('SearchUserPage', SearchUserItem)
```

UserSummary・UserPage自体は変更しない。SearchUserPageはユーザー検索だけで使用し、既存の公開プロフィール・フォロー一覧・投稿カードの参照先・レスポンス型を維持する。cursorPageのstring | nullという外形を使い、ユーザー検索の実際のnextCursorは常にnullであることをルート説明とテストで保証する。

### 既存Issue・契約との差分と実装時の更新先

実装時は2定義をplannedRoutesからsearch/routesへ移し、index.tsからHTTP登録する。plannedは2→0になるため、使用先を確認して不要になった旧契約専用ファイル・レジストリ登録を整理する。将来用の未実装基盤は残すためだけに拡張しない。

変更する成功レスポンスのJSON契約はGET /search/usersのみで、UserPageから新設SearchUserPageへ切り替え、itemsへnullableなhandleを追加する。GET /search/postsのFeedPage／BookmarkCard、既存UserSummary／UserPageと他APIのJSON契約は変更しない。両検索のパス・operationId・Zod入力・既定値を維持する。

OpenAPIはimplemented、OptionalAuth／Publicの区別、400/401/500/503の適用範囲、同一検索語での投稿ページング、ユーザー検索の登録確認済み条件・handle返却・nextCursor=nullを実動作へ合わせる。投稿検索は400/401/500/503、ユーザー検索は400/500とする。共有カーソル説明の古い「期限切れ」や旧ルートの「署名または厳格照合」は実際の署名・期限なしの方式へ修正し、検証自体は緩めない。

| 更新先 | 実装時に反映する差分 |
|---|---|
| Issue #25「ユーザー検索」 | UserPage／UserSummaryのみを返す記載をSearchUserPage／SearchUserItemの4項目へ変更。検索対象をregistration_confirmed_at非NULLに限定し、未確認の正式ユーザーもPUT /meまでは対象外と明記。現行本文には登録確認による対象制限がないため、その追加も仕様差分として記録する |
| Issue #25「テスト・完了条件」 | 返却フィールドを既存UserSummaryに限定する条件と、JSON契約をすべて維持する条件を修正。ユーザー検索の成功レスポンスだけを変更する例外、登録確認前後・handle返却・31件以上一致の検証を追加する |
| API設計書「現在の契約と実装状況」 | ユーザー検索のUserPage維持という説明をSearchUserPageへ変更し、入力維持・nextCursor=nullを明記。未実装件数の現在形を更新する |
| API設計書「2.6 検索」 | ユーザー検索の登録確認条件・4項目・取得上限超過時の制限を追記。投稿検索のPublic表記をOptionalAuthへ合わせる |
| OpenAPI・Web生成型 | users/schemasの新規2コンポーネントとgetSearchUsersの200レスポンス参照を生成。Webのitems型にhandle: string | nullが増えるため、利用側・型検証を確認する。既存UserSummary／UserPage・投稿検索の応答型に差分がないことを比較する |

Issue #25の現行本文・生成契約は旧仕様のため、この設計との差分を上表に記録する。Issue本文・API設計書・スキーマ・生成物の変更は実装時にまとめて反映する。

OpenAPI・Web生成型は実装時に既存コマンドで再生成する。[契約テスト](../apps/api/src/contracts/openapi.test.ts) はplanned件数・未登録404前提を実装済み2操作へ合わせつつ、全36操作のoperationId一意性・初期ドラフト34操作の網羅・認証・JSON契約の検証を維持する。[Web生成型検証](../apps/web/src/lib/api/generated.type-test.ts) も維持し、検索専用型と既存共有型への影響を確認する。READMEなどの未実装件数の現在形も更新する。MSWは未導入なので新規モック基盤は作らない。

既存の公開フィード用部分インデックスが本文の部分一致を高速化する保証はない。プロフィールのhandleのUNIQUE索引も前方ワイルドカード検索に最適とは限らない。データ量と遅延を確認し、必要時にEXPLAIN (ANALYZE, BUFFERS)で検証して専門索引等を検討する。今回は新規索引・マイグレーションを追加しない。

## 6. 検証方針・実装前の確認点

[createTestDatabase()](../apps/api/tests/helpers/database.ts) と署名済みJWT、アプリ専用DBロールを用いてHTTPから確認する。既存の [フィードテスト](../apps/api/tests/feed.test.ts) の構成を踏襲し、新しい共通テスト基盤は作らない。

| 対象 | 必須確認 |
|---|---|
| 検索条件 | 日本語・英字の大小文字・前後trim・内部空白・リテラルの `%`／`_`／バックスラッシュ・SQL構文に見える語・不一致。投稿は本文だけ、ユーザーは表示名またはhandleで一致。handle=NULL・両方一致でも重複なし |
| 公開範囲・JWT | 未認証・匿名・正式・本人・metadata偽装・プロフィール未初期化で公開未削除のみ。本人／他人の非公開と削除済みを全ページ・nextCursorから除外。別条件カーソルでも認可不変 |
| ユーザー検索の一致・応答 | 登録確認済みユーザーのhandle一致・displayName一致・handle=NULLでの表示名一致・両方一致の重複なし。handleの文字列／nullを返し、生JSONが4項目だけでSearchUserPageに適合する。email・Auth情報・匿名状態・登録確認日時・私有情報を露出しない |
| ユーザー検索の対象 | 匿名のままのプロフィール・正式でも確認日時NULLのプロフィールを除外。正式JWTによるPUT /me後は対象になり、handle=NULLでも取得可能。対象外行を表示名順の先頭や一致集合へ混ぜても返却枠・順序に影響せず、対象外行しかなければ200空配列 |
| Publicのユーザー検索 | JWTなし／匿名／正式／不正JWTの閲覧者へ同じ登録確認済み集合を返す。不正JWTでも認証検証・JWKS取得を行わず正常検索できることを確認する |
| 入力・エラー | 前節の優先順位、q未指定・空白のみ、limitの非数値・非整数・0・31、空／不正カーソル。早期失敗でDB未接続。認証障害503、DB障害500、全応答no-store、安全なエラー本文 |
| 投稿ページング | 既定15・最大30、同一日時・マイクロ秒差・終端・0件。固定fixtureの全ページで重複／欠落なし。境界の削除／非公開化、本文編集による一致解除、新規追加後の取得を確認 |
| ユーザーの順序・上限 | 既定20・最大30、同名時のID昇順、表示名一致とhandle一致の混在。登録確認済みが31件以上一致してもlimit=30で30件だけ、nextCursor=nullで追加取得なし。余分なcursorをページングに使わない |
| 集計・性能・回帰 | 複数いいね×複数返信の実数、削除返信除外、閲覧者別likedByMe。1件と15件で取得＋集計の問い合わせ数が一定、空時は集計なし。q未指定のall／following、CRUD、他人の本棚拒否、匿名の公開操作拒否を既存テストで回帰確認 |
| 実行環境・契約 | 実Workersで検索・認証・DB・カーソルを確認。getSearchUsersだけがSearchUserPageを参照し、既存UserSummary／UserPage・公開プロフィール・フォロー一覧・投稿カード・投稿検索の応答型が変わらないことを比較する。型チェック・全テスト・OpenAPI整合性チェック・ビルドを実行し、設計と実コードを照合する |

テストはケース固有の検索語（UUIDを含む識別子等）をfixtureへ付与し、投稿の全ページの期待値をその一致集合から作る。特殊文字ケースでは識別用の接頭辞と特殊文字を組み合わせ、ワイルドカードとして誤解釈した場合だけ一致する対照行も用意する。ユーザーの同名ケースもケース固有名を使い、handle用の検索語は既存の文字種・30文字上限を守る。ユーザー検索の期待集合は登録確認済みに限定し、未確認fixtureは正式PUT /meを先に呼ばないように準備して、確認前後を実HTTPで検証する。時刻は明示して、DB全体の空状態・件数・現在時刻に依存しない。

CIのPostgreSQLは他テストのデータが残り、既存テストコマンドはファイル並列なしでも同じDBへの別プロセスの書き込みまで防がない。必要なら一致する既存行を含む基準集合を取得するが、並行書き込み後まで不変とは扱わない。自テストの追加・変更は日時と実行順を制御し、無関係な並行追加を固有検索語で分離する。他テストの行を削除・書き換えない。

実装前には、上記のPublicとOptionalAuthの登録範囲、listPublicBookmarksの任意qが既存フィードへ影響しないこと、登録確認と部分一致のAND条件、検索専用スキーマの参照先、Issue本文との明示的な差分、planned専用コードの参照箇所、共有カーソル説明の生成物への影響を再確認する。検索語の長さ制限・高度な日本語検索・ユーザー検索の次ページ・レート制限は将来変更時に契約と性能を検討する事項とし、今回の仕組みへ先回りして組み込まない。
