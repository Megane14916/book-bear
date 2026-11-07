# 青空文庫推薦の改善　実測結果

2026-11-07（日本時間）。同じ固定seedの公開栞と保存済みの嗜好で、旧220作品と拡張索引の順位を比較した。索引構築の最終保存件数は2,403作品。順位表は、HTTP 429が発生する前に固定した**2,073作品の同一スナップショット**での実測。最終保存件数まで増えた索引や、実測後に加えた判定での順位はまだ計測できていない。[実装と実行手順](aozora-recommendation-improvement.md)

## 索引構築

| 指標 | 件数 |
| --- | ---: |
| 全作品CSV | 19,502行、17,840作品 |
| 小説・物語と判定 | 5,463 |
| 本文の権利条件を満たした対象 | 3,703 |
| アーカイブで本文を照合できた対象 | 2,413 |
| 索引化済み | 2,403（64.9%） |
| 保存したチャンク | 17,441 |
| 失敗を記録済み | 11 |
| 未処理 | 1,289 |
| 権利条件を満たさない小説・物語 | 1,760 |

失敗11作品の内訳は、Soranoha本文未収録1作品、前処理後の本文が短すぎる4作品、Workers AIのHTTP 429を受けたバッチの6作品。公式CSVとの書誌不一致、UTF-8不正、サイズ超過は各0件。1,289作品にはまだ結果がなく、失敗には数えていない。

| 実行 | 保存作品 | 保存チャンク | 再利用または重複排除したベクトル | BGE-M3呼び出し | 入力JSON文字数 | 所要時間 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1回目 | 2,073 | 14,985 | 499 | 347 | 10,599,666 | 8分11秒 |
| 2回目 | 330 | 2,456 | 49 | 56 | 1,796,744 | 1分16秒 |
| 合計 | 2,403 | 17,441 | 548 | 403 | 12,396,410 | 9分27秒 |

呼び出しには失敗1回を含む。BGE-M3の応答に利用量の内訳がなく、実トークン数と課金額は未計測。v2索引のJSONは2,403ファイルで135,159,033バイト（約129 MiB）。実験では作品ごとの読み取りを並列32件に絞り、索引全体のベクトルを同時にメモリへ置かなかった。

## 実測のTop10

A・B・Cには同じ2,073作品の索引を使い、当時の序文判定で2作品を除いて2,071作品を検索した。Aは旧方式と同じ最大4断片、Bは追加断片と補正、Cは適合性の評価を反映した順位。成長と文章表現のユーザーではQwen3の有効な評価が0件で、CはBにフォールバックした。表には当時の出力をそのまま載せる。

### mystery-b

