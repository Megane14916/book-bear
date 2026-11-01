# API設計書（OpenAPI契約の合意用）

> v0.1 / 2026-10-31 / **APIベースパス** `/api/v1`。本書のエンドポイント表では先頭を省略。  
> **初期ドラフト**：[`../contracts/openapi-draft.yaml`](../contracts/openapi-draft.yaml) は初期設計の履歴資料。現在の契約はHono/Zodから生成する `openapi.json` を参照する。
> **正本の方針**：合意したレスポンス形状を `@hono/zod-openapi` のスキーマとルート定義へ反映し、生成した `openapi.json` をクライアント側で型生成する。本書は設計の意図とエンドポイント一覧を説明する。

### 現在の契約と実装状況（Issue #7）

`apps/api/src/modules/*/schemas.ts` と `src/contracts/routes.ts` を正本として、主要34操作の `contracts/openapi.json` とWebの `src/lib/api/generated.ts` を生成する。`GET /openapi.json` も同一仕様を返す。手書きの初期ドラフトは履歴資料とし、以降の変更はZod定義・生成物・本書に反映する。

- 操作単位の `x-implementation-status: implemented` は実装済み（health・DB接続確認と、Issue #9のプロフィール／設定6操作）。
- `x-implementation-status: planned` は契約のみ。OpenAPIレジストリに登録するが、HonoのHTTPハンドラーには登録しないため、実APIは現在404となる。記載した成功・認証エラーは今後の実装の契約であり、認証や認可が稼働している意味ではない。
- `x-auth` は `Public / OptionalAuth / AnyAuth / Owner / Registered`。`OptionalAuth` はJWTなしでも閲覧可、送信時は必ず検証して無効なら401。`Registered` は匿名ユーザーに403。公開化・followingフィードなどの条件付き制限は各操作の説明と403レスポンスに記載する。
- `followedByMe`・`likedByMe` を返す公開GETと、本人の非公開情報を返し得るGETは任意認証。初期ドラフトの公開プロフィール・返信一覧・投稿検索の認証記載を補完した。
- 入力はUUID、UTC日時、列挙値、本文長、整数範囲をZodで検証。JSONの数値・booleanは文字列から変換しない。クエリのlimitは数値化し、1〜30（既定15、書籍・ユーザー検索は20）とする。
- 栞本文はtrim後1〜2,000文字、返信はtrim後1〜1,000文字。表示名はtrim後1〜50文字、bioはnullまたは500文字以内。handleはnullまたはtrim後の小文字英数字と `_` の3〜30文字。
- 栞作成の `visibility` は省略時 `private`、`isSpoiler` は栞・返信とも省略時false。初期ドラフトの必須指定から、要件書の既定値へ合わせた。PATCHには既定値を適用しない。
- Webの型生成は `--default-non-nullable false` を指定し、既定値を持つ省略可能な入力をTypeScriptでも省略可能に保つ。
- PATCHは対応フィールドを1つ以上必要とし、空オブジェクト・未知のフィールドを拒否。省略は変更なし、nullはnullable項目の解除。所有者・作成日時・栞の所属先は入力で変更できない。
- ISBN-13は978/979の接頭辞、13桁、チェックディジットを検証。openBDのproviderIdもISBN-13。手動登録はISBN・作成者IDを受け付けない。DBにない検索候補はproviderとproviderIdを必ず持つ。こうした項目間条件やtrimの処理はOpenAPIだけでは完全に表せないためZod側でも検証する。
- ユーザー検索は初期ドラフトの `UserPage` を維持し、カーソル入力がないため `nextCursor` はnullとする。

契約の更新・確認：`pnpm generate:openapi` → `pnpm check:openapi` → `pnpm typecheck` → `pnpm test` → `pnpm build`。MSWはまだリポジトリに存在しないため、本Issueではモックを追加・更新しない。導入時には生成型を使い、認証シナリオ・403/404・空データ・カーソルを再現する。

後続で操作を実装するときは対応する定義を `plannedRoutes` から取り出し、スキーマを再利用して `app.openapi()` に登録する。認証・認可と成功／異常系テストを追加してから、操作の状態を `implemented` に変更し、重複登録を避ける。DBスキーマ・マイグレーションの変更は本Issueには含まれない。

