# 青空文庫の全作品索引と再ランキング

青空文庫の公式UTF-8全作品拡充版CSVで権利を確認し、Soranohaの本文と照合する。小説・物語と判定した作品は、著者や書名の選別を設けずに索引作成の対象とする。[青空文庫の全作品CSV](https://www.aozora.gr.jp/index_pages/person_all.html)・[本文と書誌の利用規準](https://www.aozora.gr.jp/guide/kijyunn.html)・[Soranohaの本文と符号化の権利](https://soranoha.org/rights)

## 索引を作る

リポジトリのルートで実行する。承認済みのWorkers AI認証情報とSoranohaのプレーンテキストZIPは、[3方式のセットアップ](three-way-recommendations.md#準備と実行)と共通。

```powershell
pnpm --filter api recommendations:aozora import
pnpm --filter api recommendations:aozora status

# 件数、最大API回数、最大テキスト数、トークン概算を表示
pnpm --filter api recommendations:aozora index --all

# 未処理の次の200件を処理
pnpm --filter api recommendations:aozora index --limit 200 --execute

# 未処理作品を安全上限まで処理
pnpm --filter api recommendations:aozora index --all --execute

# 保存された失敗分を再試行
pnpm --filter api recommendations:aozora index --all --retry-failed --execute
```

毎回、未処理の次の作品へ進む。候補全体に300件の上限はなく、1回の入力JSONは2,400万文字、API呼び出しは最大650回とする。計画では最大8断片、1断片最大720文字の保守的な予約量を見込み、さらに件数を絞る。現在の設定では1実行の計画は最大2,077作品。残りは同じコマンドで続行する。トークン概算は文字数に基づく目安で、実トークン数や課金を表さない。Workers AIが返した計測値は `usage` に記録する。[BGE-M3の仕様](https://developers.cloudflare.com/workers-ai/models/bge-m3/)・[Workers AIの料金と日次枠](https://developers.cloudflare.com/workers-ai/platform/pricing/)

索引は1作品ごとに原子的に書き出す。同時実行をロックで防ぎ、APIエラーが発生した場合は処理中の作品を記録して停止する。強制終了で `aozora-index.lock` が残った場合は、記録されているプロセスが終了したことを確認してからロックファイルを削除する。`status` は権利条件を満たした対象、本文を用意できた件数、索引済み、未処理と失敗理由を出す。権利条件で対象外の作品数と、本文未収録・書誌不一致・UTF-8不正・短すぎる本文・サイズ超過・AIエラーを区別する。

## 本文断片と保存形式

1. 作品IDと人物ID、書名、副題が一致する本文を、取得済みのSoranoha ZIPから選ぶ。権利判定は青空文庫の公式CSVを使う。本文中のルビ・注記・底本情報を既存と同じ方法で処理する。
2. 旧方式の最大4箇所を残し、空白が大きい区間から最大8箇所まで補う。短い作品では重複や過度な重なりを避けるため、追加を打ち切る。各断片は最大720文字。本文ハッシュと断片が一致し、同じモデルで作った旧ベクトルは再利用する。
3. `aozora-index-v2` に作品単位のJSONを保存する。EmbeddingはFloat32のバイト列をBase64で格納し、本文断片、作品ID、取得元、本文ハッシュ、前処理版、モデル、次元、権利確認状態と処理日時を持つ。旧 `aozora-index` は比較用の220作品として残す。検索では互換性のあるv2をまとめて使い、v2が未作成ならv1で検索できる。異なるモデル・次元を同じランキングに混ぜない。
4. 索引の再実行では有効な保存済み作品をスキップする。公式書誌の対象作品やアーカイブが変わった場合は照合し直し、本文と断片が一致したベクトルを再利用できる。新旧のアーカイブ由来の索引を混ぜない。

## 推薦の比較

```powershell
pnpm --filter api recommendations:external aozora mystery-b --execute
pnpm --filter api recommendations:external aozora growth-b --execute
pnpm --filter api recommendations:external aozora prose-b --execute
```

各ユーザーの固定公開栞から保存済みの嗜好を使う。同一のv2作品集合で次を比較する。

| 出力 | 内容 |
| --- | --- |
| `methods.A` | 旧方式と同じ最大4断片の上位3類似度平均 |
| `methods.B` | 最大8断片の上位3類似度平均。断片数が4を超える場合、`0.012 × log2(断片数 / 4)` を減算 |
| `methods.C` と `top` | Bの上位100作品を絞り込み、追加本文とQwen3のジャンル・テーマ・文体・展開評価で再ランキング |
| `legacyTop` | 旧220作品に旧方式を適用した順位 |
| `sameLegacyCorpus` | 新索引に移行済みの旧作品だけで、Bを適用した順位 |
| `maximumTop` | 全v2の最大チャンク類似度での順位 |
| `detailTop` | Qwen3評価の前に、追加断片を含めて評価した順位 |

Bの上位100作品では、嗜好全体とジャンル・テーマ・文体・展開のEmbeddingを別々に比較する。絞り込みの重みは全体0.58、ジャンル0.16、テーマ0.12、文体0.08、展開0.06。上位24作品だけに、既存の断片間を埋める本文を最大2箇所ずつ追加し、BGE-M3で比較する。アーカイブ照合や追加Embeddingができない場合は、保存済みの断片で続行する。

Qwen3には6作品ずつ最大4回、作品ごとに最大3断片を渡す。ジャンル・テーマ・文体・展開・総合を0〜5または根拠不足で返し、作品IDと候補内の断片番号が一致した評価を採用する。総合が判断不能でも根拠のある軸があれば、その平均を低確信の推定に使う。総合評価に応じて意味スコアを補正し、明確なジャンル不一致は追加で減点する。明示的な謎解き嗜好に対し、選んだ断片に超自然的な語があり、提示した断片に捜査・推理を示す明示的な語が見当たらない場合は、ジャンルと総合の加点を制限する。補正前のモデル評価と根拠断片も出力する。これは断片に基づく加点の制御で、作品全体のジャンル判定には使わない。

確信度の低い評価は補正を弱める。LLM評価を採用できなかった作品は意味スコアを使い、全候補で採用できなかった場合はBの順位を返す。推薦理由には断片IDと評価の内訳を添え、根拠がない場合は断片から実測できる特徴を表示する。

著者・同じ収録作品集は最終Top10で各2作品まで。同じ作品と判断できる表記違い・版違いをまとめる。作品集の個別作品は、作品名と収録作品集名を分けて出す。シリーズの推定や書誌上の小説分類には取りこぼしがあり、LLMの適合スコアは人間による推薦品質の確認を補う指標とする。

[固定seed 3ユーザーでの実測と全順位](aozora-recommendation-improvement-results.md)
