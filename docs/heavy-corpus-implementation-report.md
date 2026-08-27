# 重量級コーパス拡張の実装報告（spec A / B+C / D+E）

> **2026-08-25 に重量級は `heavy/` へ移った。** 以下に出てくる `web/tests/heavy/`
> などのパスは、**測定した当時のもの**である。当時の事実として残してある。

改善指示書（2026-08-17 受領、全 12 節）に対する 3 本の spec の実装が終わった。
その §12 が求める報告である。**この文書は開発の経緯を含む。** 初見の読み手が
読むのは `heavy/heavy-report.md` のほうで、あちらは走行のたびに自動で書き出され、
経緯を一切持たない（禁止語のテストが見張っている）。

- 基準（BASE）: `b223bde`（= `main`、0.2.1 時点）
- ブランチ: `feature/heavy-power-measure` → `feature/heavy-finance-strata` →
  `feature/heavy-scientific-ui-report`（縦積み 3 本、計 61 コミット）
- 設計書: `docs/superpowers/specs/2026-08-19-heavy-{detection-power,finance-strata,scientific-ui-report}-design.md`
- 実測値の一次資料: `docs/corpus-measurements.md`（Task ごとに追記されている）

**検査の結果と件数は 2026-08-20 のフルスイープの実測である。** 走行中にしか
測れない数（証明書のプローブ数、変異が証明書を落とす件数など）は各 Task の
実測で、出どころを本文に書いた。**計画や起票時の見込みは数字として使って
いない**——食い違った箇所は実測を残して見込みのほうを消してある。

---

## 1. フルスイープ（`ci.yml` と `heavy-corpus.yml` から機械的に起こした一覧）

**計画の一覧は CI が回す検査を 7 件落としていた**（`wasm-pack` の build と test、
`vite build`、`check:sw`、`check:version`、Layer 5 の通常 e2e、`uv sync --locked`、
golden 再生成の byte 一致）。下は workflow の YAML から起こし直したもので、
**手元の検証が CI の検証を覆っている**ことを確かめてある。

| 段 | コマンド | 結果 |
|---|---|---|
| rust | `cargo fmt --check` | 緑 |
| rust | `cargo clippy --workspace --all-targets -- -D warnings` | 緑（警告 0） |
| rust | `cargo test --workspace` | **304 passed** / 0 failed |
| wasm | `wasm-pack build crates/calcarc-wasm --target web --out-dir ../../web/src/wasm` | 緑 |
| wasm | `wasm-pack test --headless --firefox crates/calcarc-wasm` | **28 passed** |
| web | `pnpm typecheck` | 緑 |
| web | `pnpm lint` | 緑（info 2 件、エラー 0） |
| web | `pnpm test`（vitest） | **263 passed** / 23 files |
| web | `pnpm exec vite build` | 緑（precache 10 entries / 594.87 KiB） |
| web | `pnpm check:sw` | 緑 |
| web | `pnpm check:version` | 緑（0.2.1、`Cargo.toml` と `web/package.json` が一致） |
| e2e | `pnpm exec playwright test`（Layer 5） | **132 passed**（12.1 秒） |
| reference | `uv sync --locked --no-config` | 緑 |
| reference | `uv run ruff check .` / `ruff format --check .` | 緑（36 files） |
| reference | `uv run pytest` | **311 passed**（23.67 秒） |
| reference | `generate.py` → `git diff --exit-code testdata/` | **差分なし** |
| heavy | `pytest tests/test_corpus_reproducibility.py -q` | **2 passed**（6.21 秒） |
| heavy | `pnpm heavy:power` | **18/18 ok**（669 秒 = 11.2 分） |
| heavy | `pnpm heavy:ui` | **36 passed**（11.9 分）。押下 19,904 回・打鍵 1,266 件・指摘 0 件 |
| heavy | `pnpm heavy` | **195 passed**（32.4 秒）。33,567 件・不一致 **0** |
| 不変条件 | `git diff --stat b223bde..HEAD -- crates/` | **空**（計算コアは 1 行も動いていない） |

**wasm 境界のブラウザは、ローカルが Firefox で CI が Chrome である。**
手元の Chrome と `wasm-pack` が持つ chromedriver が噛み合わないため、
ローカルは `--firefox`、CI（`ci.yml` の wasm ジョブ）は `--chrome` を固定して
いる。**この 1 行を落とすと「同じものを確かめた」と読まれる。**

