# 1.2.6（整数の指数・逆三角関数・平方数の √・k の範囲）の数を取り直す手順

設計書 `docs/superpowers/specs/2026-10-20-pi-marks-more-design.md` の §0・§1・§4 の数は、
1.2.5 と同じ 3 つの道具で出した（1.2.5 の手順は `../2026-10-14-pi-power-marks/README.md`）。
**実装の日に、実装したコードで同じ手順を回して取り直し、報告に印字を貼る。**
レビュー役も同じ手順で同じ数を出せる。

| 道具 | 役目 | 見張る番人 |
|---|---|---|
| `reference/scripts/ppm_rand.py` | 乱択のキー列と真値を作る（SymPy）。**4 つ目の引数 `1.2.6` で族を足す**（省けば 1.2.5 の組で、出力は前と同じバイト列） | `ruff check`・`ruff format --check`・`independence.py`（`expects`） |
| `crates/calcarc-core/examples/pitry.rs` | キー列を engine で歩いて表示と生の値を印字する（変更なし） | `cargo clippy --all-targets`・`cargo fmt` |
| `reference/scripts/ppm_cmp.py` | 2 本の pitry（今と後）を同じキー列で比べて数える。**`corpus` は左右を比べるケース（同値など 5,293 組）も歩く** | `ruff check`・`ruff format --check`・`independence.py`（`tools`） |

## 手順

`$OUT` は作業用のディレクトリ（リポジトリの外）とする。コマンドはリポジトリの根から打つ。

```bash
# 1. 乱択（engine を使わないので、どの木で作っても同じ）
(cd reference && uv --no-config run python scripts/ppm_rand.py $OUT/p6-rand.json 20261020 20000 1.2.6)
(cd reference && uv --no-config run python scripts/ppm_rand.py $OUT/ppm-rand.json 20261014 20000)
sha256sum $OUT/p6-rand.json $OUT/ppm-rand.json
#   → 56e7da5e2da9b1d7d21cd6cdde4e2f3b6e67f50d4614182ee3ff18cefb7f4c29  p6-rand.json（17,129 行）
#   → dd21fc817e2b5f36436dc68661cb0b6221e116a066805809841a6935b8d37f82  ppm-rand.json（19,331 行、1.2.5 と同じ）
#   （2026-10-20、reference/uv.lock の SymPy 1.14.0・CPython 3.14.0）

# 2. 今の pitry（481cc5db = v1.2.5。作業木を増やさず、git archive で取り出す）
mkdir -p $OUT/base && git archive 481cc5db | tar -x -C $OUT/base
(cd $OUT/base && CARGO_TARGET_DIR=$OUT/target-base cargo build -p calcarc-core --release --example pitry)

# 3. 後の pitry（実装の枝の木。設計の段では試作の枝 proto/pi-marks-more = 9fbc1a0d）
mkdir -p $OUT/new && git archive proto/pi-marks-more | tar -x -C $OUT/new
(cd $OUT/new && CARGO_TARGET_DIR=$OUT/target-new cargo build -p calcarc-core --release --example pitry)

# 4. 数える
B=$OUT/target-base/release/examples/pitry; N=$OUT/target-new/release/examples/pitry
(cd reference && python3 scripts/ppm_cmp.py random $OUT/p6-rand.json $B $N)
(cd reference && python3 scripts/ppm_cmp.py random $OUT/ppm-rand.json $B $N)
(cd reference && python3 scripts/ppm_cmp.py corpus ../corpus/generated $B $N)
```

- **`CARGO_TARGET_DIR` は木ごとに分ける。** 共有すると、片方の木の build を他方が読む。
- 印字の読み方は 1.2.5 の README と同じ。`corpus` の後半は左右を比べるケースで、
  `pairs_raw_became_equal` は「今は左右の生の値が違い、後は同じ」組、
  `pairs_*_became_unequal` は逆向き（後退の候補。id を 1 行ずつ印字する）。

## 試作の数（設計書第 1 版、2026-10-20）

試作は枝 `proto/pi-marks-more`（`9fbc1a0d`。`481cc5db` の上の 1 コミット、push しない）にある。
**実装の手本ではない**（環境変数で族を切る測定用の書き方）。手順 3 の木をこの枝の作業木に置き換えると、
次の数が出る（手順 3 は試作の枝を取り出して build する形で書いた）。

