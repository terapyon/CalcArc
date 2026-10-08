# Rust の見直しの宿題（2026-10-06）

**出どころ**: 監視役（calcarc-cd）の Rust の見直し（2026-10-06）と、1.2.2 の実装で保留にした Minor。
**このうち 1 件は 1.2.2 で直した**: `scientific/mod.rs` の `HALF_SQRT2` を `std::f64::consts::FRAC_1_SQRT_2` にし、
`#[allow(clippy::approx_constant)]` を外した（利用者の裁定 10-06）。**残りは次回以降の宿題**として、ここに置く。

**行番号は 2026-10-06、`rel/1.2.2` の先端で当て直した座標**である。着手するときに grep で当て直すこと。

---

## 1. MSRV と let チェーン

- **`Cargo.toml` の `rust-version = "1.87"`**（`6a6edef`、2026-08-12「Declare the floor the code already stands on」）に対して、
  **let チェーン（`if … && let …`。Rust 1.88 で安定化）を 5 行で使っている**:

  | 場所 | 入った時期 |
  |---|---|
  | `crates/calcarc-core/src/engine/exact.rs:353`（`&& let Some(table) = Turn::table(r * (12 / d))`） | 1.2.2 |
  | `crates/calcarc-core/src/scientific/mod.rs:291-292`（`&& let Some(Turn::Table(t)) = turn` と `&& let Some(row) = table_row(t)` の 1 つの連なり） | 1.2.2 |
  | `crates/calcarc-core/src/engine/mod.rs:433`（`&& let Some(&operand) = state.operands.last()`） | 前から（`a160bf6`、2026-09-13） |
  | `crates/calcarc-core/tests/engine_values.rs:356`（`&& let Err(e) = eval(…)`） | 前から（`56b5171`、2026-09-17） |

  **宣言した床（1.87）では、この 4 か所はコンパイルできないはずである**（let チェーンの安定化は 1.88。**1.87 での実測はしていない**）。 手元も CI も最新の stable で回しているので、誰も気づかない。
- **なぜ見えないか**: `rust-toolchain.toml` は `channel = "stable"`、CI（`ci.yml` と `setup-wasm-pack`）も
  `dtolnay/rust-toolchain` の `toolchain: stable`（action 自体は SHA で固定、中身の版は「その日の stable」）。
  **`rust-version` を読む段がどこにも無い**——宣言は番人を持たない規律になっている。
- **直し方の候補**: `rust-version` を **`1.88`** に上げる（コードがすでに立っている床に宣言を合わせる。`6a6edef` と同じ考え方）。
  let チェーンを書き直して 1.87 に留める案もあるが、4 か所を `if let { if … }` に崩すだけで得るものが無い。
- **edition は既に 2024 なので、let チェーンのためには `rust-version` を 1.88 に上げるだけで足りる**（`Cargo.toml` の `edition = "2024"`。レビュー役の注記、2026-10-07）。
- **番人の候補**: CI に **MSRV でのビルドを 1 段**足す（`cargo +1.88 check --workspace --all-targets`、
  `dtolnay/rust-toolchain` に `toolchain: 1.88`）。**宣言を上げただけでは、次の let チェーン級の機能が入っても赤くならない。**
- **クールダウン（道具の版はリリースから 2 週間、CLAUDE.md）**: Rust 1.88 は 2025-06 のリリースで、**とうに過ぎている**。
  上げるのは「新しい道具を入れる」ではなく「宣言を実態に合わせる」なので、クールダウンの趣旨にも当たらない。
  **MSRV の段に使う 1.88 の toolchain を CI に新しく足すこと**は道具の追加なので、版は厳密に綴る（`1.88.0`。CLAUDE.md「範囲で書かない」）。

## 2. 公開の面（`pub` のまま、クレートの外から見える）

- **`engine::exact`**: `add`・`sub`・`mul`・`div`・`neg`・`sqr`・`recip`・`dropped`・`turn`・`sin`・`cos`・`tan`・`of_buffer`
  （`exact.rs:151-416`）。
- **`scientific`**: `Turn`（`:84`）・`Position`（`:116`）・`Entry`（`:139`）・`Row`（`:158`）・`table_row`（`:179`）・
  `turn_of`（`:213`）・`sin_at`（`:252`）・`cos_at`（`:263`）・`tan_at`（`:289`）。
- **wasm（`crates/calcarc-wasm/src`）はどれも使っていない**（grep で 0 件）。
- **候補**: `pub(crate)` にする。**ただしクレート全体がモジュールを `pub mod` で開く流儀**（`lib.rs:7-11`、`engine/mod.rs:1-5`）
  なので、**この 2 つだけ閉じると流儀が割れる**。やるなら「core の公開の面をどこまでにするか」を全体の方針として決めてから。
  `Position` は既に中身を private にしてある（外から表の位置を作れない。1.2.2 の Task 2 の審査）。

## 3. 細かい点