### DB接続確認（Issue #8）

`GET /api/v1/health/db` は認証なしのreadiness確認。Hyperdrive binding経由で `profiles` を最大1件読み取り、200 `{ "status": "ok" }` を返す。データ・SQL・接続設定はレスポンスにもログにも出さない。binding未設定、接続失敗、未マイグレーション、権限不足は503の共通エラー形式（code=`INTERNAL_ERROR`）。成功・失敗とも `Cache-Control: no-store`。通常の `GET /api/v1/health` はDBに依存しない。設定手順は [DB初期設定](database-setup.md) を参照。

### 認証・プロフィール（Issue #9）

`GET/PUT/PATCH /me`、`GET/PATCH /me/preferences`、`GET /users/{userId}` の6操作を実装した。定義は `modules/users/routes.ts`、HTTP処理は `http.ts`、DB操作は `service.ts`。生成契約の34操作のうち28操作は引き続きplanned。

- `middleware/auth.ts` で固定プロジェクトのJWKSからES256／RS256を検証する。issuerは `SUPABASE_URL + /auth/v1`、audienceは `authenticated`。exp／iat／sub／role／session_id／is_anonymousを必須とする。JWTなし・不正・期限切れは401、設定不備・JWKS取得障害は503。HS256は使わない。
- 本人のID・匿名状態は検証済みclaimから取得し、本文やユーザーメタデータで上書きしない。公開プロフィールは任意認証で、提示したJWTが不正なら401。
- `PUT /me` はプロフィールと表示設定を同一トランザクションで作成し、既存値・作成更新日時を変更しない。GET／PATCHは未初期化なら404。Authに存在しないIDの初期化はFKでも拒否する。
- PATCHは本人だけを更新。handle重複は409 `ALREADY_EXISTS` で全更新を取り消す。表示名・handleはtrimし、bio／handleのnullは解除、省略は保持。
- 公開プロフィールは公開・未削除の栞の件数とフォロー件数を実DBから集計。設定・匿名状態は公開しない。全6操作で成功・失敗とも `Cache-Control: no-store`。
- JWTのローカル署名検証だけではサインアウト・ユーザー停止の即時反映を保証しない。鍵キャッシュ・失効の扱いとSupabase側設定は [認証設定手順](auth-setup.md) を参照。

MSWは未導入のためモックの変更はない。Web用生成型を更新しており、フロントはSupabase SDKで取得したアクセストークンをBearerで送信する。

## 1. 共通ルール

- JSONフィールドは `camelCase`。DBは `snake_case`、変換はAPI側。
- IDはUUID文字列。日時はISO 8601（UTC、例 `2026-10-31T08:00:00Z`）。`null` と省略を区別する。
- 認証：Supabase Authのアクセストークンを `Authorization: Bearer <JWT>` で送信。公開GETは認証なしで可。任意認証GETはトークンがあれば検証して閲覧者情報に使う。
- `[Public]` 認証なし可、`[AnyAuth]` 匿名／正式どちらも可、`[Registered]` 正式ユーザーのみ、`[Owner]` 自分のリソースのみ。
- 公開栞は第三者に取得可能。非公開栞は**本人以外に返さない**。直接URLでは原則404。
- ユーザー指定IDや `userBookId` をそのまま所有者として信用しない。JWTの `sub` から現在ユーザーIDを得る。
- 匿名の `is_anonymous=true` は公開投稿、いいね、返信、フォローを禁止する。403 `REGISTRATION_REQUIRED`。
- フィードと栞の流れ：`limit` 初期15件／最大30件。実際のSQLは`limit+1`件取得して次のページ有無を判定。
- ページネーションは `nextCursor: string | null`（不透明なカーソル）。フロントは内容を解析しない。
- `visibility: "private"` の自分の栞は `/me`、プロフィールの栞の流れ、投稿詳細から見られる。
- 本文の表示モードはAPIパラメータにしない。**APIは許可された投稿の本文を返し、フロントで隠す**。ネタバレ指定もUI制御。非公開だけはAPIで秘匿。
- パラメータ・本文はZodで検証。失敗は共通エラー形式にする。

