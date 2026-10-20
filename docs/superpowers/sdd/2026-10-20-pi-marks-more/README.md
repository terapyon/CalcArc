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
#   → 08ee475eb1369f3c465eebfe93342f80ba481556cead6b3df380bbed7e652f5d  p6-rand.json（17,129 行）
#   → dd21fc817e2b5f36436dc68661cb0b6221e116a066805809841a6935b8d37f82  ppm-rand.json（19,331 行、1.2.5 と同じ）
#   （2026-10-20、reference/uv.lock の SymPy 1.14.0・CPython 3.14.0。5 回同じ）

# 2. 今の pitry（481cc5db = v1.2.5。作業木を増やさず、git archive で取り出す）
mkdir -p $OUT/base && git archive 481cc5db | tar -x -C $OUT/base
(cd $OUT/base && CARGO_TARGET_DIR=$OUT/target-base cargo build -p calcarc-core --release --example pitry)

# 3. 後の pitry（実装の枝の木。設計の段では試作の枝 proto/pi-marks-more = 30458186）
mkdir -p $OUT/new && git archive proto/pi-marks-more | tar -x -C $OUT/new
(cd $OUT/new && CARGO_TARGET_DIR=$OUT/target-new cargo build -p calcarc-core --release --example pitry)

# 4. 数える
B=$OUT/target-base/release/examples/pitry; N=$OUT/target-new/release/examples/pitry
(cd reference && python3 scripts/ppm_cmp.py random $OUT/p6-rand.json $B $N)
(cd reference && python3 scripts/ppm_cmp.py random $OUT/ppm-rand.json $B $N)
(cd reference && python3 scripts/ppm_cmp.py corpus ../corpus/generated $B $N)
```

**手順 1 の印字**（行数、影で置き換えた本数、その行のキー列の順。**`shadowed` の数を毎回見る**——
0 でない数が増えたら、SymPy の真値がまた揺れている）:

```
p6-rand.json:            ppm-rand.json:
17129                    19331
shadowed                 shadowed
1                        0
angle_toggle 1 sub 1 exp 1 5 neg eq acos asin sin
```

- **sha256 が `08ee475e…` でなければ、まず `shadowed` の行を見る。** 設計書第 1 版の `56e7da5e…` は、
  影を足す前に、この 1 行の真値を SymPy が 0 にした版である（下の「真値の作り方」）。
- **`CARGO_TARGET_DIR` は木ごとに分ける。** 共有すると、片方の木の build を他方が読む。
- 印字の読み方は 1.2.5 の README と同じ。`corpus` の後半は左右を比べるケースで、
  `pairs_raw_became_equal` は「今は左右の生の値が違い、後は同じ」組、
  `pairs_*_became_unequal` は逆向き（後退の候補。id を 1 行ずつ印字する）。

## 試作の数（設計書第 1 版＋追記 1、2026-10-20）

試作は枝 `proto/pi-marks-more`（`30458186`。`481cc5db` の上の 2 コミット、push しない。1 つ目の `9fbc1a0d` が第 1 版の 3 族、2 つ目が ±π の近くの畳み）にある。
**実装の手本ではない**（環境変数で族を切る測定用の書き方）。手順 3 の木をこの枝の作業木に置き換えると、
次の数が出る（手順 3 は試作の枝を取り出して build する形で書いた）。

```
p6-rand:  lines 17129 / base_wrong 333 / new_wrong 218 / wrong->right 115 / RIGHT->WRONG 0
          wrong->other_wrong 2 / finite->error 28 / display_changed 117 / raw_changed 403
ppm-rand: lines 19331 / base_wrong 201 / new_wrong 190 / wrong->right 11 / RIGHT->WRONG 0
          display_changed 11 / raw_changed 35
corpus:   cases 25707 / raw_changed 74 / display_changed 0
          pairs 5293 / pairs_raw_became_equal 12（became_unequal は 0）
