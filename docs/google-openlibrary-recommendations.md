# Google Books・Open Library・openBDの推薦実験

固定seedの公開栞からQwen3で嗜好と検索語を作り、Google Booksで日本語書籍を1回検索する。Open Libraryの読書登録数とopenBDの書誌をISBNで照会し、利用条件を満たす文章で意味スコアと推薦理由を作る。Google Booksの検索順は `googleSearchOrder`、比較用の推薦順は `methods.A/B/C` に分けて出力する。

## 実行

リポジトリのルートで実行する。モックは外部通信なしで動作する。実行するユーザーは `mystery-b`、`growth-b`、`prose-b` などの正式seedユーザーから選ぶ。

```powershell
pnpm --filter api recommendations:external google-openlibrary-mock mystery-b
```

実APIを使う場合は、[ローカルPGlite](database-setup.md)を起動し、マイグレーションを適用する。CLIは固定seedの本棚とローカルDBの対象ユーザーの本棚を照合する。リポジトリ管理外の環境変数または `apps/api/.env.external-recommendations.local` に承認済みの値を設定する。Wrangler用 `apps/api/.dev.vars` にだけ保存しているキーは、このCLIが読む環境にも設定する。

```dotenv
GOOGLE_BOOKS_API_KEY=YOUR_APPROVED_BOOKS_KEY
CLOUDFLARE_ACCOUNT_ID=YOUR_APPROVED_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_APPROVED_WORKERS_AI_TOKEN
OPEN_LIBRARY_USER_AGENT="Book Bear (YOUR_CONTACT_EMAIL)"
# 許諾済み紹介文や独自紹介文を追加する場合だけ指定
# GOOGLE_OPENLIBRARY_PERMISSIONS_FILE="C:/path/outside/repository/permissions.json"
```

```powershell
pnpm --filter api recommendations:external google-openlibrary mystery-b --execute
pnpm --filter api recommendations:external google-openlibrary growth-b --execute
pnpm --filter api recommendations:external google-openlibrary prose-b --execute
```

