# 未登録書籍の推薦を比較する

公開のダミー栞をもとに、日本語書籍の候補生成と順位付けを調べる開発用CLI。Book Bearの既存の推薦APIや画面とは独立している。実験でBook Bearの登録状態を確認する場合も、DB操作はローカルの書籍テーブルへのSELECTだけ。

## Google Booksの利用条件と実験範囲

2026-11-06確認。Google Books APIの個別条件に加え、Google APIs共通条件が適用される。共通条件§5(a)・(e)では、権利者の許諾や法令による根拠がないAPIコンテンツの利用、第三者への提供、改変・二次利用、恒久コピーやキャッシュ期限超過に制約がある。Booksのブランディング指針は、Googleへの帰属表示・書籍へのリンクを求め、検索結果の並べ替えや改変を制限する。[Books API利用規約](https://developers.google.com/books/terms)・[Google APIs共通規約](https://developers.google.com/terms#section_5_content)・[Booksブランディング指針](https://developers.google.com/books/branding)

| データ | このCLIで行う処理 |
| --- | --- |
| Google Booksから取得した情報 | `google` でクエリ別の検索順を表示する。除外判定は各順位の注記として出し、行の並べ替えや候補の詰め直しはしない。取得対象は書誌・分類・書影URLに限定する。 |
| Google Booksの紹介文・書名など | この実験でEmbedding化・外部LLMへの送信・再ランキング・保存を行える許諾は確認できていない。紹介文はリクエスト対象から外し、書誌情報はその実行中だけ保持する。実検索結果をファイル、評価fixture、DB、永続ログに保存しない。 |
| 独立カタログ | 青空文庫の図書カードで作品名と著者を確認し、このリポジトリ用に独自に書いた紹介文とタグでB・Cを実行する。Googleの検索結果や紹介文、本文の抜粋をコピーしていない。作品単位で、版を特定しないためISBN、Google Booksのvolume ID、書影URLはnull。 |

ライブモードでの帰属はCLI内の `attribution` と各書籍のリンクに記載する。将来、Googleの検索結果を画面に出す場合は、指針が指定する帰属表示、画像、リンク、表示順を改めて確認する。ライブの再ランキングは権利・利用条件を確認できた時点で別に検討する。[青空文庫の収録基準](https://www.aozora.gr.jp/guide/kijyunn.html)

## 実行

リポジトリのルートで実行する。まずモックで、同じ候補がAからB、BからCへ渡ることを確認する。モックのスコアや並び順は疎通確認用。

```powershell
pnpm --filter api recommendations:external mock mystery-b
```

実サービスを使う場合は、ローカルPGliteを起動してマイグレーションを適用する。必要に応じて [seed](seed.md) を投入する。CLIが嗜好抽出に使う栞は固定seedの公開本文で、DBから実ユーザーの栞を読み取ることはない。ローカルDBは、今回の候補が書籍テーブルに登録済みかを照合するために使う。

承認済みの開発用認証情報を環境変数またはGit対象外の `apps/api/.env.external-recommendations.local` に設定する。

```dotenv
CLOUDFLARE_ACCOUNT_ID=YOUR_APPROVED_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_APPROVED_WORKERS_AI_TOKEN
GOOGLE_BOOKS_API_KEY=YOUR_APPROVED_BOOKS_KEY
```

```powershell
# 独立カタログでA/B/Cを比較。Workers AIだけを呼ぶ。
pnpm --filter api recommendations:external catalog mystery-b --execute

# Workers AIで検索語を作り、Google Booksの検索順と候補判定を確認。
pnpm --filter api recommendations:external google mystery-b --execute
```

`catalog` のAは独立カタログの文字bigram検索順で、複数クエリの結果を順番に1冊ずつ合わせる。実Google BooksのAとは検索の仕組みが異なるため、両方の順位を同じ評価値として扱わない。実Google Booksは `langRestrict=ja`、`printType=books`、`orderBy=relevance` を使用する。[Google Booksの検索パラメーター](https://developers.google.com/books/docs/v1/reference/volumes/list)

## 処理・出力

1. Qwen3で最大8件の公開栞から好意的な嗜好、希望する書籍種別、48文字以下の検索語を2〜3件抽出。Zodで検証し、検索演算子、重複、空の結果を拒否する。Googleへ送るのは検証後の検索語。
2. ISBN-13とvolume IDを照合し、妥当なISBN-10はISBN-13に換算する。ISBNがない場合は、著者が分かる範囲で正規化した書名と著者を併用する。書名だけの一致で候補を統合しない。登録済み判定はローカルのID、ISBN、書名・著者を使う。異なる表記や版をすべて識別できるわけではない。
3. 種別が明確に合わない候補を除外する。小説を希望する場合、明確な評論・事典をタイトルや分類で検知する。判定材料がない候補は未知として残すため、曖昧な分類には取りこぼしや混入が起こり得る。
4. Bは栞の本文と紹介文の直接比較を避け、嗜好要約と独自紹介文のコサイン類似度を使う。紹介文のない作品は書名・タグにフォールバックする。書名・タグだけで並べたTop10も `metadataOnlyTop` として出す。
5. CはBの上位10冊をQwen3で並べ替える。候補番号を過不足なく一度ずつ返すことを検証する。理由はモデル生成で、候補に付いた資料を根拠にするよう指示する。実験に正解ラベルは置かず、理由や順位は比較・人手確認に使う。

出力の `reportVersion` は形式の版、`plan` は検索語と嗜好、`candidateGeneration` は取得件数・除外理由の件数・処理時間、`methods` は方式別の上位10冊と理由。書誌は `volumeId`、`isbn10`、`isbn13`、`title`、`author`、`coverUrl`、`sourceUrl` を持つ。実GoogleではAをクエリ別に表示し、BとCには利用条件による停止状態を返す。

Google Booksは1回の実験で最大3検索・各10件、候補は最大24冊。リトライや詳細APIの追加呼び出しは行わない。Workers AIはGoogleモードで最大1回、独立カタログで最大3回、リクエスト合計2万文字、各栞600文字、Embeddingは最大49文章を1バッチ。Google Booksは1リクエスト5秒、Workers AIは15秒で応答待ちを打ち切る。報告する入力文字数は課金量とは別で、トークン・Neuronsはプロバイダーが返した応答だけを集計する。[Workers AIの利用制限](https://developers.cloudflare.com/workers-ai/platform/limits/)・[料金表](https://developers.cloudflare.com/workers-ai/platform/pricing/)

初期カタログは日本語の古典作品に偏る。新刊や実用書の評価、紹介文がある場合とない場合の精度差、実利用者の推薦品質は、使用許諾と判定理由を先に固定した別の評価データで確認する。

`mock mystery-b` の動作確認では、ローカル検索の延べ30件から重複19件と評論1件を除外し、A/B/Cそれぞれに10件を出力した。Google BooksとWorkers AIへのネットワーク呼び出しは0回。実サービスの順位、応答時間、推論使用量はこの結果から評価できない。
