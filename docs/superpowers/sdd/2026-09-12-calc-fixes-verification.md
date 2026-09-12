# 0.9.2 検証側の台帳（境界 golden・A4 集計・裁定・レビュー結果）

## §0 この文書は何か

これは 0.9.2 の検証側（PR A `docs/0-9-2-verification`、PR B `heavy/verdict-names`、共通の起点は `674b4df`）の
追跡下の台帳である。設計書は
`docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md`、計画は
`docs/superpowers/plans/2026-09-12-calc-fixes-verification.md`。タスクの作業中に書かれた
`task-N-report.md`・`progress.md`・`final-review.md` などの作業場のファイルは追跡外（`.git/info/exclude`）
で、この計画が閉じれば消える。ここに移した内容だけが、他のクローンにも他のセッションにも残る。

## §1 境界の golden の生成器の選び方

`reference/src/calcarc_reference/loan_boundary.py` は `testdata/loan_boundary.json`（境界ちょうど・すぐ下・
すぐ上を狙う専用の golden）を作る。以下は `task-2-report.md`「Deviations from the brief's exact code, with
reasons」（当初の実装、26fd75d）と、最終修正の波の `final-fix-report.md`「A1」（fb32bc6）の要旨である。

### 当初の実装（26fd75d）でブリーフのコードから逸脱した点

1. **重複 ID の不具合の修正。** ブリーフどおりの `_principals()` は、同じ元本 `p` を「`c.denominator` の倍数」
   のループと「連分数の近似分母 × `MULTS` × {-1, 0, 1}」のループの両方から出しうる（近似分母が
   `c.denominator` の倍数と一致するとき）。ブリーフのコードをそのまま動かすと `build_cases()` 自身の不変条件
   （`ValueError: duplicate case id in loan boundary golden`）が落ちた（修正前に重複 54 件）。`_principals()`
   の中に `seen: set[int]` を足し、同じ `p` を最初の 1 回だけ yield するようにした（最初のループが勝つ）。
   私的なヘルパーの中だけのバグ修正であり、アルゴリズムの形は変えていない。修正後、重複 0・876 件（レバーを
   広げる前）。
2. **`MULTS` を広げ、`RESIDUAL_J_MULTS` を新設し、`PER_CELL` を上げた（ブリーフが許した 3 つのレバー）。**
   重複修正の後も `test_each_cell_has_enough_cases` が `residual/below = 6`・`residual/above = 6`（下限 20）
   で落ちた。実測した根本原因: 残価の集合では `c2 = 1/(base**n * annuity)` の分母が `base.denominator ** n`
   にほぼ比例して伸びる。`TERMS` のうち `n=2` を除く全期間で、`c2.denominator` がすでに `U64_MAX` を超える
   （例: 年利 `"0.5"` は `n=3` で 24 bit・`n=6` で 59 bit・`n=7` で 70 bit（`U64_MAX` は 64 bit）、年利
   `"0.0001"` は `n=3` で早くも 49 bit、`n=4` で 73 bit）。残価ループは `p > b`（`b = c2.denominator * j`）を
   要求するので、`c2.denominator` が到達可能な元本レンジを超えた時点で候補が 0 になる——**残価の境界ケースは
   構造上 `n=2` だけでしか作れない、とこの時点では判断した**（この判断は最終レビュー I-1 で誤りと判明し、
   最終修正の波で撤回・修正された。撤回の裁定は §6 を参照）。`n=2` の中でも、年利の分数の分母がおよそ
   `1/NEAR = 10**6` 以上でなければ、境界の近傍に元本が来ない。4 桁の年利 `"0.0001"`（分母 1.2e7）だけがこれを
   満たした。この 1 セルだけから下限 20 に届かせるため、3 つのレバーを同時に広げた:
   - `MULTS`: `(1, 2, 3, 10, 1_000, 1_000_000)` から 1〜10,000,000 の 24 要素の等比風の並びへ。
   - 残価の `j` 乗数（旧ハードコード `(1, 2, 5)`）を `RESIDUAL_J_MULTS = (1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50)`
     というモジュール定数に切り出した。
   - `PER_CELL`: `8` から `25` へ（`(rate="0.0001", n=2)` の 1 セルだけで below/above 各 20 件以上を賄う
     必要があったため）。

   下限は下げていない。アルゴリズムの形（候補生成・フィルタ・償還安全性チェック）も変えていない——ブリーフが
   明示的に許した 3 つの調整レバーだけを広げた。

### 26fd75d 時点の件数・網羅・実行時間

`build_cases()` から直接測った (集合, 境界) 別の件数:

| set | exact | below | above |
|---|---|---|---|
| plain | 125 | 599 | 582 |
| residual | 275 | 25 | 25 |
| bonus | 104 | 376 | 347 |

9 セルすべてが下限 20 以上、`plain/below`（599）・`plain/above`（582）は下限 100 以上。`residual/below`・
`residual/above` は `PER_CELL` の上限 25 ちょうど（それでも必要な 20 以上）で、すべて `rate="0.0001", n=2`
に集中している。

- 年利: `{'0.0001', '0.5', '1', '100', '15', '2'}` — 両端 `"0.0001"` と `"100"` を含む。
- 期間: `[2, 3, 12, 120, 360, 1200]` — 両端 `2` と `1200` を含む。
- 全ケース中の最大の月額 floor: `1000000000`（= `MAX_MONTHLY_YEN` ちょうど）。
- 総件数: **2,458**。`testdata/loan_boundary.json` のサイズ: **843,750 バイト**（約 824 KiB）。
- `build_cases()` の実行時間: **約 1.07 秒**（`pytest tests/test_loan_boundary.py -q` 全体は 1.22〜1.23 秒）。

### 最終修正の波（fb32bc6）での生成器の変更 — final-fix-report.md「A1」

最終レビュー I-1 が上記の「構造上 n=2 だけ」という前提を誤りと指摘した後の直し（§6 の裁定を参照）。

- **上限から導いた B の境界。** `b_limit = _floor((MAX_MONTHLY_YEN - c1) / (c1 - c2))`（Fraction 演算。残価の
  利息が毎月の一部なので、月額 10 億円の上限が B を縛るという式）。`if b > 10**12: break` を削除し、
  `if b > b_limit: continue` に置き換えた。
- **窓を狙った P の探索。** `_window_principals(c, offset, p_lo, p_hi)`: `c` の連分数の近似分母 `t` ごとに
  `P = t·m + d`（`d ∈ {−1, 0, 1}`）を、`p_lo`・`p_hi` の両端から `WINDOW_STEPS = 3` 個ずつ探す（`c.denominator`
  の倍数も両端から加える）。重複除去あり。窓は `p_lo = B + 1`、`p_hi = floor((MAX + offset)/c1)`。
