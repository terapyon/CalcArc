# 計画 — 残っている誤差の 3 族を直す（1.2.3）

**設計書（仕様）**: [`specs/2026-10-08-precision-fixes-design.md`](../specs/2026-10-08-precision-fixes-design.md)
（第 2 版 `46e0819`、承認済み）。**計画と設計書が食い違えば、設計書が勝つ。**
**枝**: `feat/precision-fixes`（`46e0819` から）。作業木は scratchpad の `wt-prec`。

## 監視役の順からの変更（実行役の判断）

監視役の順は「§4 の赤の行を先に全部足す → Marks 化 → F2・F3 → F1」。**赤の行を先に全部コミットすると、
Marks 化（挙動を変えない）を赤い表の上でコミットすることになる。** そこで:
- **今も緑の行**（F3 の条件 1 の行・変わらない対照の行）は Task 1（Marks 化）で入れる。
- **赤から緑になる行**は、その直しのタスクの頭で足して赤を撮る（F2・F3 は Task 2、F1 は Task 3）。

## Global Constraints

- **利用者の方針「Rust は慎重に」**（設計書 §8）: 標準的な書き方。**新しい `pub` は `Held.root` の欄と `Root`・`Marks` の型名だけ**
  （欄は private）。**let チェーンを新しく書かない**（`rust-version = "1.87"`。`if let … { if … }` の入れ子か `match`）。
  **依存を足さない。`unwrap`・`expect` を書かない。** **重量級担当の試作（scratchpad の `wt-proto`）を写さない・読まない。**
- **engine_table を先に赤くする。** 赤の印字を報告に残す。
- **変異は一時コミットの上で入れ、戻すときは再編集。** `git checkout -- <file>` を使わない。最終の履歴は緑のコミットだけ。
- **各段で**（前段は `&&` だけ）: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`。
  wasm に触れたら `cargo check -p calcarc-wasm --target wasm32-unknown-unknown --tests`。reference に触れたら
  `uv run --no-config pytest`・`ruff check`・`ruff format --check`・`mypy`（`uv.lock` が動かないこと）。heavy に触れたら `cd heavy && pnpm lint && pnpm typecheck && pnpm test`。
- **`wasm-pack test`・`heavy:power` は手元で回さない**（CI／GitHub）。
- コミットの末尾: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push しない。
- 註と文書は日本語で、まわりの書き方に合わせる。**数は印字からコピーする。**

---

## Task 1: `Marks` に揃える（挙動を変えない）＋今も緑の行

**設計書 §3.1（`Marks`・`Held::settled(value, marks)`・`mark: fn(Held) -> Marks`）・§4（条件 1 の行と対照の行）・§8 を読むこと。**

1. `Marks { exact: Option<Exact>, root: Option<Root> }`（欄は private、`Marks::NONE`）と `Root { c, r }`（欄 private、serde は
   `Exact` と同じ `"num/den"` の文字列）を `engine/exact.rs` に置く。`Held` に `#[serde(default)] pub root: Option<Root>` を足す。
   **この段では `root` は常に `None`**（作る道は Task 3）。
2. 印の関数の戻り値を `Marks` に揃える: `apply_unary` の `mark: fn(Held) -> Marks`、`Held::settled(value, marks)`、
   二項演算と三角関数の印の関数も `Marks` を返す。`exact::dropped` は `Marks::NONE`。
   **既存の 12 の腕は `Marks { exact, root: None }` を返すだけで、規則を 1 つも動かさない。**
3. **`STATE_SCHEMA` はこの段では上げない**（Task 3 で 9 → 10。`Held` に欄が増えるのは Task 3 で中身が入るときに合わせて上げるか、
   この段で上げるかは、`#[serde(default)]` と往復テストの都合で判断して報告する）。
4. engine_table に **§4 の「今も後も同じ」行**を足す: F3（条件 1）`30 + 1 EXP 15 +/− = sin − 0.5 =` → `0`、
   F3 の対照 `90 + 1 EXP 15 +/− = tan` → `Math ERROR`、F2 の対照 `3 ln`・`0.4 ln`、F1 の対照 `667 ÷ 833 = − 334 √ =`・`2 √ − 1 =`。
   値は印字から（設計書 §4 の「今」と一致するか確かめる）。
5. **床が動かないこと**: `engine_table`・`engine_values`（NET・PAREN_NET・SIGN_NET の件数）・spell_differential・engine_robustness・
   golden がすべて同じ数で緑であることを、前後の印字で示す。

## Task 2: F2（1 に近い ln・log）と F3（DEG の分数の角）

**設計書 §1・§2・§4 を読むこと。**

1. **赤を先に**: §4 の F2 の 2 行（`1.000000002 ln`・`1.000000003 log10`）と F3 の 1 行（`40.2 EXP 3 + 948000 − ( 270 ÷ 132000 ) = tan`）を
   engine_table に足し、赤を撮る。
