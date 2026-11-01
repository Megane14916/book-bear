# Supabase匿名認証・プロフィールAPIの設定（Issue #9）

前提は [DB・Hyperdriveの設定](database-setup.md) が完了し、`pnpm --filter api dev:remote` で `/api/v1/health/db` が200になること。このIssueでは既存テーブルを使うため、追加マイグレーションは不要。

## 1. Supabaseの設定

開発用プロジェクトで次を確認する。画面の分類名はDashboardの更新で変わる場合があるため、設定項目名も併記する。

1. **Authentication → Sign In / Providers**（旧画面ではProviders／Settings）で **Allow anonymous sign-ins / Enable anonymous sign-ins** を有効にして保存する。匿名認証用にEmailやGoogleを有効にする必要はない。
2. **JWT Signing Keys** 画面（Settings → JWT Keys、またはAuthentication配下）を開き、現在使う署名キー **Current key** のアルゴリズムが **ES256（ECC P-256）またはRS256** であることを確認する。このAPIは公開鍵JWKS方式で検証するため、**HS256／Legacy JWT secretは非対応**。
3. Current keyがHS256の場合のみ、[公式の移行手順](https://supabase.com/docs/guides/auth/signing-keys#getting-started) に従い、非対称キーをStandbyとして作成し、**Rotate keys** でCurrentへ切り替える。既存アプリと共有したプロジェクトなら影響を確認してから行う。既存キーの失効・削除は今回の接続確認には不要。切り替え後は古いセッションを使わず、新しい匿名セッションで確認する。
4. プロジェクトの **Project URL**（`https://PROJECT_REF.supabase.co`）と、**Settings → API Keys → Publishable key**（`sb_publishable_...`）を確認する。URLとPublishable keyはクライアント向け設定。DB接続先、JWT secret、秘密鍵、service_role／Secret keyとは別物。

`https://PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json` に公開鍵が配信される。秘密鍵やJWT secretを取得してAPIに渡す作業は不要。Data APIは引き続き無効でよく、`anon`／`authenticated` にアプリテーブルの直接アクセス権を追加しない。

匿名サインインの公開運用では、[Supabaseが推奨するCAPTCHA／Turnstile](https://supabase.com/docs/guides/auth/auth-anonymous#abuse-prevention-and-rate-limits) をフロントの認証フローと合わせて設定する。既にCAPTCHAを有効にしている場合、認証要求には取得済みのcaptchaTokenが必要になる。

## 2. APIの環境変数

### Hyperdrive経由のリモート起動・デプロイ

既存の `apps/api/.env.deploy.local` に以下を追記する。**既存のHYPERDRIVE_IDは保持する**。

```dotenv
HYPERDRIVE_ID=YOUR_32_CHARACTER_HYPERDRIVE_ID
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
CORS_ORIGIN=http://localhost:5173
```

```powershell
notepad apps/api/.env.deploy.local
pnpm --filter api dev:remote
```

`SUPABASE_URL` と `CORS_ORIGIN` だけを一時Wrangler設定の `vars` に反映する。`HYPERDRIVE_ID` はbinding設定に使う。管理用DB接続文字列や他の環境変数をWorkerへ一括転送しない。デプロイは `pnpm --filter api deploy:worker`、アップロードしない確認は `pnpm --filter api deploy:worker --dry-run`。

### ローカルWorkersで動かす場合

`apps/api/.dev.vars.example` を `.dev.vars` にコピーし、同じ `SUPABASE_URL` と `CORS_ORIGIN` を設定して `pnpm dev:api` を使う。既存ファイルは上書きしない。`.dev.vars` と `.env.deploy.local` はGit対象外。

ローカルPGliteのAuthテーブルはIDだけの代替なので、本物のSupabase Authで作ったユーザーは自動で追加されない。本物の匿名認証との結合確認にはSupabase DBを使うリモート起動が適している。テスト用ユーザーを本物の `auth.users` にSQLで作成しない。

### フロント担当に渡す設定

Webの `.env.local` に `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY`、APIの接続先 `VITE_API_BASE_URL` を設定する。認証SDKの導入・画面・セッション保持はフロント担当の実装範囲。既存セッションがあれば再利用し、最初の保存時だけ次のフローを実行する。

```ts
const { data, error } = await supabase.auth.signInAnonymously()
if (error || !data.session) throw error ?? new Error('セッションがありません')
const response = await fetch(`${apiBaseUrl}/api/v1/me`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${data.session.access_token}` },
})
if (!response.ok) throw new Error('プロフィールを初期化できませんでした')
```

APIへ送るのはユーザーのアクセストークン。Publishable keyやlegacy anon keyをBearerトークンの代わりに使わない。Google連携とManual Linkingは後続の連携機能で設定する。

## 3. PowerShellで実サービスを確認する

リモートAPIを起動したまま、別ターミナルで実行する。この確認は**開発用Authユーザーを1人作成**する。変数にはトークンを保持するが、トークンそのものは画面に出さない。

```powershell
$bookBearSupabaseUrl = (Read-Host '開発用SupabaseのProject URL').TrimEnd('/')
$bookBearPublishableKey = Read-Host '開発用SupabaseのPublishable key'
$bookBearSignupBody = @{ data = @{} }
# CAPTCHAを有効にしている場合は、ブラウザで取得した有効なトークンを使用する。
# $bookBearSignupBody.gotrue_meta_security = @{ captcha_token = Read-Host 'captchaToken' }
$bookBearSession = Invoke-RestMethod -Method Post `
  -Uri "$bookBearSupabaseUrl/auth/v1/signup" `
  -Headers @{ apikey = $bookBearPublishableKey } `
  -ContentType 'application/json' -Body ($bookBearSignupBody | ConvertTo-Json -Depth 3)
$bookBearHeaders = @{ Authorization = "Bearer $($bookBearSession.access_token)" }
$bookBearApi = 'http://127.0.0.1:8787/api/v1'

# 何度PUTしても同じIDで、既存のプロフィール・設定は上書きされない。
$bookBearMe = Invoke-RestMethod -Method Put -Uri "$bookBearApi/me" -Headers $bookBearHeaders
$bookBearMe
Invoke-RestMethod -Method Put -Uri "$bookBearApi/me" -Headers $bookBearHeaders
Invoke-RestMethod -Uri "$bookBearApi/me" -Headers $bookBearHeaders
Invoke-RestMethod -Uri "$bookBearApi/me/preferences" -Headers $bookBearHeaders

$bookBearPatch = @{ displayName = '読書好き'; bio = '読書の記録' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$bookBearApi/me" -Headers $bookBearHeaders `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($bookBearPatch))
Invoke-RestMethod -Method Patch -Uri "$bookBearApi/me/preferences" -Headers $bookBearHeaders `
  -ContentType 'application/json' -Body '{"feedContentMode":"all"}'

# 公開プロフィールはJWTなしで取得できる。設定やisAnonymousは返さない。
Invoke-RestMethod -Uri "$bookBearApi/users/$($bookBearMe.id)"

# 必須JWTなしは401になる（PowerShellではHTTPエラーとして表示される）。
Invoke-WebRequest -Uri "$bookBearApi/me" -UseBasicParsing
```