- **大きい B 専用の別枠。** `LARGE_B = 10**12`、`PER_CELL_LARGE_B = 10`（(rate, n, kind) ごと）を、
  `PER_CELL = 25` とは別の辞書として設けた。
- **既存の番人はそのまま。** `monthly_payment_exact(p, …, b) != a` の検算アサート、`_schedule_ok`、
  `p <= b`、`0 < a <= MAX` のフィルタはすべて維持。
- **`_residual_js` を追加。** ブリーフの `RESIDUAL_J_MULTS ∪ _spread(j_limit)` では、(0.0001%, n=2) で
  `j_limit = 499,999,978` のとき `_spread` は `{1, 2, 3, 499, 499,999, 49,999,997, 499,999,978}` となり、
  `j = j_limit` では P の窓の幅が 2 principal 程度しかなく採択できなかった。`{j_limit·k // 10 : k = 1..9}`
  （`_residual_js`）を追加して、上限の十分の一刻みで下りる段を用意した。
- **候補の順序を 2 パスにした。** 単純な 1 パス版は既存の小さい B の候補 49 件（residual/exact 29・above 12・
  below 8）を新しい候補に押し出してしまった。パス 1 は旧コードの順（`RESIDUAL_J_MULTS` の小さい B ×
  `_principals`）を再現し、パス 2 で新しい候補を追加、(B, P) で重複除去する。結果: **旧 2,458 件は全件保持、
  68 件追加、0 件脱落**。
- **生成器のコメントの偽の理由を訂正。** `RESIDUAL_J_MULTS` の旧コメントにあった「n が増えると c2.denominator
  が u64 域を超えて…候補が消える」という理由を書き直した。
- **生成器の実行時間:** `build_cases()` 1.39〜1.40 秒（変更前 1.09 秒）。`generate.py` 全体の実時間
  **1.69 秒**（`/usr/bin/time`）。
- **acceptance:** (a) (0.0001%, n=2) で B ≥ 1e15 の残価ケース **30 件**（exact/below/above 各 10）。
  (b) residual/below は (0.0001%, 3) ×10・(0.5%, 3) ×1・(1%, 3) ×1 に到達、residual/above は
  (0.0001%, 3) ×10 に到達。(c) セルの下限は維持（residual/below 47・residual/above 45 ≥ 20、plain
  below/above ≥ 100）。

## §2 native と wasm32 の集計の印字

`final-fix-report.md`「A4」より。修正後の JSON（2,526 件）に対する、native と wasm32 の集計の印字。

**native**（`cargo test -p calcarc-core --test loan_boundary_golden -- --nocapture`、A5 の編集後に実行）:

```
loan boundary (native): {"bonus/above": Tally { low: 32, same: 662, high: 0 }, "bonus/below": Tally { low: 0, same: 665, high: 87 }, "bonus/exact": Tally { low: 37, same: 171, high: 0 }, "plain/above": Tally { low: 149, same: 433, high: 0 }, "plain/below": Tally { low: 0, same: 535, high: 64 }, "plain/exact": Tally { low: 69, same: 56, high: 0 }, "residual/above": Tally { low: 35, same: 10, high: 0 }, "residual/below": Tally { low: 0, same: 37, high: 10 }, "residual/exact": Tally { low: 176, same: 125, high: 0 }}
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

**wasm32**（機体のキャッシュ済み chromedriver が Chrome と食い違ったため、
`--chromedriver /home/terapyon/.cache/.wasm-pack/chromedriver-d65213741bcf1a26/chromedriver` を明示。実行前に
`ps` で他の重量級段が走っていないこと・空きメモリ 21 GB を確認済み）:

1. クレート全体、`wasm-pack test --headless --chrome --chromedriver <path> crates/calcarc-wasm`:

```
     Running unittests src/lib.rs (…/calcarc_wasm-2fdab1aa7e6d3121.wasm)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 filtered out; finished in 0.00s
     Running tests/boundary_shape.rs (…)
test result: ok. 10 passed; 0 failed; 0 ignored; 0 filtered out; finished in 0.01s
     Running tests/carried_value_parity.rs (…)
     Running tests/label_parity.rs (…)
     Running tests/loan_boundary.rs (…/loan_boundary-5c4d7db130ec2f9a.wasm)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 filtered out; finished in 0.14s
     Running tests/token_parity.rs (…)
     Running tests/web.rs (…)
test result: ok. 49 passed; 0 failed; 0 ignored; 0 filtered out; finished in 0.04s
```

2. `… crates/calcarc-wasm --test loan_boundary -- --nocapture`:

```
loan boundary (wasm32) [low, same, high]: {"bonus/above": Tally { low: 32, same: 662, high: 0 }, "bonus/below": Tally { low: 0, same: 665, high: 87 }, "bonus/exact": Tally { low: 37, same: 171, high: 0 }, "plain/above": Tally { low: 149, same: 433, high: 0 }, "plain/below": Tally { low: 0, same: 535, high: 64 }, "plain/exact": Tally { low: 69, same: 56, high: 0 }, "residual/above": Tally { low: 35, same: 10, high: 0 }, "residual/below": Tally { low: 0, same: 37, high: 10 }, "residual/exact": Tally { low: 176, same: 125, high: 0 }}
test monthly_payments_stay_within_the_allowance_on_yen_boundaries_in_wasm32 ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 filtered out; finished in 0.19s
```

native と wasm32 はセル単位で完全に一致する。wasm のテストバイナリは `include_str!` で新しい JSON を読んでおり
（`residual/exact` の合計が新しい件数の 301 に一致）、両方とも失敗 0 件で、§4.7 の止める条件は発火しなかった。

## §3 JSON の集計スクリプトと出力

`final-fix-report.md`「Regenerated-JSON tally script and output」より。`python3 tally_boundary.py
testdata/loan_boundary.json <old JSON>` として実行（old JSON は b51064e 時点の `testdata/loan_boundary.json`
のコピー）。

```python
"""testdata/loan_boundary.json を直接集計する(A6 の表の出典)。

usage: python tally_boundary.py <loan_boundary.json> [old.json]
"""

import json
import sys
from collections import defaultdict


def rate_key(r: str) -> float:
    return float(r)