| 順位 | 旧220作品 | A 4断片 | B 最大8断片 | C Qwen3再評価 |
| ---: | --- | --- | --- | --- |
| 1 | [ねじくり博士](https://www.aozora.gr.jp/cards/000051/card46418.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) | [俘囚](https://www.aozora.gr.jp/cards/000160/card869.html) | [俘囚](https://www.aozora.gr.jp/cards/000160/card869.html) |
| 2 | [モルグ街の殺人事件](https://www.aozora.gr.jp/cards/000094/card605.html) | [二つの手紙](https://www.aozora.gr.jp/cards/000879/card165.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) | [デパートの絞刑吏](https://www.aozora.gr.jp/cards/000236/card1261.html) |
| 3 | [殺人迷路](https://www.aozora.gr.jp/cards/000289/card47764.html) | [モルグ街の殺人事件](https://www.aozora.gr.jp/cards/000094/card605.html) | [高浜虚子著『鶏頭』序](https://www.aozora.gr.jp/cards/000148/card2667.html) | [盗まれた手紙](https://www.aozora.gr.jp/cards/000094/card42338.html) |
| 4 | [殺人の涯](https://www.aozora.gr.jp/cards/000160/card1239.html) | [落穴と振子](https://www.aozora.gr.jp/cards/000094/card1871.html) | [暗号の役割](https://www.aozora.gr.jp/cards/000160/card2714.html) | [二つの手紙](https://www.aozora.gr.jp/cards/000879/card165.html) |
| 5 | [殺人行者](https://www.aozora.gr.jp/cards/000014/card728.html) | [ニッケルの文鎮](https://www.aozora.gr.jp/cards/000260/card1428.html) | [火の唇](https://www.aozora.gr.jp/cards/000293/card1852.html) | [無系統虎列剌](https://www.aozora.gr.jp/cards/000096/card2114.html) |
| 6 | [貸家（世界怪談名作集）](https://www.aozora.gr.jp/cards/001089/card42306.html) | [鎮魂歌](https://www.aozora.gr.jp/cards/000293/card4755.html) | [デパートの絞刑吏](https://www.aozora.gr.jp/cards/000236/card1261.html) | [貸家（世界怪談名作集）](https://www.aozora.gr.jp/cards/001089/card42306.html) |
| 7 | [病院横町の殺人犯](https://www.aozora.gr.jp/cards/000094/card2076.html) | [冗談に殺す](https://www.aozora.gr.jp/cards/000096/card2109.html) | [二つの手紙](https://www.aozora.gr.jp/cards/000879/card165.html) | [鎮魂歌](https://www.aozora.gr.jp/cards/000293/card1855.html) |
| 8 | [ジーキル博士とハイド氏の怪事件](https://www.aozora.gr.jp/cards/000888/card33205.html) | [都会の幽気](https://www.aozora.gr.jp/cards/000906/card42424.html) | [不連続殺人事件](https://www.aozora.gr.jp/cards/001095/card42626.html) | [島原心中](https://www.aozora.gr.jp/cards/000083/card1339.html) |
| 9 | [解剖室](https://www.aozora.gr.jp/cards/000022/card410.html) | [高浜虚子著『鶏頭』序](https://www.aozora.gr.jp/cards/000148/card2667.html) | [島原心中](https://www.aozora.gr.jp/cards/000083/card1339.html) | [暗号の役割](https://www.aozora.gr.jp/cards/000160/card2714.html) |
| 10 | [別れ霜](https://www.aozora.gr.jp/cards/000064/card55665.html) | [Ｓ中尉の話](https://www.aozora.gr.jp/cards/000048/card807.html) | [落穴と振子](https://www.aozora.gr.jp/cards/000094/card1871.html) | [不連続殺人事件](https://www.aozora.gr.jp/cards/001095/card42626.html) |

### growth-b

| 順位 | 旧220作品 | A 4断片 | B 最大8断片 | C Qwen3再評価 |
| ---: | --- | --- | --- | --- |
| 1 | [童貞記](https://www.aozora.gr.jp/cards/000997/card46895.html) | [一問一答](https://www.aozora.gr.jp/cards/000035/card1598.html) | [一問一答](https://www.aozora.gr.jp/cards/000035/card1598.html) | [一問一答](https://www.aozora.gr.jp/cards/000035/card1598.html) |
| 2 | [遺書の一部より](https://www.aozora.gr.jp/cards/000416/card47402.html) | [僕は](https://www.aozora.gr.jp/cards/000879/card2368.html) | [僕は](https://www.aozora.gr.jp/cards/000879/card2368.html) | [僕は](https://www.aozora.gr.jp/cards/000879/card2368.html) |
| 3 | [ねじくり博士](https://www.aozora.gr.jp/cards/000051/card46418.html) | [面積の厚み](https://www.aozora.gr.jp/cards/000311/card2028.html) | [みみずく通信](https://www.aozora.gr.jp/cards/000035/card298.html) | [みみずく通信](https://www.aozora.gr.jp/cards/000035/card298.html) |
| 4 | [在学理由](https://www.aozora.gr.jp/cards/000906/card42708.html) | [大いなるもの](https://www.aozora.gr.jp/cards/000311/card7927.html) | [かめれおん日記](https://www.aozora.gr.jp/cards/000119/card24443.html) | [かめれおん日記](https://www.aozora.gr.jp/cards/000119/card24443.html) |
| 5 | [貧しき人々の群](https://www.aozora.gr.jp/cards/000311/card2025.html) | [職工と微笑](https://www.aozora.gr.jp/cards/000104/card541.html) | [面積の厚み](https://www.aozora.gr.jp/cards/000311/card2028.html) | [面積の厚み](https://www.aozora.gr.jp/cards/000311/card2028.html) |
| 6 | [犬](https://www.aozora.gr.jp/cards/000158/card50374.html) | [かめれおん日記](https://www.aozora.gr.jp/cards/000119/card24443.html) | [大いなるもの](https://www.aozora.gr.jp/cards/000311/card7927.html) | [大いなるもの](https://www.aozora.gr.jp/cards/000311/card7927.html) |
| 7 | [愛](https://www.aozora.gr.jp/cards/000076/card4996.html) | [毛利先生](https://www.aozora.gr.jp/cards/000879/card101.html) | [猫又先生](https://www.aozora.gr.jp/cards/000048/card642.html) | [猫又先生](https://www.aozora.gr.jp/cards/000048/card642.html) |
| 8 | [舌打する](https://www.aozora.gr.jp/cards/000325/card43431.html) | [脱殻](https://www.aozora.gr.jp/cards/000112/card4263.html) | [虚弱](https://www.aozora.gr.jp/cards/000022/card4873.html) | [虚弱](https://www.aozora.gr.jp/cards/000022/card4873.html) |
| 9 | [信号手（世界怪談名作集）](https://www.aozora.gr.jp/cards/000914/card42302.html) | [灰色の記憶](https://www.aozora.gr.jp/cards/001052/card4968.html) | [二人の友](https://www.aozora.gr.jp/cards/000129/card675.html) | [二人の友](https://www.aozora.gr.jp/cards/000129/card675.html) |
| 10 | [落ちてゆく世界](https://www.aozora.gr.jp/cards/001052/card4967.html) | [道](https://www.aozora.gr.jp/cards/000112/card599.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) |

### prose-b

| 順位 | 旧220作品 | A 4断片 | B 最大8断片 | C Qwen3再評価 |
| ---: | --- | --- | --- | --- |
| 1 | [ねじくり博士](https://www.aozora.gr.jp/cards/000051/card46418.html) | [『新訳源氏物語』初版の序](https://www.aozora.gr.jp/cards/000235/card13202.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) |
| 2 | [童貞記](https://www.aozora.gr.jp/cards/000997/card46895.html) | [木下杢太郎『唐草表紙』序](https://www.aozora.gr.jp/cards/000148/card2670.html) | [『新訳源氏物語』初版の序](https://www.aozora.gr.jp/cards/000235/card13202.html) | [『新訳源氏物語』初版の序](https://www.aozora.gr.jp/cards/000235/card13202.html) |
| 3 | [山地の稜](https://www.aozora.gr.jp/cards/000081/card4469.html) | [たより](https://www.aozora.gr.jp/cards/000311/card16028.html) | [たより](https://www.aozora.gr.jp/cards/000311/card16028.html) | [たより](https://www.aozora.gr.jp/cards/000311/card16028.html) |
| 4 | [鳥影](https://www.aozora.gr.jp/cards/000050/card50789.html) | [冬の女](https://www.aozora.gr.jp/cards/000168/card3625.html) | [さをのしづく](https://www.aozora.gr.jp/cards/000064/card4380.html) | [さをのしづく](https://www.aozora.gr.jp/cards/000064/card4380.html) |
| 5 | [別れ霜](https://www.aozora.gr.jp/cards/000064/card55665.html) | [雨が降って居る](https://www.aozora.gr.jp/cards/000311/card7934.html) | [冬の女](https://www.aozora.gr.jp/cards/000168/card3625.html) | [冬の女](https://www.aozora.gr.jp/cards/000168/card3625.html) |
| 6 | [愛](https://www.aozora.gr.jp/cards/000076/card4996.html) | [月令十二態](https://www.aozora.gr.jp/cards/000050/card4148.html) | [雨が降って居る](https://www.aozora.gr.jp/cards/000311/card7934.html) | [雨が降って居る](https://www.aozora.gr.jp/cards/000311/card7934.html) |
| 7 | [草みち](https://www.aozora.gr.jp/cards/000214/card51378.html) | [橡の花](https://www.aozora.gr.jp/cards/000074/card431.html) | [月令十二態](https://www.aozora.gr.jp/cards/000050/card4148.html) | [月令十二態](https://www.aozora.gr.jp/cards/000050/card4148.html) |
| 8 | [遺書の一部より](https://www.aozora.gr.jp/cards/000416/card47402.html) | [冬日記](https://www.aozora.gr.jp/cards/000293/card1849.html) | [橡の花](https://www.aozora.gr.jp/cards/000074/card431.html) | [橡の花](https://www.aozora.gr.jp/cards/000074/card431.html) |
| 9 | [理想の女](https://www.aozora.gr.jp/cards/000906/card42407.html) | [高浜虚子著『鶏頭』序](https://www.aozora.gr.jp/cards/000148/card2667.html) | [高浜虚子著『鶏頭』序](https://www.aozora.gr.jp/cards/000148/card2667.html) | [高浜虚子著『鶏頭』序](https://www.aozora.gr.jp/cards/000148/card2667.html) |
| 10 | [信号手（世界怪談名作集）](https://www.aozora.gr.jp/cards/000914/card42302.html) | [さをのしづく](https://www.aozora.gr.jp/cards/000064/card4380.html) | [火の唇](https://www.aozora.gr.jp/cards/000293/card1852.html) | [火の唇](https://www.aozora.gr.jp/cards/000293/card1852.html) |

## 比較と読み取り

| ユーザー | A・BのTop10共通数 | B・最大値方式のTop10共通数 | Bの本文長中央値 | 最大値方式の本文長中央値 | Cの著者数 | 追加断片を評価した作品 | 採用したQwen3評価 | 追跡3作品のv2収録数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mystery-b | 4/10 | 6/10 | 11,535 | 11,295 | 9 | 24 | 12/24 | 2 / 3 |
| growth-b | 5/10 | 3/10 | 4,808 | 21,686 | 8 | 22 | 0/24 | 2 / 3 |
| prose-b | 9/10 | 6/10 | 2,969 | 6,019 | 8 | 22 | 0/24 | 2 / 3 |

同じ作品が2人以上のTop10に入った数は、Aが2、Bが3、Cが1。旧220作品に由来する移行済みの作品だけにBを適用すると、旧Top10との共通数は謎解き・成長・文章表現の順に5・3・4件だった。Bの方式を固定し、全索引と旧作品に絞った場合のTop10を比べると、共通数は1・0・0件だった。AとBの全索引比較は候補集合をそろえて断片数と集約の影響を見ている。ただし、旧作品の一部がv2に未移行のため、旧220作品の完全な再現比較ではない。本文長の中央値は方式によって上下しており、3ユーザーだけで長編優位の有無は確定できない。

- **謎解き**では『デパートの絞刑吏』がBの6位からCの2位になり、『盗まれた手紙』はBのTop10外からCの3位に入った。採用された12件のうち上位10件はいずれも総合5/5で、モデル評価には強い偏りがあった。
- **『貸家』**は旧220作品で6位、拡張索引の意味検索Bで32位、Qwen3を使ったCで6位。Qwen3が選んだ本文断片には家の祟りについての話があり、論理的な謎解きとの一致を示すには弱い。それでもQwen3はジャンルを5/5と評価した。実測後、根拠のある断片の中で超自然的な語が確認でき、捜査や推理を示す語が見当たらない場合に、明示的な謎解き嗜好に対する加点を制限する処理を加えた。作品名での除外は行わず、この処理後の実順位は429のため未計測。[『貸家』の図書カード](https://www.aozora.gr.jp/cards/001089/card42306.html)
- **『信号手』**は旧220作品で成長9位・文章表現10位。拡張索引のBでは成長140位・文章表現97位で、Qwen3へ渡した24作品には入らなかった。順位低下は再評価の効果ではなく、索引拡大と意味検索の段階で起きた。[『信号手』の図書カード](https://www.aozora.gr.jp/cards/000914/card42302.html)
- **『ねじくり博士』**は旧220作品で謎解きと文章表現の1位。旧方式は断片の近さだけで順位付けしており、そのスコアで作品全体のジャンルを確認していない。この作品は比較時点のv2に未移行で、実験終了時にも未索引。新方式で降格したと判断できるデータはない。[『ねじくり博士』の図書カード](https://www.aozora.gr.jp/cards/000051/card46418.html)
- **成長と文章表現**ではQwen3の出力行に採用できる評価がなく、推薦精度の向上は未確認。実測後、断片キーの指定を簡潔な候補内番号に変更し、軸ごとの根拠不足を扱うようにした。また『唐草表紙』や『新訳源氏物語』の序が出た事例をもとに、題名・副題に明示される序文の判定を広げた。最終版の再計測は嗜好のEmbeddingでHTTP 429を受けて停止した。

## 推薦時の処理時間と使用量

秒。検索区間には、2,073作品のv2索引の読み取りとスコア計算、および旧索引との比較を含む。メモリは検索区間で観測したRSS。

| ユーザー | 嗜好Embedding | 索引検索 | 追加断片 | 再評価 | 全体 | RSS MiB | AI呼び出し | 報告トークン 入力 / 出力 | 報告Neurons |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| mystery-b | 0.35 | 4.93 | 5.77 | 11.86 | 23.20 | 168 | 6 | 23,801 / 1,620 | 159.44 |
| growth-b | 0.51 | 5.00 | 5.87 | 12.67 | 24.41 | 167 | 6 | 23,194 / 1,620 | 156.63 |
| prose-b | 0.72 | 4.81 | 5.32 | 13.24 | 24.43 | 182 | 6 | 24,253 / 1,620 | 161.53 |

報告されたトークンとNeuronsはQwen3 4応答分のみ。嗜好と追加断片のBGE-M3各1回は呼び出し数に含め、利用量の内訳は未取得。保存済みの本文チャンクのEmbeddingは推薦時に再計算していない。

## 残りを再開する

Workers AIが利用可能になった後に `index --all --execute` で未処理の1,289作品を続行し、`index --all --retry-failed --execute` で失敗分を照合し直せる。Soranohaに未収録の1作品を補完する場合は、青空文庫公式の本文ZIPの利用条件と同一底本を確認する。再開後は『ねじくり博士』も含めて同じ索引から3ユーザーを再計測し、ジャンル・テーマ・文体・展開の適合性と根拠断片を人手で比較する。日次利用枠とレート制限は別に設定されているため、今回のHTTP 429だけから具体的な制限種別は特定できない。[Workers AIの料金と日次枠](https://developers.cloudflare.com/workers-ai/platform/pricing/)・[APIレート制限](https://developers.cloudflare.com/workers-ai/platform/limits/)
