# マニュアル監査（2026-09-16〜17）——当て方と、当て損ねた形

> **★ この文書の行番号は、枝 `docs/manual-0.9.2` の先端 `e727a0c` 時点の座標である。**
> **直しの枝（`docs/manual-audit-fixes`）がマニュアルを直すので、`docs/manual/*.md` の行番号はこのあと動く。**
> 引き直さずに残すのは、**この文書が「当時どう当てたか」の記録であって、現在の座標の一覧ではない**からである
> （行番号を現在に合わせると、当て方の記録としては逆に読めなくなる）。**現在の位置は本文の語で grep して引き直すこと。**

> **この文書は `docs/superpowers/sdd/2026-09-17-manual-audit.md` として追跡下に置くための 1 本である。**
> 元になった報告 5 本はセッションの一時領域にしか無く、消える。**結論だけでなく「どう当てたか」を残す**のが
> この文書の目的である——**「確かめた」と書いてある文書は、当て方が分からなければ再現できない。**

**対象**: `docs/manual/{detail.ja,quick.ja,quick.en}.md`（約 1,157 行）、枝 `docs/manual-0.9.2` の先端 **`e727a0c`**。
**読むだけ**で行い、マニュアルは 1 行も直していない。直しは calcarc-3d の枝が行う。

## §1 結論（8 件の食い違いの裁定）

2 系統の点検が食い違い、**1 件ずつ現物で当て直した**。**7 件はマニュアルの誤り**、1 件は部分的である。

| # | 主張 | 判定 | 決め手 |
|---|---|---|---|
| 1 | `detail.ja.md:196`「60 進で表せない値（1e10 以上など）」 | **マニュアルが誤り（誤解を招く）** | `format.rs:4` `DISPLAY_DIGITS = 10`、`:136` `int_digits + 4 > DISPLAY_DIGITS` ⇒ 閾値は **1e6**。実走で `1000000` → `1,000,000`、`999999` → `999999°0'0"` |
| 2 | `:737`「年利は 8 文字」 | **部分的**（★ 2026-09-17 に当て直して判定を変えた） | **壁は 3 つあり、掛かる所が違う。**(1) **数字は 20 桁**——`pressDigit` は項目で分岐せず `pushDigit(…, MAX_YEN_DIGITS = 20)`。(2) **小数点は 8 文字目以降に打てない**——`pushDot(entryOf(active), MAX_RATE_LEN)` は `FinancePanel.tsx:661-663` の `case "dot"` に在り、**項目で分岐していない＝金額・期間・年利のどれでも同じ壁**。しかも `units/entry.ts` の `pushDot` が見るのは **`tail.text.length`＝いま打っている数字の並びの長さ**で、欄全体でも式全体でもない（演算子や【万】を挟むと新しい並びが始まる）。`>= 8` で拒むので**利用者から見える壁は 7 文字まで**。(3) **100% 超と小数第 5 位以上は計算時に `SyntaxError`**（`crates/calcarc-core/src/finance/loan/rate.rs:42-44,66-69`）。**原文「8 文字（100.0000 まで）」は、小数点の壁としては真で、数字の壁としては偽**——読者は「8 文字を超えて打てない」と読む。**「マニュアルが偽」は言い過ぎだった** |
| 3 | 上限の表の前書き「押しても増えません」 | **マニュアルが誤り** | `MAX_PERIODS` を読むのは着地だけ（`FinancePanel.tsx:599-605`→`:751,765`）。`FinancePanel.test.tsx:494-508` が「上限は打鍵でなく着地に効く」を固定（123456 が打てて Math ERROR）。**6 行中 2 行（期間 1,200・月額 10 億）は答えの上限**で、前書きが当たらない（#2 を入れると 3 行） |
| 4 | `:748-750` 月額 10 億円の上限 | **マニュアルが誤り（文言）** | 上限の判定 `closed_form.rs:92` は 0%（`:65`）と n==1（`:74`）の早期 return の**後ろ**。`the_exact_paths_are_outside_the_cap` が `monthly_payment(u64::MAX, 0%, 600) == Ok(30_744_573_456_182_586)` を固定。**コードは利用者の 09-13 の裁定どおり正しい**。マニュアルの断りが「項目」の話で「**経路**」の話になっていない |
| 5 | 幅「WebKit は 375px 以上」 | **マニュアルが誤り** | `playwright.config.ts:46-53` は project 2 つ（`mobile`・`webkit`）で `testMatch`/`testIgnore` 無し＝**両エンジンが全 spec を回す**。375 の代入は `finance-layout.spec.ts`（条件 `:84,187`／呼び出し `:92,195`）の 2 か所だけ。360px の検査（`viewport-budget.spec.ts:193`、`nav.spec.ts:37,53,67`、`convert.spec.ts:191`）は **WebKit でも走る**。320px は `footer.spec.ts:64` の**フッタの溢れだけ** |
| 6 | 高さ「1 画面に収まる」 | **部分的**（両方に誤りがある） | 13 画面中 **11** と除外 2 つ（`viewport-budget.spec.ts:7-9,37-54,55-69`）は当たり。**ただし**: (a) 許容は `:96-98` の `toBeLessThanOrEqual(0)` で**ゼロ**——`#scale/llm` は「39px 許されている」のではなく**ループから除外されていて測っていない**（39px は註に記録された裁定済みの溢れ。2026-08-20 裁定・08-27 実測、うち 6px は全 route 共通のフッタ）。(b)**★ 2026-09-17 訂正——ここに書いていた「高さに WebKit 固有の検査が在る」は言い過ぎだった。** `finance-layout.spec.ts:183-196` の複利の面の余白は**両エンジンで走る**（`widths.ts:58-65` の `narrowSize(browserName)` が返すのは**寸法だけ**で、test を WebKit に限定していない）。**真なのは「狭い方の寸法がエンジンで違う」ことだけ**——WebKit 375×812、Chromium 360×800。なお**マニュアル側の「WebKit による自動検査」という書き方が実態と違う**のは、変わらず真である（高さを見る `viewport-budget` は両エンジンで走る） |
| 7 | 「画面ごとに URL が変わる」 | **マニュアルが誤り（例外あり）** | `route.ts:48` の `finance: []` により **Finance の 6 つの計算の種類は URL に出ない**（`short-screens.spec.ts:78-90` が 1 つの `#finance` で 6 つを押して回る）。**履歴の画面も出ない**（`screen-identity.spec.ts:186-227` が「route ではない」「穴として認識のうえ利用者が承認」と明記し `toHaveTitle("関数電卓 | CalcArc")` で固定） |
| 8 | `:441-443` 残価の例 | **マニュアルが偽（省略）** | `loan_ref.forward(3_000_000, 39, 12000, 60, residual)` で、残価 1,200,000 → 月額 37,536・総支払 3,414,605、残価 1,200,195 → **月額 37,533・総支払 3,414,620**・最終回 1,200,194。**最終回しか書いていない** |

| 9 | `quick.en` の「入力の決まり（要約）」 | **マニュアルが偽（省略）**（★ 2026-09-17 追記） | 英語版の要約は **S1（打ちかけの数のあとの `(` `π` `e`）だけ**で、**S4・S5——`)` の直後・関数の答えや `π`・`e` のあと・`+/−` のあとに、数字を含む「新しい数を始めるキー」がまとめて拒まれること——が英語にどこにも無い**（`after 【)】`・`function answer`・`【+/−】` で grep 0 件）。**詳細マニュアルは日本語だけ**なので、英語の読者はこの規則をどこでも読めない。実測（実物の wasm、`refused_keys`）: `)` の直後・`4 √` のあと・`π` のあと・`e` のあと・`1 2 +/−` のあとは**どれも同じ 17 キー**（`0`〜`9`・`000`・`.`・`Exp`・`j`・`(`・`π`・`e`）を拒み、打ちかけの数のあと（S1）は `(`・`π`・`e` の 3 つだけ。**1e の通し読みで発見、3d が現物で確認**——最初の中継は「押せないキーが英語に無い」と縮まっていて、**既に在る S1 の文と取り違えられ、重複として閉じられかけた** |

**#1・#2・#5・#6 は、調べ役の報告をそのまま写さず、この文書の書き手が自分で印字して当て直している。**
**#9 は 3d の枝で直した**（`quick.en.md` の要約に 1 文）。**#2・#6 の判定は 2026-09-17 に当て直して覆っている**——表の中に訂正として残してあり、消していない。

## §2 「事実の誤り 0 件」は誤りだった——同じ言葉で違う範囲を数えていた

最初の監査は「**事実の誤り 0 件**」と報告した（数値例 78・定数と上限 15・キー名と配置 15・範囲の主張 16）。
**その数字自体は嘘ではないが、意味が違った。**正しくは「**書かれた主張を、マニュアル自身が名指す点で当てて 0 件**」である。
この当て方には、構造的に見えないものが 3 つある:

1. **境界を探さない。** `:196` は監査の #21 に**在り**、`1e20` で「表示が変わらない」を確かめて**一致**としていた。
   真である。だが**本当の閾値 1e6 は範囲の内側**で、そこは踏んでいない。
2. **定数が在ることと、定数が効いていることを取り違える。** `:737` は #55 に**在り**、「`MAX_RATE_LEN = 8` が在る」で
   一致とした。**その定数は打鍵経路から呼ばれていない。**
3. **省略は原理的に拾えない。** `:441-443` は #39 に**在り**、**マニュアルが書いた最終回だけ**を当てて一致とした。
   書かれていない月額と総支払の変化は、当てる対象にならない。

**教訓**: 「0 件」を報告するときは**数えた範囲を必ず添える**。下請けに「0 件の報告は当て方を書け」と要求しながら、
**その但し書きを外して上へ転送した**のが、今回いちばん実害の大きい誤りだった（確信のある「0 件」は、**他の人が見るのを止める**）。

## §3 番人の棚卸し——マニュアルの意味を読む番人は 1 本も無い

番人は **5 本**（`web/tests/unit/manual-{markdown,fonts,shots,widths,key-names}.test.ts`。**5 本とも別ファイル**で、
`cmp` で確認済み）。**守っている 4 種**と**守っていない 6 種**の対照は付録 C の表に全文がある。要約:

- **守っている**: 章番号の連番と日英 quick の対応／`shot:` 参照と撮影台本の双方向／固定フォントの名前・版・順序
  （**実際にどの書体が描いたかは Chromium に聞くしかなく、この単体テストは判定器の純関数を見ているだけ**）／
  本文中の**幅**の数値（**高さ 812px は対象外**）／`【…】` のキー名が画面に実在すること（**押した結果は一切見ない**）
- **守っていない**: **worked example の数値**／**挙動の範囲**（「オフラインで使える」）／**上限値の数値**／訳文の意味／
  写真が説明に合っているか／**「まだ確かめていません」という否定の主張**

**今回の 8 件は、この未ガードの 6 種のうち 3 種から出ている。**

## §4 0.9.3 の持ち越し（いちばん安く塞げる 1 本）

**上限値の表をコアの定数と突合する単体テスト**——`MAX_ENTRY_LEN`・`MAX_VALUE_DIGITS`・`MAX_PERIODS`・
`MAX_YEN_DIGITS`・`MAX_VERIFIED_MONTHLY_YEN` を export し、`manual-widths.test.ts` と同じ手法でマニュアルの数字と
突き合わせる。**いちばん安く置けて、いちばん腐りやすい所**である（今回 #2・#3・#4 がここから出た）。

---

# 付録——元の報告 5 本（全文。当て方はここに在る）


---

## 付録 A: `manual-audit-numbers.md`

### CalcArc マニュアル 数値監査 (worktree `wt-man`, detached `e727a0c`)

読み取り専用。`docs/manual/*` を含め追跡ファイルは 1 行も変えていない。
一時の Rust 検査 (`crates/calcarc-core/tests/zz_scratch_audit.rs`) は走行後に削除し、
`git status --porcelain` は空である。

#### 方法（一次資料）

| 経路 | 使ったもの |
|---|---|
| Python 参照実装 | `cd reference && uv run --no-config python …` で `loan_ref` / `compound_ref` / `convert_ref` / `expr_ref` / `eng_ref` / `sexagesimal_ref` を直接呼ぶ |
| 本物のエンジン | `crates/calcarc-core/tests/zz_scratch_audit.rs`（一時）を `cargo test -p calcarc-core --test zz_scratch_audit -- --nocapture` で走らせ、`Key::from_token` → `reduce` → `render` の実経路で打鍵列の `main` を印字 |
| 仕様表 | `crates/calcarc-core/tests/engine_table.rs`（電卓の挙動はこれが仕様書） |
| 定数の現物 | `state.rs` / `closed_form.rs` / `currency.rs` / `expr/mod.rs` / `settings/types.ts` / `history/types.ts` ほか |

**規則の出典**は `docs/numerical-policy.md`（円未満切り捨て・国税と地方税を別々に floor・
有効数字 10 桁・round-half-to-even・名目月利）と `CLAUDE.md`。

