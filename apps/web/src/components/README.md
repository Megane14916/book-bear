# 共通UI（Issue #37）

各部品はpropsだけで動作し、API通信・認証参照・設定保存を行いません。

- `BookCard`は生成型BookSummaryまたはBookSearchItemを受け取ります。
  titleHrefを指定したときだけリンクを表示し、actionsで呼び出し側の操作を渡します。
  外部候補には内部IDがないため、カードで詳細URLを推測しません。
- `BookmarkCard`は通常のBookmarkCard型、またはvariant="flow"でBookmarkFlowItem型を
  受け取ります。flowでは本と投稿者を表示しません。リンク先とactionsは呼び出し側で指定します。
  visibilityは表示ラベルであり、所有者判定・非公開情報の認可の代わりにはなりません。
- `BookmarkBody`には閲覧者のviewerId（ゲストはnull）を必ず渡します。通常本文はallで
  初期表示、tapで初期非表示です。ネタバレは常に初期非表示です。投稿・閲覧者・本文・
  ネタバレ指定・モードの変更で展開状態を初期化します。本文はHTMLとして描画しません。
- `ContentModeSwitch`は制御されたradio選択です。生成型PreferencesのfeedContentModeを
  参照し、設定の保持・保存は呼び出し側が担当します。
- `LoadingState`は初回のスケルトン、variant="more"では追加取得中の表示です。
  追加取得時は一覧の下に置き、既存カードを残してください。
- `EmptyState`には次の操作のリンクまたはボタンをactionで渡します。
  `ErrorState`には安全な説明とonRetryを渡し、再試行中はisRetryingをtrueにします。
  HTTPコードの解釈や生エラーの表示は行いません。

固定ナビを使う画面には下部余白とセーフエリアを確保してください。
実際のカードや一覧の並び順・APIの取得・ページへの組み込みは後続Issueです。

`pnpm --filter web test:ui:e2e`で、通信・Supabase接続なしの360px／キーボード検証を
実行できます。e2eのfixtureは製品のルートへ登録しません。既存Chromeを使用します。