### 走らせた順番が結果を変える 1 か所

**`pnpm heavy:ui` を `pnpm heavy` より先に回した。** その結果、最終成果物の
`web/heavy-report.md` の盤面の行は「**盤面を通る走行——通っている。** 最後に
走った `pnpm heavy:ui` は 19904 回キーを押し、1266 件のケースを盤面から打鍵
して、主張が全部通っている。」になった（4 状態のうち `passed`）。 レポートは `pnpm heavy` の
走行末尾で書かれ、**その時点でディスクにある `heavy/heavy-ui-run.json` を読む**。
逆順で回すと、前回の走行の残骸——このスイープの直前にディスクにあったのは
Task 6 の finance 単独走行のもので、読んで確認したところ
`pressedAnything: false` / `ok: false` / `totalPresses: 0` だった——を読んで
「盤面のキーを 1 つも押していない」と書いたレポートが最終成果物になる。
実際、このスイープを始めた時点でディスクにあった `web/heavy-report.md` は、
その文（「盤面を通る走行——キーを 1 つも押していない。」）を持っていた。
**生成物の状態は走行の順番で決まる。**

（`pnpm heavy:ui` の `globalSetup` は走行の頭で古い `heavy-ui-run.json` を
消す。だから「前の走行の記録を読む」事故が起きるのは `pnpm heavy` の側だけで、
**順番以外にこれを直す手が無い**。）

---

## 2. 変更したファイル（`b223bde..HEAD`、50 ファイル）

`crates/` は 1 ファイルも無い。`.superpowers/` は `.gitignore` が丸ごと無視して
いるのでコミットに含まれていない。

| 区分 | ファイル |
|---|---|
| コーパス（生成物） | `corpus/generated/{associativity,entry,errors}-000.json`（新規 3 枚）、`corpus/generated/{corrections,finance}-000.json`（作り直し） |
| 参照実装 | `reference/scripts/generate_corpus.py`、`reference/src/calcarc_reference/{compound_ref,corpus_calls,loan_ref}.py`、`reference/src/calcarc_reference/{corpus_entry,corpus_errors}.py`（新規） |
| 参照実装のテスト | `reference/tests/{test_compound_ref,test_generate_corpus}.py`、`reference/tests/{test_corpus_entry,test_corpus_errors}.py`（新規） |
| 欠陥注入 | `web/scripts/detection-power.mjs` |
| Heavy（コア経路） | `web/tests/heavy/{calls,corpus,display-cases,report}.spec.ts`、`web/tests/heavy/{corpus,report,global-teardown}.ts`、`web/tests/heavy/certificates.ts`（新規） |
| Heavy UI（盤面経路） | `web/tests/heavy-ui/{finance-cases,finance-ui.spec,global-setup,global-teardown,presses,sampling,select}.ts`（新規 7 本）、`web/tests/heavy-ui/corpus-ui.spec.ts` と `web/playwright.heavy-ui.config.ts`（改修） |
| ユニット | `web/tests/unit/{detection-power,detection-power-restore,heavy-ui-finance,heavy-ui-presses,heavy-ui-select}.test.ts`（新規 5 本） |
| 設定 | `web/tsconfig.json`、`web/vite.config.ts`、`.gitignore`、`.github/workflows/heavy-corpus.yml` |
| 文書 | `docs/corpus-measurements.md`、`docs/superpowers/{plans,specs}/2026-08-19-*.md`、この報告書 |

コーパスの規模は **15 枚 30,001 件 → 18 枚 33,567 件**になった。

---

## 3. Finance の変更前後

### 正常 / エラー / Overflow

`corpus/generated/finance-000.json` を読み、`expect` に `error` キーがあるかで
分けて数えた（`b223bde` の版は `git show` で取り出した同じ数え方）。

| | b223bde（2,000 件） | HEAD（3,500 件） |
|---|---:|---:|
| 正常 | 1,431 | **3,139** |
| SyntaxError | 480 | **270** |
| Overflow | 89 | **91** |