- `exact.rs:176` の `decimal("1")?` は `Rational::ONE` で書ける（1.2.2 の Task 1 で `Rational` に `ONE` を足した）。
- `exact.rs:312` の `dropped(_: Held) -> Option<Exact>` は、`apply_unary` の印の引数の形を揃えるためだけの関数（常に `None`）。
  閉包 `|_| None` で足りるが、**キーごとに印の規則を並べて読める**利点もあるので、直すかは好み。

## 4. 1.2.2 の作業で保留にした Minor（実行役の報告から）

- **`÷` と `1/x` が読み直しの網（`engine_values.rs` の `SIGN_NET`）に入っていない**。`^`・`÷` の右の `1/…` の包み
  （`2 ^ (1/2)`）は `spell_table` の行だけが見張っている。網に足すなら、読み手（慣例の優先順位）に `÷` と `/` を足す。
- **`web/src/ui/History/History.tsx:100-101`** の古い綴りの引用（`90 sin 0.8939966636 Rad`、`3 sin …`）に「当時の綴り」の印が無い。
- **`crates/calcarc-wasm/tests/label_parity.rs`** の対応表（`SYMBOL_SPELLING`）に、表そのものの註が無い
  （`SYMBOL_KEYS` の註が表の説明を兼ねている）。前置の 9 キーの一覧が手書きであることの註も無い（新しい前置キーは等値の枝に落ちて赤くなるので、黙りはしない）。
- **`mark` を持たない古い履歴の件と同じ計算をし直すと、重複の判定（`history/index.ts` の `pushEntry`、式・答え・角度だけを比べる）で
  古い件が残る**——呼び戻すと `DEG` が付く（`mark` を持たない件の保守的な既定）。害は小さい。

## 5. 参考: やらないこと

- **`clippy::pedantic` と `clippy::nursery` で出た種類**（`use_self`・`must_use_candidate`・`missing_errors_doc` など）は
  書き方の好みで、既存のファイル全体が同じ傾向にある。**やらない。** 入れるなら一括で、CI の lint の段に足す形になる。

## 6. DEG の整数の角で |q| ≥ 2^53 のもの（1.2.3 では直さない。利用者の裁定 2026-10-08）

**1.2.3（`feat/precision-fixes`）の F3 は、分母 ≠ 1 の角だけを印のまま畳む**（設計書
`docs/superpowers/specs/2026-10-08-precision-fixes-design.md` §2.1）。**整数の角は f64 で厳密なら
`% 360` が既に厳密**なので畳まないが、**|q| ≥ 2^53 の整数は f64 が持てないことがある。** 形は 2 つ。
**どちらも v1.2.2 と同じ答えなので、後退ではない**（印字は 2026-10-08、`ff0772c` と `v1.2.2` の両方で同じ）。

- **f64 が別の角に着地する**: `1 EXP 17 + 90 = tan` は `0.2867453858`。f64 の `1e17 + 90` は
  `100000000000000096`（`% 360` で 16）なので **tan 16°**（`16 tan` も `0.2867453858`）。
  **真値は tan 10° = `0.1763269807`**（`10 tan` の印字。mpmath 50 桁で `0.176326980708…`）。
- **f64 が表に着地する**: `1 EXP 17 + 86 = sin` は `0`。f64 の `1e17 + 86` は `% 360` で 0 になり、
  f64 の規則が表を引く。**真値は sin 6° = `0.1045284633`**（`6 sin` の印字。mpmath 50 桁で `0.104528463267…`）。

**直し方: 2 つの門を一緒に入れる。** **整数の印で |q| ≥ 2^53 のときは、「f64 が表」の段を飛ばし、
印で決める**——印が表に載れば表、載らなければ畳む（`exact::turn` の順「印が表 → f64 が表 → 畳む」の
2 段目を、この場合だけ外す）。**片方だけ入れると、もう片方の形が残る**（畳むだけなら `+ 86` が表のまま、
表を飛ばすだけなら `+ 90` が tan 16° のまま）。

**規模: S。** **コーパスの DEG の整数の角は 440 件で、全部 2^53 より小さい**（レビュー役が自分の道具で数えた数（d43cf71 のコーパスの値ケースで、fn(rad(expr)) の角が整数のもの。|q| ≥ 2^53 は 0 件））——**今これを見張る番人は無い。**
**直すときは、上の 2 行を `engine_table.rs` に足す**（今の印字で赤、直して真値）。

## 1.2.3 の床（heavy:power）

- **【未消化 2026-10-08】** GitHub での 1.2.3 の初回 `heavy:power` の後に、`f1-rationalize-off`・`f2-log1p-off`・`f3-degree-fold-off`・`display-digits/cancellation` の床（minRate）を置く。期待シャードは native の数から（F1 canc 521・F2 canc 42・F3 typed 1）。**その走行で確かめる**（試作・native の数は実装の数ではない）。設計書 `../specs/2026-10-08-precision-fixes-design.md` §5.2 から指される。
