# 計画 — 打った数と π を厳密に持つ（1.2.3）

**設計書（仕様）**: [`specs/2026-10-06-exact-pi-decimal-design.md`](../specs/2026-10-06-exact-pi-decimal-design.md)
（`d74e371`、承認済み・裁定済み）。**計画と設計書が食い違えば、設計書が勝つ。**

**枝**: `feat/exact-pi-decimal`（`origin/main` = `afa9991` の上）。作業木は scratchpad の `wt-exact`。
**分担**: T3（重量級の「RAD × π の倍数」の層）は**重量級担当**。この計画は T0〜T2・T4・T5・T6。

## 設計書 §10 からの順番の変更（実行役の判断）

設計書は T0（engine_table の行を足して赤）→ T1 → T2 の順だが、**T0 の行は T2 が入るまで赤い**——
T1 を赤い表の上でコミットすることになる（コミットの前に 3 つを揃える規律に反する）。**T1 を先に（挙動を変えない配管）、
T0 の行は T2 の頭で赤くしてから表を入れる。** 「engine_table を先に赤くする」は T2 の中で守られる。

## Global Constraints

- **engine_table を先に赤くする**（設計書 §9 の表。赤の印字をコミットか報告に残す）。
- **変異は一時コミットの上で入れ、戻すときは再編集**。`git checkout -- <file>` を使わない。最終の履歴は緑のコミットだけ。
- **コミットの前に揃える**（前段は `&&` だけ）: `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`。
  wasm に触れたら `cargo check -p calcarc-wasm --target wasm32-unknown-unknown --tests` も。web に触れたら `cd web && pnpm test && pnpm lint && pnpm typecheck`。
  **`cargo test --workspace` を毎回回す**（1.2.1 の教訓: `-p calcarc-core` だけでは wasm の crate の番人が枝の最後まで見えなかった）。
- **`calcarc-core` は panic しない。許容誤差をテストに書かない。計算は core に置く。WASM 境界は例外を投げない。**
- **`wasm-pack test` は手元で回さない**（CI）。手元では `cargo check … --tests` まで。
- **版数は上げない。** CHANGELOG は `## 1.2.3 — 未リリース` の節。
- コミットメッセージの末尾: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push しない。
- 註と文書は日本語で、まわりの書き方に合わせる。**数は印字からコピーする。**
- **レビュー役の注記 2 つ**（設計書 §4.2・§4.3 に書いてある）: (1) 表の答え 0・±1/2・±1 に k=0 の印を付けるのは引数の虚部が 0 のときだけ（ただし表の sin x が 0 なら複素でも `(0, k=0)`）。(2) RAD の k=1 の極の判定は `im == 0` に限る。

---

## Task 1: `Exact` と `Held`、印の入口と伝わり方（T1。挙動を変えない）

**設計書 §3（3.1〜3.4）・§6・§11.2 の未決 6 を読むこと。**

1. `Exact { q: Rational, pi: bool }` と `Held { value: Value, exact: Option<Exact> }`（`Copy`）を engine に置く。
   `EngineState` の `current`・`operands`・`ReplaceBase`・`ClosedGroup` を `Held` に替える。`.re` の読みは `.value.re` に（機械的）。
2. 入口（§3.3 の表の全行）と伝わり方（§3.4 の表の全行。0 は k に中立、`(0, k=1)` は `(0, k=0)` に正規化、
   i128 の溢れは印を捨てるだけ、複素の積・商・関数は落とす）。**印の規則はキーで分岐して書く**（`apply_unary` の閉包に入れない）。
3. **`re` の計算は 1 ビットも変えない**——この段の後、既存のテストはすべて緑のまま（engine_table・engine_values・golden・
   spell_differential・engine_robustness）。**印の単体テスト**を足す（入口ごと・演算ごと・0 の中立・正規化・溢れ・DEL や押し直しや
   閉じた組の開き直しで印が戻ること）。
4. **WASM**: i128 は文字列 `"num/den"` で渡す（`#[serde(with = …)]`、§6.1）。`STATE_SCHEMA` を 8 → 9（§6.3）。
   **wasm の往復テスト**（§6.4: 印つきの状態が `to_js_value` → `from_value` で戻る、`reduce_key` を通して表示がリセットされない）を
   `crates/calcarc-wasm/tests/` に足す。
5. 段の検査: Global Constraints のコミット前の 3 つ。

## Task 2: engine_table を赤く → 三角関数の表（T0＋T2）

**設計書 §4（4.1〜4.4）・§9・レビュー役の注記 2 つを読むこと。**

1. **engine_table に §9 の「段階 1 の行」「変わらないことを留める行」「印が状態の操作を越えることの行」をすべて足し、赤を撮る**
   （段階 2 の行は Task 3 で足す）。「今」の列が設計書と一致することも印字で確かめる（`afa9991` と同じはず）。