**エラーの比率が 28.5% から 10.3% に下がった**のは、エラーを減らしたからでは
なく、**正常を構成で作れるようになった**からである。改善前は逆算 op の入力を
乱択で引いていたため、`loan_term` の 243 件のうち正常が 90 件（37%）しか
無かった。改善後は正算の答から逆算の入力を組み立てる（設計書 B+C §4.4）。
残ったエラー 361 件（`SyntaxError` 270 + `Overflow` 91）のうち **155 件は
名指しの層**である（実測。1 層 1 件で、`corpus_calls.py` が Rust のガード
17 経路から起こした）。残る 206 件は乱択層がたまたま踏んだものである。
**エラーが減ったことと、エラー経路の網羅が薄れたことは別である**——`b223bde`
の版には `stratum` ラベルが無く（`git show` で確認）、名指しは
`FINANCE_BOUNDARIES` の一握りの境界だけで、どのエラー経路を何件踏んだのかを
数える手段そのものが無かった。

### op ごとの正常件数

| op | b223bde: 全 / 正常 | HEAD: 全 / 正常 |
|---|---:|---:|
| `loan_forward` | 273 / 270 | 599 / **560** |
| `loan_principal` | 269 / 269 | 433 / **432** |
| `loan_term` | 243 / 90 | 426 / **407** |
| `loan_bonus_forward` | 226 / 114 | 456 / **301** |
| `loan_bonus_principal` | 251 / 229 | 412 / **391** |
| `compound_grow` | 242 / 130 | 439 / **340** |
| `compound_deposit_for` | 233 / 130 | 420 / **404** |
| `compound_periods_for` | 263 / 199 | 315 / **304** |

**8 op すべてが正常 300 件以上**になった（設計書 B+C の要求は 100 件）。
`loan_term` の正常率は 37.0% → 95.5% である。

### `reference_gave_up`（参照実装が答を出せず捨てた件数）

| 理由 | b223bde | HEAD |
|---|---:|---:|
| `compound_deposit_search_limit`（探索限界） | 10 | **0** |
| `near_yen_boundary`（円境界近接） | 3 | **7** |
| `other`（未分類） | — | **0** |
| 合計 | 13 | 7 |

**`b223bde` の JSON は `reference_gave_up: 13` という 1 つの数しか持っていない**
（`git show` で確認）。左列の 10 / 3 は改善指示書 §5 が当時測って記録した値で、
このスイープで数え直したものではない。**理由を数える手段が無かったこと自体が
B+C Task 1 の出発点である。**

- **探索限界の 10 件は 0 になった。** 種を税引後の目標から作る（B+C Task 2）と、
  必要積立額の探索が 2 歩以内に収まる。二分探索は入れていない——手取りは期数に
  ついて非単調なので使えない。
- **円境界近接は 3 → 7 に増えた。** これは劣化ではない。`_guard_boundary` の
  条件もメッセージも変わっておらず（差分は例外型の付け替えのみ）、乱択層が
  約 3.2 倍に広がったぶん、その棄却を引く回数が増えただけである。設計書 §4.9 は
  この理由を「0 件必須にしない」としている。
- `b223bde` では 13 件が**理由の区別なく**1 つの数だった。理由を型で分け
  （`NearYenBoundaryError` / `DepositSearchLimitError`）、未分類の `ValueError` は
  その場で `RuntimeError` にして黙って捨てられないようにした。

### 層別

**名指しの層が 1,307 件、乱択層が 2,193 件**（実測。`stratum` が `/random` で
終わるかで数えた）。層の種類は **1,187 種**ある。層は `stratum` ラベルとして
JSON に入っており、レポートが `byStratum` として出す。`periods_per_year = 4` は
乱択層に 1 件も無い（実測 0。乱択層の周期は 1 が 278・2 が 278・12 が 263）。

**名指し層の下限合計が総件数を超えたら生成器が `RuntimeError` で落ちる**ことを
テストが固定している（`count = 1306` で落ち、`1307` ちょうどで通る）。

---

## 4. 新しく追加した Scientific 領域

改善指示書 §7.5〜7.7 が名指しした 3 領域が、コーパスに入った。

| シャード | 件数 | 中身 |
|---|---:|---|
| `entry-000.json`（新規） | 36 | **打鍵の途中の表示。** `=` を押す前に画面に何が出ているか。`3` `.` `.` の SyntaxError を含む |
| `errors-000.json`（新規） | 30 | **エラーと境界。** DomainError 17 / DivisionByZero 3 / TrigPole 3 / Overflow 3 / SyntaxError 2。**種別まで突き合わせる** |
| `associativity-000.json`（新規） | 2,000 | **結合方向。** 括弧を打たない平坦なキー列 1,000 本と、同じ木を全括弧で書いた双子 1,000 本の対 |
| `corrections-000.json`（層を追加） | 2,000 | `paren-edit` 790 / `ac-rebuild` 420 / `error-recovery` 418 / `typo-del` 372。**エラー後の復帰と括弧編集中**の 2 形が新規 |

