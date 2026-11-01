# Google Custom OIDCの設定・手動確認（Issue #18）

本手順は開発用Google／Supabaseプロジェクトを対象とする。**要求するscopeは `openid email` のみ**。認証設計は [Design Doc](auth-design.md) を参照。

バックエンドと検証CLIの自動テストは用意している。実際のログイン・Googleの同意画面・Supabase内部の保存内容は、利用者がこの手順で確認する。実ログイン済みとする自動テストではない。

## 1. 前提と今回の範囲

- [DB・Hyperdriveの設定](database-setup.md) と [匿名認証の設定](auth-setup.md) を完了している。
- `pnpm --filter api dev:remote` で起動したAPIの `/api/v1/health/db` が200になる。
- Supabaseの匿名サインインが有効で、JWTのCurrent keyがES256またはRS256になっている。
- アプリのUIとフロントへのSupabase SDK導入は今回行わない。検証用CLIはNode.jsのHTTP通信を使い、ブラウザを自動起動・操作しない。
- フロントには後続でSupabase SDKを**認証専用**として導入する。アプリデータはHono APIへ送る。**Data APIは使用しない。**

追加DBマイグレーションと、HonoへのGoogle Client Secret／service_roleキーの追加は不要。

## 2. Google CloudでOAuthクライアントを用意する

1. 開発用Google Cloudプロジェクトを選び、**Google Auth Platform** を開く。
2. **Branding** にアプリ名・連絡先等を設定する。表示名例は `Book Bear Dev`。
3. **Audience** で利用対象を設定する。外部向けのテスト状態で進める場合は、必要に応じて自分の検証用GoogleアカウントをTest usersへ追加する。
4. **Data Access** の認証用scopeを確認する。`openid` とemailだけとし、`profile`／`userinfo.profile` や他のGoogle API権限を追加しない。Google側の画面ではemailが `https://www.googleapis.com/auth/userinfo.email` と表示される場合がある。Supabaseのprovider設定には次節のとおり、文字列 `openid` と `email` を指定する。
5. **Clients → Create client** で種類を **Web application** にし、開発用OAuthクライアントを作成する。
6. 発行された **Client ID** と **Client Secret** を管理する。Client IDは通常 `....apps.googleusercontent.com`。SecretはSupabaseのprovider設定へ入力し、リポジトリやチャットへ貼らない。

Googleへ登録するredirect URIは次節でSupabaseに表示されるCallback URLを使う。Google → SupabaseのURIと、Supabase → ローカルCLIのURIを混同しない。

## 3. SupabaseにCustom OIDC providerを作成する

開発用Supabaseの **Authentication → Sign In / Providers** で **New Provider** を開き、**Auto-discovery (OIDC)** を選択する。組み込みGoogle providerや、Third-party AuthのCustom OIDC設定は使用しない。

次の設定を行う。

| 項目 | 設定値 |
|---|---|
| Identifier | `custom:google` |
| Name | `Google (email only)` など、管理用の名前 |
| Client ID / Client Secret | 前節のGoogle OAuthクライアントの値 |
| Issuer URL | `https://accounts.google.com` |
| Scopes | `openid` と `email` の2つだけ |
| PKCE | 有効 |
| Skip nonce check | 無効（nonce検証を省略しない） |
| Email optional | 無効 |
| Authorization params | `scope="openid email"`、`access_type="online"`、`include_granted_scopes="false"`（すべて文字列） |

画面に表示される **Callback URL** をGoogle CloudのOAuthクライアントの **Authorized redirect URIs** へ登録する。標準ドメインでは通常、次の形になるが、**画面に表示された実際の値を使う**。

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

設定後にCustom providerを有効化する。Advanced設定のAuthorization paramsにも上表の3値を指定する。Custom providerのScopesは呼び出し側から上書きできるため、最後に適用されるproviderのAuthorization paramsでも最小scopeを固定する。JSON欄で入力する場合は次の形とし、booleanではなく文字列を使う。

