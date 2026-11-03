# フォロー・いいね・返信・フォロー中フィード 設計書（Issue #14）

状態: 実装前の設計。基準: main `6063e23`（PR #23マージ後）／2026-11-03（日本時間）。

関連: [Issue #14](https://github.com/Megane14916/book-bear/issues/14)、[API設計書](api.md#25-フォローいいね返信)、[要件書の認可](requirements.md#4-アカウント認可)、[DB設計書](database.md)、[認証設計](auth-design.md#8-既存apidbとの接続契約)。入力・応答の詳細は既存の [契約ルート](../apps/api/src/contracts/routes.ts)、[返信スキーマ](../apps/api/src/modules/replies/schemas.ts)、[UserPage](../apps/api/src/modules/users/schemas.ts)、[FeedQuery](../apps/api/src/modules/feed/schemas.ts)／[FeedPage](../apps/api/src/modules/bookmarks/schemas.ts) を正本とし、フィールドを複製しない。

## 1. 目的・範囲

正式ユーザーによるSNS操作とフォロー先の公開栞の閲覧を実現する。対象は以下の既存10操作と、実装済みGET /feedのfollowing分岐。投稿・ユーザー検索、UI、通知、返信への返信・いいね、管理者機能は含めない。

| 操作（/api/v1以下） | 成功時の振る舞い |
|---|---|
| GET /users/{userId}/followers・/following | 公開のUserPage。対象プロフィールなし404、関係なしは空結果 |
| PUT・DELETE /users/{userId}/follow | 本人の関係だけを追加・解除。重複PUT・解除済みDELETEも204 |
| PUT・DELETE /bookmarks/{bookmarkId}/like | 公開中・未削除の栞へ本人のいいねを追加・解除。重複も204 |
| GET /bookmarks/{bookmarkId}/replies | 可読な元栞の未削除返信を古い順にReplyPageで取得 |
| POST /bookmarks/{bookmarkId}/replies | 公開中・未削除の栞へ返信し201 Reply |
| PATCH /replies/{replyId} | 本人の未削除返信と元栞の可読性を確認し、編集して200 Reply |
| DELETE /replies/{replyId} | 元栞の状態によらず自分の未削除返信を論理削除して204（本文なし） |
| GET /feed?scope=following | 正式ユーザー本人のフォロー先の公開・未削除栞を新しい順に取得 |

## 2. 認証・入力検証・認可

- 操作主体のUID・匿名状態は既存JWT検証のsub／is_anonymousだけを使う。metadata・本文・クエリから上書きしない。認証設定・JWKS障害は503、無効・期限切れJWTと必須JWTなしは401。
- フォロー・いいねのPUT/DELETEと返信POSTはRegistered。JWT必須→既存Zod入力検証→正式登録ガード→DBの順とし、妥当な入力の匿名JWTは対象の存在を調べず403 `REGISTRATION_REQUIRED`。正式ユーザーでもプロフィール未初期化は404で、暗黙作成しない。
- 返信PATCH/DELETEはOwnerを維持する。PATCHはJWT必須→入力検証→本人・元栞の可読性確認の順。他人の返信、第三者の非公開元栞、削除済み返信／元栞、対象なしは同じ404。元栞が公開なら匿名は403、非公開で本人の栞なら自分の返信編集は匿名でも可能。
- 返信DELETEはJWT必須→入力検証→返信の所有者・未削除条件だけで判定する。匿名・正式ともに自分の未削除返信を削除でき、元栞が非公開・論理削除済みでも許可する。他人の返信・削除済み・不存在は404。元栞の閲覧権限や正式登録は要求しない。
- 返信一覧はOptionalAuth。提示JWTは必ず検証し、元栞が公開なら誰でも、非公開なら元栞の所有者だけが閲覧可能。返信作者という理由で他人の非公開元栞を読めるようにはしない。
- フォロー／フォロワー一覧は既存のPublic契約（security=[]）を維持し、UserSummaryだけを返す。閲覧者ごとの個別化は行わない。フォロー関係から私有本棚・非公開投稿・匿名状態・内部登録確認項目を返さない。
- 全対象で成功・失敗ともno-store。既存RLS・アプリ専用DBロール・Hyperdriveキャッシュ無効・Data API不使用を維持する。SQLにも各操作に必要な所有者・公開範囲・未削除条件を適用する。返信DELETEは返信自身の条件だけで認可する。

### 検証順序を実現する配置

既存の `authentication.required` はapp.useで対象パスへ先に登録する。ローカルの@hono/zod-openapiの登録順は「ルートmiddleware→Zod validators→handler」であるため、Registered操作の正式登録ガードをapp.useやcreateRouteのmiddlewareへ置かない。app.openapiのhandler冒頭でc.req.validから検証済み入力を受け取り、既存ガードと同じ検証済みidentity.isAnonymousの403判定を行ってからDB処理へ進む。既存requireRegisteredミドルウェアの全体的な変更や新しい認可基盤は不要。

| Registered操作の入力・認証 | 応答と順序 |
|---|---|
| JWTなし・不正・期限切れ＋不正入力 | JWT検証で401。Zod／正式登録判定・DBへ進まない |
| 有効な匿名JWT＋不正なUUID／JSON本文など | Zodで400 `VALIDATION_ERROR`。正式登録判定・DBへ進まない |
| 有効な匿名JWT＋妥当な入力 | handlerの正式登録ガードで403 `REGISTRATION_REQUIRED`。対象の存在確認・DB接続なし |
| 有効な正式JWT＋妥当な入力 | DBの所有者・対象条件の確認へ進む |

followingも既存のfeed/http.tsと同様にhandler内で登録ガードを実行し、Zod検証後・カーソル内容検証前という順序を維持する。返信PATCHの条件付き403は、前述の所有者・元栞確認後に行う。

### フォロー対象の正式登録確認

既存契約はフォロー対象も正式ユーザーであることを求めるが、profilesには登録状態がなく、検証済みJWTで分かるのはアクセス中の本人だけ。[認証設計](auth-design.md#8-既存apidbとの接続契約) はauth.users／auth.identitiesへの読み取り権限追加を禁止している。プロフィール存在、email、metadata、公開栞の有無から正式ユーザーと推測しない。

列名は **registration_confirmed_at**（DrizzleではregistrationConfirmedAt、nullable timestamptz）を採用する。厳密なアカウント登録日時ではなく、**正式JWTで登録状態を初めて確認したDB時刻**であるため、旧案のregistered_atより意味が正確な名前とする。profilesへの追加はこの内部列1つだけで、追加マイグレーションが必要。「DB変更なし」とは扱わない。

- 現行[initializeMe](../apps/api/src/modules/users/service.ts)のprofiles／user_preferencesのON CONFLICT DO NOTHINGと応答取得を含むトランザクションを維持する。その中で、検証済み正式JWTの場合だけ、対象UIDかつ登録確認日時がnullの行へ以下の明示SQLを実行する。UIDはバインドし、日時はDBのnow()を使う。

  ```sql
  UPDATE public.profiles
  SET registration_confirmed_at = now()
  WHERE id = $1::uuid AND registration_confirmed_at IS NULL;
  ```

- 現行の[profiles.updatedAt](../apps/api/src/db/schema/index.ts)には `$onUpdate(() => new Date())` があるため、通常のDrizzle UPDATEへ任せずtx.executeの明示SQLで確認列だけを更新する。既存のcreated_at・updated_at、プロフィール内容・設定・ユーザーIDは変更しない。並行する正式PUTでもnull条件を再評価し、一度記録した日時を上書きしない。
- 匿名JWTでは確認列のUPDATE自体を行わず、記録・削除・上書きしない。正式JWTの再実行もnull条件により不変。GETや他APIでの暗黙同期は追加しない。確認記録や応答取得に失敗すれば既存初期化とともにロールバックする。
- 登録確認履歴を操作主体の認可に流用せず、古い匿名JWTは従来どおり公開操作403。公開／本人レスポンスに新しい列を含めず、isAnonymousは引き続きそのリクエストのJWT由来とする。
- 既存プロフィールはnullのままとし、正式ユーザーも更新後の正式JWTによるPUT /meを一度実行するまでフォロー対象として未確認となる。**ログイン・匿名アカウント昇格後、新しい正式JWTを取得してPUT /meを呼ぶことをフロントとの必須接続条件**とする。匿名と未確認の旧正式ユーザーを区別できない制限を維持する。
- フォローPUTは対象プロフィールが存在しregistration_confirmed_atが非nullの場合だけ許可し、対象なし・未確認は同じ404とする。これはAuthへのリアルタイム照会ではなく、正式JWTでの登録確認履歴である。セッション失効・ユーザー停止の即時反映を保証しない既存制限は維持する。

Auth管理API・追加Secret・Authテーブルへの権限を増やす方式は既存方針と権限の範囲を広げるため採用しない。対象の正式登録条件を緩める案も既存要件と異なる。

## 3. フォロー・いいねの処理と整合性

**フォロー**: PUTは本人のプロフィール、自己フォローでないこと、対象の登録確認を検証してINSERTする。自己フォローは400 `VALIDATION_ERROR`とし、DBのCHECKも維持する。複合PKでON CONFLICT DO NOTHINGを使い、重複PUTで関係のcreatedAtや件数を変えない。DELETEも自己指定は400、対象プロフィールなしは404とし、存在する対象なら登録確認履歴に依存せず、自分の関係だけを削除して204。解除時は新規フォローの適格性を再要求しない。

対象プロフィールの確認後の消失は既存FKで保護し、フォローの該当FK違反だけを404へ変換する。関係の削除はfollower_id=JWT UIDとfollowing_idの両方で絞る。追加の明示ロックは不要。プロフィールのfollowersCount／followingCount／followedByMeは既存の実集計へ即時反映し、別のカウンタは持たない。

**いいね**: 公開・未削除の元栞を確認して、JWT UIDとbookmarkIdの複合PKで追加／解除する。他人の非公開はもちろん、自分の非公開でもPUT/DELETEとも404。公開中の対象に限り、重複PUT・解除済みDELETEを204とする。元栞の非公開化／削除後は既存いいねを内部に残し、ここでの解除も404となる制限を明記する。

いいねのPUT/DELETEと返信POSTは、短いトランザクション内で元栞をFOR SHAREで読み、ロック取得後の公開・未削除状態で認可する。確認から書き込みまでの非公開化／削除を直列化し、元栞を変更しないSNS操作同士は共有ロックで並行できるようにする。KEY SHAREでは公開範囲変更を防げないため使わない。FKだけでは公開状態を保証できず、今回はこの状態確認に必要なロックだけを追加する。JOINを使う場合はFOR SHARE OF bookmarksのように元栞だけを対象とし、user_books・profiles等までロックしない。テーブル別名を使う場合はOFにもその別名を指定する。

## 4. 返信の処理・例外

- POSTは本人のプロフィールと公開中の元栞を確認し、userIdはJWT UID、bookmarkIdはパスから決定する。本文trim後1〜1,000文字、isSpoiler省略時false、未知フィールド拒否は既存スキーマを使う。親確認・INSERT・Reply応答取得を同一トランザクションに含め、応答取得の失敗でもロールバックする。再POSTは新しい返信を作る。
- PATCHはcontent／isSpoilerだけを受け付け、空PATCH・所有者・元栞ID・createdAt変更を拒否。親のFOR SHARE→自分の未削除返信のFOR UPDATEの順で確認し、公開中なら正式登録を要求してから更新する。更新後の応答取得まで同一トランザクションで行う。
- PATCHのロック順は親→返信に統一する。JOIN時はFOR SHARE OF bookmarks／FOR UPDATE OF bookmark_replies等で対象を指定し、無関係な行やLEFT JOINのNULL側をロックしない。更新SQLにも本人・未削除・親の可読性条件を残す。
- DELETEは返信の `id=replyId AND user_id=JWT UID AND deleted_at IS NULL` を条件とする単一UPDATEで、deleted_atとupdated_atの両方を明示的にnow()へ設定する。登録状態や元栞の可読性・公開範囲・削除状態を調べず、親JOIN・親ロック・追加トランザクションは不要。返信行のUPDATEに伴う通常のロックだけで、並行した再DELETEも一方のみ成功する。
- DELETEは更新できたIDだけを内部で確認し、成功時は204で本文なし、該当行なしなら404とする。匿名・正式ともに自分の未削除返信を削除できる。元栞の本文・公開状態・所有者や親IDを返さず、親の状態で応答を変えない。本文・返信行は内部に保持し、再DELETEは404。元栞に関する閲覧権限の拡大は行わない。
- 認可失敗は書き込みなし、予期しないDB障害は内部情報を隠した500とし、無関係なFK／CHECK違反まで404へ変換しない。

### 返信一覧の可読親と空結果

GETは、可読親CTEを起点に、限定した返信ページを `LEFT JOIN LATERAL (...) ON TRUE` で接続する1 SELECTを基本とする。親の条件は `bookmarkId一致 AND deleted_at IS NULL AND (public OR 元栞の所有者=検証済みUID)`。未認証はpublicのみとし、返信作者であることを非公開元栞の閲覧権限にしない。

LATERAL内で親IDと返信のbookmark_idを照合し、返信のdeleted_at IS NULL・昇順カーソル境界・created_at ASC, id ASC・limit+1を適用する。候補を絞ってからプロフィール要約をJOINし、最終SELECTの順序も明示する。返信に独立した公開範囲はなく、親のSQL認可に従う。返信側の条件を外側のWHEREへ移して親行を落としたり、LEFT JOIN後に無条件のINNER JOINで親行を失ったりしない。

| 同一SELECTの結果 | HTTP応答 |
|---|---|
| 可読親なし（不存在・削除済み・権限なし） | 行なしとして404 `NOT_FOUND` |
| 可読親あり・返信なし／削除済み返信のみ／境界より後の返信なし | 親行とNULLの返信側を受け取り、200 `{ items: [], nextCursor: null }` |
| 可読親あり・返信あり | 実際の返信IDがある行だけをitemsへ対応させ、最大limit件を返す |

NULLの返信はLEFT JOINの空結果用であり、返信として件数に含めない。実際の返信がlimit件を超えたときだけ最終返却返信からnextCursorを作る。2 SELECTに分ける案も比較したが、今回は親の可読性と返信の空結果を同じ読み取り時点で区別できる、限定したLATERALを採用する。DB往復数より認可の正確さと保守性を優先し、読み取り専用ロック・N+1・汎用クエリ生成基盤は追加しない。

返信本文の初期非表示はisSpoilerを使ってUIで制御する。親の非公開化後の一覧は元栞の所有者だけに許可し、返信本人のDELETEだけは前述の独立した認可とする。

## 5. 一覧・カーソル・フォロー中フィード

既存の [shared/cursor.ts](../apps/api/src/shared/cursor.ts) を再利用する。全一覧は既定15・最大30件でlimit+1件を取得し、返却分の最後の行からだけnextCursorを作る。日時はPostgreSQLのUTC・小数6桁文字列で保持し、JS Dateへ変換せずSQLへ渡す。Base64URL形式・署名なし・有効期限なしを維持する。

| 一覧 | 並びと境界ID |
|---|---|
| followers／following | 関係のcreated_at DESC、相手プロフィールID DESC。固定側のUIDと関係の向きをSQLで毎回制限する |
| 返信 | 返信のcreated_at ASC、返信ID ASC。親bookmarkIdと親の可読性・未削除を毎回確認する |
| フォロー中フィード | 栞のcreated_at DESC、栞ID DESC。フォロー条件を公開・未削除条件とともに候補CTE内で適用する |

不正な形式・日時・UUIDは400 `INVALID_CURSOR`、空カーソル・不正limit/scopeは400 `VALIDATION_ERROR`。別一覧／別ユーザー／別親の妥当なカーソルも境界値にすぎず、SQLの条件を変えない。境界行の削除・フォロー解除後も続きは取得できるが、ページ間の公開範囲・関係の変化は次回取得に反映する。固定スナップショットは作らない。

followingはJWT検証→既存FeedQueryのZod検証→未認証401／匿名403のガード→decodeCursor→本人プロフィール確認・取得の順。正式JWTへの暫定404を除去し、内容不正カーソルは400へ進む。正式でもプロフィール未初期化は404、フォロー先なし／公開栞なしは200空結果。allは任意認証・プロフィール初期化不要の既存動作を保つ。

既存の [listPublicBookmarks](../apps/api/src/modules/bookmarks/service.ts) へfollowing時だけ検証済み閲覧者のfollows条件を追加する。follower_id=JWT UID、following_id=栞の投稿者をEXISTSで照合し、候補をlimit+1件へ制限してから関連情報をJOIN、返却分だけwithCountsで一括集計する。非フォロー先・本人の私有投稿・非公開／削除済みを取得後に除外しない。フォローしたという理由で非公開の閲覧権限を与えず、N+1やlikes×repliesの件数水増しを避ける。

## 6. 実装構成・契約・設計判断

socialにフォロー・いいね、repliesに返信のroutes/http/serviceを設け、既存users・bookmarks・feedを必要な範囲だけ拡張する。小さな元栞確認処理や集計は既存bookmarks内で共有し、汎用Repository・汎用ロック管理・未実装機能用基盤は作らない。GETはJOIN／CTEと一括集計、PUTはPK競合処理、返信作成／編集は応答までのトランザクションを使い分ける。

| 設計判断 | 理由 |
|---|---|
| 返信GETは可読親を残し、返信側で削除・境界・件数を制限 | 親が読めない404と、返信がない200を混同しない。LATERALは限定した単一一覧の処理に留める |
| 登録確認はregistration_confirmed_atのみの明示SQL | DrizzleのupdatedAtの$onUpdateを起動せず、既存プロフィール・設定の冪等性を守る |
| 返信DELETEは本人・未削除だけを条件とする単一UPDATE | 元栞の非公開化・削除後にも自分の返信を消せる。親の情報を返さず、親の閲覧権限やロックは不要 |

既存パス・operationId・Zodスキーマ・JSON形状を維持する。10操作をplannedRoutesから実ルートへ移し、全36操作の一意性・初期ドラフトの網羅を残す。plannedは12→2（投稿／ユーザー検索のみ）。PUT /meの内部履歴記録、各403/404、一覧の向き・カーソル、following対応を説明へ反映し、稼働しない429等は持ち込まない。返信DELETEの説明には、匿名・正式とも本人の未削除返信のみ、親の非公開化・削除後も可能、成功204本文なし、他人／削除済み／不存在・再DELETEは404、親情報を返さないことを明記する。共通エラーコードは追加せず、OpenAPIとWeb生成型は既存手順で再生成する。

実装時にfeed設計書・API設計書・READMEのfollowing暫定404／利用不可の記述を更新し、DB・認証設計にも登録確認履歴の差分と理由を反映する。MSWは未導入のため新規モック基盤は追加しない。今回の文書作成ではこれらのコード・契約・生成物を変更しない。

登録確認列以外のDB列・制約・インデックス追加、Auth DDL、CASCADE・物理削除、外部サービス照会・依存追加は不要。既存PK／FK／CHECK・索引を使い、followingや関係一覧の性能は必要時にEXPLAIN ANALYZEで検証する。レート制限・通報等は今後の課題であり、今回の実装・テスト・完了条件へ含めない。

## 7. 検証方針と実装前の確認点

既存の署名鍵fixture・createTestDatabase・アプリ専用ロールを使い、HTTPからDB状態まで確認する。使い捨てPGliteとCI PostgreSQL 17を併用し、並行ロックの検証はPostgreSQLで行う。

| 対象 | 必須確認 |
|---|---|
| 認証・入力の優先順位 | Registered操作でJWTなし／不正＋不正入力は401、有効な匿名JWT＋不正UUID／本文は400、有効な匿名JWT＋妥当入力は403。前述のHono登録順が実HTTPで成立し、これら401／400／403で終了するケースはDB未接続であることも確認。metadata偽装、任意JWT不正401、認証障害503 |
| 登録確認日時 | 正式PUT /meでnullから初回記録、匿名PUTでは未記録・記録後も消去なし、同じ正式JWTの再実行・並行実行でも日時不変。前後のprofiles.created_at／updated_at・内容・設定・UIDを比較し、昇格前の古い日時を明示したfixtureでも不変を確認。内部項目の非露出、Authテーブル読取拒否 |
| フォロー・関係一覧 | 自己指定400、対象なし／登録未確認404、追加・重複・解除・再解除、他人の関係の不変、向き・対象UID・日時同値・ページ境界、公開プロフィールの件数とfollowedByMeの実数 |
| いいね | 公開対象への追加・重複・解除・再解除と件数／likedByMe、本人と他人の非公開・削除済み404、並行PUTでも1行、匿名拒否と失敗時のDB不変 |
| 返信GET・空結果 | 可読な元栞の返信0件／カーソルより後0件／削除済み返信のみはいずれも200空配列・nextCursor=null。元栞不存在・閲覧不可・削除済みは404。15／30件・同一日時・マイクロ秒の境界、返信側条件で親行が消えないことを確認 |
| 返信POST/PATCH | 正式POST、入力境界・未知項目・空PATCH、他人の返信変更404、非公開元栞はその所有者だけが一覧閲覧、返信作者でも非公開元栞への権限なし、公開編集の匿名403・許可する非公開編集、親削除後のPATCH404 |
| 自分の返信DELETE | 元栞が公開／他人の非公開／論理削除済みの各状態で、匿名・正式JWTとも本人のDELETE成功。返信のdeleted_at=updated_at、created_at保持、実集計から除外、他人／削除済み／不存在と再DELETE404。204本文なし・親情報非露出、親JOIN／親ロックなし、並行DELETEは204と404 |
| 並行処理・整合性 | 親の非公開化／削除といいねPUT/DELETE・返信POST/PATCHの競合、ロック後の最新状態、親→返信の順序とロック対象の限定、作成・編集の応答失敗時のロールバック、該当FKだけの404、無関係なDBエラーの500 |
| following・回帰 | 全体とは異なる結果、非フォロー先／私有・削除済み除外、フォロー解除・追加・公開変更のページ間反映、15／30件・同一日時・マイクロ秒・他人のカーソルでも漏えいなし。all・既存CRUD・栞の流れを回帰確認 |
| 応答・契約・性能 | UserPage／ReplyPage／FeedPage適合、生JSONの私有項目非露出、no-store、安全なエラー、投稿／返信数に比例するDB往復なし、実WorkersでJWT・DB・SNS操作・following確認、生成型・契約・マイグレーションの整合性 |

共有DBの既存行を前提にfixture ID・専用日時領域・制御可能な基準集合で比較する。並行追加は自テストで日時・タイミングを制御し、他テストのデータを変更せず、現在時刻やDB全体の固定件数に依存しない。[全体フィードのテストデータ方針](feed-design.md#テストデータ管理) を継承する。

実装前の主な確認事項は、登録確認列のマイグレーションと移行後の正式PUT /me呼び出し、返信GETの親行を残すSQL構成、登録確認時の既存日時保持。元栞の非公開化／削除後にいいね解除と返信PATCHは制限するが、自分の返信DELETEは許可する。実装完了時は [開発ルール](development.md) に従い、型・全テスト・OpenAPI・ビルド、DB変更の生成／履歴確認を行う。今回は本設計書だけを修正し、コード・マイグレーション・テスト・OpenAPI／生成型・PRは作成／更新しない。