`associativity-000.json` の平坦な側の内訳は `additive` 486 / `multiplicative` 321 /
`combinatorial` 166 / `power` 27 で、`parenthesized` 1,000 がその対照群である。

**改善指示書 §7.7 は、これまで意図して置いていた分離を反転させることを求めて
いた。** `associativity-flip` 変異の期待を「どのシャードも反応しない」から
「`associativity-000.json` が反応する」へ変える変更で、生成器・レポートの項目文・
それを見張るテストの 3 か所を同時に動かさないと、レポートが自分のコーパスに
ついて嘘をつく。3 か所は 1 コミット（`03ecd7d`）で同時に動かした。

---

## 5. 変異ごとの検出件数（18 種、このスイープの実測）

`cd web && pnpm heavy:power`。**18 種すべてが `ok`**——期待したシャードだけが
反応し、どれも最低検出数を上回った。所要 **669 秒（11.2 分）**。

| 変異 | 反応したシャード | 検出件数 |
|---|---|---:|
| `display-digits` | 値 9 枚 + 表示 2 枚（11 枚） | **8,271** |
| `precedence-collapse` | `precedence` 1,099 + `entry` 1 | **1,100** |
| `associativity-flip` | `associativity` | **1,000** |
| `ncr-multiply-first` | `combinatorics` | 10 |
| `eng-exponent-toward-zero` | `display` | 96 |
| `sexagesimal-no-carry` | `display` | 10 |
| `complex-multiply-sign` | `complex` | 147 |
| `polar-angle-flipped` | `complex-display` | 661 |
| `loan-interest-round-not-floor` | `finance` | **2,707** |
| `loan-interest-as-f64` | `finance` | 105 |
| `compound-deposit-at-start` | `finance` | 615 |
| `compound-round-once-at-maturity` | `finance` | 605 |
| `rate-nominal-to-effective` | `finance` | **2,272** |
| `tax-combined-rate` | `finance` | 406 |
| `loan-final-row-no-adjustment` | `finance` | **1,624** |
| `bonus-half-year-becomes-monthly` | `finance` | 368 |
| `periods-for-binary-search` | `finance` | **1** |
| `compound-inverse-ignores-tax-flag` | `finance` | 272 |

`display-digits` の 11 枚の内訳: `angle-mode` 1,017 / `associativity` 332 /
`combinatorics` 1,187 / `complex` 381 / `complex-display` 334 / `display` 415 /
`elementary` 1,210 / `inverse-trig` 732 / `precedence` 978 / `scientific` 796 /
`typed` 889。

**`b223bde` 時点の変異は 8 種で、Finance は 0 種だった。** 10 種を足して 18 種
になり、Finance の 10 種はすべて `finance-000.json` **だけ**を赤くする
（他 17 枚は 1 件も反応しない）。

### 検出数が多いことは検出力が高いことを意味しない

`periods-for-binary-search` の **1 件**は、この表でいちばん重要な数字である。
最初に書いた変異は 152 件を検出していたが、そのうち **151 件は変異の書き方
そのものの欠陥**（`probe(MAX_PERIODS)` を先に呼んで u64 を溢れさせる）が
生んだ人工物で、この変異が確かめたい「手取りの非単調な谷を二分探索が飛び越
える」性質とは無関係だった。**152 件に `minRate` を焼き付けていたら、
非単調層をコーパスから消しても 151 件を検出して緑のままになり、設計書 §5.2 が
まさに防ごうとした壊れ方が開いたまま残っていた。** 変異を engine 自身の流儀
（溢れは「届く側」に倒す）に合わせて直したら 1 件になり、コーパスに実在する
`compound_periods_for/non_monotone_net` 層の件数（1）とちょうど一致した。

### 検出数に載らないものが 1 つある

B+C Task 10 が入れた 4 つの逆算境界証明書（`web/tests/heavy/certificates.ts`、
実測 70,115 プローブ）は `record()` を呼ばないので、証明書が何本落ちても上の
検出件数は 1 も動かない。実測: `tax-combined-rate` の変異で証明書が
**124 プローブ**落ちているのに `detection-power.json` には現れない。
**見逃しではなく過小計上である**——証明書だけが落ちる変異は `verdictFor` の
`playwrightExitCode` の枝で `measurement-failed` になる。レポートはこのことを
本文に書いている。

