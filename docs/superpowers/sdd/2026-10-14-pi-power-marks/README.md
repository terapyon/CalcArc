# 1.2.5（π の多項式の印）の数を取り直す手順

設計書 `docs/superpowers/specs/2026-10-14-pi-power-marks-design.md` の §0・§2.1・§4.2 の数は、
次の 3 つの道具で出した。**実装の日に、実装したコードで同じ手順を回して取り直し、報告に印字を貼る。**
レビュー役も同じ手順で同じ数を出せる。

| 道具 | 役目 | 見張る番人 |
|---|---|---|
| `reference/scripts/ppm_rand.py` | 乱択のキー列と真値を作る（SymPy）。種 `20261014`、試行 20000 → 19,331 行 | `ruff check`・`ruff format --check`・`independence.py`（`expects`） |
| `crates/calcarc-core/examples/pitry.rs` | キー列を engine で歩いて表示と生の値を印字する | `cargo clippy --all-targets`・`cargo fmt` |
| `reference/scripts/ppm_cmp.py` | 2 本の pitry（今と後）を同じキー列で比べて数える | `ruff check`・`ruff format --check`・`independence.py`（`tools`） |

## 手順

`$OUT` は作業用のディレクトリ（リポジトリの外）とする。コマンドはリポジトリの根から打つ。

```bash
# 1. 乱択（engine を使わないので、どの木で作っても同じ）
(cd reference && uv --no-config run python scripts/ppm_rand.py $OUT/ppm-rand.json 20261014 20000)
sha256sum $OUT/ppm-rand.json
#   → dd21fc817e2b5f36436dc68661cb0b6221e116a066805809841a6935b8d37f82
#   （2026-10-14、reference/uv.lock の SymPy 1.14.0・CPython 3.14.0 で 4 回同じ）

# 2. 今の pitry（e231550 の木。その木には examples/pitry.rs が無いので、この木から写す）
git worktree add $OUT/base e231550
mkdir -p $OUT/base/crates/calcarc-core/examples
cp crates/calcarc-core/examples/pitry.rs $OUT/base/crates/calcarc-core/examples/
(cd $OUT/base && CARGO_TARGET_DIR=$OUT/target-base cargo build -p calcarc-core --release --example pitry)

# 3. 後の pitry（実装の枝の木）
CARGO_TARGET_DIR=$OUT/target-new cargo build -p calcarc-core --release --example pitry

# 4. 数える
(cd reference && python3 scripts/ppm_cmp.py random $OUT/ppm-rand.json \
  $OUT/target-base/release/examples/pitry $OUT/target-new/release/examples/pitry)
(cd reference && python3 scripts/ppm_cmp.py corpus ../corpus/generated \
  $OUT/target-base/release/examples/pitry $OUT/target-new/release/examples/pitry)
```

- **`CARGO_TARGET_DIR` は木ごとに分ける。** 共有すると、片方の木の build を他方が読む。
- `ppm_cmp.py random` が印字する `base_wrong` は「今の表示が真値と違う本数」、`new_wrong` は後のそれ、
  `RIGHT->WRONG` は後退である。後退と `wrong->other_wrong` は 1 本ずつキー列を印字する
  （`finite->error`・`error->finite` は本数だけ）。
- `ppm_cmp.py corpus` は、値の期待を持つケース（25,339 件）の**生の値（re と im の f64）**と
  **表示（文字列とエラー）**が今と後で動いた件数を印字する。
- engine_table の行（設計書 §5.1）は、キー列を 1 行ずつ書いたファイルを pitry の標準入力に流せば
  同じ印字が出る。

## 試作の数（設計書第 3 版、2026-10-14）

試作は枝 `proto/pi-power-marks`（`113fc3d4`。`e231550` の上の 3 コミット、push しない）にある。
**実装の手本ではない**（環境変数で族を切る測定用の書き方）。手順 3 の木を、この枝の作業木に
置き換え（2 と同じく `pitry.rs` を写す）ると、次の数が出る。

```
random: lines 19331 / base_wrong 319 / new_wrong 201 / wrong->right 118 / RIGHT->WRONG 0
        wrong->other_wrong 2 / finite->error 5 / display_changed 120 / raw_changed 308
corpus: cases 25339 / raw_changed 0 / display_changed 0
```

## 真値の作り方

`ppm_rand.py` のモジュールの docstring に書いた。要点:
- キー列を組むのと同じ順に、SymPy の厳密な式（`sp.pi`・`sp.Rational`・`sp.sqrt`）を組む。
  `sp.simplify` は呼ばない（自動の簡約で `sin(π)` は 0、`√(π²)` は π になる。`simplify` は
  メモリを食い尽くした）。
- 極（`zoo`・`oo`・`nan`）は `Math ERROR`。それ以外は `N(v, 50)` を `float` にして、
  参照の `real_ref.format_rect` で 10 桁の文字列にする。
- **数えるのは表示（10 桁の文字列とエラー）が真値と一致するか**で、生の値は数えない。