**重い段は 1 つも回していない**（`pnpm heavy` / `heavy:power` / `wasm-pack` / E2E / `pnpm manuals` は未実行）。

#### 結果の要約

- **検査した数値主張: 78**
- **食い違い: 0**
- 一致: 73
- 機械的に検査できない: 5（画面写真のキャプション 4 + 例示 1）

**(A) 0.9.2 の変更で陳腐化したもの: 0**
**(B) 0.9.2 より前から誤っていた/陳腐化していたもの: 0**

---

#### 1. `docs/manual/detail.ja.md`（60 件）

##### 1.1 Scientific — 打鍵と表示（21 件）

| # | 行 | 書かれている主張 | 実測 | 出典 | 判定 |
|---|---|---|---|---|---|
| 1 | L45-46 | 【2】【+】【3】【×】【4】【=】は 14 | `"14"` | engine_table:246 + 実走 | 一致 |
| 2 | L73 | 【1】【.】【5】【Exp】【3】で 1.5e3、【=】で 1,500 | `"1.5e3"` / `"1,500"` | engine_table:140-141 + 実走 | 一致 |
| 3 | L102 | 【3】【+】【(】【DEL】は 3 | `"3"` | 実走 | 一致 |
| 4 | L103 | 【3】【×】【(】【DEL】【=】は 9 | `"9"` | 実走 | 一致 |
| 5 | L104-105 | 【3】【+】【(】【4】【√】【DEL】【=】は 5 | `"5"` | 実走 | 一致 |
| 6 | L107 | 【2】【+】【3】【=】【(】【DEL】【=】は 0 | `"0"` | 実走 | 一致 |
| 7 | L111 | 【3】【=】は 3 | `"3"` | engine_table:578 + 実走 | 一致 |
| 8 | L112 | 【2】【×】【(】【3】【+】【4】【=】は 14 | `"14"` | engine_table:614 + 実走 | 一致 |
| 9 | L114 | 【3】【+】【=】は【3】【+】【3】と同じ（= 6） | `"6"` | engine_table:913 + 実走 | 一致 |
| 10 | L118-120 | 【3】【+】【×】【4】【=】は 12 | `"12"` | engine_table:849 + 実走 | 一致 |
| 11 | L139-140 | 【n!】【nPr】【nCr】は 0 以上の整数でだけ使える | `check_pair` → `non_negative_integer` + `r ≤ n` | `scientific/mod.rs:241-248` | 一致 |
| 12 | L145 | 【3】【0】【sin】で 0.5（DEG） | `"0.5"` | engine_table:673 + 実走 | 一致 |
| 13 | L150 | 【2】【xʸ】【3】【xʸ】【2】【=】は 512 | `"512"` | engine_table:280 + 実走 | 一致 |
| 14 | L156 | 有効数字 10 桁・整数部 3 桁カンマ | 同 | numerical-policy §表示 | 一致 |
| 15 | L157-158 | \|x\|≥1e10 と 0<\|x\|<1e-9 で指数表記（例 1e12） | `"1e12"` | numerical-policy + 実走 | 一致 |
| 16 | L173 | 12345 は 12.345e3 | `12.345e3` | `eng_ref.format_real_eng(12345.0)` + 実走 | 一致 |
| 17 | L182 | 3+4j は DEG で 5 ∠ 53.13010235 | `"5 ∠ 53.13010235"` | engine_table:727 + 実走 | 一致 |
| 18 | L190-191 | 【1】【°′″】【3】【0】で 1°30、【=】で 1.5 | `"1°30"` / `"1.5"` | engine_table:510 + 実走 | 一致 |
| 19 | L192-193 | 3.75 なら 3°45'0" | `3°45'0"` | engine_table:465 + `sexagesimal_ref` + 実走 | 一致 |
| 20 | L196 | 30.5 は 30°30'0" | `30°30'0"` | `sexagesimal_ref.format_sexagesimal(30.5)` + 実走 | 一致 |
| 21 | L196 | 1e10 以上は表示が変わらない | `1e20` のまま・error なし | engine_table:496-501 | 一致 |

##### 1.2 履歴・保存（2 件）

| # | 行 | 主張 | 実測 | 出典 | 判定 |
|---|---|---|---|---|---|
| 22 | L212 / L566 | 50 件を超えると古いものから消える | `HISTORY_LIMIT = 50` | `web/src/history/types.ts:35` | 一致 |
| 23 | L218 | 打ち直せない例として `-3e12` | 指数付きの負値という**分類の例示**。特定の計算結果ではない | — | 機械的に検査できない（例示） |

##### 1.3 Convert / 為替（5 件）

| # | 行 | 主張 | 実測 | 出典 | 判定 |
|---|---|---|---|---|---|
| 24 | L250 | -40 °C = -40 °F | `{'text': '-40'}`（対照: 0→32、100→212） | `convert_ref.compute("-40","temperature","degc","degf")` | 一致 |
| 25 | L256-265 | 既定単位 8 組（km→mi / kg→lb / °C→°F / 坪→m² / L→gal(US) / km/h→mph / GB→GiB / USD→JPY） | 8 組とも一致 | `web/src/ui/Convert/UnitPanel.tsx:83-103` | 一致 |
| 26 | L273-276 | 16 通貨 | `pub const ALL: [Currency; 16]`、綴りも 16 個一致 | `convert/currency.rs:50-67` | 一致 |
| 27 | L288 / L712 | 24 時間を過ぎていると取りに行く | `REFRESH_AFTER_MS = 24 * 60 * 60 * 1000` | `web/src/currency/rates.ts:29` | 一致 |
| 28 | L302-303 | JPY/KRW/VND は整数、ほかは小数第 2 位 | `decimals()` = 0 が Jpy/Krw/Vnd、他 13 通貨が 2 | `convert/currency.rs:109-126` | 一致 |

##### 1.4 Scale / LLM / 転送（4 件）

| # | 行 | 主張 | 実測 | 出典 | 判定 |
|---|---|---|---|---|---|
| 29 | L320 | 【3】【M】で 300 万 | `Count = [('G',1e9),('M',1_000_000),('K',1_000)]` → 3M = 3,000,000 | `expr/mod.rs:46` | 一致 |
| 30 | L340-346 | LLM の既定 7 項目（7B / FP16 / 層数 空 / KV 8 / 次元 128 / 4K / FP16） | `7000000000` / `fp16` / `EMPTY` / `8` / `128` / `4096` / `fp16` | `LlmPanel.tsx:49,81-90` | 一致 |
| 31 | L349 | パラメータの B は 10 億、文脈長の K は 1024・M は 1024×1024 | `Params=[('B',1e9),('M',1e6)]`；context = `[2048,4096,8192,16384,32768,131072,1048576]`（2K=2·1024 … 1M=1024²） | `expr/mod.rs:56`、`ui/Keypad/llm.ts:37` | 一致 |
| 32 | L369-370 | 最初は【Mbps】と【時】 | `DEFAULT_BANDWIDTH_UNIT="mbps"` / `DEFAULT_DURATION_UNIT="hour"` | `TransferPanel.tsx:50-51` | 一致 |

`float32` が Data Scale の既定であること（L324-325）も `settings/types.ts:113` の
`dataScale: { dtype: "float32", primary: "decimal" }` で確認した。

##### 1.5 Finance — ローン（12 件）

すべて `reference/src/calcarc_reference/loan_ref.py` を直接呼んで再計算した。
年利は `rate_fraction("1.5") = (15, 12000)`、`rate_fraction("3.9") = (39, 12000)`。

| # | 行 | 主張 | 実測 | 判定 |
|---|---|---|---|---|
| 33 | L388-389 | 3000万 = 30,000,000／1億2000万 = 120,000,000 | `Yen=[('億',100_000_000),('万',10_000)]` | 一致 |
| 34 | L393 | 【期間】は 1,200 まで | `MAX_TERM_MONTHS = 1_200` / `MAX_PERIODS = 1_200` | 一致 |
| 35 | L403 | 【3】【5】【年】で 420 か月 | `Months=[('年',12),('月',1)]` → 35×12 = 420 | 一致 |
| 36 | L412-413 | 3,000万・1.5%・35年 → 月額 **91,855**／総支払 **38,579,007**／総利息 **8,579,007** | `forward(30_000_000,15,12000,420,0)` = `{'monthly_payment': 91855, 'total_payment': 38579007, 'total_interest': 8579007, 'final_payment': 91762}` | 一致 |
| 37 | L430-432 | 91,855×420 = **38,579,100**、総支払より **93** 多い、最終回 **91,762** | 91855×420 = 38,579,100；差 93；`final_payment` 91,762（91,855−91,762 = 93） | 一致 |
| 38 | L438-439 | 300万・3.9%・60回・残価120万 → 月額 **37,536**／最終回 **1,200,000**／総支払 **3,414,605** | `forward(3_000_000,39,12000,60,1_200_000)` = `{'monthly_payment': 37536, 'total_payment': 3414605, 'final_payment': 1200000}` | 一致 |
| 39 | L441-443 | 残価を 1,200,195 にすると最終回は **1,200,194** | 同条件 `residual=1_200_195` → `final_payment` = **1200194**（月額 37,533） | 一致 |
| 40 | L444-446 | 残価なしの総利息 **306,828**、残価120万で **414,605** | `forward(…,60,0)` の `total_interest` = 306,828；残価ありは 414,605 | 一致 |
| 41 | L455-456 | 賞与回は 6 か月ごと、35年（420か月）なら **70 回** | `bonus_rows` = 70（420 // 6） | 一致 |
| 42 | L457 | 賞与回の利率は年利の半分 | `half_year(num,den) = (num, den//6)`（月利×6 = 年利/2） | 一致 |
| 43 | L458 | 賞与で返す分は借入額の半分まで | `_check_bonus_share`: `bonus_principal*2 > principal` で SyntaxError | 一致 |
| 44 | L461-463 | 賞与600万 → 月々 **73,484**／賞与回 **110,487**（70回）／総支払 **38,597,286**、賞与なしより **18,279** 多い | `bonus_forward(30_000_000,6_000_000,15,12000,420)` = `{'monthly_payment': 73484, 'bonus_payment': 110487, 'bonus_rows': 70, 'total_payment': 38597286}`；38,597,286 − 38,579,007 = **18,279** | 一致 |

##### 1.6 Finance — 複利と税（7 件）

`compound_ref` を直接呼んだ。`rate_fraction("1", 2) = (1, 200)`、`rate_fraction("1.5", 12) = (15, 12000)`。

| # | 行 | 主張 | 実測 | 判定 |
|---|---|---|---|---|
| 45 | L481 | 月ごとなら【1】【0】【年】で 120 期 | `Periods(12)=[('年',12),('月',1)]` → 10×12 = 120 | 一致 |
| 46 | L483 | 【1】【年】【6】【月】で 18 期 | 12+6 = 18（同じ単位表） | 一致 |
| 47 | L488 | 1 期あたりの利率は年利を 1 年の期数で割ったもの | `den = scale*100*periods_per_year`（名目換算） | 一致・numerical-policy「月利換算は名目のみ」と整合 |
| 48 | L497-498 | 元本100万・年1%・半年ごと・10期 → **1,051,136** | `grow(1_000_000,0,1,200,10)` = **1051136** | 一致（numerical-policy の表とも一致） |
| 49 | L528-530 | 同条件で税引前 **1,051,136**・運用収益 **51,136**・国税 **7,831**・地方税 **2,556**・手取り **1,040,749** | 利息 51,136；`withholding_tax(51136)` = **(7831, 2556)**；1,051,136−7,831−2,556 = **1,040,749** | 一致 |
| 50 | L543 | 20.315% を国税 15.315% と地方税 5% に分けてそれぞれ切り捨て | `NATIONAL=15315/100000`、`LOCAL=5/100`、別々に floor | 一致（numerical-policy §税） |
| 51 | L548-549 | 元本999・1.5%・月ごと・税あり、目標1,016 の必要年数は **19 期**、20 期の手取りは **1,015** | 手取りの列: 17→1014、18→1015、**19→1016**（最初に到達）、**20→1015**、21→1016 | 一致（非単調も再現） |

##### 1.7 範囲・制限・既知の制約（9 件）

| # | 行 | 主張 | 実測 | 出典 | 判定 |
|---|---|---|---|---|---|
| 52 | L602-605 | 幅 360px 以上（Chromium）/ 375px 以上（WebKit）、320px は未確認 | E2E が `setViewportSize({width: 360})` で判定（`nav.spec.ts:37,53,67`、`convert.spec.ts:191`）。375 は WebKit プロジェクト側の幅 | 一致（360px は直接確認。375px は WebKit プロジェクト幅で、個別に再導出はしていない） |
| 53 | L735 | Scientific の入力は 12 文字、指数は別に 3 桁 | `MAX_ENTRY_LEN = 12`、`MAX_EXPONENT_LEN = 3` | `engine/state.rs:26,30` | 一致 |
| 54 | L736 | Convert の値は 39 桁 | `MAX_VALUE_DIGITS = 39` | `web/src/convert/entry.ts:44` | 一致 |
| 55 | L737 | 年利は 8 文字（100.0000 まで） | `MAX_RATE_LEN = 8`、注釈も「コアが受ける最長は "100.0000"」 | `FinancePanel.tsx:144-147` | 一致 |
| 56 | L738 | 期間は 1,200 | `MAX_TERM_MONTHS = 1_200`、`MAX_PERIODS = 1_200` | `loan/inverse.rs:21`、`compound.rs:19` | 一致 |
| 57 | L739 | 金額は 20 桁 | `MAX_YEN_DIGITS = 20` | `web/src/finance/entry.ts:42` | 一致 |
| 58 | L740 / L748-750 | 【返済月額】と賞与の返済額は 10 億円まで。**【借入可能額】【返済期間】には働かない** | `MAX_VERIFIED_MONTHLY_YEN = 1_000_000_000` を使うのは `closed_form::monthly_payment` だけ。呼ぶのは `forward.rs:7`（賞与も `forward` 経由）。`inverse.rs` は `annuity` しか取らず、`monthly_payment` の import は `mod tests` の中 (`inverse.rs:178`) | `closed_form.rs:27,92` | 一致（適用範囲の限定まで正しい） |
| 59 | L743-744 | 計算できる金額の上限は 18,446,744,073,709,551,615 円 | 2^64 − 1 = 18,446,744,073,709,551,615（`U64_MAX`） | — | 一致 |
| 60 | L766-769 | 【2】【9】【nCr】【3】【=】→ 3,654／そのあと【nCr】【1】【=】→ Math ERROR／【nPr】【1】【=】→ Math ERROR／最初から【3】【6】【5】【4】【nCr】【1】【=】→ 3,654 | 実走で 4 行とも一致。原因も確認: コアは `acc = acc/(i+1)*(n−i)` なので 29 nCr 3 = **3654.0000000000005**（`is_integer()` は false）→ `check_pair` が弾く。打ち直した `3654.0` は整数なので通る | `scientific/mod.rs:281-295` + 実走 | 一致（説明の因果も正しい） |

---

#### 2. `docs/manual/quick.ja.md`（8 件）

| # | 行 | 主張 | 実測 | 判定 |
|---|---|---|---|---|
| 61 | L16-19 | 360px / 375px / 320px | #52 と同じ | 一致 |
| 62 | L45 | 写真キャプション「100 万件・768 次元」 | 画面写真の説明。計算結果を主張していない | 機械的に検査できない（キャプション） |
| 63 | L47 | 写真キャプション「3,000 万円・年 1.5%・35 年」 | 入力の説明。#36 の条件と一致し、結果は主張していない | 機械的に検査できない（キャプション） |
| 64 | L59-60 | 【2】【+】【3】【×】【4】【=】は 14 | `"14"` | 一致 |
| 65 | L62 | 【3】【0】【sin】で 0.5 | `"0.5"` | 一致 |
| 66 | L78 | `1/3*3-1` の【=】は `0` | `expr_ref.evaluate("1/3*3-1")` = `Fraction(0, 1)`（対照: `1/3` → `Fraction(1,3)`） | 一致 |
| 67 | L126 | 【3】【5】【年】で 420 か月 | 35×12 = 420 | 一致 |
| 68 | L137 | 履歴 50 件 | `HISTORY_LIMIT = 50` | 一致 |

---

#### 3. `docs/manual/quick.en.md`（10 件）

| # | 行 | 主張 | 実測 | 判定 |
|---|---|---|---|---|
| 69 | L23-24 | 【万】= ×10,000、【億】= ×100,000,000 | `Yen=[('億',100_000_000),('万',10_000)]` | 一致 |
| 70 | L41-48 | 360px / 375px / 320px | #52 と同じ | 一致 |
| 71 | L70 | キャプション "1,000,000 items of 768 dimensions" | 画面写真の説明 | 機械的に検査できない（キャプション） |
| 72 | L72 | キャプション "30,000,000 yen at 1.5% a year over 35 years" | 入力の説明。#36 と一致 | 機械的に検査できない（キャプション） |
| 73 | L85 | 2 + 3 × 4 = 14 | `"14"` | 一致 |
| 74 | L87 | 30 sin = 0.5 | `"0.5"` | 一致 |
| 75 | L106 | `1/3*3-1` gives `0` | `Fraction(0,1)` | 一致 |
| 76 | L159 | 【3】【0】【0】【0】【万】is 30,000,000 | 3000 × 10,000 = 30,000,000 | 一致 |
| 77 | L161 | 【3】【5】【年】is 420 months | 35×12 = 420 | 一致 |
| 78 | L174 | history up to 50 | `HISTORY_LIMIT = 50` | 一致 |

---

#### 4. (A)/(B) の切り分け

##### (A) 0.9.2 の変更で陳腐化したもーー **0 件**

0.9.2 が触った 4 つの面を名指しで当て直した。**どれも現物と一致していた。**

| 0.9.2 の変更 | 当てた主張 | 結果 |
|---|---|---|
| 演算子の押し直しの直し | #10（L118-120「【3】【+】【×】【4】【=】は 12」） | 一致。`engine_table.rs:856` の `a_corrected_operator_means_what_the_right_one_would_have` が同じ原則を固定しており、マニュアルの言い回し（「最初から正しく打った列と同じ答えになる」）はこのテストの主張そのもの |
| 押せないキー | #3〜#9、#11（DEL・括弧・【=】の各規則） | 一致。8 件とも実エンジンで再現 |
| ¥10 億の月額上限 | #58（L740 / L748-750） | 一致。**適用範囲の限定（借入可能額・返済期間には働かない）まで正しい**——`MAX_VERIFIED_MONTHLY_YEN` を読むのは `closed_form::monthly_payment` だけで、`inverse.rs` は本体では呼んでいない |
| convert/currency の変更 | #24、#26、#28、#66、#75（`1/3*3-1` = 0 を含む） | 一致 |

##### (B) 0.9.2 より前から誤っていた/陳腐化していたもの —— **0 件**

「誰も検査したことがない」と指示で名指しされた領域を全部当て直した。

| 領域 | 件数 | 結果 |
|---|---|---|
| ローン（月額・総支払・総利息・最終回・残価・賞与） | 12 | 全件一致。金額は 1 円も違わない |
| 複利（残高・国税・地方税・手取り・必要年数の非単調） | 7 | 全件一致 |
| 単位換算（既定単位 8 組・温度） | 2 | 一致 |
| データ量・LLM のメモリ・転送（既定値・単位の倍率） | 4 | 一致 |
| 通貨（16 通貨・丸め桁・24 時間） | 3 | 一致 |
| 入力の上限 7 種 | 7 | 一致 |

**特に確かめたかった点**——マニュアルの丸めが製品と違う向きに倒れていないか:

- ローンの各行利息は `floor(残高 × 分子 / 分母)`。マニュアルの例（#36〜#44）は
  すべてこの切り捨てを通した値と一致しており、**連続式の値ではない**。
  たとえば #37 の「月額×回数 ≠ 総支払額、差 93 円」は切り捨ての端数が最終回に
  集まる話で、数字（93 円）も最終回（91,762 円）も実測と一致した。
- 複利の税は**国税と地方税を別々に切り捨てる**（No.1310）。#49 の
  7,831 / 2,556 は `withholding_tax` の 2 回 floor の値そのもので、
  合算 20.315% を 1 回切り捨てた値（51,136 × 0.20315 = 10,388.3… → 10,388、
  内訳を出せない）ではない。**マニュアルは正しい側を書いている。**
- #51 は numerical-policy が「手取りは期数について非単調」と書いている性質の
  実例で、19 期→1,016 円、20 期→1,015 円まで再現した。

---

#### 5. 提案する訂正（本文）

**無し。** 78 件のうち食い違いは 0 件で、書き換えを要する数値は 1 つも見つからなかった。

機械的に検査できなかった 5 件も「誤り」ではない:

- #62 / #63 / #71 / #72 は**画面写真のキャプション**で、入力条件だけを述べて
  計算結果を主張していない。#63・#72 の条件（3,000 万円・年 1.5%・35 年）は
  #36 で検算した例と同じである。写真そのものが条件と合っているかは
  `manual-shots` の領分で、本監査の対象外とした（`pnpm manuals` は指示により未実行）。
- #23 の `-3e12` は「指数が付いたマイナスの答え」という**分類の例示**であって、
  ある計算の答ではない。指数表記の閾値（1e10）と符号の条件は満たしている。

##### 参考: 監査の網から外れるもの（数値主張ではない）

次は数値を含むが「計算の正しさ」ではないので判定していない——
版数、URL、章番号、読み上げの画面名 13 個（L661-666）、
キーの一覧の行数。読み上げの 13 個は `web/src/ui/screenName.ts` と
`screenName.test.ts` が持っており、既存の番人がある。

#### 6. 後片付け

- 一時ファイル `crates/calcarc-core/tests/zz_scratch_audit.rs` は削除済み。
- `git status --porcelain` は空（出力 0 行）を確認した。
- `/home/terapyon/dev/CalcArc` には一切触れていない。

---

## 付録 B: `manual-audit-limits.md`

### Manual audit: limits/constants and keypad layout vs code

Worktree: /tmp/claude-1000/-home-terapyon-dev-CalcArc/6d3f235a-bf78-4fce-8121-beb0c8c7c3d9/scratchpad/wt-man
HEAD: e727a0c "Correct the j-key rule: the exponent's digits do not unlock it" (docs/manual-0.9.2)
Method: read-only. `git grep` + `Read` over crates/calcarc-core/src, web/src/calc, web/src/ui,
web/src/units, web/src/datascale, web/src/finance, web/src/currency, web/src/convert, and
docs/numerical-policy.md. No cargo test run (not needed — all checks resolved from source).

#### Part 1 — limits and constants

| Manual claim (file:line) | Code constant (file:line) | Verdict |
|---|---|---|
| Scientific 入力 12 文字, Exp 指数 3 桁 — detail.ja.md:735 | `MAX_ENTRY_LEN: usize = 12` (crates/calcarc-core/src/engine/state.rs:26), `MAX_EXPONENT_LEN: usize = 3` (state.rs:29) | matches |
| Convert 値 39 桁 — detail.ja.md:736, 745-747 | `MAX_VALUE_CHARS: usize = 39` (crates/calcarc-core/src/convert/settle.rs:24), mirrored as `MAX_VALUE_DIGITS = 39` (web/src/convert/entry.ts:44) | matches |
| Finance 年利 8 文字「100.0000まで」— detail.ja.md:390, 737 | `MAX_RATE_LEN = 8` (web/src/ui/Finance/FinancePanel.tsx:144-145); core rejects >100% or ≥5 int digits (crates/calcarc-core/src/finance/loan/rate.rs:18-19 doc comment "100% 超・5 桁以上は SyntaxError") | matches |
| Finance 期間 1,200 (ローン月・複利期) — detail.ja.md:393,403,415,738 | `MAX_TERM_MONTHS: u32 = 1_200` (crates/calcarc-core/src/finance/loan/inverse.rs:21); `MAX_PERIODS: u32 = 1_200` (crates/calcarc-core/src/finance/compound.rs:19) | matches |
| Finance 金額 20 桁, 上限 18,446,744,073,709,551,615円 — detail.ja.md:739,742-744 | `MAX_YEN_DIGITS = 20` (web/src/finance/entry.ts:42); amounts are `u64` (u64::MAX = 18,446,744,073,709,551,615) throughout crates/calcarc-core/src/finance/loan | matches |
| ローン返済月額/賞与返済額の答え 10億円まで — detail.ja.md:740,748-750 | `MAX_VERIFIED_MONTHLY_YEN: u64 = 1_000_000_000` (crates/calcarc-core/src/finance/loan/closed_form.rs:27), applied independently to the monthly and bonus schedules via `forward`/`bonus.rs`; not applied to 借入可能額/返済期間 (closed_form.rs doc comment: "逆算の答えには掛けない") | matches |
| 表示 有効数字10桁, `|x|>=1e10` または `0<|x|<1e-9` で指数表記 — detail.ja.md:156-158 | `format_real` tests: `shows_ten_significant_digits`, `format_real(1e10)=="1e10"`, `format_real(1e-9)=="0.000000001"` (crates/calcarc-core/src/numeric/format.rs:6-8,219,239-240) | matches |
| 履歴 50件まで — detail.ja.md:211,566 / quick.ja.md:137 | `HISTORY_LIMIT = 50` (web/src/history/types.ts:35) | matches |
| 為替レート保存後 24 時間で背後取得 — detail.ja.md:288 | `REFRESH_AFTER_MS = 24 * 60 * 60 * 1000` (web/src/currency/rates.ts:29) | matches |
| 為替 16通貨・順序、JPY/KRW/VND=整数・他=小数2桁 — detail.ja.md:275-276,302-303 | `CURRENCY_TOKENS` 16通貨、順序同一 (web/src/currency/types.ts:21-38); `Currency::{Jpy,Krw,Vnd}.decimals()==0`、他13通貨は2桁 (crates/calcarc-core/src/convert/currency.rs:330-337) | matches |
| Convert 既定単位 (長さkm→mi 等8組) — detail.ja.md:258-266 | `DEFAULT_UNITS` (web/src/ui/Convert/UnitPanel.tsx:83-102) — all 8 pairs identical | matches |
| Scale 件数 K=千 M=百万 G=十億 — detail.ja.md:319 | `UnitSet::Count` → G=1e9,M=1e6,K=1e3 (crates/calcarc-core/src/expr/mod.rs:45) | matches |
| LLM 文脈長候補 2K/4K/8K/16K/32K/128K/1M, K=1024/M=1024² — detail.ja.md:345,349 | `context: [2048,4096,8192,16384,32768,131072,1048576]` (web/src/ui/Keypad/llm.ts:37) | matches |
| LLM パラメータ候補 1B..70B, ヘッド数/次元候補, 精度候補順 — detail.ja.md:340-346 | `CANDIDATE_VALUES` (web/src/ui/Keypad/llm.ts:29-36), `PRECISION_TOKENS`=[fp32,fp16,bf16,int8,int4] (web/src/datascale/types.ts:34-39), KV precision list order (web/src/ui/Keypad/finance… llm.ts:52-56) | matches |
| Scale データ型候補・順序・既定float32 — detail.ja.md:323-325 | `DATA_TYPE_TOKENS` same order (web/src/datascale/types.ts:10-19) | matches |
| Scale 次元数候補 384..4096 — detail.ja.md:321 | `DIMENSION_CANDIDATES` (web/src/ui/Keypad/dataScale.ts:60-61) | matches |
| 数値の丸め (numerical-policy.md「★単位換算には既知の限界が1つ」) not named in manual's 既知の計算制限 | crates: convert `format_rational` overflow when an in-range answer exists (docs/numerical-policy.md:369-431); manual only has a generic disclaimer "39桁に収まっていても答えが出せない…ことがある" (detail.ja.md:745-747), no worked example / no mention that the answer mathematically exists | **B, informational gap** — not wrong, but the specific documented known-limitation (2026-08-31 裁定 explicitly asked for it to be "recorded") isn't named; the generic 39-digit disclaimer covers the *symptom* but not the fact that this is a tracked, intentionally-unfixed defect |

Part 1 summary: 15 distinct claims checked against a code constant/validation; **0 differ**, **0 "not enforced anywhere"**, 1 informational gap relative to numerical-policy.md (not a wrong claim, a missing cross-reference).

#### Part 2 — key names and keypad layout

| Manual claim (file:line) | Code (file:line) | Verdict |
|---|---|---|
| Scientific キー一覧 (Shift, sin/cos/tan, √, x², DRG, ENG, ln, log, 1/x, eˣ, xʸ, °′″, ( ), +/−, DEL, AC, 0-9/000/., +−×÷, =, j, ▸∠, Exp) — detail.ja.md:48-73 | `FUNCTION_ROW`+`FUNCTIONS_SECOND`+`MAIN_GRID` (web/src/ui/Keypad/scientific.ts:12-257) — same key set | matches |
| Shift 面表 (sin/cos/tan→asin/acos/atan, eˣ→e, (→n!, )→nPr, +/−→nCr, j→hist, Exp→π) — detail.ja.md:126-134, quick.ja.md:88 / quick.en.md:115-116 | same 7 pairs defined via `shift:` fields (scientific.ts:32-37,129-134,166-171,178-183,190-195,213-219,243-248) | matches |
| 押せないキー: 数字打鍵中は ( π e 不可; 【)】直後/関数の答え/π/e/+−反転後は 0-9・000・.・Exp・j・(・π・e が一括不可 — detail.ja.md:81-85 | `refuses()` (crates/calcarc-core/src/engine/mod.rs:22-53): buffer 中は `LParen\|Pi\|E`（+ conditional J）; `on_hand` 中は exactly `Digit\|Zeros3\|Dot\|Exp\|J\|LParen\|Pi\|E` | matches exactly |
| j の押せない条件 (Exp直後・数字0でexponentがある場合／°′″直後で数字0) — detail.ja.md:88-93 | `Key::J => !buffer.has_digits() && (exponent.is_some() \|\| !sexagesimal.is_empty())` (engine/mod.rs:33-36); this text was corrected in the current HEAD commit e727a0c specifically to match this rule | matches (already fixed pre-audit) |
| 演算子の押し直しは最初から正しく打った列と同じ答えになる (F1) — detail.ja.md:118-120, quick.ja.md:95-99, quick.en.md:125-130 | `push_binop` doc: "二項演算子はどの状態でも拒まない…訂正した列は、最初から正しい演算子を打った列と同じになる" (engine/mod.rs:20,260-313), implements 0.9.2 design §2 / F1 | matches |
| 【方式】キーで 月/半年/年 と 期末/期首 が出る — detail.ja.md:504-514 | `PERIODS_FACE` keys: period:12="月", period:2="半年", period:1="年", timing:end="期末", timing:start="期首" (web/src/ui/Keypad/finance.ts:352-406) | matches |
| 【税】キーで なし/20.315% — detail.ja.md:518 | `TAX_FACE`: tax:none="なし", tax:withholding="20.315%" (finance.ts:409-441) | matches |
| Finance 項目の並び (ローン: 借入額/年利/期間/月額/残価/賞与; 複利: 元本/積立/年利/期間/方式/税) — detail.ja.md:399,474 | `FIELDS` (finance.ts:186-246), `COMPOUND_FIELDS` (finance.ts:252-308) — same order | matches |
| 賞与欄見出しはモードで切替 (返済月額→ボーナス返済分（元本）, 借入可能額→ボーナス回の返済額) — detail.ja.md:405-406 | `bonusName(mode)`: `mode==="principal" ? "ボーナス回の返済額" : "ボーナス返済分（元本）"` (web/src/ui/Finance/FinancePanel.tsx:357-358) | matches |
| Convert カテゴリ順 (長さ/質量/温度/面積/体積/速さ/データ量/為替) — detail.ja.md:232 | `CATEGORY_LABELS` key order identical (web/src/ui/Keypad/convert.ts:75-84) | matches |
| Convert 値の【±】キー — detail.ja.md:239 | `token:"sign", label:"±"` (web/src/ui/Keypad/convert.ts:512-517) | matches |
| Convert【AC】: 値なら値を消す、単位なら既定に戻す — detail.ja.md:246-247, quick.ja.md:74 | `UnitPanel.tsx:252-262` — exactly this branching | matches |
| Scale/Data Transfer/LLM: ( ) ÷ × − + = are shown but unused on those 3 screens — detail.ja.md:312-313 | `PAD` in dataScale.ts includes lparen/rparen/add/sub/mul/div/eq tokens, but `DataScaleField`/`LlmField`/`TransferField` panels never branch on them for those digit-only fields | matches |
| キーボード対応表 (0-9, ., +, -, *, /, = / Enter, Backspace, Escape, (, ), j) — detail.ja.md:634-646 | `KEYBOARD_MAP` (web/src/ui/useKeyboard.ts:10-34) — identical set (plus an undocumented uppercase "J" alias, not a contradiction) | matches |
| キーボードは Scientific だけ — detail.ja.md:628-630, quick section n/a | `useKeyboard()` only called from `web/src/ui/ScientificPanel.tsx` (only non-test call site) | matches |
| 押せないキーは HTML 上も押せない (0.9.2) — detail.ja.md:77-79 | `Key.tsx:90-91`: `disabled={off}` where `off` derives from `refuses()`/`refused_keys()` carried across the wasm boundary | matches |

Part 2 summary: 15 distinct layout/behavior claims checked; **0 differ**. The one rule that *was* stale for 0.9.2 (the j-key wording) had already been corrected in this branch's HEAD commit (e727a0c) before this audit started, so it is not reported as an open finding — noted for completeness only.

#### (A) Made stale by 0.9.2 changes

**None found remaining open.** All four 0.9.2-era changes named in the task were checked and the manual text already reflects them correctly:
- Operator-correction fix (F1): detail.ja.md:118-120 matches `engine/mod.rs` `push_binop`.
- Refused keys (`engine::refuses`, disabled HTML): detail.ja.md:77-96 matches `refuses()` exactly, key-for-key, including the two J-key sub-cases (the wording for J was corrected in the very last commit on this branch, e727a0c, before this audit ran).
- ¥1bn monthly cap: detail.ja.md:740,748-750 matches `MAX_VERIFIED_MONTHLY_YEN` and its scope (payment/bonus only, not principal/term).
- Convert/currency expression change: detail.ja.md:239-243,271-305 (Convert 値 takes an expression, doesn't round on `=`) matches `settle.rs`/`web/src/convert/entry.ts`, and currency specifically (line 304-305, "為替の【値】にも四則演算の式が打てます") matches commits `505558a`/`6e97489`/`2b77960`.

#### (B) Wrong or stale before 0.9.2

**None found as outright errors.** One informational gap noted above (Part 1 table, last row): the manual's Convert digit-limit disclaimer (detail.ja.md:745-747) is generic and does not name the specific tracked-but-unfixed defect described in docs/numerical-policy.md:369-431 (★ 単位換算には、既知の限界が1つある — an answer that exists and fits the display rules can still return `Overflow` due to an internal normalization overflow, for ~182 unit pairs starting at 26 digits). This is not a false claim — the existing disclaimer's spirit ("39桁に収まっていても答えが出せないことがある") already covers the symptom — but it doesn't surface the fact that this is a *known, intentionally unfixed* limitation the user asked to have "recorded," which arguably belongs next to the loan-rounding and nCr/nPr items in the 既知の計算制限 section (detail.ja.md:752-776).

#### Proposed correction (text only, not applied)

In detail.ja.md's `### 既知の計算制限` section (after line 776 or before the ローン rounding item), consider adding:

> **単位換算では、答えが存在し表示の規則に収まる入力でも、まれにエラーになることがあります。** 内部で使っている分数を表示できる形に直す途中で、扱える大きさを超えることがあるためです（27 桁前後の非常に小さい・大きい値を極端な単位の組み合わせで換算したときに起こります）。この限界は把握していますが、まだ直していません。

This is a proposal only — no tracked file was edited.

---

## 付録 C: `manual-audit-scope.md`

### マニュアル監査 — 「確かめた」claim の棚卸し (docs/manual/, worktree e727a0c)

対象: `docs/manual/detail.ja.md` (781 行), `docs/manual/quick.ja.md` (169 行),
`docs/manual/quick.en.md` (207 行)。

確認方法: 各マニュアルファイルを全文読了。ガード 5 本
(`web/tests/unit/manual-widths.test.ts` `manual-shots.test.ts` `manual-fonts.test.ts`
`manual-markdown.test.ts` `manual-key-names.test.ts`) を全文読了(推測ではなく assert
文そのものを読んだ)。`web/playwright.config.ts` `web/tests/e2e/widths.ts`
`web/tests/e2e/pwa.spec.ts` `web/tests/e2e/viewport-budget.spec.ts`
`web/tests/e2e/short-screens.spec.ts` `web/tests/e2e/refused-keys.spec.ts`
`tools/tests/webkit-gate.test.ts` `.github/workflows/ci.yml` `.github/workflows/release.yml`
`web/tests/shots/shots.ts` を読了。個々の数値worked exampleは `grep -rl` で
crates/ web/ reference/ testdata/ heavy/ を横断検索して裏取りの有無を確認した
(`playwright test --list` は不要だった — config自体を読めば project 構成が分かるため)。

---

#### Part 1 — 「確かめた」範囲の claim 一覧

| manual file:line | claim | 実際にカバーするもの | 判定 |
|---|---|---|---|
| detail.ja.md:597-598, quick.ja.md:14-15, quick.en.md:38-40 | オフライン動作を確かめているのは Chrome 系ブラウザだけ、iPhone Safari は未確認 | `web/tests/e2e/pwa.spec.ts` のオフライン検査は Chromium のみ。WebKit は `test.fixme(browserName === "webkit", ...)` で明示的に除外(理由: Playwright が WebKit で SW 配下のネットワーク切断ができない) | **正確** |
| detail.ja.md:602-605, quick.ja.md:16-19, quick.en.md:41-45 | 画面幅は Chromium 360px以上・WebKit 375px以上を自動検査、iPhone実機は確認していない | `manual-widths.test.ts` がマニュアル文中の数字を `web/tests/e2e/widths.ts` の `CHROMIUM_NARROW_WIDTH=360`/`WEBKIT_NARROW_WIDTH=375` と突合。`playwright.config.ts` の `webkit` project は実際に `browserName: "webkit"` で iPhone デバイスエミュレーションではない(実機ではない、の文言と整合) | **正確・ガードあり** |
| detail.ja.md:607-612, quick.ja.md:20-23, quick.en.md:46-48 | 1画面に収まる高さの自動検査はホーム画面起動相当の高さで、WebKitによる検査であり実機iPhoneではない | `viewport-budget.spec.ts` は 11 route を webkit/mobile 両 project のデフォルト viewport (390×844) で検査(project定義の高さを継承)。狭幅側の 812px は `WEBKIT_NARROW_HEIGHT` として `finance-layout.spec.ts` の2箇所でのみ使用(`webkit-gate.test.ts` が数を固定) | **正確** — ただし「WebKit」は "iPhone実機と同じ描画エンジン"の意で厳密にはブラウザエンジンのシミュレーションである旨マニュアル自身が明記済み |
| detail.ja.md:609-610, quick.ja.md:21 | 低い画面でもスクロールすればすべての表示とキーが見えて押せることを確かめている | `short-screens.spec.ts` が 13 画面×Financeの6モードを Chromium/WebKit 双方、`SAFARI_VIEWPORTS`(実機 iPhone のタブ表示寸法4種)で「横スクロールしない」「無効でないキーは全てスクロールして押せる」「他要素に隠れない」を検査 | **正確・ガードあり** |
| detail.ja.md:596-597 (「オフライン」章), quick.ja.md:14 | 「一度開いたあとはネットワークが無くても使えるように作っている」 | `pwa.spec.ts` の "Scientific and Scale keep working once the network drops" が Chromium で実測(Scientific/Scaleのみ明示的に検証、他タブは未言及) | **claimed だが検証範囲より広い可能性** — テストは Scientific と Scale の2画面だけをオフラインで確認しており、Convert(為替以外)・Financeのオフライン動作は本文中に明示テストなし。ただし為替以外はネットワーク依存の実装が無い旨は本文で説明されており、実質的に妥当と推測されるが**機械的には未確認** |
| detail.ja.md:118-120「演算子の押し直し」, quick.ja.md(要約に同旨なし), quick.en.md:125-130 | `3 + × 4 =` は `3 × 4 =` と同じ12 | `web/tests/e2e/refused-keys.spec.ts` の "a corrected operator means the right one, through the browser" が実ブラウザ+実WASMで `2+3+×4=` = 14 を確認し、履歴の式が訂正後演算子のみを持つことも確認(0.9.2 設計書 §2, 外部監査F1由来) | **正確・E2Eでガードあり(0.9.2で新規追加)** |
| detail.ja.md:77-96「押せないキー」 | 手元の値を黙って捨てる打鍵はそもそも押せない | `refused-keys.spec.ts` の1本目のテストと `engine_table.rs` の `refused_keys_lists_every_key_that_refuses_in_key_all_order` で裏取り(0.9.2 で "開き括弧" disabled ボタンの検証をE2Eに追加、0.9.2設計書§3, 外部監査F5) | **正確・ガードあり** |
| detail.ja.md:762-776「nCr・nPr は続きの計算からは断られることがある」の worked example (29 nCr 3 = 3,654 → 続けて nCr 1 = Math ERROR) | 具体的な打鍵列と数値の主張 | `crates/calcarc-core/tests/engine_table.rs` 等リポジトリ全体を grep しても `3654` や該当キー列は**どこにも見つからない** | **claimed だが未検証(unguarded)** — Part 1 の finding。数値そのものが誤りとは断定できないが、機械的裏取りが一切無い |
| detail.ja.md:412-413, 430-432「ローン返済月額の worked example」91,855円/38,579,007円等 | 具体的な計算結果 | `crates/calcarc-wasm/tests/web.rs`, `testdata/finance.json`, `web/src/ui/Finance/FinancePanel.test.tsx`, `web/tests/e2e/loan.spec.ts`, `reference/src/calcarc_reference/cases.py` に同じ数値が登場 | **十分にガードあり** |
| detail.ja.md:438-446, 441-444「残価の worked example」(1,200,194円 / 1,200,195円 / 3,414,605円等) | 具体的な計算結果 | `testdata/finance.json`, `reference/src/calcarc_reference/cases.py`, `web/src/ui/Finance/FinancePanel.test.tsx` に同じ数値 | **ガードあり** |
| detail.ja.md:461-463「賞与の worked example」(月々73,484円・賞与回110,487円(70回)・総支払額38,597,286円・差18,279円) | 具体的な計算結果 | `73484` は `FinancePanel.test.tsx` に登場するが、`110487`・`38597286`・`18279` はリポジトリ全体を grep しても**どこにも見つからない** | **claimed だが部分的に未検証(unguarded)** — Part 1 finding |
| detail.ja.md:497-498, 528-530「複利の worked example」(1,051,136円・国税7,831円・地方税2,556円・手取り1,040,749円等) | 具体的な計算結果 | `crates/calcarc-wasm/tests/web.rs`, `testdata/finance.json`, `FinancePanel.test.tsx` に同じ数値 | **ガードあり** |
| detail.ja.md:548-549「必要年数の worked example」(999円/1.5%/19期→1,016円、20期→1,015円) | 具体的な計算結果 | `reference/tests/test_compound_ref.py`, `testdata/finance.json` に同じ数値 | **ガードあり** |
| detail.ja.md:242-243, quick.ja.md:78「Convert の値の worked example」(`1/3*3-1` = `0`、`12345678901.5`) | 具体的な計算結果 | `crates/calcarc-core/src/convert/settle.rs`, `crates/calcarc-wasm/tests/web.rs`, `web/src/ui/Convert/UnitPanel.wasm.test.tsx` に同じ値 | **ガードあり** |
| detail.ja.md:304「為替の【値】にも四則演算の式が打てます」 | 0.9.2 で新規に追加された挙動(0.9.2以前はリテラルのみ) | 対応するコミット `505558a`(currency readerをexpression evaluationに変更)。E2Eレベルの直接テストは今回未確認(`convert.spec.ts`等に個別ケースがある可能性はあるが、grep範囲では未特定) | **claimed、実装の裏取りは確認、テストの網羅性は未確認** |
| detail.ja.md:735-740「範囲と制限」の表(12文字・39桁・8文字・1,200・20桁・10億円) | 各画面の入力上限の数値 | `MAX_VERIFIED_MONTHLY_YEN = 1_000_000_000` を `crates/calcarc-core/src/finance/loan/closed_form.rs:27` で確認(10億円の値と整合)。他の上限値(12文字・39桁等)は個別の逆引きは行っていない(範囲外) | **10億円分はコード上に定数として実在(部分確認)** |
| detail.ja.md:752-760「既知の計算制限」(月額±1円ずれ、理論値を超えない/借主に不利にならない/総支払額は変わらないの否定) | ローン切り捨ての性質に関する断定 | ユーザーのメモリ(`heavy-corpus-next-steps.md`)によれば「残価は構造上作れない」という過去の裁定が偽だったと記録されており、この種の断定は過去に誤りが判明した実績がある領域。本文自体を裏取りする engine_table.rs / testdata 上のピンポイントの一致は未確認 | **claimed、構造的に検証しづらい(unguarded)** |

**Part 1 まとめ**: 幅・高さ・オフライン・0.9.2の操作訂正/拒否キーの4件は、いずれも命名どおりの
E2E/単体ガードで実測されており「wrong」ではない。**未検証(unguarded)なのは主に Finance の
worked example のうち賞与回りの3数値と、nCr/nPr続き計算の worked example**。これらは
「間違っている」と示す証拠はないが、リポジトリのどこにも裏取りが存在しない。

---

#### Part 2 — 機械的ガードの棚卸し(guarded / unguarded)

5 本のガードは全て**構造とラベルの一致**だけを見ており、**文章の意味（計算結果・挙動の記述）
は一切読まない**。実際に assert している内容:

| ガード | 名前が示唆すること | 実際に assert していること |
|---|---|---|
| `manual-markdown.test.ts` | Markdown構造 | 3冊の章番号が連番であること(quick=1..7, detail=1..10)、英語版quickの章数・番号が日本語版と一致すること、`shot:` 参照が撮影台本(`SHOTS`)と両方向で一致すること(台本にない`shot:`は無い、`use:"manual"`の写真は必ずどれかのマニュアルから参照される)。**訳文の正確さ・写真が説明に合っているかは明示的に「機械では見られない」と docstring に明記** |
| `manual-fonts.test.ts` | フォント | PDF/写真の描画に使う固定フォント3つ(Noto Sans JP, Arimo, Noto Sans Symbols 2)の並び順、`package.json`のdevDependenciesが厳密バージョンで固定されていること、フォントCSSが正しい`font-family`を名乗ること、レンダリングHTMLがその順で`font-family`を書くこと、`unpinnedGlyphs`(web-font以外が描いた文字数を数える純関数)の単体テスト。**実際にどのグリフをどのフォントが描いたかはChromiumに聞くしかなく、それは`pnpm manual`/`pnpm shots`実行時のみ判定される——このテストは判定「器」の純関数を見ているだけ** |
| `manual-shots.test.ts` | 写真参照とREADME写真の区別、章立て | manual-markdown.test.tsと同じテストファイル(実体は1ファイルに両方の`describe`がある)。上記に同じ |
| `manual-widths.test.ts` | 画面幅の記述 | マニュアル本文中の「幅 (\d+)px 以上」(JA)・「from (\d+)px wide」(EN)の数字が`CHROMIUM_NARROW_WIDTH`・`WEBKIT_NARROW_WIDTH`と一致すること。`viewport-budget.spec.ts`のいちばん狭い幅が`CHROMIUM_NARROW_WIDTH`と一致すること。**高さ(812px)や「iPhone実機ではない」という定性的な文言そのものは検査対象外** |
| `manual-key-names.test.ts` | キー名の実在性 | マニュアル中の全`【…】`表記が、現在の画面のラベル定義(Keypad各種・FinancePanel・Nav等、計14ソースファイルからimportした文字列集合)のいずれかに一致すること。件数下限(272ラベル、625キー名参照)を主張。**キー名が実在することだけを見る。そのキーを押した結果として書かれている数値や挙動は一切見ない** |

##### 機械的にガードされている claim の種類
- 章の数・番号の整合性(markdown)
- 英日quickマニュアルの章の対応(markdown)
- `shot:`参照と撮影台本の双方向整合性(markdown)
- 固定フォントのバージョン・名前・埋め込み順序(fonts)
- マニュアル文中の画面幅の数値(widths、幅のみ・高さは対象外)
- マニュアル中の全キー名(`【…】`)が現在の画面に実在すること(key-names)

##### 機械的にガードされていない claim の種類(具体例つき)
| claimの種類 | 具体例(file:line) | ガードの案(スケッチ) |
|---|---|---|
| 計算結果のworked example(数値) | detail.ja.md:762-776 (nCr続き計算 3,654の例)、detail.ja.md:461-463(賞与の38,597,286円等) | `engine_table.rs`や`reference`のgolden、または新規の単体テストでマニュアルの打鍵列を実際に評価し、書かれた数値と突合する(reference実装またはRustコアから再計算) |
| 挙動の記述(「〜ができる/できない」という定性的主張) | detail.ja.md:592-598「オフラインで使える」の範囲(Scientific/Scaleのみ実測、Convert以外は未言及) | マニュアルの章見出しとE2E specファイル名を対応表にして、章に対応するE2Eが実在し緑であることをCIレベルで突合する(現状は存在しない) |
| 上限値・制限値の数値(桁数・件数) | detail.ja.md:735-740「12文字」「39桁」「1,200」「20桁」「10億円」 | コア側の定数(`MAX_VERIFIED_MONTHLY_YEN`等)をexportし、マニュアルの数字と定数値を突合する単体テスト(manual-widths.test.tsと同じ手法をFinance/Scientific/Convertの上限に拡張) |
| 訳文の意味の正確さ(日英対応) | quick.en.md全体 | 機械的に不可能に近い(意味の翻訳品質)。妥協案として重要な数値・固有名詞だけを英日で突合する正規表現ガード |
| 写真が説明と一致しているか | detail.ja.md:206, 502等の`shot:`画像 | 機械的に困難。妥協案としてキャプション文字列に含まれるキーワード(「複利」「履歴」等)が撮影台本の`hash`/`keys`と字面上関連することだけチェックする弱いガード |
| 版数に依存する挙動の記述(0.9.2固有の新機能) | detail.ja.md:118-120(演算子訂正)、304(為替の式入力) | CHANGELOGの当該バージョンの箇条書きと、マニュアルの対応する文の存在を突合する(粗いキーワードマッチ) |
| 「確かめていない」という否定的主張自体 | detail.ja.md:598「iPhoneのSafariでは、まだ確かめていません」 | E2Eのproject一覧・test.fixme理由を読み、「iPhone実機」を名指すprojectが0件であることを主張するテスト(webkit-gate.test.tsに類似の手法を転用) |

**Part 2 まとめ**: ガードされているのは「構造(章番号・shot参照)」「フォントの固定」「画面幅の数値」
「キー名の実在」の4種のみ。**計算結果・挙動範囲・上限値・訳文品質・写真の妥当性・「確かめていない」
という否定文の正しさは、5本のどのガードにも一切かかっていない。**

---

#### (A) 0.9.2 の変更で stale になった/なりうる claim

0.9.2 の変更点: 演算子訂正の修正(外部監査F1)、拒否キーの明示化(外部監査F5)、
¥10億の月額上限(`MAX_VERIFIED_MONTHLY_YEN`、`loan/closed_form.rs`)、
為替の値を式として読む変更(コミット `505558a`、外部監査由来)。

- **すでに本文へ反映・E2Eガードも追加済み**: 演算子の押し直し(detail.ja.md:118-120、
  `refused-keys.spec.ts`)、押せないキー(detail.ja.md:77-96、同spec)。stale ではない。
- **すでに本文へ反映、コードの裏取りは確認、E2Eの網羅性は未確認**: 為替の値に式が打てる
  (detail.ja.md:304)。
- **すでに本文へ反映、定数と部分一致確認**: ローン月額の10億円上限と既知の丸め(±1円)
  (detail.ja.md:740-760)。
- **未検証のまま残る worked example**: nCr/nPr続き計算の例(detail.ja.md:762-776)、
  賞与のworked example中の3数値(detail.ja.md:461-463)。これらは0.9.2の変更そのもの
  ではないが、今回のworktreeのコミット群(`85cdf0b`「既知の計算制限セクション追加」)で
  **新規に書き足された文**であり、0.9.2作業の一部として追加されたのに機械的裏取りが
  伴っていない。

#### (B) 0.9.2 以前から誤り・古い・未ガードだった claim

- worktreeのコミット履歴(`b88408d`, `303c855`, `8295fcd`)が示す通り、0.9.2の読み直しで
  **複数の既存の虚偽記述**が見つかり修正済み: DELキーの「関数の誤操作を取り消す」という
  理由(`docs/definition-of-done.md`等4文書、`8295fcd`/`b88408d`で修正)、iPhone実機で
  検査しているという誤claim(3マニュアルとも、`b88408d`で修正)、入力規則の過小な記述
  2件(`303c855`で修正)。**これらは監査時点(現worktree)ではすでに修正済み**であり、
  今回の監査では再発を確認していない。
- **今回新たに見つかった、0.9.2以前から一貫して unguarded な claim 種別**(Part 2参照):
  worked exampleの数値主張全般(算出根拠がガードにない賞与例・nCr例)、上限値の数値
  (10億円以外は定数との突合未確認)、訳文の意味的正確さ、写真の妥当性。これらは
  0.9.2固有ではなく、5本のガードが最初から意味を読まない設計であることに起因する
  構造的な穴。

---

## 付録 D: `manual-dispute-core.md`

### マニュアル論争の裁定（4 件）

作業木: `scratchpad/wt-man`（detached `e727a0c`、`docs/manual-0.9.2`）。読み取りのみ。
終了時 `git status --porcelain` は空。

---

#### Item 1 — 60 進の閾値 — **正しい**（挑戦者が正しい。マニュアルは直すべき）

##### マニュアルが実際に言っていること（`docs/manual/detail.ja.md:195-197`）

```
195: 角度（度・分・秒）にも、時間（時・分・秒）にも使えます。24 で割ることは
196: しません（30.5 は 30°30'0" と出ます）。60 進で表せない値（1e10 以上など）では、
197: 表示は変わりません。度・分・秒で打った角度は、そのまま【sin】などに渡せます。
```

##### コード

`crates/calcarc-core/src/numeric/format.rs:4` — `pub const DISPLAY_DIGITS: usize = 10;`
`crates/calcarc-core/src/numeric/format.rs:129-137`:

```rust
let int_digits = if degrees < 1.0 { 1 } else { degrees.log10().floor() as i32 + 1 };
if int_digits + 4 > DISPLAY_DIGITS as i32 {
    return None;
}
```

度が `nd` 桁、分 2 桁＋秒の整数部 2 桁で 4 桁。`nd + 4 > 10` すなわち **`nd > 6`**、
つまり **度の整数部が 7 桁になった瞬間＝1,000,000 以上**で `None` になる。

##### 実測（本物のコアを走らせた）

一時ファイル `crates/calcarc-core/tests/zz_dms_probe.rs` を置き、
`cargo test --package calcarc-core --test zz_dms_probe -- --nocapture` を実行（実行後に削除済み）。

```
value=999998         dms=Some("999998°0'0\"")  plain="999,998"
value=999999         dms=Some("999999°0'0\"")  plain="999,999"
value=999999.5       dms=Some("999999°30'0\"")  plain="999,999.5"
value=1000000        dms=None  plain="1,000,000"
value=1000001        dms=None  plain="1,000,001"
value=9999999        dms=None  plain="9,999,999"
value=1000000000     dms=None  plain="1,000,000,000"
value=9999000000     dms=None  plain="9,999,000,000"
value=10000000000    dms=None  plain="1e10"
```

`None` のとき表示がどうなるかは `crates/calcarc-core/src/engine/display.rs:101-113`
（`sexagesimal_view_of` が `None` を返すと呼び出し側が通常表示に落ちる。エラーにはならない）。
したがって画面では:

- **999999 →『999999°0'0"』**（60 進になる）
- **1000000 →『1,000,000』**（60 進にならず 10 進のまま）

##### 裁定

挑戦者の 3 つの主張——閾値は 1,000,000、`999999` は `999999°0'0"`、`1000000` は
`1,000,000`——は**すべて実測と一致**した。引用された `format.rs:136` の行も正しい。

マニュアルの文は「1e10 以上**など**」と例示の形なので、**文としては偽ではない**
（1e10 以上でも確かに表示は変わらない）。しかし**唯一挙げている数が真の閾値より
10^4 倍大きい**ので、読者はここから 1,000,000 を導けない。既存のユニットテストも
両側を押さえている（`format.rs:310` が `1e10 → None`、`format.rs:312` が
`999999.5` は `is_some`）——**真の境界は 999,999 と 1,000,000 のあいだにある**。

直すなら「1,000,000 以上」。

---

#### Item 2 — 年利の「8 文字」 — **正しい**（挑戦者が正しい）

##### マニュアルが実際に言っていること（`docs/manual/detail.ja.md:730-737`）

```
730: 各画面には、打てる数の大きさに上限があります。上限に達すると、それ以上は打てません
731: （押しても増えません）。
...
733: | 項目 | 上限 |
737: | Finance の年利（5 章） | 8 文字（100.0000 まで） |
```

表の見出し行 730-731 が、この表の数を**「押しても増えない打鍵の上限」**と定義している
——つまり :737 の「8 文字」は入力遮断の主張である。

##### 実際の呼び出し経路

1. `web/src/ui/Finance/FinancePanel.tsx:648` — `pressDigit(token.slice("digit:".length));`
2. `web/src/ui/Finance/FinancePanel.tsx:590-592`:
   ```tsx
   function pressDigit(digit: string) {
     setEntry(active, pushDigit(entryOf(active), digit));
   }
   ```
   **項目（`active`）で分岐していない。年利も金額も同じ 1 本を通る。**
3. `web/src/finance/entry.ts:42-46`:
   ```ts
   const MAX_YEN_DIGITS = 20;
   export function pushDigit(entry: units.Entry, digit: string): units.Entry {
     return units.pushDigit(entry, digit, MAX_YEN_DIGITS);
   }
   ```
4. `web/src/units/entry.ts:65-79` — `if (tail.text.length >= maxDigits) return entry;`（＝20）

`MAX_RATE_LEN` の定義と使用は 2 箇所しかない（`grep -rn "MAX_RATE_LEN" web/src/`）:

```
web/src/ui/Finance/FinancePanel.tsx:147:const MAX_RATE_LEN = 8;
web/src/ui/Finance/FinancePanel.tsx:662:        setEntry(active, pushDot(entryOf(active), MAX_RATE_LEN));
```

`web/src/units/entry.ts:81-87` の `pushDot` は `tail.text.length >= maxDigits` で
**小数点の追加だけ**を止める。

##### 上限を実際に効かせているのは何か

値の天井は**コア側で、計算のときに**効く（`crates/calcarc-core/src/finance/loan/rate.rs`）:

```
42: if frac_part.len() > 4 {
43:     return Err(CalcError::SyntaxError);
44: }
...
66: // 100% 超は拒否: numerator/scale > 100  <=>  numerator > 100·scale
67: if numerator > 100u64.saturating_mul(scale) {
68:     return Err(CalcError::SyntaxError);
69: }
```

つまり `100.00000`（9 文字・小数 5 桁）や `999999999999` は**打てるが**、
計算時に `SyntaxError`（画面では Math ERROR）になる。**打鍵は止まらない。**

##### 裁定

- **年利の欄に打てる数字は 20 桁**（`MAX_YEN_DIGITS`）。8 ではない。
- **`MAX_RATE_LEN = 8` が縛るのは小数点だけ**——先頭の数字列が 8 文字に達すると
  【.】が効かなくなる。挑戦者の言うとおり。
- **値の上限 100.0000 は本物**だが、それは*入力の遮断*ではなく*計算時の拒否*で、
  マニュアルが 730-731 で宣言した「押しても増えません」の形では働かない。

マニュアル :737 は、表の見出しが与える意味で読むと**偽**。挑戦者は全面的に正しい。
（括弧内の「100.0000 まで」だけは真だが、それも「打てない」ではなく「エラーになる」。）

---

#### Item 4 — 10 億円の上限が届かない経路 — **正しい**（挑戦者が正しい。ただし直すのは文であってコードではない）

##### マニュアルが実際に言っていること（`docs/manual/detail.ja.md:740, 748-750`）

```
740: | ローンの【返済月額】と賞与の返済額の答え（5 章） | 10 億円まで |
...
748: - **ローンの【返済月額】と賞与の返済額は、答えが 10 億円を超えるとエラーになります。**
749:   この上限が働くのは、CalcArc がこの 2 つの額を計算で求めるときだけです——
750:   【借入可能額】【返済期間】には働きません。
```

##### コード側の事実

`crates/calcarc-core/src/finance/loan/closed_form.rs:58-96`。上限を見る行は**ただ 1 つ**:

```
92: if monthly > MAX_VERIFIED_MONTHLY_YEN {
93:     // 精度を確かめていない答えは出さない(0.9.2 設計書 §5.1。画面は既存の Math ERROR)。
94:     return Err(CalcError::Overflow);
95: }
```

その手前に**上限を見ないまま返る 2 つの早期 return** がある:

```
65: if rate.is_zero() {
68:     return Ok(if residual == 0 {
69:         principal / n as u64
71:         (principal - residual) / (n as u64 - 1)
...
74: if n == 1 {
75:     // 厳密経路(f64 不要)。residual は n<2 で拒否済み。
76:     let interest = rate.monthly_interest_floor(principal)?;
77:     return principal.checked_add(interest).ok_or(CalcError::Overflow);
```

定数の docstring 自身がこれを明記している（`closed_form.rs:24-27`）:

```
24: /// **比べるのは切り捨てたあとの月額**——ちょうど 10 億円は通す(境界 golden の
25: /// `residual/exact/15/2/987654400/81`)。**f64 を通らない経路(金利 0%・1 回払い)と
26: /// 逆算の答えには掛けない**(0.9.2 設計書 §9 の 7)。
27: const MAX_VERIFIED_MONTHLY_YEN: u64 = 1_000_000_000;
```

見張りのテスト `closed_form.rs:210-221`:

```rust
#[test]
fn the_exact_paths_are_outside_the_cap() {
    // 金利 0% と 1 回払いは f64 を通らない厳密な経路で、精度の心配が無い(§9 の 7)。
    let zero = Rate::from_percent("0").unwrap();
    assert_eq!(
        monthly_payment(18_446_744_073_709_551_615, &zero, 600, 0),
        Ok(30_744_573_456_182_586)
    );
    let r = Rate::from_percent("1").unwrap();
    assert!(monthly_payment(5_000_000_000, &r, 1, 0).is_ok());
}
```

**30,744,573,456,182,586 円**（約 3 京円）が、エラーにならずに答えとして返る。
10 億円の 3,000 万倍である。

賞与側も同じ関数を通る（`bonus.rs:63,75-76` が `monthly_payment` の結果を使い、
`bonus.rs:235` のコメントが「賞与の分も同じ `monthly_payment` の f64 の枝を通る」と言う）
ので、賞与の返済額にも同じ穴が空いている。逆算側（`inverse.rs`）が上限を見ないのは
`grep -rn "MAX_VERIFIED_MONTHLY_YEN" crates/` が `closed_form.rs` の 3 行しか返さないことで確認。

##### 裁定（**コードではなく文言を裁く**）

利用者の 2026-09-13 の裁定により、**コードは正しい**。0% と 1 回払いに上限を掛けないのは
意図した設計であり、`the_exact_paths_are_outside_the_cap` はその番人である。

問われているのは :748-750 の文言だけ。そこにある唯一の限定は
**「どの項目か」**（返済月額・賞与 ⇔ 借入可能額・返済期間）であって、
**「どの計算経路か」**ではない。読者が「年利 0%」または「期間 1 回」で
【返済月額】を求めると、**10 億円を超える答えが普通に返る**——:748 の文が
そのまま破れる。文は項目を限定しきった顔をしているので、読者が「例外はもう無い」と
読むのは自然である。

挑戦者の主張（2 つの厳密経路が上限を迂回する／マニュアルはその限定を欠く）は
**両方とも事実**。:748 に「（年利が 0% より大きく、期間が 2 回以上のとき）」に
相当する限定を足すべきである。

---

#### Item 8 — 残価の計算例 — **正しい**（挑戦者が正しい）

##### マニュアルが実際に言っていること（`docs/manual/detail.ja.md:438-443`）

```
438: 例: 借入額 300 万円・年利 3.9%・期間 5 年（60 回）・残価 120 万円のとき、月額は
439: 37,536 円、最終回は 1,200,000 円、総支払額は 3,414,605 円です。
440:
441: - 最終回は**残価を超えない額**です。同じ条件で残価を 1,200,195 円にすると、
442:   最終回は 1,200,194 円になります（1 円単位の刻みの都合で、ちょうど残価にならない
443:   ことがあるためです）
```

##### 参照実装による再計算

`reference/` で `uv run --no-config python`、`loan_ref.forward(3_000_000, num, den, 60, residual)`
（`rate_fraction('3.9')` → `(39, 12000)`）:

```
rate_fraction(3.9) = (39, 12000)

residual = 1200000
   monthly_payment = 37536
   rows_paid = 60
   total_payment = 3414605
   total_interest = 414605
   final_payment = 1200000

residual = 1200195
   monthly_payment = 37533
   rows_paid = 60
   total_payment = 3414620
   total_interest = 414620
   final_payment = 1200194
```

残価 120 万円の側は :438-439 の 3 つの数（37,536 / 1,200,000 / 3,414,605）と**完全に一致**。
:444-445 の総利息（残価ありで 414,605 円）も一致する。

##### 残価を 1,200,195 円にしたとき、実際に何が変わるか

| 項目 | 残価 1,200,000 | 残価 1,200,195 | マニュアルの扱い |
|---|---|---|---|
| 月額 | 37,536 | **37,533**（−3） | **触れていない** |
| 最終回 | 1,200,000 | 1,200,194 | :442 が正しく書いている |
| 総支払額 | 3,414,605 | **3,414,620**（+15） | **触れていない** |
| 総利息 | 414,605 | **414,620**（+15） | **触れていない** |

##### 裁定

挑戦者の主張（月額 37,536 → 37,533、総額 3,414,605 → 3,414,620 も変わる）は
**数値まで正確**。マニュアル :441-443 は最終回しか述べておらず、**月額と総支払額
（および総利息）の変化を落としている**。:441-443 に書いてあること自体は偽ではない
（最終回は確かに 1,200,194 になる）が、「同じ条件で残価を変えると最終回だけが動く」
という誤った像を残す。残価を上げると分割される元本 `(P − B)` が減るので
月額が下がり、そのぶん利息の付く残高が長く高く残って総額が増える——
**3 つとも動くのが正しい挙動**である。

直すなら :441 を「月額は 37,533 円、最終回は 1,200,194 円、総支払額は 3,414,620 円になります」
の形にする。

---

#### まとめ

| Item | 裁定 | 決め手 |
|---|---|---|
| 1 | **正しい** | 実測: `1000000 → dms=None / plain="1,000,000"`、`999999 → "999999°0'0\""`。閾値は 1e6（`format.rs:136` + `DISPLAY_DIGITS=10`）で、1e10 ではない |
| 2 | **正しい** | `FinancePanel.tsx:590-592` は項目で分岐せず `finance/entry.ts:44` の `MAX_YEN_DIGITS = 20` を通る。`MAX_RATE_LEN` の使用箇所は `FinancePanel.tsx:662` の `pushDot` だけ |
| 4 | **正しい**（文言のみ。コードは裁定どおりで正しい） | `closed_form.rs:92` の上限は `:65` と `:74` の早期 return より後ろにある。`the_exact_paths_are_outside_the_cap` が 30,744,573,456,182,586 を `Ok` として固定している |
| 8 | **正しい** | 参照実装: 残価 1,200,195 で `monthly_payment=37533` / `total_payment=3414620`（120 万円では 37536 / 3414605） |

4 件とも挑戦者が正しく、4 件ともマニュアル側を直す必要がある。
**機械的に決められなかった点は無い。**

##### 注記（裁定の性質の違い）

- Item 2・8 は**文が偽**（打てる桁数が 8 でない／数値が違う）。
- Item 1・4 は**文が字義的には偽でない**が、唯一挙げた数（1e10）または欠けた限定
  （0%・1 回払い）のせいで読者が誤る。直す必要があることに変わりはないが、
  「嘘が書いてある」ではなく「真の境界が書いていない」型である。

##### 後始末

一時ファイル `crates/calcarc-core/tests/zz_dms_probe.rs` は実行後に削除。
`git status --porcelain` は空（出力なし）。

---

## 付録 E: `manual-dispute-coverage.md`

### マニュアル論争の裁定 — 「テストが実際に覆っている範囲」4 件

対象ワークツリー: `/tmp/claude-1000/-home-terapyon-dev-CalcArc/6d3f235a-bf78-4fce-8121-beb0c8c7c3d9/scratchpad/wt-man`（detached `e727a0c`、枝 `docs/manual-0.9.2`）
読み取りのみ。編集・コミットなし。E2E / heavy / wasm-pack / manuals は 1 つも走らせていない。

判定の記号: **正しい**（challenger の指摘が当たり、マニュアルが誤り）／**誤り**（challenger が外れ、マニュアルで問題ない）／**部分的**。

---

#### Item 3 — 上限の表の前置き

##### マニュアルの実際の文

`docs/manual/detail.ja.md:730-731`:

> 各画面には、打てる数の大きさに上限があります。上限に達すると、それ以上は打てません
> （押しても増えません）。

表（`:733-740`）:

| 行 | 上限 |
|---|---|
| Scientific の入力（2 章） | 12 文字 |
| Convert の値（3 章） | 39 桁 |
| Finance の年利（5 章） | 8 文字（100.0000 まで） |
| Finance の期間（5 章） | 1,200（ローンはか月、複利は期。月ごとなら 100 年ぶんです） |
| Finance の金額（5 章） | 20 桁 |
| ローンの【返済月額】と賞与の返済額の答え（5 章） | 10 億円まで |

##### 行ごとの実測（打鍵の上限か、答えの上限か）

| 行 | 種別 | 決め手 |
|---|---|---|
| Scientific 12 文字 | **打鍵** | `crates/calcarc-core/src/engine/state.rs:26` `pub const MAX_ENTRY_LEN: usize = 12;` |
| Convert 39 桁 | **打鍵** | `web/src/convert/entry.ts:44` `const MAX_VALUE_DIGITS = 39;` → `web/src/units/entry.ts:73` `if (tail.text.length >= maxDigits) return entry;`（押しても増えない、そのもの） |
| Finance 年利 8 文字 | **一部だけ打鍵** | `web/src/ui/Finance/FinancePanel.tsx:147` `const MAX_RATE_LEN = 8;` を読むのは `:662` の `pushDot(entryOf(active), MAX_RATE_LEN)` **だけ**。数字は `:591` `pressDigit` → `web/src/finance/entry.ts:44-46` の `pushDigit` で、上限は `MAX_YEN_DIGITS = 20`（`:42`）。**小数点は 8 文字で塞がるが、数字は 8 文字を越えて打てる** |
| Finance 期間 1,200 | **答え（打鍵ではない）** | 下記 |
| Finance 金額 20 桁 | **打鍵** | `web/src/finance/entry.ts:42` `const MAX_YEN_DIGITS = 20;` |
| 返済月額・賞与の 10 億円 | **答え** | `crates/calcarc-core/src/finance/loan/closed_form.rs:92` |

##### 期間 1,200 が打鍵の上限でない証拠

`web/src/ui/Finance/FinancePanel.tsx:94` の `MAX_PERIODS = 1200` を読むのは `domainOf`（`:599-605`）だけで、その戻り値 `max` を使うのは **着地の 2 か所**（`:751`, `:765`）である。打鍵の経路（`:591` `pressDigit`）はこの値を一切見ない。

番人がその意味を字で書いている——`web/src/ui/Finance/FinancePanel.test.tsx:494-508`:

```
it("keeps an out-of-range term from producing an answer", async () => {
    // **上限は打鍵ではなく着地に効く**(設計書 §5)。以前は 4 桁で打ち止めに
    // していたが、単位が入ると `9999年9999` のように**打鍵は短くても合成後が
    // 大きい**形が作れる。いまは打った通りに出したうえで、定義域を超えた値は
    // コアが Overflow にし、答えが出ない
    ...
    await press(["返済期間を入力", "1", "2", "3", "4", "5", "6"]);
    expect(echo()).toHaveTextContent("期間 123456か月");
    expect(main()).toHaveTextContent("Math ERROR");
```

**123456 が打てて、画面にそのまま出る。** 止まるのは答えのほうである。コア側も同じ形——`crates/calcarc-core/src/finance/compound.rs:114` `if periods == 0 || periods > MAX_PERIODS { return Err(CalcError::SyntaxError); }`、`loan/inverse.rs:21` の `MAX_TERM_MONTHS` は逆算の探索打ち切り。

##### 10 億円が答えの上限である証拠

`crates/calcarc-core/src/finance/loan/closed_form.rs:27,92`:

```rust
const MAX_VERIFIED_MONTHLY_YEN: u64 = 1_000_000_000;
...
    if monthly > MAX_VERIFIED_MONTHLY_YEN {
        // 精度を確かめていない答えは出さない(0.9.2 設計書 §5.1。画面は既存の Math ERROR)。
        return Err(CalcError::Overflow);
    }
```

計算して出た `monthly` を見ており、打鍵とは無関係である。

##### 判定: **正しい**（challenger が当たり）

前置きの「上限に達すると、それ以上は打てません（押しても増えません）」は、表 6 行のうち **2 行に当てはまらない**。1,200 は打鍵を止めず（打った 123456 がそのまま表示に出る）、10 億円は答えの側でしか働かない。

補足 2 点:

- **表そのものは無実に近い。** 10 億円の行は見出しに「**の答え**」と書いてあり、`:748-750` の箇条書きも「答えが 10 億円を超えるとエラーになります」と正しい。1,200 も 5 章（`:393`）で「【期間】に入れられるのは 1,200 までです。**それを超えるとエラーになります**」と、実装どおりに書かれている。**誤っているのは前置きの 1 文で、それが表の全行を「打てなくなる」で束ねている**ことである。前置きと 5 章の記述が正面から食い違っている。
- **challenger が挙げていない 3 行目がある。** 「Finance の年利 8 文字」も純粋な打鍵上限ではない（小数点だけが 8 で塞がり、数字は 20 まで通る。上表参照）。前置きの主張はこの行でも厳密には成り立たない。

---

#### Item 5 — 幅の主張

##### マニュアルの実際の文

`docs/manual/detail.ja.md:603-605`（「### 画面の幅」）:

> 画面の崩れを自動で確かめている幅は、Chromium 系のブラウザ（Android の Chrome など）が
> 幅 360px 以上、WebKit（iPhone の Safari と同じ描画エンジン）が幅 375px 以上です。自動検査
> はこのブラウザエンジンの上で動いており、実機の iPhone では確かめていません。それより狭い
> 画面（320px など）でも表示はされますが、崩れないことは確かめていません。

##### 実際に走っているもの

**project は 2 つ、絞り込みは無い。** `web/playwright.config.ts` の `projects` は `mobile`（Chromium、390×844）と `webkit`（WebKit、390×844、`isMobile` も同じ）の 2 つだけで、`testIgnore` / `testMatch` / `grep` は**どちらにも無い**。`testDir: "./tests/e2e"` なので、**両 project が同じ spec 全部を回す**。CI も両方回している——`.github/workflows/ci.yml:220` `playwright test --project mobile`、`:266` `playwright test --project webkit`。

**375 に差し替わるのは 2 か所だけ。** `web/tests/e2e/widths.ts` の `narrowSize()` を呼ぶのは（grep で全 spec を見て）`finance-layout.spec.ts:92` と `:195` の 2 つのみ。分岐の条件は `:84`（`face.name === "compound" && size.width === 360`）と `:187`（`size.width === 360`）で、**どちらも Finance の複利の面**である。`widths.ts` 自身がその範囲を明記している:

> `finance-layout.spec.ts` の 360px の 2 本（複利の説明の行数と、複利の面の
> 余白）は、WebKit では 375px で測る。…**Chromium は 360px のまま**
> …呼んでよいのは上の 2 本だけにする——番人がその数と理由を見る。

**360px の検査は WebKit でもそのまま 360px で走る**（エンジンで分岐しない）:

| 場所 | 何を見るか |
|---|---|
| `viewport-budget.spec.ts:193` `const NARROW = { width: 360, height: 800 }` → `:197` | 11 タブの横あふれ（≤8px） |
| `viewport-budget.spec.ts:221` | キーが 360px でも 44px を保つ |
| `viewport-budget.spec.ts:264` | キーの区画が親より広くない |
| `nav.spec.ts:37,53,67` | タブの折り返し・44px の標的・横あふれ |
| `convert.spec.ts:191` | 換算の面のキーの横あふれ |

**320px は 1 か所だけ、しかもフッタだけ。** 全 spec の `setViewportSize` を grep した結果、320 が出るのは `footer.spec.ts:64` の `for (const width of [430, 390, 375, 360, 320])` のみで、主張は `footer.scrollWidth - window.innerWidth <= 0`（`:72-76`）、つまり**フッタの横あふれだけ**である。`viewport-budget.spec.ts:189-192` が 320 を外した理由を書いている——「7 列 × 44px = 308px は gap と padding を 0 にしても 320px にほぼ隙間が無く、**44px と 7 列は 320px で両立しない**（算数である）」。

ついでに判明した逆向きの事実: `short-screens.spec.ts:95,113` は `SAFARI_VIEWPORTS`（390×664, 390×651, **375**×667, **375**×629）を**両エンジンで**回す。つまり **Chromium も 375 を踏んでおり、`footer.spec.ts` 経由で 320 も踏んでいる**。

##### 判定: **正しい**（challenger が当たり）

challenger の 4 つの事実主張はすべて裏が取れた——(1) spec は両エンジンで走る（config に project 別の絞り込みが無い）、(2) 375 を代入するのは `finance-layout.spec.ts:84,187` の 2 か所だけ、(3) `viewport-budget.spec.ts:193` と `nav.spec.ts:37,53,67` の 360px は WebKit でも走る、(4) 320px は `footer.spec.ts:64` だけ・フッタの溢れだけ。

したがってマニュアルの「WebKit が幅 375px 以上」は**不正確**である。WebKit は 360px でも多数の検査（タブ 3 本・11 タブの横あふれ・44px のキー・区画の幅・Convert の面）を通っている。実態は「**両エンジンとも 360px から。ただし Finance の複利の面の 2 本だけ、WebKit では 375×812 で測る**」であり、エンジンで対応幅が分かれているかのような書き方は事実に合っていない。

なお「320px は崩れないことは確かめていません」も厳密には言い過ぎ側の誤り（フッタだけは 320px で両エンジンが見ている）だが、**盤面については正しい**——44px × 7 列が 320px に入らないのは算数であり、意図的に外してある。

唯一の細かい留保: `pwa.spec.ts:56-63` は spec の中で `browserName === "webkit"` を見て分岐しており、「すべての**検査**が両エンジンで同一」ではない。ただしこれは project の絞り込みではなく、幅とも無関係である。

---

#### Item 6 — 高さの主張

##### マニュアルの実際の文

`docs/manual/detail.ja.md:609-612`（「### 画面の高さ」）:

> 画面が低いと（ブラウザのタブで開いたときなど）、ページがスクロールすることがあります。
> そのときも、すべての表示とキーは、スクロールすれば見えて押せます。1 画面に収まるように
> 自動で確かめているのは、ホーム画面から開いたときの高さで、これも幅と同じく WebKit による
> 自動検査であり、実機の iPhone では確かめていません。

##### 実際に走っているもの

**巡回は 11 画面。** `viewport-budget.spec.ts:55-69` の `TABS` は 11 件:

`#scientific` / `#convert/length` / `#convert/mass` / `#convert/temperature` / `#convert/area` / `#convert/volume` / `#convert/speed` / `#convert/data-size` / `#scale/data-scale` / `#scale/transfer` / `#finance`

spec 自身の冒頭（`:7-9`）:

> **全 route は 13(scientific 1 + convert 8 + scale 3 + finance 1)、
> この巡回が持つのは 11 である。** 外にいるのは `#scale/llm` と
> `#convert/currency` の 2 つだけで、**どちらも理由が下に書いてある**。

**外した 2 つの理由**（`:37-54`「## 残した 2 つ」）:

- `#scale/llm`（`:39-45`）: 「**LLM `#scale/llm` は溢れる。ユーザー裁定で許容**(実験的機能)…**量は 2026-08-27 の実測で 39px**(裁定した日の記録は 33px)」
- `#convert/currency`（`:46-54`）: レートのキャッシュ無しの案内が出た状態で 10px 溢れるため、「どのレート状態で測るのか」を決めていない。「寸法の予算表ではなく為替の検査の話」

**許容値は 0 であって 39 ではない。** 実際の主張は `:96-98`:

```
expect(overflow, `${name} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
```

11 画面には **0px** しか許していない。39px は**外した画面の実測値がコメントに書いてあるだけ**で、どの `expect` にも入っていない。

**高さの検査で、寸法がエンジンで変わるものがある——ただし検査そのものは両エンジンで走る（★ 2026-09-17 訂正）。** `finance-layout.spec.ts:183-196` の「複利の面の余白」は高さの検査（`mainHeight - panelHeight >= 8`）であり、`:187` `const narrow = size.width === 360;` → `:195` `setViewportSize(narrow ? narrowSize(browserName) : size)` で、**同じ test が WebKit では 375×812、Chromium では 360×800** で測る（`widths.ts:58-65` の `narrowSize` は**寸法を返すだけ**で、test をエンジンで限定しない。`WEBKIT_NARROW_HEIGHT = 812`）。**以前ここには「エンジンで分岐する検査がある」と書いていたが、分岐するのは寸法だけである。**

**一方で「1 画面に収まる」の本体は WebKit 固有ではない。** `viewport-budget.spec.ts` は 390×844 を両 project で同じに回す。`short-screens.spec.ts` も「**Chromium と WebKit で同じ検査である**(エンジンで分岐しない)」と冒頭に明記し、Safari の 4 つの viewport を両エンジンで回している。

##### 判定: **部分的**

challenger の当たっている部分:

- 「13 画面のうち 11 で成り立つ」— **当たり**（`viewport-budget.spec.ts:55-69` の 11 件、`:7-9` の「全 route は 13」）。
- 除外は `#scale/llm` と `#convert/currency` — **当たり**（`:37-54`）。引用された行域 `:37-54` も正確。
- LLM の溢れが約 39px — **数字は当たり**（`:41` の実測 39px）。

challenger の外している部分:

- 「LLM は約 39px の溢れを**許されている**」という言い方は不正確。**許容している検査は存在しない**——LLM は巡回から外れており、`expect` の許容は 11 画面に対して 0px である（`:96-98`）。「39px まで緑になる」のではなく「1 度も測っていない」。
- 「**高さの検査に WebKit 固有のものは無い**」は**おおむね真**（★ 2026-09-17 訂正。以前ここには「誤り」と書いていた）。`finance-layout.spec.ts:183-196` の複利の面の余白は高さの検査だが、**test は両エンジンで走る**——WebKit だけ**寸法**が 375×812 に差し替わるだけで（`widths.ts:58-65` の `narrowSize` は寸法を返すだけ）、**WebKit 専用の高さ検査は存在しない**。

マニュアル側の誤りも 1 つある（challenger が指摘していない）: 「これも幅と同じく **WebKit による**自動検査であり」——1 画面に収まるかを見ているのは `viewport-budget.spec.ts` で、これは **Chromium と WebKit の両方**が 390×844 で同じに回している（CI の 2 ジョブ）。WebKit の検査であるかのような書き方は実態と合わない。また「1 画面に収まるように自動で確かめている」は、**13 画面のうち 11 画面**についてのみ真である（LLM と為替は測っていない）。

---

#### Item 7 — 「画面ごとに URL が変わる」

##### マニュアルの実際の文

`docs/manual/quick.ja.md:39`:

> 画面ごとに URL が変わるので、よく使う画面はブックマークできます。

`docs/manual/quick.en.md:64`:

> Each screen has its own URL, so you can bookmark the screens you use often.

直前の文脈（`quick.ja.md:34-35`）:

> 【Convert】と【Scale】では、タブのすぐ下の欄で計算の種類を選びます
> （例: 【為替 Currency】）。

##### route が実際に符号化しているもの

`web/src/route.ts:44-49`:

```ts
const CATEGORIES: Record<ModuleId, readonly string[]> = {
  scientific: [],
  convert: CONVERT_CATEGORIES,
  scale: SCALE_CATEGORIES,
  finance: [],
};
```

`:48` の `finance: []` が決め手——**Finance はカテゴリを 1 つも持たない**。ハッシュは `#finance` の 1 つきりで、6 つの計算の種類は URL に現れない。`routeFromHash`（`:63-74`）が返すのも `{ module, category }` の 2 段だけである。

約束された URL は 13 本（`web/tests/promised-urls.ts`）で、`#finance` はその 1 本。`screen-identity.spec.ts:50-64` の `SCREENS` も同じ 13 件で、Finance は `["#finance", "金融計算 | CalcArc", "金融計算"]` の 1 行のみ。

**6 つのモードは React の state。** `FinancePanel.tsx:611-613` で `setMode(next)` を呼ぶだけで、URL には触れない（保存先は `rememberFinance`、つまり localStorage）。E2E も URL を変えずにモードを切り替えている——`short-screens.spec.ts:78-90` は `#finance` へ 1 度行ってから

```
const modes = page.getByRole("group", { name: "計算の種類" }).getByRole("button");
await expect(modes).toHaveCount(6);
for (let i = 0; i < 6; i++) { await modes.nth(i).click(); ... }
```

と 6 つを押して回る。**6 モードが 1 つの URL を共有していることが、この巡回の前提そのもの**である。

##### 履歴の面

`screen-identity.spec.ts:186-227` の `test("the history screen keeps the <h1> and nests its own <h2> under it")`。冒頭（`:188-190`）:

> **履歴の面は route ではない**(設計書 §8)。`showingHistory` は
> `ScientificPanel` の state で、ハッシュは `#scientific` のままである。

末尾（`:219-226`）はそれを固定している:

> **タイトルは `関数電卓 | CalcArc` のまま**(設計書 §8.1)。履歴の面は
> route ではないので、タブの名前は動かない。**これは穴として認識された
> うえで利用者が承認した挙動**である（直すなら履歴を route にする話に
> なり、それは URL 設計の変更で、この計画の範囲ではない）。
>
> ```
> await expect(page).toHaveTitle("関数電卓 | CalcArc");
> ```

つまり **履歴は画面いっぱいを置き換えるのに URL もタイトルも `#scientific` のまま**であり、リポジトリ自身がこれを「穴」と呼んでいる。

##### 判定: **正しい**（challenger が当たり）

引用された座標は 2 つとも正確（`web/src/route.ts:48` の `finance: []`、`screen-identity.spec.ts:186-227` の履歴のテスト）。「画面ごとに URL が変わる」は無条件には成り立たず、例外が 2 つある:

1. **Finance の 6 つの計算の種類**（返済月額・借入可能額・返済期間・複利残高・必要積立額・必要期間）はすべて `#finance` の 1 本を共有する。ブックマークしても開くのは保存された既定のモードであって、選んでいた種類ではない。
2. **履歴の面**は `#scientific` のままで、URL でもタイトルでも指せない。

マニュアルに酌むべき点はある——`quick.ja.md:34-35` が「種類を選ぶ欄」を **Convert と Scale に限って**説明しており、Finance をその仲間に数えていない。13 の「タブ＋カテゴリ」の画面に限れば URL は 1 対 1 に対応している（`promised-urls.ts` の 13 本）。それでも `:39` の文は無条件で、利用者の目に「画面」と映るもの（履歴の面は表示もキーも全部入れ替わる）に例外があることを伝えていない。**部分的ではなく正しいと採る理由は、例外の一方をリポジトリ自身が「穴」と明記しているからである。**

---

#### 走らせたもの・走らせていないもの

- 読んだだけ: `playwright.config.ts`、`ci.yml`、`tests/e2e/*.spec.ts`、`tests/e2e/widths.ts`、`tests/promised-urls.ts`、`web/src/route.ts`、`web/src/ui/Finance/FinancePanel.tsx(.test.tsx)`、`web/src/{units,finance,convert,datascale}/entry.ts`、`crates/calcarc-core/src/finance/**`、`crates/calcarc-core/src/engine/state.rs`、`docs/manual/{detail.ja.md,quick.ja.md,quick.en.md}`。
- `npx playwright test --list` は**使っていない**（config と spec の字面だけで足りた）。E2E・`pnpm heavy`・`wasm-pack`・`pnpm manuals` は 1 つも実行していない。`uv` は使っていない。
- `/home/terapyon/dev/CalcArc` には触れていない。追跡下のファイルの編集・コミット・push なし。
- 終了時の `git status --porcelain`: 空。