---

## 6. Heavy run の URL

**この縦積みはまだ push されていないので、この内容に対する CI の走行は存在
しない。** 記録できるのは走らせた人の手元の実測だけである（上の表）。

参考までに、リポジトリ上で最後に成功した Heavy corpus の走行は
<https://github.com/terapyon/CalcArc/actions/runs/32017320950>
（2026-08-17、タグ `v0.2.1`、17 分 4 秒）で、**これは改善前のコーパス
15 枚 30,001 件・変異 8 種の記録**である。この報告の数字とは比較できない。

---

## 7. `heavy-corpus.yml` の段の順番を入れ替えた

**このスイープで見つけて、この報告と同じコミットで直した。**

改善前の段の順番は `heavy:power` → `heavy` → `heavy:ui` → ジョブ要約だった。
レポートを書くのは `heavy` で、その走行末尾に `heavy/heavy-ui-run.json` を読む。
**まっさらな runner にはその記録がまだ無い**ので、ジョブ要約に載るレポートの
盤面の行は**毎回「記録が無い」になる**——D+E Task 10 が入れた 4 状態のうち、
CI では 1 つしか出ない。レポートは嘘をついていない（本当に記録が無い）が、
**CI の記録に盤面の結果が一度も載らない**。

`heavy:ui` を `heavy` の前へ移した。**`heavy:ui` の `if: always()` は残す**
——「前の段が落ちても走らせる。計算が合っているかと盤面から打てるかは別の
問いで、片方の赤でもう片方を隠さない」という理由は順番に依存しない。
**入れ替えた以上、`heavy` にも `if: always()` が要る**：無いと `heavy:ui` の赤が
`heavy` を丸ごと隠し、同じ理由が逆向きに破れる。

`heavy:power` が落ちた走行でも `heavy` が走るようになるが、その場合レポートは
「**測っていない**」と書く（`renderDetectionPower` の `null` の枝）ので、測って
いない走行が測った顔で出ることはない。ジョブは落ちた段のぶん赤のままである。

同じコミットで `report.ts` の 1 行も直した。盤面の走行を「同じワークフローの
**次の段**がそれである」と書いていた——順番を入れ替えた時点で偽になる。
「別の段」にした。**理由は静かに腐る。**

**CJK フォントの追加は行っていない**（ユーザー裁定）。`heavy-ui` は寸法を
一切測っていない（`boundingBox` / `scrollWidth` / `toHaveScreenshot` などが
`web/tests/heavy*/` に 0 件）ので、フォントを入れても px 値は 1 つも変わらない。

---

## 8. 残っている未検証領域・持ち越し

**全部書く。** 緑で終わったことは、これらが解決したことを意味しない。

### 8.1 engine の挙動について未裁定のもの

- **`(29 nCr 4) nCr 2` が `Math ERROR`（`DomainError`）になる。** `C(29,4)` を
  engine が f64 で「割ってから掛ける」順に計算した値は `23751.000000000004`
  で、`nPr`/`nCr`/`n!` 共通の `fract() != 0` の門に弾かれる。**画面には
  `23751` と出るので表示からは見えない。** コーパス側は連鎖の内側を `nPr` に
  限って回避した（入力は削っていない）。**engine 側の是非は未裁定。**
- **期数 0 の複利は画面から観測できない。** 答の行が空で `data-error` も無い。
  `FinancePanel` が `periods > 0` を見てからコアを呼ぶので、コーパスが期待する
  `SyntaxError` が出る機会が無い。コアは正しく撥ねている。**画面の定義域を
  どちらに寄せるかが未裁定。**
- **1,201 か月のローンはコアが答えるのに画面から打てない**（`fin-000172`、
  `rows_paid` 1201）。`MAX_TERM_MONTHS = 1_200` は `loan/inverse.rs` にしか
  無く、**逆算の探索の打ち切り**であって正算の償還表の上限ではない。
  `FinancePanel.tsx` の `MAX_PERIODS = 1200` のコメントは「コアと同じ」と書くが、
  **同じなのは数字だけで掛かる場所が違う**。**未裁定。**

### 8.2 盤面から打てない入力