```

### 族ごとの寄与（試作の環境変数）

手順 4 の 1 行目を、環境変数を付けて回す（`env PROTO_NO_INV=1 python3 scripts/ppm_cmp.py random …`）。
pitry は環境変数を引き継ぐ。

| 環境変数 | 切るもの | `wrong->right`（p6-rand） |
|---|---|---:|
| （なし） | — | 115 |
| `PROTO_NO_PIFOLD` | RAD の角を 90° 単位とずれに分けて畳む直し（±π の近く） | 113 |
| `PROTO_NO_POWINT` | 整数の指数の `xʸ` 全部 | 82 |
| `PROTO_NO_ZERO_ANY` | `x⁰` の印を底の印が無くても 1 にする規則 | 114 |
| `PROTO_NO_POWROOT` | root の底の整数乗（偶数の指数で単項に戻す） | 115 |
| `PROTO_POWROOT_ODD` | （足す側）root の底の奇数乗も root で運ぶ | 116 |
| `PROTO_NO_INV` | 逆三角関数の表 | 45 |
| `PROTO_NO_INVROOT` | 逆三角関数の表のうち root の引数（`0.5 √` など） | 108 |
| `PROTO_NO_SQ0` | k = 0 の平方数の √ を単項に戻す | 96 |

`ppm-rand`（1.2.5 の組）の 11 本は、6 本が `PROTO_NO_SQ0` で、5 本が `PROTO_NO_PIFOLD` で戻る。
**4 つ（`PROTO_NO_PIFOLD`・`PROTO_NO_POWINT`・`PROTO_NO_INV`・`PROTO_NO_SQ0`）を全部切ると、2 つの乱択とコーパスの全件で
`481cc5db` と生の値・表示が同じになる**（自己検査）。

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
- **影の数値**: 同じ手順を mpmath（400 桁）でも 1 段ずつ追い、SymPy の値と食い違えば影の数値を真値にする
  （印字の `shadowed` が本数とキー列）。SymPy は `sin(asin(acos(1 − 10⁻¹⁵)))` を、走るたびに 0 にしたり
  正しい値（約 4.47e-8）にしたりして、出力のバイト列が変わった（設計書第 1 版の sha256 `56e7da5e…` は
  その行が 0 の版である）。1.2.5 の組では `shadowed` は 0 で、バイト列は前と同じ。

## 畳みの直しで遠ざかる行（設計書 §2.6、第 2 版）

表に載らない角 `nπ/d`（`d` = 5〜60、12 の約数を除く、既約）の `sin`・`cos`・`tan` 6,540 本を、手順 2・3 の
2 本の pitry で歩く。**今と後の畳みを Python で写し、pitry とビット一致することを先に数える**
（`emulation differs` が 0 でなければ、下の分解は pitry の答えの分解ではない）。そのうえで、角の誤差の
上限（`f64(q)` の丸め・π の f64 の誤差・積の丸め）を今（`q = r`）と後（`q = δ`）で比べ、遠ざかった行の
実際の角の誤差を比べる。

```bash
(cd reference && B=$B N=$N uv --no-config run python - <<'EOF'
import math, os, subprocess, collections
from fractions import Fraction as F
import mpmath as mp
mp.mp.dps = 60
rows = [(n, d, f) for d in range(5, 61) if 12 % d for n in range(2 * d) if math.gcd(n, d) == 1
        for f in ("sin", "cos", "tan")]
inp = "".join(f"angle_toggle pi mul {' '.join(str(n))} eq div {' '.join(str(d))} eq {f}\n" for n, d, f in rows)
def run(b):
    out = subprocess.run([b], input=inp, text=True, capture_output=True, check=True).stdout
    return [float(line.split("\t")[2]) for line in out.splitlines()]
def angle(q):  # f64(q) × π の値と、真の qπ との差
    x = float(q) * math.pi
    return x, mp.mpf(x) - mp.mpf(q.numerator) / q.denominator * mp.pi
def bound(q):  # 角の誤差の上限: f64(q) の丸め・π の f64 の誤差・積の丸め
    if q == 0:
        return mp.mpf(0)
    upi = abs(mp.mpf(math.pi) - mp.pi) / mp.pi
    return (mp.mpf(math.ulp(float(abs(q)))) / 2 * mp.pi + abs(mp.mpf(q.numerator) / q.denominator) * mp.pi * upi
            + mp.mpf(math.ulp(abs(float(q) * math.pi))) / 2)
pick = lambda sc, f: {"sin": sc[0], "cos": sc[1], "tan": sc[0] / sc[1]}[f]
c = collections.Counter(); worst = collections.Counter()
for (n, d, f), vb, vn in zip(rows, run(os.environ["B"]), run(os.environ["N"])):
    r = F(n, d) % 2
    r = r - 2 if r > 1 else r
    k = math.floor(2 * r + F(1, 2)); delta = r - F(k, 2)
    xo, ao = angle(r); xn, an = angle(delta)
    so, co, sn, cn = math.sin(xo), math.cos(xo), math.sin(xn), math.cos(xn)
    c["emulation differs"] += (pick((so, co), f), pick([(sn, cn), (cn, -sn), (-sn, -cn), (-cn, sn)][k % 4], f)) != (vb, vn)
    c["bound new > old"] += bound(delta) > bound(r)
    t = getattr(mp, f)(mp.mpf(n) / d * mp.pi); u = math.ulp(abs(float(t)))
    eb, en = float(abs(vb - t)) / u, float(abs(vn - t)) / u
    worst[f + " old"] = max(worst[f + " old"], eb); worst[f + " new"] = max(worst[f + " new"], en)
    c["over 1 ulp old"] += eb > 1; c["over 1 ulp new"] += en > 1
    if en > eb:
        c["farther"] += 1; c["farther, |r| <= 1/4"] += abs(r) <= F(1, 4); c["farther, over 1 ulp"] += en > 1
        c["farther, new angle error larger"] += abs(an) > abs(ao)
    else:
        c["closer" if en < eb else "same"] += 1
print(len(rows), dict(c)); print({k: round(v, 2) for k, v in sorted(worst.items())})
EOF
)
#   → 6540 {'emulation differs': 0, 'bound new > old': 0, 'over 1 ulp old': 2574, 'over 1 ulp new': 556,
#      'same': 3196, 'farther': 318, 'farther, |r| <= 1/4': 0, 'farther, over 1 ulp': 102,
#      'farther, new angle error larger': 234, 'closer': 3026}
#   → {'cos new': 1.47, 'cos old': 55.74, 'sin new': 1.47, 'sin old': 60.28, 'tan new': 3.25, 'tan old': 68.61}
```

コーパスで生の値が動く 18 件（`rad-pi-display-000.json`）は、同じ 2 本で次のように数える。遠ざかる 2 件は
`rpi-000272`・`rpi-000275`（どちらも `r = 2/7` の `tan`）。

```bash
(cd reference && B=$B N=$N uv --no-config run python - <<'EOF'
import json, math, os, subprocess
import mpmath as mp
mp.mp.dps = 60
cases = json.load(open("../corpus/generated/rad-pi-display-000.json"))["cases"]
inp = "".join(" ".join(c["keys"]) + "\n" for c in cases)
run = lambda b: subprocess.run([b], input=inp, text=True, capture_output=True, check=True).stdout.splitlines()
for c, a, b in zip(cases, run(os.environ["B"]), run(os.environ["N"])):
    ra, rb = float(a.split("\t")[2]), float(b.split("\t")[2])
    if ra != rb:
        t = eval(c["expr"], {"pi": mp.pi, "sin": mp.sin, "cos": mp.cos, "tan": mp.tan})
        u = math.ulp(abs(float(t)))
        print(c["id"], c["expr"], "old %.3f new %.3f ulp" % (abs(ra - t) / u, abs(rb - t) / u))
EOF
)
#   → 18 行。new > old は rpi-000272 tan(pi*2/7) と rpi-000275 tan(pi*14002/7)（0.344 → 0.656 ulp）
```
