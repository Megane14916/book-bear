# 青空文庫・NDL・Qwen3の外部書籍推薦を比較する

公開seed栞からQwen3で嗜好を抽出し、同じ嗜好で3方式を個別に評価する。推薦はローカルCLIの実験結果。登録済み判定には固定seedとローカルPGliteの対象ユーザーの本棚を使う。[3ユーザーの実測とTop10](three-way-recommendation-results.md)

青空文庫方式は全件索引と再ランキングに更新した。現在の索引コマンドと順位の定義は[青空文庫の全作品索引と再ランキング](aozora-recommendation-improvement.md)を参照。このページのA方式の評価条件は、旧220作品の実験を記録したもの。

| 方式 | 候補を取得する先 | 順位付けの根拠 |
| --- | --- | --- |
| A `aozora` | 青空文庫公式の全作品CSVとSoranohaの本文アーカイブ | BGE-M3で嗜好と本文チャンクの類似度を計算 |
| B `ndl` | NDLサーチの国立国会図書館全国書誌情報 | ISBN付き書籍をQwen3が書名・分類・件名から評価 |
| C `llm-direct` | Qwen3が提案した書名と著者をNDLサーチで照合 | Qwen3の適合推定と確信度。実在確認を通過した候補が対象 |

## 準備と実行

リポジトリのルートから、[ローカルDBの手順](database-setup.md)に沿ってPGliteを起動し、ローカルにマイグレーションを適用する。Workers AIで承認済みの `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を、環境変数またはGit対象外の `apps/api/.env.external-recommendations.local` に設定する。青空文庫とNDLサーチの公開取得に個別のAPIキーは不要。

```powershell
pnpm --filter api recommendations:aozora import