### 共通エラーレスポンス

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力内容を確認してください",
    "details": { "field": "content" }
  }
}
```

| HTTP | 例のcode | 用途 |
|---|---|---|
| 400 | `VALIDATION_ERROR` / `INVALID_CURSOR` | 入力／カーソル不正 |
| 401 | `UNAUTHORIZED` | 必須のJWTがない、無効・期限切れ |
| 403 | `REGISTRATION_REQUIRED` / `FORBIDDEN` | 匿名公開行動、操作権限なし |
| 404 | `NOT_FOUND` | 存在しない、または存在を知らせない非公開対象 |
| 409 | `ALREADY_EXISTS` / `HAS_BOOKMARKS` / `ACCOUNT_LINK_CONFLICT` | 重複・データ競合 |
| 429 | `RATE_LIMITED` | 操作回数制限 |
| 500 | `INTERNAL_ERROR` | サーバー内部エラー（内部情報は返さない） |
| 502 | `BOOK_PROVIDER_UNAVAILABLE` | 書籍外部API障害 |

**共通公開プロフィール**

```ts
export type UserSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};
export type BookSummary = {
  id: string;
  isbn13: string | null;
  title: string;
  author: string | null;
  coverUrl: string | null;
};
export type BookmarkCard = {
  id: string;
  author: UserSummary;
  book: BookSummary;
  pageNumber: number | null;
  content: string;
  visibility: "public" | "private"; // privateは本人の取得結果のみ
  isSpoiler: boolean;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;  // 未ログインならfalse
  createdAt: string;
  updatedAt: string;
};
export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
```

## 2. エンドポイント一覧

### 2.1 プロフィール／設定

| Method | Path | 権限 | 主な内容 |
|---|---|---|---|
| GET | `/me` | AnyAuth | 自分のプロフィール／`isAnonymous`を返す |
| PUT | `/me` | AnyAuth | 初回プロフィールを冪等作成（何度呼んでも同じUID） |
| PATCH | `/me` | Owner | 表示名・自己紹介・handleを更新 |
| GET | `/me/preferences` | AnyAuth | 表示設定を取得 |
| PATCH | `/me/preferences` | AnyAuth | `feedContentMode: "all" | "tap"` を保存 |
| GET | `/users/{userId}` | Public | 公開プロフィール・公開栞数・フォロー数 |
| GET | `/users/{userId}/followers` | Public | フォロワー一覧（カーソル可） |
| GET | `/users/{userId}/following` | Public | フォロー中一覧（カーソル可） |

`PUT /me` の初回呼び出しは `profiles` と `user_preferences` を既定値で用意する（既に存在すれば変更しない）。未認証時は401。SupabaseのログインやGoogle連携自体は**Supabase SDKが実施し、独自ログインAPIは設けない**。

`PATCH /me` 例：`{ "displayName": "読書好きA", "bio": "ミステリ好き" }`。返却は更新後プロフィール。`handle` は任意・ユニークで、プロフィールURLは変更に強い `userId` を使う。

### 2.2 書籍と本棚

| Method | Path | 権限 | 主な内容 |
|---|---|---|---|
| GET | `/books/search?q={q}&limit={n}` | Public | DB＋外部APIを検索、正規化した候補を返す |
| GET | `/books/{bookId}` | Public | 登録済みの書籍情報 |
| POST | `/books/import` | AnyAuth | 選択した外部API候補を検証し、書籍マスタへ取り込み |
| POST | `/books/manual` | AnyAuth | ISBNなしなどの書籍を手動登録 |
| GET | `/me/books` | AnyAuth/Owner | 自分の本棚（登録日時降順、カーソル可） |
| POST | `/me/books` | AnyAuth | 指定書籍を本棚へ登録（冪等・重複再利用） |
| PATCH | `/me/books/{userBookId}` | Owner | 読書状態・現在ページを更新 |
| DELETE | `/me/books/{userBookId}` | Owner | 栞がなければ削除、あれば409 `HAS_BOOKMARKS` |
| GET | `/users/{userId}/books` | Public | **公開栞が1件以上ある本のみ**一覧で返す |

#### 書籍検索候補の正規化形式

```json
{
  "items": [
    {
      "localBookId": null,
      "provider": "google_books",
      "providerId": "external-volume-id",
      "isbn13": "9780000000000",
      "title": "小説A",
      "author": "著者A",
      "coverUrl": null,
      "totalPages": 320
    }
  ]
}
```

- すでにDBに存在する候補は `localBookId` を返す（この場合import不要）。外部候補は `provider` と `providerId` を返す。
- `POST /books/import` ：`{ "provider": "google_books", "providerId": "external-volume-id" }`（openBDの場合、`providerId` はISBN）。**バックが再取得・正規化**して保存。フロント送信の書誌情報をそのまま信頼しない。
- ISBNが有効で同一ISBNレコードがあれば既存の `bookId` を返す。201=新規、200=既存を再利用。
- `POST /books/manual`：`{ "title": "ISBNのない本", "author": "著者名", "totalPages": null }`。ISBNを任意で受け付ける仕様にはせず、ISBN付きは通常のインポート／検索を優先する。[暫定] 手動作成は共有マスタに保存、作成者IDを追跡して連投を制限する。
- `POST /me/books`：`{ "bookId": "UUID", "status": "reading" }`。201新規／200既存、レスポンスは `UserBook`。同一 `(user_id, book_id)` は一意。
- `PATCH /me/books/{id}`：`{ "status": "completed", "currentPage": 250 }`。ページは未設定可、総ページ数による厳密な上限は課さない。
- `GET /users/{id}/books`：登録した全本棚を公開しない。公開栞がある書籍だけを `EXISTS` で取得。本人用は `/me/books` に分ける。

### 2.3 栞・栞の流れ

| Method | Path | 権限 | 主な内容 |
|---|---|---|---|
| POST | `/bookmarks` | AnyAuth（公開はRegistered） | 栞を作成 |
| GET | `/bookmarks/{bookmarkId}` | Public／非公開はOwner | 栞詳細（公開／本人のみ） |
| PATCH | `/bookmarks/{bookmarkId}` | Owner（公開化はRegistered） | 本文、位置、公開、ネタバレの更新 |
| DELETE | `/bookmarks/{bookmarkId}` | Owner | 論理削除 |
| GET | `/me/bookmarks?cursor=` | Owner | 自分の公開／非公開の栞を新しい順に取得 |
| **GET** | **`/users/{userId}/books/{bookId}/bookmarks`** | Public／自分ならOwner | **「栞の流れ」：投稿日時の古い順** |

作成・編集入力（`PATCH` は一部フィールドでよい）：

```json
{
  "userBookId": "a0000000-0000-4000-8000-000000000001",
  "pageNumber": 120,
  "content": "最初に後ろの章を読んだときの感想",
  "visibility": "private",
  "isSpoiler": false
}
```

- `content` は空白除去後1〜2,000文字。[暫定] `pageNumber` は正整数かnull。
- `userBookId` が自分の本棚に属するかをAPIで確認。`visibility=public` は正式ユーザーのみ。
- 投稿時の `createdAt` はDBが設定し、編集しても変わらない。
- 削除投稿はフィード／検索／返信一覧／公開URLに返さない。

#### 栞の流れレスポンス

`GET /users/{userId}/books/{bookId}/bookmarks?limit=15&cursor=...`

```json
{
  "author": {
    "id": "a0000000-0000-4000-8000-000000000002",
    "displayName": "読書好きA",
    "avatarUrl": null
  },
  "book": {
    "id": "a0000000-0000-4000-8000-000000000003",
    "isbn13": null,
    "title": "小説A",
    "author": "著者A",
    "coverUrl": null
  },
  "items": [
    {
      "id": "a0000000-0000-4000-8000-000000000004",
      "pageNumber": 200,
      "content": "後ろの章から読み始めた",
      "visibility": "public",
      "isSpoiler": false,
      "likeCount": 2,
      "replyCount": 0,
      "likedByMe": false,
      "createdAt": "2026-10-28T08:00:00Z",
      "updatedAt": "2026-10-28T08:00:00Z"
    }
  ],
  "nextCursor": "opaque-cursor-or-null"
}
```

同じ画面のヘッダーで表示するため、`author` と `book` は**レスポンス直下に1回だけ**置き、`items` の投稿カード内で繰り返さない。`items` は `BookmarkCard` の軽量版。`bookId` はISBNでなく内部UUIDなのでISBNなしの本にも対応する。

**閲覧制御**：`userId` が閲覧者本人ならその人の公開・非公開栞両方、それ以外は公開栞のみ。ユーザー×本の組み合わせが存在しない／公開栞がない場合、外部閲覧者には空配列（プロフィールからは選べない）。

### 2.4 タイムライン

| Method | Path | 権限 | 内容 |
|---|---|---|---|
| GET | `/feed?scope=all&limit=15&cursor=` | Public | 全体公開栞を新着順に取得 |
| GET | `/feed?scope=following&limit=15&cursor=` | Registered | フォロー中の公開栞を新着順に取得 |

レスポンス：`CursorPage<BookmarkCard>`。`content` は公開本文を含める。`isSpoiler` と閲覧設定はフロントの表示判定に使う。

```json
{
  "items": [
    {
      "id": "a0000000-0000-4000-8000-000000000004",
      "author": { "id": "a0000000-0000-4000-8000-000000000002", "displayName": "読書好きA", "avatarUrl": null },
      "book": { "id": "a0000000-0000-4000-8000-000000000003", "isbn13": null, "title": "小説A", "author": "著者A", "coverUrl": null },
      "pageNumber": 200,
      "content": "後ろの章から読み始めた",
      "visibility": "public",
      "isSpoiler": false,
      "likeCount": 2,
      "replyCount": 0,
      "likedByMe": false,
      "createdAt": "2026-10-31T08:00:00Z",
      "updatedAt": "2026-10-31T08:00:00Z"
    }
  ],
  "nextCursor": null
}
```

### 2.5 フォロー・いいね・返信

| Method | Path | 権限 | 内容 |
|---|---|---|---|
| PUT | `/users/{userId}/follow` | Registered | 対象をフォロー、冪等（204） |
| DELETE | `/users/{userId}/follow` | Registered | フォロー解除、冪等（204） |
| PUT | `/bookmarks/{bookmarkId}/like` | Registered | 公開栞にいいね、冪等（204） |
| DELETE | `/bookmarks/{bookmarkId}/like` | Registered | いいね解除、冪等（204） |
| GET | `/bookmarks/{bookmarkId}/replies?cursor=&limit=15` | Public | 公開栞の返信を投稿順（古い順）に取得 |
| POST | `/bookmarks/{bookmarkId}/replies` | Registered | 公開栞にテキスト返信を作成 |
| PATCH | `/replies/{replyId}` | Owner | 自分の返信本文・ネタバレ指定変更 |
| DELETE | `/replies/{replyId}` | Owner | 論理削除 |

返信入力例：`{ "content": "私もそう思います", "isSpoiler": false }`。返信は1階層のみ・最大1,000文字。[暫定] 返信へのいいね／スレッド返信はMVP外。

返信レスポンス例：

```json
{
  "items": [
    {
      "id": "a0000000-0000-4000-8000-000000000005",
      "author": { "id": "a0000000-0000-4000-8000-000000000002", "displayName": "読書好きA", "avatarUrl": null },
      "content": "私もこの場面が好きです",
      "isSpoiler": false,
      "createdAt": "2026-10-31T08:10:00Z",
      "updatedAt": "2026-10-31T08:10:00Z"
    }
  ],
  "nextCursor": null
}
```

`GET /bookmarks/{id}/replies` は元投稿が非公開なら第三者へ404。いいね・返信は公開中の投稿にだけ許可。非公開化／削除後は第三者が既存返信を取得できなくなる。

### 2.6 検索

| Method | Path | 権限 | 内容 |
|---|---|---|---|
| GET | `/search/posts?q=&cursor=&limit=15` | Public | 公開栞本文を検索（ネタバレの本文抜粋はUIで隠す） |
| GET | `/search/users?q=&limit=20` | Public | 表示名・handleの検索 |
| GET | `/books/search?q=&limit=20` | Public | 書名・著者・ISBN（外部APIも） |

MVPでは日本語検索を `ILIKE` 等の簡易検索で開始。データ量が増えたらPGroonga等の専用インデックスを検討。実際の検索速度を見て決める。

### 2.7 外部共有（API不要）

公開栞のURLをコピー、または `https://x.com/intent/tweet` に `url` と任意の `text` を設定して開く。**投稿本文（とくにネタバレ）を共有文へ自動挿入しない**。Xへの実際の投稿はユーザーが行う。非公開投稿の共有導線は出さない。

