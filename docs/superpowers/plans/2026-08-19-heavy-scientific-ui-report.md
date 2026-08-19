# 実装計画 — Heavy corpus 改善 D+E（Scientific の残り・Heavy UI・レポート）

設計書: [`docs/superpowers/specs/2026-08-19-heavy-scientific-ui-report-design.md`](../specs/2026-08-19-heavy-scientific-ui-report-design.md)

**A（`feature/heavy-power-measure`）と B+C（`feature/heavy-finance-strata`）の上に積む。**
§8.2 の Finance 内訳は B+C の `stratum` を読み、§7.7 の期待反転は A の判定の枠組みに載る。
B+C 完了時点の実測を出発点にする: `finance-000.json` は **3,500 件**、
コーパス全体は 16 枚目を足す前で **31,501 件**、`pnpm heavy` は **162 passed / 26.5 秒**。

## この計画の並べ方

**新しいシャードを作る側（D）を先に、レポートが読む側（E）を後に**並べた。
E はコーパスの実物が無いと「0 件のときの見た目」しか書けない。

**コーパスは、生成器の出力が変わった Task ごとに再生成する。** B+C の途中で
決めた運用をそのまま引き継ぐ（再現性ゲートを何 Task も赤にしない）。**実測 6.1 秒**
（2026-08-20、15 枚 31,501 件、`uv run` の起動込みの壁時計）。

**長い走行が 3 つある。** `heavy:ui` が 10.6 分 × 2 回（Task 5 で必須キーの
現状実測と、サンプリング変更後の確認）、`heavy:power` が 18 変異で **実測 9.2 分**
（B+C Task 11 で 3 回走らせた実測 558s / 552s / 551s）。走らせる前に必ず
一時コミットを打つ。

## 守ること（各 Task 共通）

- **`crates/` を変更しない。** 完了条件が「差分が空」である。
- **`uv` は `uv run` だけ。** `uv lock` / `uv sync` を実行しない。`uv run` は
  `reference/uv.lock` を書き換えるので、検証のたびに `git checkout --` で戻す。
- **`entry-000.json` を「外部参照」と呼ばない。** あれは `engine_table.rs` から
  起こした期待値で、Python が独立に出したものではない（設計書 §4.1）。
  混ぜるとレポートが検証の強さについて嘘をつく。
- **許容誤差をテストに書かない。**

---

### Task 1: 入力途中の表示（`entry-000.json`）

**Files:** `reference/src/calcarc_reference/corpus_entry.py`（新規）、
`reference/scripts/generate_corpus.py`、`reference/tests/test_corpus_entry.py`（新規）、
`corpus/generated/entry-000.json`（新規）

- [ ] **Step 1: 規則を `engine_table.rs` から読む**

打鍵中の表示に数学的な定義は無い。規則を持っているのは `engine_table.rs` だけ
（CLAUDE.md が「電卓の挙動の仕様書」と定めている）。**推測で書かない。**
先頭 `0`・`00`・`0.`、小数点の 2 つ目（`:69`）、`MAX_ENTRY_LEN`（`state.rs:17`）、
`EXP` の書式、演算子直後、括弧を開いた直後、`+/-` の途中適用。

- [ ] **Step 2: 生成器を書く。`kind: "display"`、キー列は `eq` で終わらない**

- [ ] **Step 3: 表から起こしたことをファイル自身に書く**

`generated_by` か同等の場所に「`engine_table.rs` から起こした」を残す。
**レポートが第 3 の枠に入れる根拠がここになる。**

- [ ] **Step 4: 形ごとに 1 件以上あることをテストで固定する**

- [ ] **Step 5: 再生成 → `entry-000.json` だけが増え、既存 15 枚が変わらないこと**

- [ ] **Step 6: `pnpm heavy` で照合が通ること**（`display-cases.spec.ts` が読む）

---

### Task 2: エラー種別（`errors-000.json`）

**Files:** `reference/src/calcarc_reference/corpus_errors.py`（新規）、
`reference/scripts/generate_corpus.py`、`web/tests/heavy/corpus.ts`、
`web/tests/heavy/display-cases.spec.ts`、`corpus/generated/errors-000.json`（新規）

