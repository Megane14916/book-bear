# 書籍検索・詳細・登録（Issue #38）

共通UIはIssue #37、認証と保存前初期化はIssue #36を再利用します。
アプリデータの通信は既存openapi-fetchと生成型を使用し、Supabase Data APIは使いません。

- `/search?q=...`：送信された条件だけを検索します。空入力は通信しません。
  検索は既定20件で、現行APIにカーソルはありません。ISBN-13（ハイフン・空白可）に
  対応し、ISBN-10変換は行いません。
- `localBookId`がある候補はその内部UUIDで詳細へ進み、取り込みも匿名認証も行いません。
- 外部候補は利用者の「書籍情報を取り込む」で認証・PUT /meを完了し、providerとproviderIdを
  POST /books/importに送ります。200と201のどちらも、応答Book.idが永続的なbookIdです。
  外部IDやISBNを内部UUIDとして扱いません。
- `/books/manual`：タイトル必須、著者・総ページ数は任意です。ページ数は1〜2147483647の
  整数で、空欄はnullです。失敗後も入力を保持し、再試行では現在の入力を再検証します。
  ISBNなしの作成は重複を許容するため、通信結果が不明な場合は検索で確認してから再試行します。
- `/books/:bookId`：公開の書誌情報を取得します。存在しないIDは検索へ戻す導線を表示します。
  `?userId=<UUID>`が明示された場合だけ、そのユーザー×書籍の栞の流れへのリンクを表示します。
  書籍単位の全公開栞取得は行いません。流れの画面実装は後続Issueです。

## Issue #39への受け渡し

書籍詳細の「本棚への追加へ進む」は`/library?bookId=<Book.id>`へ遷移します。
#39はこの永続的なbookIdを使い、明示的な登録操作でPOST /me/booksを実行してください。
本Issueでは本棚登録APIを呼ばず、追加済みとも表示しません。#39実装前の/libraryは準備中です。
そのAPIが返すUserBook.id（userBookId）は、書籍IDと別に管理します。

## 確認

`pnpm --filter web test:books:e2e`で実画面・実Auth SDKを使うブラウザテストを実行します。
APIとSupabase HTTPはモックです。Chromeと5193番ポートを使用し、実サービスへは接続しません。
既存の認証・共通UIテストも継続して実行します。実Google Books/openBD・Supabase/開発DBとの
結合結果はモックの成功とは区別して報告します。