```json
{"scope":"openid email","access_type":"online","include_granted_scopes":"false"}
```

`profile` を含むscope、`access_type=offline`、`include_granted_scopes=true` を設定しない。Custom claims allowlistは空のままとし、追加のプロフィール項目を取り込むAttribute mappingも設定しない。GoogleのAPIを継続利用するためのrefresh tokenは要求しない。

設定値の公開部分は、リポジトリのルートで次を実行して確認できる。このコマンドは値を表示するだけで、Supabaseへ設定を書き込まない。

```powershell
pnpm --filter api auth:google config
```

### Scopesの入力欄が見つからない場合

作成／更新画面のAdvanced設定も確認する。scopeを設定できない状態で組み込みGoogleへ切り替えない。

管理画面で指定できない場合は、[公式Custom provider管理API](https://supabase.com/docs/guides/auth/custom-oauth-providers) を使用できる。以下は**利用者が設定を反映する場合だけ**実行する。SupabaseのSecret keyとGoogle Client Secretは対話入力し、このファイルや `.env.auth.local` へ保存しない。providerが既にある場合は作成し直さず、更新を使う。

```powershell
$bookBearSupabaseUrl = (Read-Host '開発用Supabase Project URL').Trim().TrimEnd('/')
$bookBearAdminSecret = [pscredential]::new('unused', (Read-Host 'Supabase Secret key' -AsSecureString)).GetNetworkCredential().Password
$bookBearGoogleSecret = [pscredential]::new('unused', (Read-Host 'Google Client Secret' -AsSecureString)).GetNetworkCredential().Password
$bookBearGoogleClientId = (Read-Host 'Google Client ID').Trim()
$bookBearProviderBody = @{
    provider_type = 'oidc'
    identifier = 'custom:google'
    name = 'Google (email only)'
    client_id = $bookBearGoogleClientId
    client_secret = $bookBearGoogleSecret
    issuer = 'https://accounts.google.com'
    scopes = @('openid', 'email')
    pkce_enabled = $true
    skip_nonce_check = $false
    email_optional = $false
    enabled = $true
    authorization_params = @{
        scope = 'openid email'
        access_type = 'online'
        include_granted_scopes = 'false'
    }
}
try {
    # 新規作成時だけ実行する。
    $bookBearProvider = Invoke-RestMethod -Method Post `
        -Uri "$bookBearSupabaseUrl/auth/v1/admin/custom-providers" `
        -Headers @{ apikey = $bookBearAdminSecret } `
        -ContentType 'application/json' -Body ($bookBearProviderBody | ConvertTo-Json -Depth 4)
    $bookBearProvider | Select-Object identifier, provider_type, issuer, scopes
} finally {
    Remove-Variable bookBearAdminSecret, bookBearGoogleSecret, bookBearProviderBody -ErrorAction SilentlyContinue
}
```

既存のproviderを更新する場合は、Secret keyを同様に対話取得したうえで、管理APIの `PUT /auth/v1/admin/custom-providers/custom:google` に以下を送る。指定したAuthorization paramsへ更新するため、既存の追加パラメータがある場合は内容を確認する。設定の読み取り・更新APIの詳細は公式資料を参照する。管理APIで保存できても、実際の認可URLの検査は後述のCLIで別途行う。

```json
{"scopes":["openid","email"],"authorization_params":{"scope":"openid email","access_type":"online","include_granted_scopes":"false"}}
```

### Manual Linkingと戻り先

1. Supabaseの認証設定で **Manual Linking / Allow manual linking** を有効化する。
2. **Authentication → URL Configuration → Redirect URLs** に、検証用CLIの戻り先を追加する。

```text
http://127.0.0.1:8790/auth/callback
```

このURLはSupabaseからローカルCLIへ戻るためのもの。Googleへ登録するURIではない。`localhost` ではなく `127.0.0.1` とし、portとpathを一致させる。CLIのportを変えたら許可URLも変更する。既存のWeb用Site URLを変更する必要はない。

**Enable Data API、Automatically expose new tablesは無効のまま**とする。SDKの認証利用にアプリテーブルの直接権限は不要。

### 開発環境と本番環境

本手順では開発用プロジェクトへ設定する。本番導入時は次を本番環境の値で設定し直し、手動確認を行う。

| 設定 | 開発 | 本番 |
|---|---|---|
| Supabase | 開発用プロジェクト | 本番用プロジェクト |
| Google OAuthクライアント | 開発用Client ID／Secret | 本番専用Client ID／Secret、Audienceの公開設定を確認 |
| Googleのredirect URI | 開発用SupabaseのCallback URL | 本番用SupabaseのCallback URL |
| Custom provider | `custom:google`、本書のscope・PKCE・nonce設定 | 同じ識別子・制限を本番にも設定 |
| Supabaseの許可リダイレクト先 | CLI用loopback、開発WebのURL | 後続フロントの本番コールバックURL。CLI用loopbackは本番へ追加しない |
| Hono | 開発用SUPABASE_URL・Hyperdrive | 本番用SUPABASE_URL・Hyperdrive・CORS_ORIGIN |

本番のGoogle Client SecretもSupabaseへだけ保存する。CLIの `.env.auth.local` は開発用のままとし、本番向けの設定やセッションを混在させない。Google Client IDを変更するときは既存Identityとの関係も事前に確認する。

## 4. CLI用の環境変数を用意する

既存の `.env.deploy.local` はAPIの起動用として保持する。検証用には別の `.env.auth.local` を使う。

```powershell
if (!(Test-Path -LiteralPath apps/api/.env.auth.local)) {
    Copy-Item apps/api/.env.auth.example apps/api/.env.auth.local
}
notepad apps/api/.env.auth.local
```

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
GOOGLE_OIDC_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
API_BASE_URL=http://127.0.0.1:8787
OIDC_CALLBACK_PORT=8790
```

