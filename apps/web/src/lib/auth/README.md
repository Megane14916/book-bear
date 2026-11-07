# 認証基盤（Issue #36）

`AuthProvider` はQueryClientProvider配下に1つ配置します。公開画面は
常に表示でき、起動や検索だけでは匿名アカウントを作成しません。

## 後続画面からの利用

- `useAuth()` の `canReadPrivate` がtrueのときだけ本人用Queryを開始します。
  Query Keyには `userId` を含め、QueryのsignalをAPIへ渡してください。
- 保存は `runAuthenticatedWrite(async ({ signal, userId }) => ...)` を通します。
  セッション復元、必要な匿名認証、PUT /meの成功後にだけコールバックを呼びます。
  コールバック内でも既存の `api` と `requestData` を使い、signalを渡してください。
- 同一タブの同時保存は匿名認証と初期化を共有し、各保存自体は別々に実行します。
  同じボタンの連打は画面側のisPending等で防いでください。別タブからの同時の
  初回保存を1件にまとめる独自ロックは導入していません。
- `retrySession()` はセッション復元・初期化の再試行です。ゲストの匿名認証は
  開始しません。初回保存の失敗後は同じ保存操作を再試行できます。
- `signOut()` はこのブラウザのSDKセッションを終了します。匿名ユーザーは
  サインアウトすると既存の記録へ再ログインできないため、正式なUIを追加する
  際にはその点を案内してください。

UID変更・サインアウト・匿名から正式への変化では、旧通信を中断してQueryと
Mutationのキャッシュを消去します。同じ本人の通常のJWT更新では消去しません。
通信中断はサーバーへ既に届いた更新を取り消す保証ではありません。

## 手動確認

1. `.env.example` を参考にWebの `.env.local` に開発用SupabaseのURLとPublishable key、
   対応するHono APIのURLを設定します。Secret keyやservice_roleは使いません。
2. APIとWebを起動し、`http://localhost:5173/?auth-check=1` を開きます。
3. 新規ブラウザではguest、本人データ取得は停止となることを確認します。
   画面遷移だけで匿名サインインやPUT /meが送信されないことも確認します。
4. 「保存前処理を確認」を押します。匿名認証 → PUT /me → GET /meが成功し、
   readyとなることを確認します。本や栞を作成する機能ではありません。
5. 再読み込みして同じUIDで利用できることをNetworkのGET /me応答で確認します。
   トークンをコピーしたりログに出したりする必要はありません。
6. API停止中に初期化を試し、保存が進まないことを確認してからAPIを再起動し、
   再試行します。認証状態の切替やJWT更新は開発用アカウント・環境で確認します。
7. 匿名セッションを失ってよい検証用ブラウザでサインアウトを確認します。

認証設定がない場合も公開画面は開けます。確認パネルでの保存前処理は設定エラーに
なります。パネルは開発時かつ `?auth-check=1` の場合だけ表示され、本番では除去します。

## ブラウザ結合テスト

```sh
pnpm --filter web test:auth:e2e                 # モックAuth/API + 実SDK/ブラウザ
pnpm --filter web test:auth:e2e --project=live  # 開発用Supabase + 専用ローカルHono API
```

Chromeをインストールした環境で実行します。Webは5190、実APIは8795、Wranglerの
inspectorは9245を使い、テストがサーバーを起動・停止します。既存サーバーは再利用しません。

liveは既存の `apps/api/.env.auth.local` のSUPABASE_URL・SUPABASE_PUBLISHABLE_KEYを
Webへプロセス環境変数で渡します。`.dev.vars`・`.env.deploy.local` のSUPABASE_URLと
`.env.local` のCLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVEが同じ開発用
プロジェクトであることを事前検査します。設定ファイル・DB設定は変更しません。
実行者はこれらを開発専用環境として用意してください。本番設定では実行しません。

6項目を順番に検証します：閲覧時の未作成、初回認証・初期化、再読み込みのUID維持、
SDKでのJWT更新後のAPI成功、サインアウト・別UIDでのキャッシュ消去、初期化再試行。
最後の項目はPUT /meの最初の応答だけ503を注入し、再試行は実サービスへ接続します。
キャッシュ確認は開発パネルでQuery2件・Mutation1件の検証データを作り、消去を確認します。
本棚・栞の書き込みはありません。liveでは開発用匿名ユーザーとプロフィールが3件残ります。
終了時に最後のセッションをサインアウトします。ユーザー削除やDB設定変更はしません。

トークンはテスト中のメモリ内で比較するだけです。storageState・HAR・trace・動画・
スクリーンショットには保存せず、レポートへJWTやUIDを出力しません。複数タブからの
同時初回保存は今回の検証対象外です。

2026-11-07の自動検証：Chromeでmock 6件・live 6件が成功しました。
liveは実Supabase Authと、同じ開発用DBへ接続するローカルHono APIを使用しました。
初期化再試行の最初の503のみ意図的な障害注入で、再試行は実APIで成功しています。
