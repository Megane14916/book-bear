# CiNii・openBDで実在書籍を推薦する実験

公開のseed栞からQwen3で嗜好と日本語の検索語を作り、CiNii Researchの書籍候補をBGE-M3で順位付けする。書籍の重複を整理して、同じ候補を意味類似度だけ、所蔵館数20%補正、所蔵館数10%補正の3方式で比較する。登録済み判定は対象ユーザーのseed本棚と、ループバックの開発DBにある同じUIDの本棚を照合する。

## 実行

```powershell
pnpm --filter api recommendations:external cinii-mock mystery-b
```

`cinii-mock` は外部通信せず、独立カタログの作品名に模擬ISBN・NCID・所蔵館数を組み合わせる。推薦スコアと取得率は動作確認用。

実APIを使うには、承認済みの開発用資格情報を環境変数またはGit対象外の `apps/api/.env.external-recommendations.local` に設定する。あわせて[ローカルPGlite](seed.md)を起動し、マイグレーションを適用する。

```dotenv
CINII_APP_ID=YOUR_CINII_APP_ID
CLOUDFLARE_ACCOUNT_ID=YOUR_APPROVED_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_APPROVED_WORKERS_AI_TOKEN
# 紹介文などの追加許諾がある場合だけ指定する
# CINII_EXPERIMENT_PERMISSIONS_FILE="C:/path/outside/repository/cinii-permissions.json"
```

```powershell
pnpm --filter api recommendations:external cinii mystery-b --execute
```