`SUPABASE_URL` はAPIの `.env.deploy.local` と同じプロジェクト。Publishable keyは **Settings → API Keys** で取得する。Google Client Secret・Supabase Secret key・DBパスワードはこのファイルへ入れない。

```powershell
pnpm --filter api auth:google check
```

`Local configuration is valid` と出れば、ローカルの形式検査は成功。このコマンドはネットワークへ接続せず、実サービスの設定・ログイン・鍵の有効性までは検証しない。ファイルはGit対象外で、WranglerやWorkerへ渡されない。

次に、Supabaseに保存したscopeと上書き防止設定をログイン前に確認する。

```powershell
pnpm --filter api auth:google scopes
```

Supabaseへ通常の認可URLとscope上書きを試みる認可URLを要求し、どちらもGoogle向けの最終scopeが `openid email` のみになることを検査する。probeではSupabaseへの要求に意図的にprofileを含めるが、**返されたGoogle URLへはアクセスせず、Googleへ認可要求を送らない**。ブラウザ・ログイン・ユーザー作成は不要。Supabase側に短命の認可フローは生成される。

`Provider scopes and override protection verified` ならこの検査は成功。余分なscopeを検出した場合はログインを進めず、Authorization paramsの固定設定を修正する。

## 5. APIを起動する

API起動中ならそのターミナルで `Ctrl+C` で停止し、再起動する。

```powershell
pnpm --filter api dev:remote
```

APIが `http://127.0.0.1:8787` で起動し、`/api/v1/health/db` が200になることを確認する。別portで起動した場合は `.env.auth.local` のAPI_BASE_URLも合わせる。このターミナルは起動したままにする。

## 6. 匿名からGoogleへの連携を自分で確認する

**最初にlink、次にloginの順**で確認する。検証用Googleアカウントは、このCustom providerでまだ別ユーザーへ連携されていないものを使う。先に同じGoogleアカウントでloginすると、その後のlinkは既存Identityとの競合になり得る。

別のPowerShellをリポジトリのルートで開いて実行する。

```powershell
pnpm --filter api auth:google link
```