**3,500 件中 211 件が盤面で表現できない**（残る 3,289 件 = 94.0% は打てる）。
内訳は 150 件が残価つきボーナス案件（残価とボーナスは排他）、31 件がローンの
期間 1,200 か月超、15 件が年利の入口文法（小数 5 桁・負・非数字・100 超）、
9 件が周期 4/13/0 期（盤面は年・半年・月の 3 つしか持たない）、4 件が複利の
期間 1,200 期超、2 件が期数 0。**これは engine の欠陥ではなく盤面の表現力の
話である**が、打てない入力があること自体は残っている。

### 8.3 証明書の穴

- **証明書の失敗が検出数に載らない**（§5 に既述）。過小計上であって見逃し
  ではないが、レポートの検出件数を「壊れた検査の全部」と読んではいけない。
- **証明書への変異の影響は 18 種のうち 2 種しか実測していない。** 未確認の
  うち大きいのは `rate-nominal-to-effective`（検出率 64.91%）と
  `loan-final-row-no-adjustment`（46.40%）。
- **`loan_principal` の縮退 17 件**（`rows_paid < n`）は境界の証明が無いまま、
  値の一致だけが確認されている。`loan_forward` だけでは組めない（答の元本でも
  答 + 1 円でも両側 `SyntaxError`。Python 参照でも同一挙動を確認済み）。
  除外件数はテストが 432 件中 17 件として焼き付けている。
- **`loan_term` に同種の縮退が起きないこと**は、`n` が探索で決まる答である
  ことからの推論であって、総当たりで確かめてはいない（実測 407 件は全通過）。

### 8.4 コーパス・レポートの構造上の持ち越し

- **`errors-000.json` は `areaOfShard` 上 `display` 領域に入る。** エラー経路の
  集計軸と `AREAS` の軸は目的が違うので、枠 1 だけシャード名で選ぶ形にして、
  そのずれをテストで固定した。**シャードの領域そのものは直していない。**
- **設計書の 5 枠に入らないエラー期待値が 1 件ある**（`entry-000.json` の
  `3 . .` の SyntaxError）。6 枠目（`entry-syntax`）を作って収めた。どの枠にも
  入らないものは番兵（`unclassified`）が名前ごと本文に出す。
- **`corrections-000.json` の `stratum` を `corpus.ts` は読んでいない。**
  JSON にはあるが、レポートで層別の内訳を出すには型の拡張が要る。
- **Python 側 `_needs_precedence` の `ac` 対応はいま効いていない**
  （`precedence-000.json` に `ac` が無い）。双子を揃えるためだけに残っている。
- **`AC` はコーパスのキー列に 1 件も現れない**（harness が各ケースの頭で必ず
  押すので、押下の台帳では harness 側にだけ数が立つ）。`corrections-000.json`
  は最後の `ac` 以降だけを残す形に落ち着いたため。
- **`DEL` を含むケースは 33,567 件中 3 件しかない**（すべて `entry-000.json`）。
  必須キー優先のサンプリングで確実に選ばれるようにしたが、**細い糸である
  ことは変わらない**。

### 8.5 0.3.0 の画面に対する heavy-ui の確認（マージ後・タグ前）

**この縦積みが main に入るころ、画面のほうも変わる。** 0.3.0 前半（`U-0`/`S-0`）は
ナビを 4 タブ + カテゴリ `select` に組み替える。**Heavy corpus のワークフローは push
では走らない**（手動とタグのみ。週 1 の cron は 2026-08-25 に外した）ので、
**赤くなるとすれば、タグを打った日である**——製品の欠陥ではなく、
**ハーネスが画面に追いつく**話である。

**実測で切り分けた結果、危ないのは 1 点だけである**（`git show feature/nav-restructure:…`
で 0.3.0 側の現物を読んだ。2026-08-20）:

| 見た点 | 0.3.0 での実物 | 判定 |
|---|---|---|
| `page.goto("/")`（`corpus-ui.spec.ts`・`reachability.spec.ts`） | `routeFromHash` が知らない先頭を `{module:"scientific"}` へ倒す | **生存** |
| 4 タブ | `<a href>`（リンク）。ラベルは `Scientific`/`Convert`/`Scale`/`Finance` | **盤面のボタンとロールが違う。衝突しない** |
| カテゴリ `select` | `CATEGORIES.scientific` は空なので科学計算では出ない | **無関係** |
| `#finance`（`finance-ui.spec.ts`） | `MODULES.finance.href = "#finance"` のまま | **生存** |
| `#data-scale` | **`#scale/data-scale` に変わり、旧ハッシュは互換分岐なしで既定へ落ちる** | heavy-ui は**使っていない**（使うのは `/` と `#finance` だけ）ので無事 |