## 3. カーソルページネーションの厳密仕様

- **全体／フォロー中フィード**：`ORDER BY created_at DESC, id DESC`。次ページは `(created_at, id) < (lastCreatedAt, lastId)`。
- **栞の流れ**：`ORDER BY created_at ASC, id ASC`。次ページは `(created_at, id) > (lastCreatedAt, lastId)`。
- **返信**：[暫定] `created_at ASC, id ASC` とする。
- カーソルには日時・IDに加え、必要に応じて並び順や対象（scope、userId、bookId）の検証情報を持たせる。外部からはopaque。改ざんを防ぐため署名付き形式またはクエリ条件の厳格な照合を行う。
- `limit=15`のときDBでは最大16件取り、返すのは15件。16件目があれば `nextCursor` を返す。ない場合はnull。
- 新しい投稿が途中に追加されても、カーソルで既存の続きが取得できる。編集・削除で結果が変わる可能性は許容し、重要な変更時は先頭から再取得。
- 期限切れ・不正なcursorは400 `INVALID_CURSOR` とし、UIで一覧を再取得できるようにする。

## 4. 認証と例外フロー

1. 初回に本を本棚へ登録しようとしたら、フロントがSupabase `signInAnonymously()` を呼ぶ。
2. フロントは `PUT /me` でプロフィールを作成し、JWTを付けて本棚APIへアクセス。
3. Google連携時、`supabase.auth.linkIdentity({ provider: 'google' })` を実行。
4. 同じUIDで正式ユーザーになれば記録はそのまま。連携失敗／既存Googleアカウントとの競合は明示的に表示し、自動マージはしない。
5. サーバーはJWTの署名・issuer・audience・exp等を検証し、`sub` と `is_anonymous` を読んで認可する。
6. ログアウトやユーザー切替時はフロントの個人用TanStack Queryキャッシュを消去する。