CiNiiはデベロッパー登録で発行されるアプリケーションIDを使う。openBD v1の書誌取得には別のキー設定は不要。ユーザーを変える場合は、正式ユーザーのseedキーを指定する。外部サービスへ送る栞は固定seedの公開データに限定する。[CiNii API利用登録](https://support.nii.ac.jp/ja/cinii/api/developer)・[Workers AIの認証](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)

## 取得先と上限

| 段階 | 実装 |
| --- | --- |
| CiNii書籍検索 | `/opensearch/v2/books`。日本語、図書、NACSIS-CATに絞り、各検索語30件、最大3回・延べ90件。応答はJSON-LD、各5秒。検索語は目録に載りそうな1〜2語をQwen3に求める。 |
| 重複と対象外 | ISBN-10はチェックディジットを検証しISBN-13へ変換。ISBN・NCID・CRIDで重複を整理し、ISBNなしの場合は書名と著者の組も使う。ISBNなしの本も候補に残す。小説希望時は、書名・件名が明確に評論、研究、事典に当たる候補を除く。 |
| openBD | 一意なISBN-13を `/v1/get?isbn=...` で最大90件・1回にまとめる。各結果のISBNを照合し、nullや不一致を未取得として扱う。書名・著者・出版社・書影とONIXの紹介文を読み取る。照会失敗時も利用可能なCiNii書誌で比較する。 |
| 所蔵館数 | Researchの書籍検索には `ownerCount` が定義されていない。`/opensearch/holder?ncid=...` の `opensearch:totalResults` を使う。意味順位の上位からNCIDがある最大20件を2並列・各3秒で照会する。429で後続照会を停止する。異なる版の数値は合算しない。 |
| Workers AI | Qwen3は1回、BGE-M3は最大2バッチ。Embeddingは1バッチ56文章、入力は各600文字。実行内の同一テキストを重複送信しない。各AI呼び出し15秒、合計最大3回・入力JSON 7万文字。 |

CiNii Booksは2026年3月に統合され、旧検索APIは移行期間中。所蔵館数はNACSIS-CAT参加館の所蔵範囲を表し、一般読者の人気や販売数とは異なる。[CiNii Research検索仕様](https://support.nii.ac.jp/ja/cir/r_opensearch)・[所蔵検索仕様](https://support.nii.ac.jp/ja/cir/r_opensearch_hold)・[統合状況](https://support.nii.ac.jp/ja/cir/cib_integration)

openBDは2023年にv1の終了方針と代替書誌への切り替えを告知した。2026-11-06に現行のHTTPSエンドポイントへ既知ISBN2件を1回照会し、HTTP 200、ISBNが一致する書誌1件、null 1件を確認した。一致した書誌に紹介文はなかった。この2件から全体の収録率は推定できない。[v1の稼働状況](https://status.openbd.jp/)・[バッチ仕様](https://openbd.jp/pdf/openBD_doc_20170123.pdf)・[データ仕様](https://openbd.jp/spec/)・[終了方針](https://openbd.jp/news/20230725.html)・[代替書誌への移行](https://openbd.jp/news/20230829.html)

## Embeddingに使う文章

1. **許諾確認済みopenBD紹介文**。ISBNにひも付く許諾根拠と、紹介文そのもののSHA-256が一致し、EmbeddingとWorkers AIへの送信が明示的に許可された場合に限る。許諾済みでも600文字を超える場合は切り詰めず次の候補へ進む。
2. **利用権限のある独自文章**。ISBNまたはNCIDで一致した文章。Workers AIへの送信根拠を記録する。
3. **NACSIS-CAT由来を確認できる書誌・件名**。CiNii側の出典を確認し、書名・著者・件名を連結する。出典が不明・混在のレコードはこの経路から除く。
4. どの文章も使えなければ `embeddingSource: "none"`。候補一覧には残し、順位付けから外す。

NACSIS-CATの公開書誌はCC BY 4.0の対象。出力に国立情報学研究所、レコードURL、ライセンスと加工内容を記載する。openBDの利用規約や版元ドットコムの「利用可」表示から、Embeddingや外部AI送信まで一律に許可されるとは判断しない。許諾ファイルの初期値は空。紹介文・ベクトルは実行中だけ保持し、書籍や外部コンテンツのDB登録は行わない。[CiNiiの著作権・リンク](https://support.nii.ac.jp/ja/cinii/copyright)・[openBD利用規約](https://openbd.jp/terms/)・[版元ドットコムの利用案内](https://www.hanmoto.com/use_bibliographic_information)・[第三者提供の承諾規約](https://www.hanmoto.com/permission-for-use/agreement)

許諾ファイルはGit対象外の場所に置く。キーはISBN-13またはNCID。openBD紹介文の許諾はISBN-13を使う。ハッシュは対象の `Text` を改変せずUTF-8で計算する。

```json
{
  "9780306406157": {
    "openBdDescription": {
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "evidence": "実際の許諾文書を特定できる参照名に置き換える",
      "embedding": true,
      "workersAi": true
    }
  },
  "BA8164687X": {
    "ownContent": {
      "text": "使用権限を確認した独自の書籍紹介文に置き換える",
      "evidence": "独自文章の作成者と利用範囲を示す参照名に置き換える",
      "workersAi": true
    }
  }
}
```

## 順位付けと出力

意味スコア `S = (cosine + 1) / 2`。所蔵スコア `P = min(1, log(1 + 所蔵館数) / log(1001))`。1,000館以上は同じ上限とするため、外れ値がほかの候補の正規化を変えない。

- **A** は `S`。
- **B** は `0.8 × S + 0.2 × P`。
- **C** は `0.9 × S + 0.1 × P`。

B・Cは、`S` が0.60以上で、かつ最高の意味スコアとの差が0.15以内の場合に補正する。未照会、NCID不明、照会失敗は `ownerCount: null` とし、B・Cも `S` を使う。APIで0件と確認できた場合は `ownerCount: 0`。既知の小さい所蔵数は合成スコアを下げる場合がある。

JSONの `methods.A/B/C` が各上位10冊。`candidateGeneration` は候補と除外、ISBN取得率、openBD書誌取得率、紹介文の取得率・許諾確認率・実使用率を別々に記録する。所蔵の取得率は全候補を分母とし、照会件数と失敗件数、取得値の最小・中央値・最大も出す。`planMs`、`timings`、`durationMs` はステージ別と全体の所要時間。AI使用量は `usage`、Embedding対象数は `embedding.texts` で確認する。使用量の集計はプロバイダーが値を返した応答が対象。

## モック結果　mystery-b

延べ39件から対象外3件、重複24件、本棚登録済み1件を除き、11冊を順位付けした。ISBNは10/11冊、openBDの書誌は7/10冊、紹介文は3/7冊。紹介文の許諾確認と実使用は各1/3冊で、残りは独自文章1冊と書誌・件名9冊でEmbeddingした。所蔵数は10/11冊で、最小8・中央値205・最大1,200館。AI呼び出しは模擬2回、Embedding対象は12文章だった。

ローカルのモック計測例は、嗜好抽出9 ms、CiNii検索213 ms、ISBN・重複・本棚照合9 ms、openBD照会17 ms、Embedding 3 ms、所蔵照会40 ms、ランキング1 ms、全体302 ms。ネットワークや実推論の応答時間は含まない。

| 順位 | A 意味のみ | B 所蔵20% | C 所蔵10% |
| ---: | --- | --- | --- |
| 1 | Ｄ坂の殺人事件 | 藪の中 | Ｄ坂の殺人事件 |
| 2 | 心理試験 | 屋根裏の散歩者 | 心理試験 |
| 3 | 羅生門 | 羅生門 | 羅生門 |
| 4 | 藪の中 | 心理試験 | 藪の中 |
| 5 | 走れメロス | 注文の多い料理店 | 屋根裏の散歩者 |
| 6 | 注文の多い料理店 | Ｄ坂の殺人事件 | 注文の多い料理店 |
| 7 | 屋根裏の散歩者 | 走れメロス | 走れメロス |
| 8 | 吾輩は猫である | 吾輩は猫である | 吾輩は猫である |
| 9 | 銀河鉄道の夜 | 銀河鉄道の夜 | 銀河鉄道の夜 |
| 10 | 夢十夜 | 夢十夜 | 夢十夜 |

20%では意味スコアが最高の『Ｄ坂の殺人事件』が1位から6位に下がり、10%では1位を保った。所蔵数欠損の『羅生門』のスコアは補正前と同じだった。これは補正の挙動を確認するモック結果で、実在書籍の推薦精度を測ったものではない。

今回の環境にはCiNiiのアプリケーションIDがなく、CiNii検索から実Workers AIまでの通し実験は未実施。実環境では、まず検索語ごとの候補取得率、NACSIS-CATの出典判定率、所蔵数取得率、補正で下がった高関連候補と処理時間を確認する。