`OPEN_LIBRARY_USER_AGENT` にアプリ名と連絡先を設定する。Open Libraryの案内では識別なしで毎秒1件、識別ありで毎秒3件。上のコマンドは順番に実行し、429を受けた場合は時間を置いて確認する。[Open Library API利用ガイド](https://openlibrary.org/developers/api)

## 処理と利用条件

- **Google Books**は1検索・最大40件、`langRestrict=ja`、`printType=books`、`orderBy=relevance`。元順位と書籍URLを保持する。ISBNを検証し、Volume ID、ISBN、版表記を整理した書名と著者で重複を照合する。小説希望時は明確な評論・作法書・参考書などを除外し、種別不明は残す。翻訳版は、ISBN経由で同じOpen Library Workに安全に結合できた場合もまとめる。[Google Books検索仕様](https://developers.google.com/books/docs/v1/reference/volumes/list)
- **Open Library**は正規化済みISBN-13と換算可能なISBN-10を `isbn:(… OR …)` にまとめて1回検索する。要求ISBNが返却ISBNに含まれ、Workまたは同じISBNの版の書名が一致し、双方の著者が分かる場合は著者名が1つ以上一致したときにだけ結合する。別表記や別Workで判断できない場合は保留する。最大100 Workを取得し、途中で切れた応答では人気度を使わない。`readinglog_count` はOpen Library利用者の読書ログ登録数。0件と欠損を区別し、`ratings_count` は補助情報として出力する。[Search API](https://openlibrary.org/dev/docs/api/search)・[読書登録数の定義](https://openlibrary.org/search/howto/more)
- **openBD**は同じISBN集合を1回で照会し、レスポンスのISBNを確認する。未収録、タイムアウトや失敗があってもほかの根拠で比較を続ける。Open LibraryとopenBDは並列で、個別時間と並列区間の実経過時間を別々に出す。書籍APIは各5秒、最大計3回。自動再試行は行わない。[openBD API仕様](https://openbd.jp/spec/)
- **AIに渡す文章**は、ISBNごとに本文ハッシュとEmbedding・Workers AI送信の許諾を確認したopenBD紹介文、利用権限を確認した独自紹介文、または独立カタログで確認した書名・タグに限る。[許諾ファイルの例](cinii-recommendations.md#embeddingに使う文章)と同じ形式で、ISBNに対して `openBdDescription` または `ownContent` を指定できる。許諾を確認した紹介文も600文字を超える場合は次の根拠に進む。既存の[独立カタログ](../apps/api/scripts/external-recommendations/catalog.json)とは書名と著者で照合する。根拠なしは `embeddingSource: "none"`、意味スコアは `null`。[openBD利用規約](https://openbd.jp/terms/)・[版元ドットコムの第三者利用承諾](https://www.hanmoto.com/permission-for-use/agreement)
- **Google Booksの利用条件**では検索結果の並べ替え・改変に制約がある。今回の独自順位は取得順と分けたローカル比較に限定する。この範囲についてGoogleの許諾が確認できたという意味ではない。Googleの紹介文・レビューは取得対象から外し、Google由来の書誌やOpen Libraryの数値はAIに送らない。実APIの書誌行、紹介文、Embeddingは永続化せず、このレポートには集計だけを記録した。公開前には独自順位、外部データとの統合、Googleへの帰属とリンクを含めて利用条件を確認する。[Books API利用規約](https://developers.google.com/books/terms)・[Google APIs共通規約](https://developers.google.com/terms#section_5_content)・[Booksブランディング指針](https://developers.google.com/books/branding)

## 順位と理由

| 方式 | スコア |
| --- | --- |
| A | 意味類似度 `S = (cosine + 1) / 2` |
| B | `S + 0.05 × P` |
| C | `S + 0.10 × P` |

`P = min(1, log(1 + readinglog_count) / log(1501))`。予備照会で確認した最大値1,500を暫定上限として固定した。少数の公開ISBNによる値で、日本語書籍の分布に合わせた上限ではない。加点は `S ≥ 0.60` かつ最高の意味スコアとの差が0.12以内のときに限る。所蔵や販売の推定には用いない。登録数が0または不明の場合は加点なし。意味スコアが `null` の候補は元の候補一覧に残る。

Embeddingは重複を除いて最大41文章を1バッチ。Qwen3による理由生成は3方式の上位候補をまとめて1回呼び、各候補番号と根拠を対応させる。理由生成に失敗した場合は順位を保持し、理由を `null` とする。Workers AIは嗜好抽出を含め最大3回、各15秒、入力JSONの合計上限7万文字。

## 実APIでの検証　2026-11-07（日本時間）

### Open Libraryの予備照会

公開ISBN4件をOR条件にまとめたところHTTP 200で3 Workが返り、読書登録数は0、1,312、1,500。日本語ISBN2件のうち、1件は `isbn` に一致し、残り1件は未収録だった。取得できた日本語Workは『吾輩は猫である』のローマ字表記だった。書名の同一性を確認できない場合、CLIはこのような結果にも自動で数値を付けない。別の1回の照会で `editions.title` と `editions.isbn` の取得も確認した。この少数の予備照会は日本語全体の収録率を示さない。

### 3ユーザーの検索・推薦

| ユーザー | Qwen3が作った検索語 | Google取得 | 対象外 / 重複 / 本棚除外 | 残った候補（うち小説判定） | 有効ISBN / 候補 | Open Library照合 / ISBN | openBD書誌 / ISBN | A / B / C |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| mystery-b | 推理小説 手がかり 謎解き | 20 | 3 / 0 / 0 | 17（5） | 2/17 | 0/2 | 0/2 | 0 / 0 / 0 |
| growth-b | 人間関係 心理描写 日常の描写 小説 | 20 | 3 / 0 / 0 | 17（3） | 1/17 | 0/1 | 1/1 | 0 / 0 / 0 |
| prose-b | 散文 音の表現 静かな反復 余白 | 1 | 0 / 0 / 0 | 1（0） | 0/1 | — | — | 0 / 0 / 0 |

元検索の段階では延べ41件中5件に有効ISBNがあり、候補整理後は35件中3件だった。謎解きと人物描写のケースでは小説と判定できる候補が残ったが、種別不明の候補も各12件と14件あった。文章表現のケースで得た唯一の候補のGoogle分類は共産主義で、嗜好への対応は確認できなかった。

openBDの書誌1件に紹介文はなく、独立カタログと一致する作品もなかった。3ユーザー全員でEmbeddingに使えた文章は0件。A・B・Cの順位と理由は空で、読書登録数による実推薦の改善は評価できなかった。

| ユーザー | Qwen3 | Google Books | ISBN・候補整理 | Open Library | openBD | 並列区間 | 全体 | 書籍API / Workers AI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| mystery-b | 1,518 ms | 884 ms | 43 ms | 538 ms | 125 ms | 538 ms | 2,986 ms | 3 / 1 |
| growth-b | 809 ms | 1,548 ms | 16 ms | 566 ms | 52 ms | 566 ms | 2,941 ms | 3 / 1 |
| prose-b | 1,390 ms | 1,038 ms | 27 ms | — | — | — | 2,457 ms | 1 / 1 |

実Qwen3の報告値は合計1,162入力トークン、155出力トークン、10.10 Neurons。Embeddingと理由生成はスキップした。各ユーザー1回の計測で、所要時間の代表値ではない。

## モックでのTop10

`mystery-b` のモックでは14件から種別不一致1件と重複1件を除いて12件を順位付けした。ISBN11件中7件がOpen Libraryに一致し、openBD書誌8件、模擬紹介文8件のうち1件を許諾確認済みとして使用した。理由生成まで含め、書籍APIとAIは各3回の模擬呼び出し。次の順位はテスト用データと模擬ベクトルでの結果。

| 順位 | A 意味のみ | B 弱い加点 | C 強い加点 |
| ---: | --- | --- | --- |
| 1 | 藪の中 | 藪の中 | 藪の中 |
| 2 | 夢十夜 | 夢十夜 | 夢十夜 |
| 3 | 吾輩は猫である | 吾輩は猫である | 注文の多い料理店 |
| 4 | 羅生門 | 注文の多い料理店 | 走れメロス |
| 5 | 注文の多い料理店 | こころ | 吾輩は猫である |
| 6 | 心理試験 | 心理試験 | こころ |
| 7 | こころ | 羅生門 | 心理試験 |
| 8 | Ｄ坂の殺人事件 | 走れメロス | 羅生門 |
| 9 | 走れメロス | Ｄ坂の殺人事件 | Ｄ坂の殺人事件 |
| 10 | 銀河鉄道の夜 | 銀河鉄道の夜 | 銀河鉄道の夜 |

モックでは『注文の多い料理店』が5位からBで4位、Cで3位に上がった。登録数不明の『羅生門』のスコアは維持されたが、加点された候補に抜かれて4位から7位・8位に下がった。

次の比較では、検索語をジャンル名と特徴語に絞った場合の小説候補数、ISBN取得率、許諾済みの独立データに照合できる割合を測る。人気度補正は、同じ候補と根拠文を使い、補正前後で読みたい本が上がったかを人手で判定する。
