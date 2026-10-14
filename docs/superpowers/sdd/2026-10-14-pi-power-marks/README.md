# 1.2.5（π の多項式の印）の数を取り直す道具

設計書 `docs/superpowers/specs/2026-10-14-pi-power-marks-design.md` の §0・§2.1・§4.2 の数は、
ここにある 3 つの道具で出した。**実装の日に、実装したコードで同じ手順を回して取り直す。**
レビュー役も同じ手順で同じ数を出せる。

| ファイル | 役目 |
|---|---|
| `ppm-rand.py` | 乱択のキー列と真値を作る（SymPy）。種 `20261014`、試行 20000 → 19,331 行 |
| `pitry/` | キー列を engine で歩いて表示と生の値を印字する（Rust。この木の `crates/calcarc-core` を読む） |
| `ppm-cmp.py` | 2 本の `pitry`（今と後）を同じキー列で比べて数える |

## 手順

`$OUT` は作業用のディレクトリ（リポジトリの外）とする。

```bash
# 1. 乱択（どの木で作っても同じ。engine を使わない）
cd reference
uv --no-config run python ../docs/superpowers/sdd/2026-10-14-pi-power-marks/ppm-rand.py $OUT/ppm-rand.json 20261014 20000
sha256sum $OUT/ppm-rand.json
#   → dd21fc817e2b5f36436dc68661cb0b6221e116a066805809841a6935b8d37f82
#   （2026-10-14、reference/uv.lock の SymPy 1.14.0・CPython 3.14.0 で 3 回同じ）

# 2. 今の pitry（e231550 の木で build。この木に pitry/ が無ければ、このディレクトリから写す）
git worktree add $OUT/base e231550
cp -r docs/superpowers/sdd/2026-10-14-pi-power-marks/pitry $OUT/base/pitry
sed -i 's|"../../../../../crates/calcarc-core"|"../crates/calcarc-core"|' $OUT/base/pitry/Cargo.toml
(cd $OUT/base/pitry && CARGO_TARGET_DIR=$OUT/target-base cargo build --release)

# 3. 後の pitry（実装の枝の木で build。この木には pitry/ がある）
(cd docs/superpowers/sdd/2026-10-14-pi-power-marks/pitry && CARGO_TARGET_DIR=$OUT/target-new cargo build --release)

# 4. 数える
python3 docs/superpowers/sdd/2026-10-14-pi-power-marks/ppm-cmp.py random $OUT/ppm-rand.json \
  $OUT/target-base/release/pitry $OUT/target-new/release/pitry
python3 docs/superpowers/sdd/2026-10-14-pi-power-marks/ppm-cmp.py corpus corpus/generated \
  $OUT/target-base/release/pitry $OUT/target-new/release/pitry
```

- **`CARGO_TARGET_DIR` は木ごとに分ける。** 共有すると、片方の木の build を他方が読む。
- `ppm-cmp.py random` が印字する `base_wrong` は「今の表示が真値と違う本数」、`new_wrong` は後のそれ、
  `RIGHT->WRONG` は後退である。後退・`wrong->other_wrong`・`finite->error`・`error->finite` は
  1 本ずつキー列を印字する。
- `ppm-cmp.py corpus` は、値の期待を持つケース（25,339 件）の**生の値（re と im の f64）**と
  **表示（文字列とエラー）**が今と後で動いた件数を印字する。

## 試作の数（設計書第 2 版、2026-10-14）

試作は枝 `proto/pi-power-marks`（`186ea066`。`e231550` の上の 2 コミット、push しない）にある。
**実装の手本ではない**（環境変数で族を切る測定用の書き方）。上の 2 で `e231550` の代わりに
この枝を「後」に使うと、次の数が出る。

```
random: lines 19331 / base_wrong 319 / new_wrong 201 / wrong->right 118 / RIGHT->WRONG 0
        wrong->other_wrong 2 / finite->error 5 / display_changed 120 / raw_changed 308
corpus: cases 25339 / raw_changed 0 / display_changed 0
```

## 真値の作り方

`ppm-rand.py` の冒頭の註に書いた。要点:
- キー列を組むのと同じ順に、SymPy の厳密な式（`sp.pi`・`sp.Rational`・`sp.sqrt`）を組む。
  `sp.simplify` は呼ばない（自動の簡約で `sin(π)` は 0、`√(π²)` は π になる。`simplify` は
  メモリを食い尽くした）。
- 極（`zoo`・`oo`・`nan`）は `Math ERROR`。それ以外は `N(v, 50)` を `float` にして、
  参照の `real_ref.format_rect` で 10 桁の文字列にする。
- **数えるのは表示（10 桁の文字列とエラー）が真値と一致するか**で、生の値は数えない。