- [ ] **Step 1: 期待値を数学の定義域から決める。Rust を見ない**

設計書 §5.1 の 9 経路。**`CalcError` の種別名は公開契約なので共有してよいが、
どの式がどの種別になるかは数学から決める。**一致しなければどちらかが誤り——
それが二経路検証の意味である。

- [ ] **Step 2: `DisplayCase.expect` に `error` を足し、照合を 1 段深くする**

`ERROR_TEXT` は全件 `"Math ERROR"` なので、**主張の中身は種別のほうである。**
表示だけ見る照合のままだと、種別が全部入れ替わっても緑になる。

- [ ] **Step 3: 赤確認 — 1 件の種別をわざと変えたら落ちるか**

- [ ] **Step 4: 種別ごとに 1 件以上あることをテストで固定する**

- [ ] **Step 5: 再生成・`pnpm heavy`**

---

### Task 3: エラー後の復帰と括弧編集中（`corrections` に 2 形）

**Files:** `reference/scripts/generate_corpus.py`、`reference/tests/`、
`corpus/generated/corrections-000.json`（再生成）

- [ ] **Step 1: 2 形を足す**

`[エラー列, ac, 正しい列] ≡ [正しい列]`（**エラー中の他キーが無視されることまで
含む**）と `[a, add, lparen, b, del, c, rparen, eq] ≡ [a, add, lparen, c, rparen, eq]`。

- [ ] **Step 2: 層として数える**（B+C の `stratum` の考え方をここにも）

- [ ] **Step 3: 新形が 1 件以上あることをテストで固定する**

- [ ] **Step 4: 再生成 → `corrections-000.json` だけが変わること**

---

### Task 4: 結合方向（`associativity-000.json` + 3 か所同時）

**この Task は 1 コミットにまとめる。** 片方だけ動かすとレポートが自分の走行に
ついて矛盾する——指示書 §3 が指摘したのと同じ壊れ方に戻る。

- [ ] **Step 1: 先に赤を見る（順序が肝）**

シャードを入れる**前**に `associativity-flip` の `expectShards` を反転し、
`heavy:power` を回して**測定失敗で赤くなる**ことを確かめる（A の判定 4 が
「期待シャードが読み込まれていない」を見る）。順序が逆だと静かに緑になりうる。
**走行前に一時コミット。**

- [ ] **Step 2: シャードを作る。括弧つきを対照群として同じシャードに入れる**

変異がシャード内の**一部だけ**を赤くすることになり、無差別に壊しているのでは
ないことが言える。

- [ ] **Step 3: 3 か所を同時に動かす**

`detection-power.mjs` の期待反転（`minRate` は実測から）、`report.ts:1407` と
`:1463` 付近の文言、`report.spec.ts` の「踏んでいないと言い続ける」テストの反転。

- [ ] **Step 4: `heavy:power` で実測（約 10 分。事前申告）**

---

### Task 5: 押下キーを数える（Heavy UI）

**Files:** `web/tests/heavy-ui/corpus-ui.spec.ts`、
`web/tests/heavy-ui/global-teardown.ts`（新規）、`web/playwright.heavy-ui.config.ts`

- [ ] **Step 1: サンプリングを変える前に実測する（10.6 分。事前申告）**

**指示書の 9 キーのうち何個が現状で押されていないかは、まだ誰も知らない。**
記録だけ先に入れて 1 回走らせ、実測を `docs/corpus-measurements.md` に書く。

- [ ] **Step 2: `globalTeardown` を新設し、9 キーの全押下を主張する**

**主張を別のテストファイルに置かない。** ファイルの実行順に依存すると
「記録より先に検査が走って空を見る」事故が起きる。`writeReport` が
`globalTeardown` に居るのと同じ理由。

- [ ] **Step 3: 必須キー優先サンプリングにする**

`spread` は等間隔に選ぶだけで、必須キーを含むケースが 1 件も選ばれないことが
ありうる。**先に必須キーを含むケースを各 1 件確保してから、残りを等間隔で埋める。**

- [ ] **Step 4: `heavy-ui-run.json` を書く**（押下トークンと走行の成否。E が読む）

- [ ] **Step 5: もう一度走らせて緑を確かめる（10.6 分。事前申告）**