このコマンドは次を行う。

1. **検証専用の匿名Authユーザーを1人作成**する。既存の匿名アカウントのセッションは読み込まない。
2. Hono APIでプロフィールを初期化し、表示名を `連携確認用`、bioを `OIDC連携前の確認データ`、表示設定を `all` にする。
3. SupabaseへIdentity連携URLを要求する。Googleへ送るscopeが `openid email` 以外なら、URLを開く前に停止する。
4. Googleの認可URLをターミナルに表示し、最大10分待機する。

表示された**一度限りのURLを自分でコピーしてブラウザで開き**、Googleアカウントを選んで同意する。CLIはブラウザを自動操作しない。URLやターミナル出力を他人へ転送しない。

戻り先で `Received. Return to the terminal...` が表示されたら、ターミナルの結果を見る。認可コード交換、JWTを使うAPI確認、セッション更新後の再確認をCLIが行う。access token／refresh token／認可コードは表示・ファイル保存しない。

```text
"isAnonymous": false
"sameUid": true
"profilePreserved": true
"additionalMetadataDetected": false
```

上記が `after-login` と `after-refresh` の両方で出ることを確認する。最初に表示された匿名ユーザーのUUIDと、結果のuidが一致していることも確認する。氏名や画像がなくてもメール情報で認証でき、アプリの表示名・bio・設定が維持されれば、この部分の確認は成功。

### CAPTCHAが有効な場合

匿名サインインにCAPTCHAを設定している場合は、ご自身で取得した新しいトークンを `.env.auth.local` の `AUTH_CAPTCHA_TOKEN` に設定してからlinkする。不要になったトークンはファイルから削除する。CLIはCAPTCHAの取得・回避を行わない。

### 追加メタデータが検出された場合

`additionalMetadataDetected=true` や `Additional Auth metadata was detected` で終了した場合、API接続が成功していても、情報取得・保存の要件を確認済みとはしない。CLIは値を出さず、既知のprofile項目名と追加フィールド数だけを表示する。自動でメタデータを削除したり設定を書き換えたりしない。