$stateDir = 'apps/api/.recommendation-experiments'
$archive = Join-Path $stateDir 'soranoha-plaintext.zip'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest 'https://soranoha.org/bulk/soranoha-plaintext.zip' -OutFile "$archive.part"
    Move-Item -LiteralPath "$archive.part" -Destination $archive
}
pnpm --filter api recommendations:aozora index --limit 200 --execute
```

`import` はローカルにCSVの取り込み済みスナップショットがあれば再利用する。更新する場合は `import --refresh`。索引は作品ごとに原子的に書き出す。中断後は同じコマンドを再実行すると、現在の書誌・前処理版・モデルに対応する保存済み作品を再利用する。保存先を変える場合は `RECOMMENDATION_EXPERIMENT_DIR` を絶対パスで設定し、本文ZIPもその場所に置く。既定のディレクトリはGitの対象外。新しいコーパスリリースで全件再計算する場合は、別の保存先に新しいスナップショットとZIPを用意する。

```powershell
pnpm --filter api recommendations:external preferences mystery-b --execute
pnpm --filter api recommendations:external aozora mystery-b --execute
pnpm --filter api recommendations:external ndl mystery-b --execute
pnpm --filter api recommendations:external llm-direct mystery-b --execute
```

`growth-b`、`prose-b` に置き換えて繰り返す。初回の方式実行でも嗜好を保存するため、明示的な `preferences` 実行は省略できる。保存済みの嗜好はseed版と公開栞のハッシュが一致する間は同一で、CLI出力の `preferenceSource.fingerprint` と `reused` で照合できる。栞の順序と文字数制限は全方式で共通。

## A 青空文庫

- 通常のUTF-8全作品CSVには分類・権利フラグ・本文URLがないため、同じ公式ページで配布しているUTF-8全作品**拡充版**をZIPのまま取得する。全行を読み、作品IDに著者・翻訳者等の人物IDを束ねる。作品ID、底本に対応する本文URL、図書カード、出典、取得時刻、CSVのハッシュを保持する。NDCの小説・物語系を利用し、判定不明は保留。書誌はCC BY 4.0。[青空文庫の配布ページ](https://www.aozora.gr.jp/index_pages/person_all.html)・[利用規準](https://www.aozora.gr.jp/guide/kijyunn.html)
- 本文は作品と全寄与者の権利フラグが「なし」で、著者等の役割・没年・本文URLを確認できた作品に限定する。海外小説の分類か原題がある作品は翻訳者情報も必須。没年は年単位の余裕を取り、国内分類は71年以上前、海外・原題ありは82年以上前を追加の保守的なフィルターとする。権利状態が不明な作品は書誌だけ保持する。この条件は索引対象を狭める運用で、個々の法的判断を置き換えるものではない。[青空文庫の利用規準](https://www.aozora.gr.jp/guide/kijyunn.html)
- 本文はSoranohaのプレーンテキストZIPから、公式CSVと作品ID・人物ID・書名・副題を照合して取得する。ZIPは一括で取得し、対象ファイルだけを解凍する。Soranohaの符号化と作品本文の権利条件は別であり、本文の選択には公式CSV側の権利条件を適用する。本文ハッシュ、元の識別子、底本ハッシュ、リリース、出典URLを索引に記録する。[Soranohaの一括配布](https://soranoha.org/#bulk-download)・[権利とライセンス](https://soranoha.org/rights)
- サンプルは作家ごとに最大5作品で、約5分の1は探偵・事件などの語を含む書名から選ぶ。残りは固定ハッシュ順で選ぶ。ルビを除いて親文字を残し、青空文庫の注記・外字の指示・底本情報を除く。本文260文字未満は除外し、最大720文字の窓を最大4箇所、本文に均等に配置する。短い作品で窓が重なる場合がある。索引は1回1〜300作品、8作品・最大32テキストごとにBGE-M3へ送る。
- 推薦時には本文索引を読み、嗜好のEmbeddingと各窓のコサイン類似度を計算する。主順位は上位3窓の平均（3窓未満は存在する窓の平均）、比較順位は最大値。作品を水増ししないよう書名・著者と翻訳者の組で重複を抑え、題名から明らかな序文などを除く。著者あたり上位2作品まで。理由生成は本文の根拠チャンクを指定し、モデルが返した引用がそのチャンクに完全一致した理由だけを採用する。該当しない場合は、本文に含まれる語句や文長・会話記号の実測に基づく説明を付ける。

## B NDL

全国書誌のOpenSearchを `iss-ndl-opac-national` に限定する。日本の小説 `913.6` と海外の小説 `933.7`、年代の違う区間、必要に応じて「推理」「青春」「短編集」などの広い探索語を使い、20件ずつ最大4回取得する。2ページ目は `idx=21`。ISBN-10の妥当性を検証してISBN-13に変換し、ISBNのない書誌は件数のみを数える。NDL書誌ID・ISBN・版表記を正規化した書名と著者で重複を除く。

Qwen3に書名・著者・分類・件名を渡し、0〜4の適合推定または根拠不足を返させる。探索語自体は書籍内容の根拠に使わない。件名が空の候補は最大2・低確信とし、適合推定2以上から著者最大2件でTop10を選ぶ。書誌の詳細、出版社の紹介文や外部画像は推論へ渡さない。ISBNは既存のopenBDの一括照会に渡せる形式で出力する。

## C Qwen3直接提案

定番、新しめ、代表作以外、別ジャンルの4観点に分け、それぞれ最大6件をQwen3に提案させる。書名と著者で提案を重複除去し、最大3候補ずつNDL全国書誌のSRUに照会する。検索の `title any` と `creator any` は別々のOR条件なので、結果を候補ごとに再照合する。正規化した書名と、著者または書誌上の別表記が一致した候補を採用する。1回最大30書誌・最大8回。似た題名、別著者、判定が曖昧な候補は照合結果に残し、推薦順位から除く。結果上限のため確認できなかった候補も区別する。実在が確認できたISBNなしの書籍は別の状態として保持する。理由はモデルの推定であり、NDLが検証した情報は書誌の部分。提案の「定番」はモデルの自己分類で、人気度を表す実測値ではない。

## 外部APIの条件と評価

NDLは全国書誌情報のメタデータを対象に、提供元と参照URLを出力する。提供元の表にあるCC BYの適用範囲に従い、画像や本文など第三者の権利が関係する素材は取得・推論の対象に含めない。照会は上限付きで、429を受けたら以降の照会を停止する。継続運用ではNDLの利用案内を参照する。[API利用案内](https://ndlsearch.ndl.go.jp/help/api)・[仕様](https://ndlsearch.ndl.go.jp/help/api/specifications)・[提供元と利用条件](https://ndlsearch.ndl.go.jp/help/api/provider)

人気度補正を使わずに比較する。方式ごとに候補集合、使う根拠、スコアの尺度が異なるため、絶対値同士は比較しない。候補数、確認率、著者・分類の偏り、実際の書籍と理由が対応しているかを確認する。LLMのスコアは人手判定を補助する指標。