**残る本物の risk**: heavy-ui は**領域で括らずページ全体から要素を掴む**
（`reachability.spec.ts` の `panel = (page) => page`）。**同じアクセシブルネームを持つ要素が
増えると Playwright の strict mode 違反で落ちる。** これは `git show` では確かめられない
——**マージ後の実物で `pnpm heavy:ui` を 1 回回すまで分からない。**

**タグ運用**: `v*` のタグ打ちが Heavy corpus を起動する。**`v0.3.0` は、この確認を
済ませてから打つこと。** 順序を逆にすると、リリースの記録として残る走行が
ハーネスの画面ずれで赤くなる。

---

### 8.6 まだ踏んでいない領域（レポートが毎回データから書き出すもの）

`web/heavy-report.md` の「まだ踏んでいない、または限定的にしか踏んでいない
領域」の節が、走行の実データから毎回書き出す。手書きの否定ではないので、
踏んだ瞬間に文章も変わる。**この報告書ではその節を写さない**——写した瞬間に
腐るからである。

---

## 9. Finance は実金融機関一致ではなく決定的概算である（再確認）

`docs/numerical-policy.md` §「第 3 の分類」と `docs/base-spec.md` §3 の
非目標が宣言しているとおり、**Finance は実額の機関一致を目標にしない。**
返済額の端数処理・手数料・日割りは金融機関ごとに違い、「どの銀行とも一致する」
計算は存在しない。保証するのは決定性——同じ入力は常に同じ答を返し、方法は
仕様に書かれ、Python の独立実装が検証する。

**このコーパスの 3,500 件も、その決定性を確かめているのであって、実在の
ローン商品との一致を確かめてはいない。** 償還表は厳密整数（u128 中間・u64 円）
で走り、f64 は閉形式の月額決定にだけ使う。逆算 2 種の答は f64 が決めず、
厳密償還表への単調探索が確定する。UI には免責が常設されている。

---

## 10. 3 つの spec の完了条件

### spec A — 検出力の測定（`2026-08-19-heavy-detection-power-design.md` §7）

| | 条件 | 結果 |
|---|---|---|
| ✅ | mutation 実行自体の失敗が成功扱いにならない | `verdictFor` が健全性 4 件（ビルド・`heavy-run.json` の有無・テストが走ったか・シャード完備）を検出より先に見る。`measurement-failed` と `caught-nothing` が別の判定になった |
| ✅ | 期待シャード集合が完全一致で検査される | `sameSet(reacted, expectShards)`。ずれれば `shard-set-mismatch` |
| ✅ | 各変異に最低検出数（率）があり、下回ると赤くなる | 実測率の半分を 3 桁切り捨てで `minRate` に。18 種すべてこのスイープで上回った |
| ✅ | 原状回復が成功・失敗・解析例外のすべてでテストされている | `detection-power-restore.test.ts`。実走でも `crates/` の差分が空に戻ることを確認 |
| ✅ | 変異元不在が明示的に失敗する（テストつき） | `detection-power.test.ts` |
| ✅ | `cargo fmt` / `clippy` / `cargo test --workspace` | §1（304 passed） |
| ✅ | `pnpm typecheck` / `lint` / `test` / `heavy` / `heavy:power` | §1 |

### spec B+C — Finance の層別化と Finance 変異（同 §8）

| | 条件 | 結果 |
|---|---|---|
| ✅ | 正常・異常・Overflow が層として分離されている | `stratum` ラベル。3,139 / 270 / 91 |
| ✅ | 残価 0 ≥ 100、ボーナス 0 ≥ 30 | 実測 100 / 30（下限ちょうど。`build` が `i` を振る層なので件数を増やしても動かない） |
| ✅ | 正の 0.1% 未満と小数 4 桁の金利がコーパスに入る | 実測 `0 < rate < 0.1` が **333 件**、小数 4 桁が **326 件**（`b223bde` は金利が 0.1 刻みだけで両方 0 件） |
| ✅ | `periods_per_year = 4` が乱択正常群から外れる | 実測 0 件 |
| ✅ | 税あり必要積立額の探索限界棄却が 0 件 | 実測 0（§3） |
| ✅ | 逆算証明書が Heavy 対象にも適用される | 4 種・対象 1,530 件・70,115 プローブ。**ただし 17 件は縮退で除外**（§8.3） |
| ✅ | Finance 用 mutation が 10 種追加され、`finance-000.json` だけを赤くする | §5。18 種すべて `ok` |
| ✅ | 非単調ケースが層として存在し、#9 が最低 1 件を検出する | `compound_periods_for/non_monotone_net` は実測 **1 件**（`fin-000265`。前進走査 19 期 / 二分探索 21 期）。`periods-for-binary-search` の検出も **1 件**で一致する |
| ✅ | 層別件数がテストで固定される | 下限合計 1,307 の境界を両側から固定 |
| ✅ | 再生成後、`finance-000.json` 以外に差分が無い | 各 Task で確認。このスイープでも再現性テスト 2 passed |
| ✅ | Rust / reference / web の各検査 | §1 |