def main() -> None:
    cases = json.load(open(sys.argv[1], encoding="utf-8"))["cases"]
    cells: dict = defaultdict(lambda: {"n": 0, "rates": set(), "terms": set(), "maxB": 0})
    rn: dict = defaultdict(lambda: defaultdict(int))
    big = defaultdict(int)
    for c in cases:
        key = f"{c['set']}/{c['boundary']}"
        inp = c["input"]
        cell = cells[key]
        cell["n"] += 1
        cell["rates"].add(inp["rate"])
        cell["terms"].add(inp["n"])
        b = int(inp.get("residual", "0"))
        cell["maxB"] = max(cell["maxB"], b)
        if c["set"] == "residual":
            rn[key][(inp["rate"], inp["n"])] += 1
            for lim in (10**12, 10**15):
                if b >= lim:
                    big[(inp["rate"], inp["n"], c["boundary"], lim)] += 1
    order = [f"{s}/{b}" for s in ("plain", "residual", "bonus") for b in ("exact", "below", "above")]
    print("| 集合/境界 | 件数 | 年利 | 期間(回) | 最大の B |")
    print("|---|---|---|---|---|")
    for k in order:
        c = cells[k]
        rates = ", ".join(sorted(c["rates"], key=rate_key))
        terms = ", ".join(str(t) for t in sorted(c["terms"]))
        print(f"| {k} | {c['n']} | {rates} | {terms} | {c['maxB']:,} |")
    print("total", len(cases))
    print()
    for k in ("residual/exact", "residual/below", "residual/above"):
        print(k, dict(sorted(rn[k].items(), key=lambda kv: (rate_key(kv[0][0]), kv[0][1]))))
    print()
    for key, v in sorted(big.items(), key=lambda kv: (rate_key(kv[0][0]), kv[0][1], kv[0][3], kv[0][2])):
        print("residual B >= %.0e" % key[3], key[:3], v)
    r2 = [int(c["input"]["residual"]) for c in cases
          if c["set"] == "residual" and c["input"]["rate"] == "0.0001" and c["input"]["n"] == 2]
    print("(0.0001, 2) residual cases with B >= 1e15:", sum(b >= 10**15 for b in r2))
    if len(sys.argv) > 2:
        old = {c["id"] for c in json.load(open(sys.argv[2], encoding="utf-8"))["cases"]}
        new = {c["id"] for c in cases}
        print(f"ids: old {len(old)}, new {len(new)}, kept {len(old & new)}, "
              f"dropped {len(old - new)}, added {len(new - old)}")
        dropped = defaultdict(int)
        for i in old - new:
            dropped["/".join(i.split("/")[:2])] += 1
        print("dropped by cell:", dict(dropped))


if __name__ == "__main__":
    main()
```

出力（コミットされた `testdata/loan_boundary.json` に対して）:

```
| 集合/境界 | 件数 | 年利 | 期間(回) | 最大の B |
|---|---|---|---|---|
| plain/exact | 125 | 0.5, 1, 2, 15, 100 | 2, 3 | 0 |
| plain/below | 599 | 0.0001, 0.5, 1, 2, 15, 100 | 2, 3, 12, 120, 360, 1200 | 0 |
| plain/above | 582 | 0.0001, 0.5, 1, 2, 15, 100 | 2, 3, 12, 120, 360, 1200 | 0 |
| residual/exact | 301 | 0.0001, 0.5, 1, 2, 15, 100 | 2, 3 | 5,400,000,209,999,980 |
| residual/below | 47 | 0.0001, 0.5, 1 | 2, 3 | 6,912,000,864,000,024 |
| residual/above | 45 | 0.0001 | 2, 3 | 6,912,000,864,000,024 |
| bonus/exact | 104 | 0.5, 1, 2, 15, 100 | 12 | 0 |
| bonus/below | 376 | 0.0001, 0.5, 1, 2, 15, 100 | 12, 120, 360, 1200 | 0 |
| bonus/above | 347 | 0.0001, 0.5, 1, 2, 15, 100 | 12, 120, 360, 1200 | 0 |
total 2526

residual/exact {('0.0001', 2): 35, ('0.5', 2): 31, ('0.5', 3): 35, ('1', 2): 25, ('1', 3): 25, ('2', 2): 25, ('2', 3): 25, ('15', 2): 25, ('15', 3): 25, ('100', 2): 25, ('100', 3): 25}
residual/below {('0.0001', 2): 35, ('0.0001', 3): 10, ('0.5', 3): 1, ('1', 3): 1}
residual/above {('0.0001', 2): 35, ('0.0001', 3): 10}

residual B >= 1e+12 ('0.0001', 2, 'above') 10
residual B >= 1e+12 ('0.0001', 2, 'below') 10
residual B >= 1e+12 ('0.0001', 2, 'exact') 10
residual B >= 1e+15 ('0.0001', 2, 'above') 10
residual B >= 1e+15 ('0.0001', 2, 'below') 10
residual B >= 1e+15 ('0.0001', 2, 'exact') 10
residual B >= 1e+12 ('0.0001', 3, 'above') 10
residual B >= 1e+12 ('0.0001', 3, 'below') 10
residual B >= 1e+15 ('0.0001', 3, 'above') 10
residual B >= 1e+15 ('0.0001', 3, 'below') 10
residual B >= 1e+12 ('0.5', 2, 'exact') 6
residual B >= 1e+12 ('0.5', 3, 'exact') 10
(0.0001, 2) residual cases with B >= 1e15: 30
ids: old 2458, new 2526, kept 2458, dropped 0, added 68
dropped by cell: {}
```

残価の B の範囲、(rate, n, kind) ごと（同じ JSON への一回きりの集計）:

```
('0.0001', 2, 'above') min 12,000,001 max 5,400,000,209,999,980
('0.0001', 2, 'below') min 12,000,001 max 5,400,000,209,999,980
('0.0001', 2, 'exact') min 12,000,001 max 5,400,000,209,999,980
('0.0001', 3, 'above') min 5,760,000,720,000,020 max 6,912,000,864,000,024
('0.0001', 3, 'below') min 6,048,000,756,000,021 max 6,912,000,864,000,024
('0.5', 2, 'exact') min 2,401 max 1,080,224,949,468
('0.5', 3, 'below') min 23,054,402 max 23,054,402
('0.5', 3, 'exact') min 11,527,201 max 1,440,289,183,347
('1', 2, 'exact') min 1,201 max 2,402
('1', 3, 'below') min 5,767,202 max 5,767,202
('1', 3, 'exact') min 2,883,601 max 8,650,803
('2', 2, 'exact') min 601 max 1,202
('2', 3, 'exact') min 721,801 max 1,443,602
('15', 2, 'exact') min 81 max 81
('15', 3, 'exact') min 13,041 max 26,082
('100', 2, 'exact') min 13 max 13
('100', 3, 'exact') min 325 max 325
```

**`b_limit` と `c2.denominator` の (年利, n) ごとの値**（設計書の n ≥ 12 の残価の議論の出典。生成器自身の
`_floor` と `loan_ref` で計算）:

```
0.0001 n=2    c2.den bits=24    b_limit=6.000e+15 j_limit=499999978
0.0001 n=3    c2.den bits=49    b_limit=8.000e+15 j_limit=27
0.0001 n=12   c2.den bits=263   b_limit=1.100e+16 j_limit=0
   0.5 n=2    c2.den bits=12    b_limit=1.200e+12 j_limit=499895854
   0.5 n=3    c2.den bits=24    b_limit=1.600e+12 j_limit=138831
   0.5 n=12   c2.den bits=127   b_limit=2.200e+12 j_limit=0
     1 n=2    c2.den bits=11    b_limit=6.002e+11 j_limit=499791752
     1 n=3    c2.den bits=22    b_limit=8.003e+11 j_limit=277546
     1 n=12   c2.den bits=116   b_limit=1.100e+12 j_limit=0
     2 n=2    c2.den bits=10    b_limit=3.002e+11 j_limit=499583679
     2 n=3    c2.den bits=20    b_limit=4.003e+11 j_limit=554630
     2 n=12   c2.den bits=105   b_limit=5.505e+11 j_limit=0
    15 n=2    c2.den bits=7     b_limit=4.025e+10 j_limit=496894409
    15 n=3    c2.den bits=14    b_limit=5.366e+10 j_limit=4115014
    15 n=12   c2.den bits=74    b_limit=7.378e+10 j_limit=0
   100 n=2    c2.den bits=4     b_limit=6.240e+09 j_limit=479999999
   100 n=3    c2.den bits=9     b_limit=8.316e+09 j_limit=25586353
   100 n=12   c2.den bits=44    b_limit=1.138e+10 j_limit=0