次節の監査を行い、項目名と有無だけを記録する。Googleが返す追加claimとSupabase内部の保存を区別する。scope制限だけで内部保存まで保証できない点は [設計書](auth-design.md#10-未解決事項と完了判定) を参照する。

## 7. Googleでの再ログインを確認する

linkが成功したGoogleアカウントを使い、次を実行する。

```powershell
pnpm --filter api auth:google login
```

表示されたURLを自分で開いて同じアカウントでログインする。`uid` がlink時と同じで、`isAnonymous=false`、`profilePreserved=true` になることを確認する。loginでは既存プロフィールの表示名を変更せず、`PUT /me` を再実行しても保持されることを検証する。

端末の確認に使うトークンは各コマンドのプロセスメモリだけで扱う。コマンド終了はSupabaseやGoogle全体のログアウトを意味しない。

## 8. Supabase内部と競合を手動で確認する

Supabaseの **Authentication → Users** で結果のuidを開き、user_metadata／Identityのidentity_dataの項目を確認する。管理画面で確認できない場合、SQL Editorで**対象ユーザーに限定した読み取り**を行う。値そのものをスクリーンショット・チャット・PRへ貼らない。

```sql
-- 対象UIDを自分の検証用UUIDへ置き換える。表示するのはキー名と存在判定のみ。
SELECT id, is_anonymous,
       ARRAY(SELECT jsonb_object_keys(COALESCE(raw_user_meta_data, '{}'::jsonb))) AS metadata_keys
FROM auth.users
WHERE id = 'YOUR_TEST_USER_UUID'::uuid;

SELECT provider,
       ARRAY(SELECT jsonb_object_keys(COALESCE(identity_data, '{}'::jsonb))) AS identity_keys
FROM auth.identities
WHERE user_id = 'YOUR_TEST_USER_UUID'::uuid;
```

email／email_verified、認証用のsub等と、name／full_name／picture／avatar_url等を区別して記録する。CLIが検査するのは取得できたAuthユーザー情報・Identity・Supabase JWTのuser_metadataであり、Googleからの生のID tokenやUserInfo応答が一切追加情報を含まない証明にはならない。

Googleの同意画面と要求scopeも、新しい同意・再ログイン・匿名連携で確認する。過去にprofileへ同意したクライアントの影響を避けるため、必要に応じて検証専用OAuthクライアントを使う。既存アプリの認可を一括で削除しない。

既存Identityとの競合は、別の `auth:google link` を実行し、既に連携したGoogleアカウントを選択して確認する。**別の匿名テストユーザーが追加される**。認証が拒否され、元のユーザーID・プロフィールが別UIDへ付け替わらないことを管理画面で確認する。同意キャンセルについても同様に確認する。

中断・失敗後も作成済みのテストユーザーは残る。不要な検証ユーザーはIDを確認してSupabase管理画面から個別に整理する。CLIはユーザー削除・統合を行わない。

記録する結果の例:

```text
確認日:
provider: custom:google
要求scope（新規同意／再ログイン／匿名連携）:
UID維持: OK / NG
プロフィール・設定保持: OK / NG
JWT更新後のisAnonymous: false / その他
Google由来の追加情報（項目名・有無のみ）:
Supabase Auth内部への追加保存（項目名・有無のみ）:
Data API無効のままAuthとHonoが動作: OK / NG
既存Identity競合／同意キャンセル:
未確認事項:
```

## 9. トラブルシューティング

| 状況 | 確認する点 |
|---|---|
| `Google scope must be exactly openid email` | Custom providerのScopes、Authorization paramsを確認。profileを追加して回避しない |
| `expected HTTP 302` / link時HTTP 400・422 | Custom provider有効化、識別子、issuer、Client ID、Manual Linkingを確認 |
| Googleのredirect_uri_mismatch | GoogleのAuthorized redirect URIsにSupabase表示のCallback URLを正確に登録 |
| Googleでaccess_denied | GoogleのAudience・テストユーザー、組織制限、同意キャンセルを確認 |
| 匿名サインインHTTP 400・429 | Anonymous sign-ins、CAPTCHA、認証のレート制限を確認。繰り返してユーザーを大量作成しない |
| コールバックが届かない | SupabaseのRedirect URLs、127.0.0.1、port、path、他プロセスによるport使用を確認 |
| API HTTP 401 | Supabaseの署名方式、URL・プロジェクト、有効な新JWTかを確認 |
| API HTTP 503 | APIのSUPABASE_URL、JWKSへの接続、API再起動を確認 |
| API接続失敗 | 起動中のAPIとAPI_BASE_URLを一致させる。CLI用8790とAPI用8787を区別する |
| UID不一致・追加metadata検出 | 成功扱いにせず、前節の確認結果を記録する。自動でデータを統合しない |

## 10. 自動検証と後続フロントへの引き渡し

```powershell
pnpm typecheck
pnpm test
pnpm check:openapi
pnpm build
```

自動テストはモックHTTP、生成した署名鍵、使い捨てDB、loopbackコールバックを使用する。実Googleのログインは実行しない。既存Honoの認証・API契約・DBスキーマは維持しており、フロントの生成型変更とSDK導入は今回不要。

後続フロント担当へは、provider識別子 `custom:google`、認証用のSupabase URLとPublishable key、HonoのAPI URL、許可コールバックURL、認証／連携の区別と手動確認結果を渡す。SDKはAuth専用に使い、Data APIの `.from()`／`.rpc()` は使用しない。SDKのCustom provider対応・Identity連携の型と画面上のセッション管理は、導入時に採用バージョンで検証する。

参考: [Custom OAuth/OIDC Providers](https://supabase.com/docs/guides/auth/custom-oauth-providers)、[Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)、[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)、[Supabase Authの実装](https://github.com/supabase/auth/blob/master/internal/api/provider/custom_oauth.go)。