2. **F2**: `fn apply_log(state, base)`（`engine/mod.rs` の private。`apply_trig` と同じ形）。順は §1.1 のとおり
   （先に今の `scientific::ln`／`log10` を呼んで定義域の誤りを今の道で出す → 印 k=0・虚部 0・`1/2 ≤ q ≤ 3/2` なら
   `ln_1p(ratio_to_f64(n − d, d))`、`log10` は `× LOG10_E` → 印は落とす）。`q − 1` は有理数で引く。溢れたら今の f64 の答え。
   **番人**: `1.000000117 ln` の生の値が `ln_1p(117e-9 を正しく丸めた f64)` とビット一致する単体テスト（§1.3）。
   `1 ln` の答えに `(0, k=0)` の印を付けるかは判断して報告する（§1.4 の注記。付けるなら `1 ln + π = sin`（RAD）→ `0` の行も）。
3. **F3**: `exact::turn` の順を「**印が表 → f64 が表 → どちらでもないときだけ畳む**」（§2.1）。畳むのは DEG で印 k=0・分母 ≠ 1 のときだけ。
   `r = n % (360·d)`（切り捨ての剰余）→ `ratio_to_f64(r, d)?.to_radians()` → `Turn::Folded`。`360·d` が溢れたら `None`。
4. **変異**: 畳みを先にする → 条件 1 の行が赤（`-5.551115123e-17`）。F2 の範囲を外す（常に log1p）→ 対照の行か単体が赤になるか確かめて報告。
   F2 を外す → F2 の行が赤。F3 を外す → F3 の行が赤。
5. 段の検査。golden が動かないこと（設計書 §5.5）。

## Task 3: F1（√ の印と ± の書き換え）・STATE_SCHEMA 10

**設計書 §3（3.1〜3.5）・§4 を読むこと。**

1. **赤を先に**: §4 の F1 の 4 行を足して赤を撮る。
2. `√` の印の関数が `root = (1, q)` を作る（§3.2）。`+/−` は `(−c, r)`、`x²` は印 `(c²·r, k=0)`、ほかは落とす。不変: `root` が `Some` なら `exact` は `None`。
   `Held::settled` の丸め直しは root に及ばない。
3. `apply_binop` の `Add`・`Sub` の腕で書き換え（§3.3）: 符号と 2 乗で読み、符号が逆で `A²/4 ≤ B² ≤ 4A²`（有理数で比べる）なら
   `(A² − B²) ÷ (|A| + |B|)` に符号。分子 0 なら `(0, k=0)`。溢れたら今の f64。**分岐の数を最小に**（レビュー役が見る）。
4. `STATE_SCHEMA` 9 → 10（Task 1 で上げていなければ）。wasm の往復テスト（`crates/calcarc-wasm/tests/exact_state.rs` と native 版）に `√` の後の状態を 1 本。
5. **変異**: 書き換えを外す → F1 の行が赤。門を外す → `667 ÷ 833 = − 334 √ =` の対照が動くか確かめて報告。
6. 段の検査（wasm の check を含む）。

## Task 4: 10 桁で比べる網（native のテスト）

**設計書 §5.3 を読むこと。**

1. `crates/calcarc-core/tests/` に、コーパスの値ケースを歩いて「表示 = 期待値を `format_real`（複素は相当の整形）で 10 桁にした文字列」を
   数えるテストを 1 本（`corpus_refused_presses.rs` と同じ読み方）。**一致しない件は名前で列挙した許可リストだけ——`canc-000949` の 1 件**。
   許可リストの件が一致するようになったら赤（名前で見張る）。比べた件数に下限。
2. **変異**: F1・F2・F3 をそれぞれ外す → この網が赤（設計書の見込み 532・223・1 件。実装の数を印字から報告）。
3. 段の検査。

## Task 5: 重量級（コーパスの許容・上書き・変異）

**設計書 §5.1・§5.2・§5.4 を読むこと。** **重量級のコーパスとスクリプトの流儀は `heavy/` と `reference/scripts/generate_corpus.py` の既存の書き方に合わせる。**

1. `corpus/overrides.json` から `typed-001490` を外す（上書き 0 件）。
2. `CANCELLATION_TOLERANCE` を 5e-10 に締め、註を「締めた理由」に書き換える。**シャードを再生成**（生成器の手順は既存のとおり。
   ほかのシャードが動かないこと）。
3. `detection-power.mjs` の `display-digits` の表に `cancellation-000.json (values)` を足し、変異を 3 本（`f1-rationalize-off`・`f2-log1p-off`・
   `f3-degree-fold-off`）足す。**変異の `from` の綴りは実装の実物の行から取る。床は置かない**——`heavy:power` を GitHub で回してから置く
   （手元では回さない）。床を置かないことで既存の検査が落ちるなら、どう扱うかを止まって報告する。
4. 段の検査: `cd heavy && pnpm heavy`（コーパス）、`pnpm lint && pnpm typecheck && pnpm test`、reference の 4 段。

## Task 6: 文書と版上げ

**設計書 §7 を読むこと。**

1. numerical-policy（F2 の範囲・F3 の順・F1 の書き換えの範囲・直せない 1 件・`CANCELLATION_TOLERANCE` の註）。
2. CHANGELOG `## 1.2.3 — 未リリース`（3 行。数は印字から）。マニュアル 3 冊を点検し、要らなければ理由を CHANGELOG に。「印」という語は使わない。
3. **版を 1.2.3 に上げる**（6 か所）。CHANGELOG の日付は「未リリース」のまま。`check-version`（`--tag` なし）・manual の番人・citations。