初期化の成功は200で、IDがAuthユーザーと一致し、`isAnonymous=true`、初期表示名が `ゲスト`。初期設定は `{"feedContentMode":"tap"}`。ブラウザで `/me` に直接アクセスするとAuthorizationヘッダーがないため401になる。

401はトークン・署名方式・プロジェクト・有効期限を確認する。署名方式変更後は新しいセッションを使う。503は `SUPABASE_URL` の設定とJWKSへの接続を確認する。設定変更後はAPIを再起動する。404は初回の `PUT /me` が必要、409はhandle重複。エラー調査のためにトークンやパスワードをチャットへ貼る必要はない。

## 4. 検証仕様と運用上の範囲

- `jose` でES256/RS256の署名、固定プロジェクトのissuer、audience=`authenticated`、期限を確認し、UUIDのsub／session_id、role=`authenticated`、booleanのis_anonymous、iatも必須にする。匿名状態にユーザー編集可能なメタデータを使わない。
- JWKS取得先は設定のURLから固定生成する。JWTのjku／iss等から接続先を選ばない。鍵を最大10分キャッシュし、未知kidは30秒のcooldown後に再取得する。鍵変更・失効がキャッシュへ反映されるまでの時間を見込む。
- JWT検証は各リクエストで実施する。Authサーバーへのユーザー照会やセッション照会は毎回行わないため、サインアウト・セッション失効・ユーザー停止の即時反映は保証しない。発行済みアクセストークンは期限まで有効になり得る。期限はSupabase設定で確認し、即時停止が必要になった場合は追加のAuth照会／失効管理を設計する。
- プロフィールと設定の作成は同一トランザクション。既存値は上書きしない。未初期化のGET／PATCHは404。所有者の指定はJWTのsubだけを使用する。
- handleはtrim後の小文字英数字と `_` の3〜30文字。nullで解除でき、DBの一意制約で競合を拒否する。bioもnullで解除可能。
- 本人APIと任意認証の公開プロフィールは成功・失敗とも `Cache-Control: no-store`。内部SQL、DB接続情報、JWTをログ／レスポンスへ出さない。
- 実サービス設定の変更と実Authでの動作確認は上記の手動手順で実施する。自動テストは使い捨てDBと生成した署名鍵を使用し、実Supabaseへのユーザー作成やデプロイは行わない。

参考：[匿名認証](https://supabase.com/docs/guides/auth/auth-anonymous)、[JWT検証](https://supabase.com/docs/guides/auth/jwts)、[JWT claims](https://supabase.com/docs/guides/auth/jwt-fields)、[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)、[セッション](https://supabase.com/docs/guides/auth/sessions)。
