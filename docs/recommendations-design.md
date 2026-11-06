# 栞に基づく書籍推薦の設計・評価

[Issue #30](https://github.com/Megane14916/book-bear/issues/30) の初期実装。評価には [Issue #33 の固定データ](seed.md) を使う。

未登録の実在書籍の検索と順位付けは、[外部書籍推薦の実験CLI](external-recommendations.md) で確認できる。

## APIとデータ利用

- `GET /api/v1/me/recommendations` は正式JWTを要求する。limitは1〜10、既定5。プロフィール未初期化は404、匿名JWTは403、本人の公開栞または候補がなければ200で `{ items: [] }` を返す。応答は推薦順の `BookSummary` とし、本文・ベクトル・利用者識別子は返さない。AI障害・タイムアウト・利用制限は503とする。
- 本人の公開・未削除の栞を新しい順に8件取得する。候補は他者の公開・未削除の栞で、本人の本棚にある本を除外する。書籍内は新しい順で2件まで、全体は48件まで。各書籍の1件目を優先し、書籍間は閲覧者と書籍IDによる固定順にする。DB接続を閉じた後にAIを呼ぶ。
- 入力は各栞600文字、1回の推薦で最大56文章。同じ入力はリクエスト内で1回だけEmbedding化し、BGE-M3に1バッチで送る。正規化した履歴ベクトルの和と候補の内積を使い、書籍内の平均で順位を決める。同点は書籍ID順。リクエスト間でベクトルを共有しないため、次の読み取りには栞の編集・削除・非公開化が反映される。
- AI bindingは `wrangler.jsonc` の `AI`。EmbeddingとLLMは内部アダプターに分離する。LLMはQwen3 30Bの構造化出力をZodで検証し、実験用の嗜好抽出に利用する。APIの順位付けはEmbeddingのみ。モデルIDは `RECOMMENDATION_EMBEDDING_MODEL` と `RECOMMENDATION_LLM_MODEL` で置換できる。10秒で応答待ちを打ち切り、リトライは行わない。上流処理の取り消しは保証されない。

公式資料は [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/)、[BGE-M3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)、[Qwen3 30Bのモデルパラメータ](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)、[Workers AI利用制限](https://developers.cloudflare.com/workers-ai/platform/limits/)。

## データ版2で比較する

クリーンなローカルPGliteに[版2のseed](seed.md)を投入する。評価は10ユーザー、1ケース12冊、正例2〜3冊。嗜好が複数あるユーザー、嗜好の手掛かりが少ないユーザー、共通する語彙で意味が異なる負例を含めた。評価JSONに候補ごとの判定理由を置く。

```sh
pnpm --filter api recommendations:evaluate lexical legacy both
pnpm --filter api recommendations:evaluate compare legacy both
pnpm --filter api recommendations:evaluate compare balanced both
pnpm --filter api recommendations:evaluate embeddings diverse both
```

- 第1引数は `lexical`、`embedding`、`llm`、`embedding-mean`、`embeddings`、`compare`。文字bigram、Embeddingの書籍内最大・平均集約、LLMによる嗜好抽出後のEmbeddingを比較する。`embeddings` は最大と平均、`compare` は全方式を同じ入力で評価する。
- 第2引数の `legacy` は従来の取得、`diverse` は候補取得のみを分散する。`balanced` はさらに、履歴を1冊3件までにして各書籍の新しい栞を順に選ぶ。現行APIは `diverse` と `embedding-mean` の組み合わせ。
- 第3引数の `fixed` は判定済みの候補だけで順位付けを比較し、`db` は候補取得から測る。`both` は両方を計算する。`db` の `candidateMisses` は取得できなかった正例、`rankingMisses` は取得できたが上位3件から外れた正例。未判定の書籍は正例・負例のどちらにも数えず、`unjudgedTop3` に記録する。

Precision@1は先頭が正例だった割合、Recall@3はラベル済み正例のうち上位3件で拾った割合、MRRは最上位の正例の順位の逆数の平均。Hard Negative Hit Rateは上位3件に難しい負例が1冊でも入ったケースの割合。ランダムの各指標は候補を一様に並べ替えた期待値で、DB評価では候補から漏れた正例もRecallの分母に含める。

AI実験では `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を環境変数またはGit対象外の `apps/api/.env.recommendations.local` に設定する。送信する栞はseedの公開本文と一致するものに限る。1回のCLI実行で最大45呼び出し（LLMなしは20）、入力30万文字、1バッチ56文章、各栞600文字、待ち時間10秒。比較内では1ケースのベクトルを方式と評価範囲で共有する。共有Embedding時間はそのケースの共同計算時間で、個別APIの応答時間ではない。

出力には方式別のDB・順位付け時間、ケース間の平均、AI呼び出し総数と入力文字数を含める。Workers AIが返した分は `reportedNeurons` と `meteredCalls` に記録する。全体の費用を求める場合は実験前後に同じ開発アカウントの使用量を記録し、[Workers AIの料金表](https://developers.cloudflare.com/workers-ai/platform/pricing/) と照合する。文字数や一部の応答だけの使用量を全体の課金額として扱わない。

### 版2の実測

同じ10ケースを各条件で1回計測。指標はケース平均。難しい負例の率は低いほど良い。

| 範囲 | 取得 | 順位付け | P@1 | R@3 | MRR | 難負例率 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 固定 | 共通 | ランダム | 20.0% | 25.0% | 0.422 | 25% |
| 固定 | legacy | 文字一致 | 0% | 5.0% | 0.212 | 30% |
| 固定 | legacy | Embedding最大 | 30% | 30.0% | 0.501 | 10% |
| 固定 | legacy / diverse | Embedding平均 | 30% | 36.7% | 0.501 | 10% |
| 固定 | legacy | LLM＋Embedding最大 | 70% | 60.0% | 0.794 | 10% |
| 固定 | balanced | 文字一致 | 0% | 5.0% | 0.206 | 30% |
| 固定 | balanced | Embedding最大 | 0% | 16.7% | 0.273 | 0% |
| 固定 | balanced | Embedding平均 | 20% | 33.3% | 0.441 | 10% |
| 固定 | balanced | LLM＋Embedding最大 | 80% | 70.0% | 0.900 | 10% |
| DB | legacy | ランダム | 9.2% | 11.5% | 0.254 | 12.5% |
| DB | legacy | 文字一致 | 0% | 0% | 0.086 | 0% |
| DB | legacy | Embedding最大 | 20% | 11.7% | 0.334 | 10% |
| DB | legacy | Embedding平均 | 30% | 20.0% | 0.427 | 0% |
| DB | legacy | LLM＋Embedding最大 | 30% | 31.7% | 0.485 | 0% |
| DB | diverse / balanced | ランダム | 9.5% | 11.9% | 0.260 | 11.9% |
| DB | diverse | Embedding最大 | 20% | 8.3% | 0.331 | 10% |
| DB | diverse | Embedding平均 | 20% | 20.0% | 0.381 | 10% |
| DB | balanced | 文字一致 | 0% | 0% | 0.088 | 0% |
| DB | balanced | Embedding最大 | 0% | 8.3% | 0.167 | 0% |
| DB | balanced | Embedding平均 | 10% | 11.7% | 0.288 | 10% |
| DB | balanced | LLM＋Embedding最大 | 60% | 66.7% | 0.767 | 10% |

従来のAPI相当（legacy＋最大）と比べ、採用した候補分散＋平均集約は、P@1と難負例率が同じでR@3とMRRが改善した。候補は平均24冊から25.2冊になり、従来は `growth-a` の `growth-2`、`growth-b` の `growth-3` を取得できなかったが、分散後はラベル済み正例をすべて取得できた。旧候補＋平均は採用方式とR@3が同じで、P@1・MRR・難負例率は優れていた。候補の網羅性と順位付けの改善を分けて追えるよう、両方を評価に残す。

履歴を分散すると参照する本が平均3.3冊から3.8冊に増えたが、Embedding単独では固定・DBの両方で順位付けが悪化したためAPIには採用しなかった。LLM併用では同じ履歴分散が良い結果を示した。判定済みの候補書籍と評価ユーザーを増やし、嗜好の対象と肯定・否定を分ける抽出や、短い記録を低く重み付けする方式を比較する価値がある。DBでは未判定の本が採用方式のTop3に平均1.2冊あり、実利用での精度は別に評価する。

ローカルのDB処理は、候補取得込みで実験ごとに平均6.9〜12.6msだった。共有Embeddingは legacy 816ms、balanced 1,162ms、diverse 882ms、追加のLLM抽出は平均671〜765ms。呼び出しはそれぞれ20、20、10回で、計50回・91,834文字。使用量を返した20応答の合計は約65.04 Neurons。全応答分の費用と配信APIの応答時間は未計測。

APIは同期のEmbeddingを1回だけ呼ぶ。LLMは評価用とし、配信時の費用と遅延を測るまで採用しない。利用が増えたら、アカウント単位の使用量とエラーを計測したうえで、利用者単位の頻度制御やモデル・本文版・公開状態をキーにした再利用を検討する。公開範囲変更時の無効化が必要なため、現段階の再利用は1リクエスト内に限る。

## データ版1の記録

データ版1の5ケースを固定候補で比較した結果。処理時間は評価CLIが計測した1ケースあたりの平均。

| 方式 | 平均Precision@3 | 平均Recall@3 | 負例が上位3件に入ったケース | 平均処理時間 | AI呼び出し総数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 文字一致 | 0.067 | 0.20 | 5/5 | 2.6 ms | 0 |
| BGE-M3 | 0.133 | 0.40 | 3/5 | 602 ms | 5 |
| Qwen3で嗜好抽出 + BGE-M3 | 0.200 | 0.60 | 3/5 | 1,641 ms | 10 |

Qwen3の嗜好抽出には `/no_think` と構造化出力の検証を使う。版1と版2は候補数とラベルが異なるため、数値の増減を方式の改善幅として扱わない。

通常のCIはAIをモックする。開発用Workerの疎通では、seed済み正式ユーザーのJWTを使い推薦APIの200と応答形式を確認する。実モデルの品質は、合成データの結果に加えて許可を得た実利用データで別に評価する。