2. 表（§4.1・§4.2）: 16 の位置、RAD の k=1（`r = q mod 2`）、DEG の k=0（`r = q mod 360`）と印なしの f64 の 30/45 倍、
   RAD の k=0 は q = 0 のときだけ。√ の定数 4 つと tan の定数（§4.2 の値をそのまま）。tan を表から返す（商にしない）。
   表に載らない k=1 の角は `r` を `(−1, 1]` に畳んでから `f64(r) × π`。
3. 極（§4.3）: RAD の k=1 で `r = 1/2` か `3/2`、**`im == 0` に限る** → `TrigPole`。DEG の `is_tan_pole` は変えない。
   印のある DEG は印の剰余で同じ判定。
4. 複素（§4.4）: 複素の公式の `sin x`・`cos x` を同じ表から、`re` の印で引く。**注記 1** のとおりに印を付ける。
5. 今の `quadrant_exact`・`to_rad` の註と、`radian_mode_keeps_the_answer_for_the_f64_pi` などの単体テストを新しい規則に合わせて書き換える
   （1.0.0 の「RAD は触らない」は、設計書 §7.2 の文案の理屈に替わる）。
6. **変異で赤を確かめる**（少なくとも: RAD の k=1 で表を引かない → engine_table が赤／注記 1 の条件を外す → 複素の行が赤／
   注記 2 の `im == 0` を外す → 複素の極の行が赤（行が無ければ足す）／DEG の 30・45 を外す → `30 sin − 0.5 =` が赤）。
7. 段の検査: コミット前の 3 つ。**golden（`testdata/scientific.json`）が動かないこと**（設計書 §8.1 の見込み）を確かめる。
   動いたら止まって報告する。

**→ Task 2 が緑で閉じたら中間報告（段階 1 の終わり）。core を T3 が使える形になったことを監視役に知らせる。**

## Task 3: 段階 2——四則を十進で厳密に（T5）

**設計書 §5・§8.2・§11.2 の未決 2 を読むこと。**

1. engine_table に §9 の「段階 2 の行」を足して赤を撮る（`4548399.395 − 4548399.394 =` → `0.001`、`0.1 + 0.2 = − 0.3 =` → `0`）。
2. 「i128 の分数 → 正しく丸めた f64」の関数（§5.3。分子・分母が 2^53 以下なら除算 1 回、それより大きいときは u128 の長除算で
   54 ビット＋sticky）。**panic しない**。
3. k=0 の印がある値の `re` を、印を正しく丸めた f64 に置き換える（k=1 は変えない）。
4. golden（§8.2）: `reference/` に生成器を足す（`float(Fraction(num, den))`、`独立: 別手順`）、`independence.py` の範囲の表に行を足す、
   `testdata/` に JSON、Rust の読み手。境界の行（2^53 の前後・非正規化数・偶数への丸めの同点）。
   **`uv` は `--no-config` を付ける**（CLAUDE.md の罠）。`ruff check` と `ruff format --check` と `mypy` を回す。
5. 既存の網（`engine_values.rs`）の件数が動いたら、理由を印字から書く。
6. 変異: 正しく丸める関数の丸め方向を壊す → golden が赤。`re` の置き換えを外す → 段階 2 の行が赤。
7. 段の検査: コミット前の 3 つ＋reference の 4 段。

## Task 4: 数値の規則・マニュアル 3 冊・CHANGELOG（T4）

**設計書 §7（7.1 は「段階 2 まで」の文案を使う）・§11.1 の未決 7・8 を読むこと。**

1. `docs/numerical-policy.md`: §7.1（段階 2 まで）・§7.2 の文案、i128 の溢れの段差（未決 7）、RAD の tan の極の既知の制約の書き換え。
2. マニュアル 3 冊（§7.3）: 数値の例は**実物の印字から**。「印」という語を使わない（未決 8 の文の形）。
3. `CHANGELOG.md` に `## 1.2.3 — 未リリース`（前例の形）。利用者向けの言葉で。
4. 段の検査: `cd web && pnpm check:version && pnpm check:manual-freshness && pnpm check:manual-limits && pnpm check:citations`。

## Task 5: 重量級で段階 2 の動きを測る（T6）

1. `cd heavy && pnpm install --frozen-lockfile && pnpm heavy` を回し、`cancellation`・`equivalence` を含む全シャードの結果を報告する
   （設計書 §5.2: near_subtraction の 527 件が「違う → 合う」、合っていたものが外れるのは 0 件、の見込みを実測で当てる）。
2. **上書き（`corpus/overrides.json`）が要らなくなった件が在れば**、`corpus.spec.ts` が何と言うかを印字で報告する。
   **重量級の検査・上書き・報告書を書き換える判断は重量級担当のもの**——ここでは測って報告するだけにする（書き換えが要るなら止まる）。