(n = 120, 360, 1200: j_limit = 0 for all six rates; c2.den 445–28,207 bits.)
```

n ≥ 12 のすべての年利で `j_limit = 0` である——上限が許す B の最大が、その n での `c2.denominator` を
下回るため、残価の境界ケースは期間 12 回以上には置けない（これは上限の式に根拠のある限度であり、§6 の
ruling 129 で「既知の限度」として受け入れている）。

## §4 赤の確認の印字（設計書 §4.5）

**許容 0、native**（`task-3-report.md:132-142`）。`testdata/loan_boundary.json` の `tolerance.above_yen` /
`below_yen` を `1`/`1` から `0`/`0` に変更:

```
Result: FAILED. `613 outside the allowance:` — first line:
`residual/exact/0.0001/2/24000000/12000001: monthly 12000001 vs floor 12000002`
```

`cd reference && uv run --no-config python scripts/generate.py` で戻し、`git status --porcelain
testdata/` が空であることを確認した。

**−2、native（集約されたやり直し）**（`task-3-report.md:38-66`）。`closed_form.rs` の
`Ok(a as u64) // 円未満切り捨て(設計書 §2 の 1 語)` を `Ok((a as u64).saturating_sub(2)) // 円未満切り捨て
(設計書 §2 の 1 語)` に変更:

```
Result: FAILED, and this time the tally line **is** printed, followed by the full aggregated
list of 3126 entries (both `Err`-derived lines and allowance violations):

loan boundary (native): {"bonus/above": Tally { low: 688, same: 0, high: 0 }, "bonus/below": Tally { low: 744, same: 0, high: 0 }, "bonus/exact": Tally { low: 204, same: 0, high: 0 }, "plain/above": Tally { low: 576, same: 0, high: 0 }, "plain/below": Tally { low: 596, same: 0, high: 0 }, "plain/exact": Tally { low: 125, same: 0, high: 0 }, "residual/above": Tally { low: 25, same: 0, high: 0 }, "residual/below": Tally { low: 25, same: 0, high: 0 }, "residual/exact": Tally { low: 275, same: 0, high: 0 }}
...
thread '...' panicked at crates/calcarc-core/tests/loan_boundary_golden.rs:...:
3126 outside the allowance:
plain/above/0.0001/2/4/0: loan_forward returned SyntaxError
plain/above/0.0001/2/6/0: monthly 1 vs floor 3
plain/above/0.0001/2/8/0: monthly 2 vs floor 4
plain/above/0.0001/2/10/0: monthly 3 vs floor 5
plain/above/0.0001/2/14/0: monthly 5 vs floor 7
...
test monthly_payments_stay_within_the_allowance_on_yen_boundaries ... FAILED
```

3126 件のうち 18 件は `Err` に由来（`loan_forward returned SyntaxError`）、残りは許容違反。`compared` は
2,458 件全件と一致し、9 セルすべてが少なくとも 1 件のタリーを受け取った（＝1 件の `Err` で走行全体が
止まらないことを確認）。再編集で `Ok(a as u64) // 円未満切り捨て(設計書 §2 の 1 語)` に戻した。

（この赤の確認は元は panic で止まる形だった——`task-3-report.md:144-163` の旧形は c3a7c60 の直し
（Task 3 review の Ruling、§6 参照）で集約する形に置き換えられ、上のとおり超えられた。旧 panic 形の記録は
残すが、数える対象は上の集約形である。）

**+2、native**（`task-3-report.md:165-174`）。`closed_form.rs` の同じ行を `Ok(a as u64 + 2) // 円未満切り捨て
(設計書 §2 の 1 語)` に変更:

```
Result: FAILED. `2823 outside the allowance:` — first line:
`plain/above/0.0001/2/4/0: monthly 4 vs floor 2`
```

再編集で元に戻し、`git diff --quiet -- crates/calcarc-core/src` が exit 0 であることを確認した。

**許容 0、wasm32**（`task-4-report.md:89-114`）。`testdata/loan_boundary.json` の `tolerance.below_yen` /
`above_yen` を `0`/`0` に変更（コミットしない一回きりの Python 編集）:

```
Result: **FAILED**.

613 outside the allowance:
plain/below/0.0001/2/7999999/0: monthly 4000000 vs floor 3999999
plain/below/0.0001/2/15999998/0: monthly 8000000 vs floor 7999999
plain/below/0.0001/2/23999997/0: monthly 12000000 vs floor 11999999
plain/below/0.0001/2/39999995/0: monthly 20000000 vs floor 19999999
plain/below/0.0001/2/55999993/0: monthly 28000000 vs floor 27999999
...
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 filtered out; finished in 0.15s

(613 is the exact count reported; the aggregated list included both `plain`, `residual`, and
`bonus` lines, i.e. the same failure format used by the PASS path's `assert!`.)

Revert: `cd reference && uv run --no-config python scripts/generate.py` regenerated
all `testdata/*.json` (including `loan_boundary.json`, 2458 cases).
```

**期待値の側 +1**（`progress.md`、§4.5 expected-side red check try 1 / try 2）:

- try 1: 全 2,458 件の `monthly_floor` を +1 → FAILED だが**間違った理由**——
  `loan_boundary_golden.rs:111` の golden 健全性の assert（expectation above the cap）が
  `residual/exact/15/2/987654400/81` で先に落ち、比較そのものには届いていない（上限ちょうどの件が +1 で
  上限を超えた）。**数えない。**
- try 2: 上限を超えない 2,457 件だけ `monthly_floor` を +1（上限ちょうど 1 件は除外）→ FAILED、**正しい理由**
  ——`loan_boundary_golden.rs:173` の最後の assert、393 件が許容外、1 件目は
  `plain/above/0.0001/3/30000001/0: monthly 10000001 vs floor 10000003`、集計の印字あり。393 =
  元の `plain` と `residual` の low の合計（69+149+150+25）。使い捨て木の中で restore、`status` 空、
  `worktree` を除去して戻した。

**最終修正の波自身の赤の確認**（`final-fix-report.md`「A2」「B2」「B3」の短い形、FAIL 行つき）:

A2（新しい 2 つの pytest ガードを、`_residual` ループの先頭に一時的に `if b > 10**12: break` を戻して確認）:

```
E       AssertionError: 0
E       assert 0 >= 10
E           AssertionError: ('above', {2})
E           assert False
FAILED tests/test_loan_boundary.py::test_residual_cases_reach_the_largest_residuals_the_cap_allows
FAILED tests/test_loan_boundary.py::test_residual_near_boundary_cases_reach_beyond_two_payments
2 failed, 6 passed in 1.50s
```

B2（`renderVerdicts` から `if … throw` ブロックを外して確認）:

```
  1) tests/corpus/report.spec.ts:1963:1 › an exact area that measured a relative error is refused, not reported as a match
    Error: expect(received).toThrow(expected)
    Expected pattern: /厳密に比べる領域/
    Received function did not throw
  1 failed
```

B3（`exact: cases > 0 && measured === 0` に戻して確認）:

```
  1) tests/corpus/report.spec.ts:1939:1 › the comparison kind comes from the area, not from whether an error was measured
    Error: expect(received).not.toContain(expected) // indexOf
    Expected substring: not "厳密一致"
    Received string:        "| `scientific` | **採録ケースで表示精度内** | 2000 | 厳密一致 | 0 |"
  1 failed
```

いずれも再編集で戻し、`git diff` が元の内容と一致することを確認した。

## §5 残価の f64 誤差の実測（最終レビュー I-1、controller）

`progress.md` の「I-1 調査」「I-1 調査の続き」より。

**I-1 調査**（native の閉形式を Python で正確に写す——`as_f64_monthly` は `num as f64 / den as f64`、glibc の
`expm1`/`log1p`）: 残価ありの月額は概ね `(c1−c2)·B`（残価の利息）以上なので、月額 10 億円の上限が B も縛る
（年 0.0001%・n=2 で b_max ≈ 6.0e15、n=3 で 8.0e15、n=12 で 1.1e16、年利が上がれば比例して小さくなる）。
`P < 2^53` なので `P as f64` は正確で、誤差は `B/pow_n` の丸めと `pow_n`・年金現価の偏りに由来する——桁外れの
破れは無い。5 年利 × n=2,3,12 × 各 2 万件の走査: 最悪 **−0.863 円**（0.0001%・n=2・B≈5.96e15）、floor が 2 以上
ずれた件は 0。**native では許容は保たれている。ただし余裕は薄く、wasm32（Rust の libm）で `pow_n` が 1 ulp
違えば B≈6e15 で約 0.6 円動く**——製品の算術で確かめる価値がある、と判断した。

**I-1 調査の続き**: 上位 1% の B に各 10 万件。年 0.0001%・n=2（b_max 6.0000e15）で最悪 **−0.8662**、|err| の
分布 `[0,.25,.5,.75,1+) = [38400, 25009, 25171, 11420, 0]`、floor が 2 以上ずれた件 0。n=3（8.0000e15）で最悪
**+0.7717**、`[0, 46111, 49919, 3970, 0]`、0 件。native では |err| < 1 が全件。wasm32 用のドライバは
`~/.cache/.wasm-pack/chromedriver-d65213741bcf1a26`（135.0.7049.114、Chrome は 135.0.7049.52）。

この調査に使った 2 本のスクリプト（再実行できるよう全文を載せる）:

```python
"""I-1: how large can the residual path's f64 error get while the monthly stays ≤ 10億?

err = (pv / annuity_m, the f64 value before the floor) − (exact theoretical monthly).
If |err| < 1 everywhere, the floor is off by at most 1 yen and the policy holds; if some
|err| ≥ 1 exists, look for an input whose floor is off by 2 and confirm it on Rust.

The emulation is exact for native Rust on linux-gnu: Rate::as_f64_monthly is
`num as f64 / den as f64` (both exact small integers → the correctly rounded quotient,
the same as float(Fraction)), and math.expm1/math.log1p are the glibc calls Rust makes.
Sampling: for each (rate, n), B up to the largest residual whose smallest monthly
(P = B + 1) is still ≤ 10億, and P uniform over the feasible window (B, (10億 + c2·B)/c1].
"""

import math
import random
import sys
from fractions import Fraction

from calcarc_reference import loan_ref

CAP = 10**9
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 20260913)
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 20000


def f64_monthly(p: int, rf: float, n: int, b: int) -> float:
    pow_n = math.expm1(n * math.log1p(rf)) + 1.0
    x = (math.expm1((n - 1) * math.log1p(rf)) + 1.0) - 1.0
    ann = (x / (x + 1.0)) / rf
    return (float(p) - float(b) / pow_n) / ann


worst_overall = (0.0, None)
for rate in ["0.0001", "0.0002", "0.0005", "0.001", "0.01"]:
    num, den = loan_ref.rate_fraction(rate)
    r = Fraction(num, den)
    rf = num / den
    base = 1 + r
    for n in (2, 3, 12):
        ann_m = (1 - base ** (-(n - 1))) / r
        c1 = 1 / ann_m
        c2 = 1 / (base**n * ann_m)
        b_max = math.floor((CAP - c1) / (c1 - c2))  # monthly at P = B + 1 stays ≤ CAP
        worst = (0.0, None)
        off2 = 0
        for i in range(SAMPLES):
            # half the samples in the top decade of B, where the error is largest
            b = random.randint(b_max // 10, b_max) if i % 2 else random.randint(1, b_max)
            p_hi = math.floor((CAP + c2 * b) / c1)
            if p_hi <= b:
                continue
            p = random.randint(b + 1, p_hi)
            exact = loan_ref.monthly_payment_exact(p, num, den, n, b)
            got = f64_monthly(p, rf, n, b)
            err = float(Fraction(got) - exact)
            if abs(err) > abs(worst[0]):
                worst = (err, (p, b))
            if abs(int(got) - math.floor(exact)) >= 2:
                off2 += 1
        print(f"{rate:>7} n={n:<3} b_max={b_max:.3e}  worst err={worst[0]:+.4f} at P,B={worst[1]}  floor off by ≥2: {off2}")
        if abs(worst[0]) > abs(worst_overall[0]):
            worst_overall = (worst[0], (rate, n, worst[1]))
print("overall worst:", worst_overall)
```

```python
"""I-1, dense pass: 100k samples in the top 1% of B, where the 20k scan found the worst error.

Same emulation as i1_residual_error_search.py (exact for native Rust on linux-gnu).
Run from reference/: uv run --no-config --frozen python <this file>
Printed on 2026-09-13:
  0.0001 n=2 top-1% B (b_max=6.0000e+15) 100k: worst err=-0.8662  |err| buckets [0,.25,.5,.75,1+)=[38400, 25009, 25171, 11420, 0]  floor off by >=2: 0
  0.0001 n=3 top-1% B (b_max=8.0000e+15) 100k: worst err=+0.7717  |err| buckets [0,.25,.5,.75,1+)=[0, 46111, 49919, 3970, 0]  floor off by >=2: 0
"""

import math
import random
from fractions import Fraction

from calcarc_reference import loan_ref

CAP = 10**9
random.seed(7)


def f64m(p: int, rf: float, n: int, b: int) -> float:
    pow_n = math.expm1(n * math.log1p(rf)) + 1.0
    x = (math.expm1((n - 1) * math.log1p(rf)) + 1.0) - 1.0
    return (float(p) - float(b) / pow_n) / ((x / (x + 1.0)) / rf)


for rate, n in (("0.0001", 2), ("0.0001", 3)):
    num, den = loan_ref.rate_fraction(rate)
    r = Fraction(num, den)
    rf = num / den
    base = 1 + r
    ann = (1 - base ** (-(n - 1))) / r
    c1 = 1 / ann
    c2 = 1 / (base**n * ann)
    b_max = math.floor((CAP - c1) / (c1 - c2))
    worst = 0.0
    off2 = 0
    hist = [0] * 5
    for _ in range(100000):
        b = random.randint(b_max * 99 // 100, b_max)
        p_hi = math.floor((CAP + c2 * b) / c1)
        if p_hi <= b:
            continue
        p = random.randint(b + 1, p_hi)
        ex = loan_ref.monthly_payment_exact(p, num, den, n, b)
        got = f64m(p, rf, n, b)
        e = float(Fraction(got) - ex)
        worst = e if abs(e) > abs(worst) else worst
        hist[min(4, int(abs(e) / 0.25))] += 1
        off2 += abs(int(got) - math.floor(ex)) >= 2
    print(
        f"{rate} n={n} top-1% B (b_max={b_max:.4e}) 100k: worst err={worst:+.4f}  "
        f"|err| buckets [0,.25,.5,.75,1+)={hist}  floor off by >=2: {off2}"
    )
```

実行コマンド（`reference/` から）: `uv run --no-config --frozen python <file>`。

## §6 裁定

`progress.md` の `Ruling:` 行を、出た順に、それぞれ属するタスクの文脈つきで、すべて載せる。

**Pre-flight scan（controller、Task 1 の前）**

- Ruling: PR B を main からではなく PR A の先端から切る（設計書 §9 は B を main 起点と書く）——計画と設計書が
  同じ枝にあるので、B の読み手が設計書を辿れる。マージは A → B の順 — 間違っていたら（B を先に入れたいなら）
  B を main へ積み直す。B は heavy のファイルと docs 2 つだけで A と重ならない
- Ruling: 重い段は Task 4 の `wasm-pack test` の直前に controller が監視役に知らせる。Chrome が手元で立たなけ
  れば CI の WASM boundary の段で確かめ、§4.7 の wasm32 の欄は「未確認」で書く — 間違っていたら wasm32 の数の
  書き戻しが 1 回遅れるだけ

**Task 1**

- Ruling: レビュー役の「コミットの末尾が CLAUDE.md の文字列（(1M context) つき）と違う」は採らない——この
  セッションのシステムの帰属の指示（Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> と Claude-Session の
  2 行）が CLAUDE.md の文言に優先する（システムが「以前の帰属の指示を置き換える」と明示）。以後も同じ 2 行 —
  間違っていたら末尾 1 行を揃え直すだけ

**Task 2**

- Ruling: residual の below/above が (0.0001%, n=2) の 1 系統にしか届かないのは、残価の項 c2·B を整数にする
  作り方の構造上の限界（c2 の分母が n=3 で 49 ビット、n=4 で 73 ビット——実装者の実測）。この段では受け入れる。
  Task 5 で設計書 §4.7 に限界として書き、最終レビューに回す。作り方を変える（c2·B を整数にせず、目標の整数と
  の差を探す非斉次の近似）は計画の範囲外 — 間違っていたら、残価ありの境界のずれを n=2 以外で見逃す（残価
  なしと賞与は年利・期間の端まで踏んでいる）
  **→ この裁定は最終レビュー I-1 で前提が偽と判明し、後出の ruling（「私の Task 2 の裁定…を撤回する」）で
  撤回された。台帳の行として両方残す。**

**Task 3**

- Ruling: 直す——Err は失敗の 1 件として記録して続け、最後にまとめて赤くする（compared にも数える）。計画の
  コード（私が書いた）のままでは、番人が「全体を見て落ちる」という設計 §0-3 の狙いを 1 件目の Err で失う。
  Task 4 の wasm32 のテストも同じ形（kind != "ok" を失敗として記録して続ける）で書かせる — 間違っていたら
  数行の直しが無駄になるだけ

**Task 6**

- Ruling: 注記 D のテストの `not.toContain("採録ケースで一致")` を行に絞った実装者の変更を認める — 簡約書の
  文言は凡例が必ずその語を含むので満たせない（簡約書の欠陥、私の書き損じ）。行の形
  `"`scientific` | **採録ケースで一致**"` は relMeasured から判定を引く誤りのときにだけ現れる — 誤りなら、
  行の書式が変わった日に何も主張しないテストになる（レビューで赤確認の有無を見る）
- Ruling: 既存の biome useTemplate info 2 件（report.ts、exit 0）は本タスクの差分外なので直さず持ち越す —
  触ると差分が改名と無関係に広がる — 誤りなら最終レビューで拾う 1 行
- Ruling: 1 行の修正差分の限定再レビューは controller が差分を直接読んで行う（指摘どおりの toContain 1 行・
  他の変更なし・作業木 空）— 1 行に別の席を立てる手数が見合わない — 誤りなら最終レビューが拾う

**Task 7**

- Ruling: Task 8 step 2 のスイープを Task 7 のレビューと並べて c1dd7bb で回す — レビュー役は読むだけ（重い段
  なし）で、差分は文書 2 本なので結果に影響しない — レビューが文書の直しを求めたら check-citations だけ回し
  直す（コードに触る直しなら全部回し直す）
- Ruling: 最終レビューを Task 7 のレビューと並べて出す — Task 7 は文書 2 行で、最終レビューは読むだけ —
  Task 7 のレビューが直しを求めたら、最終レビューの 1 回きりの修正の波に入れる（波が 2 回にならない）

**設計書 §4.5 の欠けた赤の確認（Finding、controller の計画の欠陥）**

- Ruling: スイープの後に controller が同じ作業木で行う——JSON の monthly_floor を全件 +1（Python の一回きり、
  コミットしない）→ `cargo test -p calcarc-core --test loan_boundary_golden` が FAIL することを見る → 戻しは
  generate.py の再生成、git status 空を確かめる — 設計書の求める番人の確認が 1 つ欠けたまま「§4.5 を回した」
  と報告しない — 誤りなら（赤くならなければ）期待値を比べていない穴なので最終の修正の波に入れる

**最終レビュー（opus）を受けての裁定**

- Ruling: I-3 を採る——`renderVerdicts` で厳密の領域が `relMeasured > 0` なら throw、単体テスト
  （`finance-000.json`, `relMeasured 5` で throw）と throw を消す赤確認、`:1941` の同語反復のテストはこれに
  置き換える — 「一致」は強い主張で、崩れたとき赤くなるものが要る（CLAUDE.md の番人） — 誤りなら将来の正当な
  シャードで報告書が落ちるが、落ちるのは黙って嘘を書くより良い
- Ruling: M-4 を採る（exact 列は `comparisonOf(area)==="exact" && cases>0 && measured===0`。I-3 と同じ手）、
  M-5 を採る（凡例と JSDoc の「10 桁の文字列を突き合わせてはいない」を「値のケースは相対誤差で比べており、
  この判定は 10 桁の文字列の一致を意味しない」に）、M-1 を採る（§4.7 の「674b4df 相当」を JSON を作った
  26fd75d と測った先端に）、M-2 を採る（bonus の集計は 1 件 2 比較と 1 行書く）、M-3 を採る（「何かを比べた
  ことを数える」の註を直し、セルの空の assert より先に失敗の一覧を出す） — いずれも数行で、最終の 1 回の波に
  収まる — 誤りでも挙動は変えない（M-3 の assert の順だけ）
- Ruling: I-1 は文書の直しだけでなく生成器の直しまで採る——b の上限 10**12 を「上限の月額が B を縛る」式の
  上限に換え、j を b_max まで広げ、P を実現可能な窓 (B, (10億+c2·B)/c1] に向けて探す。残価の below/above を
  n=2 以外にも、B≥1e15 の件を (0.0001%, n=2) に置き、native と wasm32 で測り直す。§4.7 の偽の理由を直す —
  最も余裕の薄い角（0.86 円）が golden に 1 件も無く、wasm32 の数は Python では出せない — コストは JSON の
  差し替えと §4.7 の測り直し（wasm-pack 1 回）。10 億円以下で上下 1 円を超えたら §4.7 の止める条件どおり
  止めて利用者へ戻す
- Ruling: 私の Task 2 の裁定（progress.md:40「構造上の限界」）を撤回する——前提が偽（49 bit は u64 に収まる。
  限度は生成器の 1e12 の打ち切りと窓を狙わない P の探索）。台帳の該当行は残し、この行で打ち消す
- Ruling: I-2 を採る——numerical-policy.md に網羅の限度を 1 文足す（数は生成器の直しの後の §4.7 の表から
  取る）。test_policy_matches_loan_boundary.py の文言は保つ
- Ruling: 最終の修正は 1 回の発注（opus）にまとめる。PR A 側の直し（生成器・JSON・pytest・Rust テストの
  M-3・設計書 §4.7・数値方針）は docs/0-9-2-verification に積み、heavy/verdict-names をその上に rebase
  （未 push なので SHA が変わってよい）、PR B 側の直し（I-3・M-4・M-5）は heavy/verdict-names に積む — 直しが
  属する PR に入らないと、A だけ先に入ったとき偽の理由が main に残る — rebase の衝突は起きない見込み（触る
  ファイルが重ならない。起きたら止めて報告）

**最終修正の波（opus）を受けての裁定**

- Ruling: 懸念 1（(0.0001%, 2) の B の上位 10% に件が無い、最大は 5.4e15）は持ち越し、PR D（同じ生成器を触り
  wasm32 を回す）で上位の段を足す — native は上位 1% に 10 万件で |err| < 1 が全件、wasm32 は B≥1e15 の
  50 件を含む全 2,526 件で native と floor が一致（libm の差が効いていない）、上位 10% で誤差は 1 割ほどしか
  増えない — 誤りなら wasm32 だけが上位 10% で 1 円を超える件を PR D まで見逃す
- Ruling: 懸念 2（n ≥ 12 の残価の件が 0）は既知の限度として受ける——「c2·B を整数にする」作り方では n ≥ 12 で
  c2 の分母が上限から決まる b_limit を超える（今度は上限の式に根拠のある限度）。§4.7 に記載済み。作り方を
  変える（c2·B の端数を連分数の目標に入れる）のは名前つきの持ち越し — 誤りなら長期の残価ローンの境界のずれを
  見逃す
- Ruling: 懸念 3（progress.md:40 の偽の理由）は、既に同じ台帳の撤回の行で打ち消してある（台帳は履歴として
  消さない）
- Ruling: 懸念 4（Playwright の部分走行が exit 1）は既存の仕様——globalTeardown の writeReport が要約 0 件の
  とき書くのを拒む。Task 6 の時点（B の直しの前）でも同じ exit 1。判定は「N passed」と失敗 0 で見る。今後の
  簡約書ではこの 1 段を `&&` で繋がない
- Ruling: 懸念 5（計画書の Task 6 のコードが旧い凡例の文言）は直さない——計画は書いた日の論証で、実装は計画
  の後にレビューで直った（設計書が拘束する）
- Ruling: 逸脱「summary() の既定 relMeasured を読み込み側の型に合わせて 0 にした（17 件の個別修正の代わり）」
  は受ける——不可能な状態の出どころはヘルパーの既定で、明示の上書きは勝つ（B2 はそれで作る）。限定再レビュー
  で意図の変わったテストが無いかを見る

**Correction（ruling 128 の文言）**

「全 2,526 件で native と floor が一致」は証拠より強い——比べたのはセルごとの集計（9 セル同一）と、両方とも
±1 円の外 0 件であること。1 件ずつの floor は突き合わせていない。結論（許容が保たれ、libm の差が集計に現れ
ない）は変わらない。報告ではこの弱い形で書く。

**限定再レビュー（opus）を受けての裁定**

- Ruling: N-1 は controller が直す（PR A の枝に 1 行、PR B を rebase）——2・3 回は上限（6.0e15・8.0e15）が
  2^53 未満なので正確、12 回は上限が 2^53 を超え P と B の f64 化にも丸めが入るが年金現価（約 11）で割られる
  （controller の 2 万件の走査で 12 回の最悪 −0.28 円）と書く — 拘束する設計書に偽の理由を残さない（1 行で
  直る）— 文書だけなので check-citations だけ回し、フルスイープは回し直さない（コードと JSON はスイープ
  済みの木と同じ）

**この文書自身についての裁定**

- Ruling: 作業場を消す前に、引かれている証拠を追跡下の 1 本 `docs/superpowers/sdd/2026-09-12-calc-fixes-
  verification.md` に移す——内容は (1) 引用されている印字（A4 の native/wasm32 の集計の行、JSON の集計
  スクリプトと出力、n≥12 の (年利,n) ごとの値、Task 2 の生成器の逸脱の理由）、(2) 全裁定とコスト、(3) 持ち
  越しと裁定待ち、(4) レビューの結論（最終・限定再レビュー）。7 か所の引用をこの文書へ向け直す。PR A に
  1 コミット、PR B を rebase — 引用先が消える／見えないまま出荷しない — コストは文書 1 本と註の書き換え
  （コード・JSON は動かない。check-citations と reference の ruff/pytest で確かめる）

## §7 レビューの結論

### 最終レビュー（opus、`final-review.md`）

**判定: With fixes。** Critical 0。

- **I-1.** Task 2 の裁定の前提が偽——49 bit は u64 に収まる。残価の境界ケースが (0.0001%, n=2) 1 点に限られる
  真の理由は、生成器の `10**12` 打ち切りと、窓を狙わない P の探索だった。§4.7 も同じ偽の理由を持つ。
- **I-2.** `numerical-policy.md` が golden の実際の網羅より広い網羅（年利・期間の全端）を主張している。
- **I-3.** 「採録ケースで一致」という強い名前が、崩れても赤くならない前提（`relMeasured > 0` の exact 領域）
  に依存している。
- **M-1.** §4.7 の「674b4df 相当のコミットで実測」は、その JSON が 674b4df には存在しないので誤り。
- **M-2.** bonus の集計は 1 件につき 2 回比較しているが、その旨が書かれていない。
- **M-3.** `compared` は毎回インクリメントされるので `assert_eq!(compared, len)` は原理上落ちない——実効的な
  番人はセルごとの `> 0` の方だが、コメントが違う行を指している。
- **M-4.** note D の状態で「表示精度内」の判定行は直ったが、隣の段落がまだ「`scientific` は厳密一致である」
  と主張していて矛盾する。
- **M-5.** 凡例の「10 桁の文字列を突き合わせたのではない」という文言が広すぎる（display シャードは実際に
  文字列一致で比べている）。

### 限定再レビュー（opus、`final-rereview.md`）

I-1・I-2・I-3・M-1〜M-5 はすべて **Addressed**（それぞれの直しを一次資料で確認済み。§6 の該当する ruling を
参照）。

新しい Minor 1 件:

- **N-1.** §4.7 の「この範囲では P < 2^53」は (0.0001%, n=12) では偽（B の上限 1.1e16 > 2^53 ≈ 9.0e15）。
  golden には n ≥ 12 の残価の件が無いので golden 自体への影響はない。**`61d5f21` で修正済み**（PR B は
  `8b055b3` に rebase、`range-diff` で 4 コミットとも `=`）。

### タスクごとのレビュー（`progress.md`）

- **Task 1:** ✅ Approved（拒否の規則は `monthly_payment` と同一、残価の式も同じ構造、監査の例を代数で検算、
  独立の宣言あり、2 ファイルだけ）。
- **Task 2:** ✅ Approved（9 セルから 54 件を厳密値で再計算して食い違い 0、重複除去は同じ p の二重導出だけを
  落とす正しい直し、広げたのは許された手段だけ、残価の偏りの裁定に同意）。
- **Task 3:** ✅ Approved、ただし Important 1 件（`Err` を `unwrap_or_else(panic)` にしていた）。fix round 1
  （c3a7c60）で ADDRESSED、新しい破損なし。
- **Task 4:** ✅ Approved（境界を渡る・同じ JSON と許容・Err を記録して続ける・報告の形は native と揃う・
  fmt/clippy はレビュー役も再現で緑、赤の確認の出力は実物の golden と整合）。
- **Task 5:** ❌ Needs fixes — Important 1 件（bonus の below/above が年利・期間の両端に届くという記述が bonus
  について偽）。fix round 1（b51064e）で 2 件とも ADDRESSED、新しい破損なし。
- **Task 6:** spec ✅ / quality Changes requested（注記 D のテストに「表示精度内」の肯定の assert が無い）。
  fix round 1（c87855d）で 1 行の肯定 assert を追加、限定再レビューは controller が直接読んで確認。
- **Task 7:** spec ✅ / quality Approved、指摘 0（対応表は `report.ts` の `AREAS`/`EXACT_AREAS` と一致、
  5e-10 不変、check-citations 緑）。

## §8 持ち越しと裁定待ち

**`minor (deferred)` の一覧**（`progress.md`）:

- Task 1: `monthly_payment_exact` の `n == 1` の分岐をテストが通らない（1 行の積）。
- Task 2: `_plain`/`_residual`/`_bonus` のふるいの条件が似た形で 3 回ある。
- Task 2: `PER_CELL=25` は residual のために全体で上げた——plain/bonus の exact も下限を大きく超えた。
- Task 3: `residual/above` は low 25 だけ（片側）——構造上の限界（Task 2 の裁定）の表れ（この裁定は §6 で
  撤回されている。片側になっていた真の理由は生成器の 1e12 打ち切りであり、最終修正の波で both が採れる
  ようになった——修正後の件数は §3 の表を参照）。
- Task 4: wasm32 のテストは `max_monthly_yen` を確かめない（native はする）。
- Task 4: ok の結果の欄が欠けたら `get()`/`yen_field()` が panic（`Outcome` の形は `boundary_shape.rs` が
  見張る）。

**biome の `useTemplate` info。** `heavy/tests/corpus/report.ts:1690,1700` の 2 件は本タスクの差分と無関係の
既存の info（exit 0）。Task 6 の ruling（§6）で「触ると差分が改名と無関係に広がる」ため直さず持ち越した。

**I-1 の 2 つの既知の限度:**

- (0.0001%, 2) の B の上位 10%（≈ 5.4e15〜6.0e15）に golden の件が無い。**PR D**（同じ生成器を触り、wasm32 を
  もう一度回す）に持ち越し（§6 の ruling 128）。
- n ≥ 12 の残価の件が 0（c2 の分母が上限から決まる `b_limit` を超えるため、§3 の表）。名前つきの持ち越し
  （§6 の ruling 129）。

**PR C・PR D**（計画の「残り（別の計画）」より）:

- **PR C（F1 のシャード、設計書 §3）。** calcarc-3d のエンジン修正の枝（`fix/engine-correction`）ができてから、
  その上に積む計画を書く。
- **PR D（10 億円を超える月額の `Overflow` の見張り、§4.8）。** calcarc-3d の上限の実装の上に積む。コアの
  定数と JSON の `max_monthly_yen` の一致の検査もここ。

**利用者の裁定待ち:**

- 10 億円の上限を年利 0%・1 回払いにも掛けるか（数値方針の新節の範囲の文を、裁定後に書き足す）。
- F5 の「関数の答えの後」と `neg`（`entry-000033`）。