```
p6-rand:  lines 17129 / base_wrong 333 / new_wrong 220 / wrong->right 113 / RIGHT->WRONG 0
          wrong->other_wrong 3 / finite->error 28 / display_changed 116 / raw_changed 397
ppm-rand: lines 19331 / base_wrong 201 / new_wrong 195 / wrong->right 6 / RIGHT->WRONG 0
          display_changed 6 / raw_changed 12
corpus:   cases 25707 / raw_changed 56 / display_changed 0
          pairs 5293 / pairs_raw_became_equal 12（became_unequal は 0）
```

### 族ごとの寄与（試作の環境変数）

手順 4 の 1 行目を、環境変数を付けて回す（`env PROTO_NO_INV=1 python3 scripts/ppm_cmp.py random …`）。
pitry は環境変数を引き継ぐ。

| 環境変数 | 切るもの | `wrong->right`（p6-rand） |
|---|---|---:|
| （なし） | — | 113 |
| `PROTO_NO_POWINT` | 整数の指数の `xʸ` 全部 | 80 |
| `PROTO_NO_ZERO_ANY` | `x⁰` の印を底の印が無くても 1 にする規則 | 112 |
| `PROTO_NO_POWROOT` | root の底の整数乗（偶数の指数で単項に戻す） | 113 |
| `PROTO_POWROOT_ODD` | （足す側）root の底の奇数乗も root で運ぶ | 114 |
| `PROTO_NO_INV` | 逆三角関数の表 | 44 |
| `PROTO_NO_INVROOT` | 逆三角関数の表のうち root の引数（`0.5 √` など） | 106 |
| `PROTO_NO_SQ0` | k = 0 の平方数の √ を単項に戻す | 94 |

`ppm-rand`（1.2.5 の組）の 6 本は、6 本とも `PROTO_NO_SQ0` で戻る。

### k の範囲（設計書 §2.4）

```bash
# 範囲の外へ出た k を数える（試作の PROTO_RANGE_LOG。pitry の標準出力は行ごとに書き出すので、
# 標準エラーの印は、その行の印字より前に並ぶ）
python3 - <<'EOF'
import json, os, subprocess, collections
rows = json.load(open(os.environ["OUT"] + "/p6-rand.json"))
out = subprocess.run(os.environ["N"] + " 2>&1", shell=True, text=True, capture_output=True,
                     input="\n".join(k for _, k, _ in rows) + "\n",
                     env={**os.environ, "PROTO_RANGE_LOG": "1"}).stdout.splitlines()
hit, pending = 0, False
for line in out:
    if line.startswith("RANGE "):
        pending = True
    else:
        hit, pending = hit + pending, False
print("lines leaving -2..4:", hit)
EOF
#   → p6-rand 562 本、ppm-rand 263 本

# 範囲を -32..32 に広げた pitry（手順 3 で取り出した試作の写しを、もう 1 つ取り出して
# exact.rs の 3 つの定数を書き換え、別の target に build する）
mkdir -p $OUT/wide && git archive proto/pi-marks-more | tar -x -C $OUT/wide
sed -i -e 's/^const TERMS: usize = 7;/const TERMS: usize = 65;/' \
       -e 's/^const LOWEST: i8 = -2;/const LOWEST: i8 = -32;/' \
       -e 's/^const HIGHEST: i8 = 4;/const HIGHEST: i8 = 32;/' $OUT/wide/crates/calcarc-core/src/engine/exact.rs
(cd $OUT/wide && CARGO_TARGET_DIR=$OUT/target-wide cargo build -p calcarc-core --release --example pitry)
W=$OUT/target-wide/release/examples/pitry
(cd reference && python3 scripts/ppm_cmp.py random $OUT/p6-rand.json $N $W)   # display 0 / raw 0
(cd reference && python3 scripts/ppm_cmp.py random $OUT/ppm-rand.json $N $W)  # display 0 / raw 0
(cd reference && python3 scripts/ppm_cmp.py corpus ../corpus/generated $N $W) # 0 / 0、組も 0
```

## 真値の作り方

`ppm_rand.py` のモジュールの docstring に書いた（1.2.5 と同じ）。1.2.6 の組で足したもの:
- `xʸ` の整数の指数（−3〜5）は `v**n`。0 の負の冪は捨てる。
- 逆三角関数は `sp.asin`・`sp.acos`・`sp.atan`。DEG は `× 180 / π`。定義域の外の `asin`・`acos` は捨てる。
  **SymPy は表に載る値（`asin(1/2)` = π/6、`acos(−√3/2)` = 5π/6 ほか）を記号で返す**ので、
  そのあとの `sin` の 0 も記号の簡約で出る。engine の表とは別の表である（§0）。
- 途中の `sin`・`cos`・`tan`（族 `inv` の `fwd`）は、逆三角関数に表の値を渡すため。