## 5. API契約とモック

- バックは`@hono/zod-openapi`でRoute・リクエスト/レスポンスのZodスキーマを定義。`/openapi.json`（APIバージョンの外側）で生成仕様を公開し、CIで成果物を確認。
- フロントは生成されたOpenAPI仕様から `openapi-typescript` で `api.d.ts` を生成し、`openapi-fetch` 経由でアクセス。**Honoの型をimportしない**。
- 初期契約に合意したら、実装がなくてもフロントはMSWでHTTPをモック。匿名／正式／未ログインのシナリオと403、404、空リスト、15件+cursorを再現する。
- バック側のAPI変更は契約を先に変更し、生成型によるフロントの型チェックで不一致を検出する。
- 本書は開発契約の**解説文書**。確定後の機械可読な正本は生成されたOpenAPI JSONとし、Markdownや手書き型と二重管理しない。

## 6. 非機能・性能上の注意

- フィード：最初に条件を満たす投稿を最大16件に絞る。その後15件の投稿について書籍・ユーザー情報を取得し、いいね／返信数を**一括集計**。返信本文は一覧APIに含めない。
- 栞の流れ：最初に `(user_id, book_id)` の `user_books.id` を特定し、専用インデックスを使って15件取得。共通の書籍・投稿者情報はルートに1回だけ返す。
- 自分のいいね状態はアクセス中ユーザーのIDから一括検索する。集計時にlikesとrepliesを無条件に多重JOINして件数が膨らまないよう注意。
- CORS許可元はWebフロントのドメインに限定。認証トークン／秘密鍵・内部SQLエラーはログに残さない。
- 本文表示モード切替だけではAPIを再取得しない。TanStack Queryのキャッシュを画面間で活用する。