- [ ] **Step 6: 赤確認 — 必須キーを 1 つ外したら teardown が落ちるか**

---

### Task 6: Finance を実画面から通す

**Files:** `web/tests/heavy-ui/finance-ui.spec.ts`（新規）

- [ ] **Step 1: 8 面 × 正常 1・異常 1 = 16 件**

面は 6 モード + ボーナスを使う `payment` / `principal` の 2 面。

- [ ] **Step 2: ケースはコーパスの層から引く**

**手で書いた入力をここで作らない**——手書きの期待値が「コーパスを通した」顔を
するのを避ける。B+C の `stratum` で選ぶ。

- [ ] **Step 3: 駆動は既存 e2e を再利用する**

- [ ] **Step 4: 異常系は画面に出るエラー表示を見る**

`data-testid="finance-load-error"` は **wasm 読み込み失敗の枠**であって計算の
エラーではない。実物を確認して確定する。

- [ ] **Step 5: 増分を実測して記録する**（見込み 1 分未満。Finance は打鍵ではなく
      欄入力なので 1 件あたりの費用が科学計算と違う）

---

### Task 7: レポート — エラー経路を 5 つに分ける（§8.1）

- [ ] 5 枠（Scientific 定義域 / Finance SyntaxError / Finance Overflow /
      Data Scale 入力 / **走行そのものの失敗**）
- [ ] **「エラー経路はテストしていない」の一括表示を消す。**各枠が 0 件のときだけ
      その枠について未検証と書く
- [ ] 0 件の枠と非 0 の枠が同時に出る走行をテストで作る

---

### Task 8: レポート — Finance の内訳（§8.2）

- [ ] `ShardSummary` に `callBreakdown`（`byOp` / `byStratum` / `gaveUp`）
- [ ] `calls.spec.ts` が記録し、`report.ts` が出す。**`rejections` は JSON が
      持っているのでレポートは読むだけ**
- [ ] **「Finance 3,500 件」を、すべて正常な金融計算であるかのように書かない。**
      実測の内訳は正常 3,139 / SyntaxError 270 / Overflow 91
- [ ] **逆算証明書の位置づけを書く（B+C からの持ち越し）。** B+C Task 10 が入れた
      4 つの境界証明書（`web/tests/heavy/certificates.ts`、70,115 プローブ）は
      `record()` を呼ばないので、その失敗は `mismatchesByShard` にも
      `detection-power.json` にも現れない。実測: `tax-combined-rate` の変異で
      証明書が 124 プローブ落ちているのに検出数には 1 件も乗らない。
      **見逃しではなく過小計上である**——証明書だけが落ちる変異は
      `verdictFor` の `playwrightExitCode` の枝で `measurement-failed` になる。
      レポートが検出数を「コーパスが見つけた件数」として出す以上、
      **証明書はそこに含まれないことを書く**（含まれると読ませない）

---

### Task 9: レポート — 検証の強さを 3 つに分ける（§8.3）

- [ ] 外部参照 / 自己同値 / **仕様書からの写し**
- [ ] `entry-000.json` が 3 枠目に入ること、**1 枠目に混ざっていないこと**を
      テストで固定する（混ぜるのがレポートが一番静かに嘘をつく道である）

---

### Task 10: レポート — 矛盾を見張る（§8.4）

- [ ] 6 状態を個別にテスト
- [ ] **3 の「未実行」が肝。** `heavy-ui-run.json` が無い＝走っていない、
      在って失敗、在って成功の 3 状態を区別する。**2 枚とも無い走行では
      両方を未実行と書く**

---

### Task 11: 縦積み末尾のフルスイープと実装報告

- [ ] `cargo fmt --check` / `clippy` / `cargo test --workspace`
- [ ] `cd reference && uv run ruff check . && ruff format --check . && pytest`
- [ ] `cd web && pnpm typecheck && lint && test && heavy && heavy:power && heavy:ui`
- [ ] `git diff --stat b223bde..HEAD -- crates/` が空
- [ ] 実装報告を `docs/` に書く（指示書 §12。**`heavy-report.md` には書かない**）
- [ ] 3 つの spec の完了条件を全部チェックする
