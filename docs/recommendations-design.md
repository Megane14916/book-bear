# 栞に基づく書籍推薦の設計・評価

[Issue #30](https://github.com/Megane14916/book-bear/issues/30) の初期実装。評価には [Issue #33 の固定データ](seed.md) を使う。

## APIとデータ利用

- `GET /api/v1/me/recommendations` は正式JWTを要求する。limitは1〜10、既定5。プロフィール未初期化は404、匿名JWTは403、本人の公開栞または候補がなければ200で `{ items: [] }` を返す。応答は推薦順の `BookSummary` とし、本文・ベクトル・利用者識別子は返さない。AI障害・タイムアウト・利用制限は503とする。
- 本人の公開・未削除の栞を新しい順に8件取得する。候補は他者の公開・未削除の栞で、本人の本棚にある本を除外し、書籍ごとに新しい2件まで、全体で48件までに絞る。本人の非公開栞もAIへ送らないため、非公開データの外部送信に関する新しい同意や保存処理は不要。候補選択はDB上の公開状態を照合し、DB接続を閉じた後にAIを呼ぶ。
- 入力は各栞600文字まで。BGE-M3でまとめてEmbeddingを生成し、正規化した履歴ベクトルの和と候補の内積を使う。書籍ごとの最大スコアで順位を決め、同点は書籍ID順とする。ベクトルは保存せず、次のリクエストには栞の編集・削除・非公開化が反映される。件数増加で遅延や費用が許容範囲を超える場合に、pgvectorや再生成手順を検討する。
- AI bindingは `wrangler.jsonc` の `AI`。EmbeddingとLLMは内部アダプターに分離する。LLMはQwen3 30Bの構造化出力をZodで検証し、実験用の嗜好抽出に利用する。APIの順位付けはEmbeddingのみ。モデルIDは `RECOMMENDATION_EMBEDDING_MODEL` と `RECOMMENDATION_LLM_MODEL` で置換できる。10秒で応答待ちを打ち切り、リトライは行わない。上流処理の取り消しは保証されない。

公式資料は [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/)、[BGE-M3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)、[Qwen3 30Bのモデルパラメータ](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)、[Workers AI利用制限](https://developers.cloudflare.com/workers-ai/platform/limits/)。

## 固定データで比較する

クリーンなローカルPGliteにseedを投入して以下を実行する。`lexical` は外部通信せず、文字bigramの一致数で順位付けする。`embedding` はAPIと同じ順位付け、`llm` は履歴をLLMで要約してから同じ順位付けを試す。

```sh
pnpm --filter api recommendations:evaluate lexical
pnpm --filter api recommendations:evaluate embedding
pnpm --filter api recommendations:evaluate llm
```

AIを使う実験では、承認済み開発用CloudflareアカウントのIDとWorkers AIのAPIトークンを `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` に設定する。環境変数またはGit対象外の `apps/api/.env.recommendations.local` を使う。評価CLIはseedの公開栞と本文が一致する入力だけを送信する。

各実行の版、モデル、上位3件、Precision@3・Recall@3、負例が上位に入った数、処理時間、AI呼び出し回数、入力文字数を記録する。候補は評価JSONの固定集合に絞るため、候補収集の網羅性は別に評価する。実際の推論費用は、他のAI実行を避けた開発アカウントで実験前後の使用量の差を確認し、[Workers AIの料金表](https://developers.cloudflare.com/workers-ai/platform/pricing/) と照合する。文字数をトークン数や課金額として扱わない。

データ版1の5ケースを固定候補で比較した結果。処理時間は評価CLIが計測した1ケースあたりの平均。

| 方式 | 平均Precision@3 | 平均Recall@3 | 負例が上位3件に入ったケース | 平均処理時間 | AI呼び出し総数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 文字一致 | 0.067 | 0.20 | 5/5 | 2.6 ms | 0 |
| BGE-M3 | 0.133 | 0.40 | 3/5 | 602 ms | 5 |
| Qwen3で嗜好抽出 + BGE-M3 | 0.200 | 0.60 | 3/5 | 1,641 ms | 10 |

Qwen3の既定の推論モードでは出力予算の512トークンを使い切り、JSONを生成する前に終了するケースがあった。嗜好抽出ではQwen3の `/no_think` を指定し、構造化出力の検証を維持する。比較結果はこの合成データに対する各1回の測定。

通常のCIはAIをモックする。開発用Workerの疎通では、seed済み正式ユーザーのJWTを使い推薦APIの200と応答形式を確認する。実モデルの品質は、合成データの結果に加えて許可を得た実利用データで別に評価する。