### spec D+E — Scientific の残り・Heavy UI・レポート（同 §11）

| | 条件 | 結果 |
|---|---|---|
| ✅ | レポートに既知の矛盾がない | 矛盾を見張るテスト 11 本（`report.spec.ts`）。**Task 9 が公開数字の水増しを 1 件掘り出して直した**——「Python と突き合わせた 28,275 件」は 36 件多く、`entry-000.json`（Python が独立に計算していない）が混ざっていた。いまは 28,239 |
| ✅ | Finance の正常・異常・Overflow 件数が分離表示される | `callBreakdown`（`byOp` / `byStratum` / `gaveUp`） |
| ✅ | 外部参照と自己同値（と仕様書からの写し）が分離表示される | 3 枠: 外部参照 28,239 / 自己同値 5,292 / 仕様書からの写し 36（合計 33,567） |
| ✅ | Rad・複素数・小数・EXP・ENG・DMS・編集・エラー境界が追加される | 編集は `corrections` の 2 形、エラー境界は `errors-000.json` 30 件。他は先行する段階で入っている |
| ✅ | 結合方向変異を最低 1 件以上検出する | `associativity-flip` が 1,000 件。**シャードのちょうど半分**で、括弧つきの対照群 1,000 本は 1 件も動かない |
| ✅ | §8 の 9 キーが実画面で押されたことを測って主張している | 押下の台帳（`presses.ts`）と `globalTeardown` の二層の主張。**「押せる」（`reachability.spec.ts`）と「押した」は別の主張である** |
| ✅ | Finance の各モードが実画面を 1 往復している | 8 面 × 正常 1・異常 1 = 16 件。`missingOps` が「コーパスに在って面が覆っていない op」を毎回数える |
| ✅ | 既存の通常 CI・Heavy・Heavy UI がすべて成功する | §1 |

**未達はない。** ただし §8 の持ち越しは完了条件の外にあり、そのまま残っている。

---

## 11. この 3 spec で繰り返し出た壊れ方

実装中に同じ形の欠陥が何度も出た。記録として残す。

- **テストが何も主張していないことがある。** 除外件数を
  `toBeGreaterThanOrEqual(0)` で見ていた検査は、除外が 17 件から 400 件に
  増えても緑だった。反証可能性の確認（わざと壊して赤を見る）を毎 Task で
  求めるようにした。
- **理由は静かに腐る。** 検査は緑のまま「なぜ」だけが嘘になる。
  `check_against_closed_form` の「1e-30 に取る」という説明は**最初から嘘**
  だった（定数は `10 ** -(PRECISION - 20)` で、`PRECISION` を変えれば
  1e-30 でなくなる）。この報告書と同じコミットで直した `report.ts` の
  「次の段」も同じ形である。
- **緑にするために入力を削らない。** 「壊れているのは engine ではなく報告
  専用ヒューリスティックの前提だ」と正しく突き止めたうえで、入力をプールから
  除く——という誘惑が 2 度出た。**原因が判定側だと分かったなら、直すのは
  判定側。**
- **避けて通っていた入力は、両実装が一度も突き合わせていない入力でもあった。**
  `compound_deposit_for` に `principal=0` かつ `periods=0` を渡すと参照実装が
  `decimal.DivisionByZero` で落ちるので、その組を避けて層が作られていた。
  避けるのではなく参照実装の定義域ガードを直し、コーパスに入れた（`74cd4e0`）。
- **再抽選は標本を偏らせる。** 失敗のたびに周期を引き直すと、受理されやすい
  値（`ppy=12`）に偏る。均等にしたい因子は再抽選ループの外で引く。
