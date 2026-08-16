"""Rust と突き合わせる入力ケース。

境界を重点的に含める(base-spec §33)。ゼロ、負数、四象限すべて、
実軸上と虚軸上、極めて大きい値と小さい値。
"""

from __future__ import annotations

# (re, im)
RECT_INPUTS: list[tuple[float, float]] = [
    (3.0, 4.0),
    (1.0, 0.0),
    (0.0, 1.0),
    (-1.0, 0.0),
    (0.0, -1.0),
    (1.0, 1.0),
    (-1.0, 1.0),
    (-1.0, -1.0),
    (1.0, -1.0),
    (0.0, 0.0),
    (-5.0, 10.0),
    (1e-8, 1e-8),
    (1e8, -1e8),
    (0.1, 0.2),
    (123456.789, -987654.321),
]

# (r, theta_deg)
POLAR_INPUTS: list[tuple[float, float]] = [
    (5.0, 53.13010235415598),
    (1.0, 0.0),
    (1.0, 90.0),
    (1.0, 180.0),
    (1.0, -90.0),
    (1.0, 45.0),
    (2.0, -135.0),
    (0.0, 30.0),
    (1e6, 1.0),
    (1e-8, 45.0),
]

# (関数名, 引数, 角度モード)
UNARY_INPUTS: list[tuple[str, float, str]] = [
    ("sin", 0.0, "Deg"),
    ("sin", 30.0, "Deg"),
    ("sin", 90.0, "Deg"),
    ("sin", 180.0, "Deg"),
    ("sin", -30.0, "Deg"),
    ("sin", 0.5235987755982988, "Rad"),
    ("cos", 0.0, "Deg"),
    ("cos", 60.0, "Deg"),
    ("cos", 180.0, "Deg"),
    ("cos", 3.141592653589793, "Rad"),
    ("tan", 0.0, "Deg"),
    ("tan", 45.0, "Deg"),
    ("tan", -45.0, "Deg"),
    ("tan", 89.0, "Deg"),
    # 極めて大きい値・小さい値（base-spec §33）。
    #
    # ラジアンは f64 の値をそのまま使うので、libm の引数削減と mpmath の
    # 任意精度評価は全桁一致する（1e6 まで測定して差 0）。
    # 度は f64 で π/180 を掛ける段階で誤差が入り、角度が大きいほど増幅する。
    # 実測した差は 1e5 度で 9.1e-15、1e6 度で 3.3e-13、1e7 度で 1.8e-12。
    # 許容誤差 1e-12 を超えるのは 1e6 と 1e7 のあいだなので、golden には
    # 余裕のある 1e5 を使う。この限界は numerical-policy.md に記録する。
    ("sin", 100000.0, "Deg"),
    ("sin", 1e-8, "Deg"),
    ("cos", 1e-8, "Deg"),
    ("sin", 1000000.0, "Rad"),
    ("cos", 1e-8, "Rad"),
    ("tan", 100000.0, "Rad"),
]

# sqrt の入力（実数のみ）
SQRT_INPUTS: list[float] = [0.0, 1.0, 4.0, 2.0, 0.25, -4.0, -1.0, 1e-8, 1e8]

# S-1 で足した実数の関数（設計書 §3）。**定義域の境界を必須で含める**（§8）。
# 戻り値が dict なので UNARY_INPUTS とは別のループが読む。
REAL_FN_INPUTS: list[tuple[str, float, str]] = [
    # 自然対数: 既知値 / 境界 0 / 定義域の外 / 極大・極小
    ("ln", 1.0, "Deg"),
    ("ln", 2.718281828459045, "Deg"),
    ("ln", 2.0, "Deg"),
    ("ln", 0.5, "Deg"),
    ("ln", 0.0, "Deg"),
    ("ln", -1.0, "Deg"),
    ("ln", 1e-300, "Deg"),
    ("ln", 1e300, "Deg"),
    # 常用対数
    ("log10", 1.0, "Deg"),
    ("log10", 100.0, "Deg"),
    ("log10", 0.001, "Deg"),
    ("log10", 2.0, "Deg"),
    ("log10", 0.0, "Deg"),
    ("log10", -1.0, "Deg"),
    # e^x: 全実数。溢れる側の境界も置く(709.78 あたりが f64 の限界)
    ("exp_e", 0.0, "Deg"),
    ("exp_e", 1.0, "Deg"),
    ("exp_e", -1.0, "Deg"),
    ("exp_e", 2.0, "Deg"),
    ("exp_e", 709.0, "Deg"),
    ("exp_e", 710.0, "Deg"),
    ("exp_e", -745.0, "Deg"),
    # 逆三角: 両モード / 定義域の境界ちょうど / その外側
    ("asin", 0.0, "Deg"),
    ("asin", 0.5, "Deg"),
    ("asin", 1.0, "Deg"),
    ("asin", -1.0, "Deg"),
    ("asin", 1.0000001, "Deg"),
    ("asin", -1.0000001, "Deg"),
    ("asin", 0.5, "Rad"),
    ("acos", 0.0, "Deg"),
    ("acos", 0.5, "Deg"),
    ("acos", 1.0, "Deg"),
    ("acos", -1.0, "Deg"),
    ("acos", 1.0000001, "Deg"),
    ("acos", 0.5, "Rad"),
    ("atan", 0.0, "Deg"),
    ("atan", 1.0, "Deg"),
    ("atan", -1.0, "Deg"),
    ("atan", 1e300, "Deg"),
    ("atan", 1.0, "Rad"),
    # 逆数（設計書 §3.0）。0 は DivisionByZero、極小は Overflow。
    ("recip", 4.0, "Deg"),
    ("recip", -8.0, "Deg"),
    ("recip", 1.0, "Deg"),
    ("recip", 3.0, "Deg"),
    ("recip", 0.0, "Deg"),
    ("recip", 1e-320, "Deg"),
    ("recip", 1e300, "Deg"),
]

# xʸ（設計書 §4 の定義域表と 1:1）。(x, y)
POW_INPUTS: list[tuple[float, float]] = [
    (2.0, 10.0),  # x > 0 / 整数
    (2.0, 0.5),  # x > 0 / 非整数
    (2.0, -1.0),  # x > 0 / 負
    (10.0, 3.0),
    (1.5, 2.5),
    (0.0, 3.0),  # x = 0, y > 0 → 0
    (0.0, 0.0),  # x = 0, y = 0 → 1（§4.1）
    (0.0, -1.0),  # x = 0, y < 0 → DomainError
    (-2.0, 3.0),  # x < 0 / 整数 → -8
    (-2.0, 2.0),  # x < 0 / 偶数 → 4
    (-2.0, 0.0),  # x < 0 / 0 乗 → 1
    (-2.0, 0.5),  # x < 0 / 非整数 → DomainError
    (-8.0, 0.3333333333333333),  # x < 0 / 非整数（立方根の見た目）→ DomainError
    (10.0, 400.0),  # Overflow
    (10.0, -400.0),  # 極小（Overflow ではない）
    (1e-8, 2.0),
]

# 階乗（S-3 設計書 §3・§4）。1 引数。
FACTORIAL_INPUTS: list[float] = [
    0.0,  # 0! = 1（境界）
    1.0,
    5.0,
    10.0,
    20.0,  # 2^53 を超える。f64 は既に厳密でないが表示の 10 桁は正しい
    170.0,  # f64 に収まる最大
    171.0,  # Overflow
    2.5,  # 非整数 → DomainError（ガンマ関数には広げない）
    -1.0,  # 負 → DomainError
]

# nPr / nCr（S-3 設計書 §3・§4）。(n, r)
PAIR_INPUTS: list[tuple[float, float]] = [
    (5.0, 2.0),  # 既知値: P=20, C=10
    (5.0, 0.0),  # nP0 = nC0 = 1（境界）
    (5.0, 5.0),  # nPn = n!, nCn = 1（境界）
    (5.0, 6.0),  # r > n → DomainError
    (10.0, 3.0),
    (170.0, 3.0),
    (52.0, 5.0),  # トランプの手札。実用域
    # **途中であふれない書き方の証拠**（設計書 §4 の訂正）。
    (200.0, 100.0),  # 素直な n!/(r!(n-r)!) はここで落ちる
    (1000.0, 500.0),  # f64 の上限近く
    (1020.0, 510.0),  # 帯の外側（3 つの書き方すべてが通る対照）
    (1022.0, 511.0),  # **掛けてから割る形はここから落ちる**
    (1028.0, 514.0),  # 帯の上端
    (5.5, 2.0),  # 非整数 → DomainError
    (5.0, -1.0),  # 負 → DomainError
]

# ((a_re, a_im), (b_re, b_im))。各ペアに 4 演算すべてを生成する。
# 設計基準は spec §2: Smith 法の両分岐、単体テストの極端値、四象限・軸上、
# 成分比の偏り。結果が inf/nan になるペアは入れない(generate.py が
# allow_nan=False で落ちる)。ゼロ除数も入れない(エラー系は engine_table)。
BINARY_INPUTS: list[tuple[tuple[float, float], tuple[float, float]]] = [
    ((3.0, 4.0), (1.0, 2.0)),  # 既知値 (3+4j)(1+2j) = -5+10j
    ((1.0, 0.0), (0.0, 1.0)),  # 軸上どうし
    ((0.0, 0.0), (3.0, 4.0)),  # ゼロの被演算数(除数ではない)
    ((-1.0, 1.0), (1.0, -1.0)),  # 象限をまたぐ
    ((-5.0, 10.0), (1.0, 2.0)),  # 単体テストの逆除算既知値
    ((123456.789, -987654.321), (0.1, 0.2)),  # 桁の離れた実用値
    # Smith 法の両分岐を通す(経路カバレッジ)。中庸な値では両分岐とも高精度
    # なので、分岐の取り違えを区別するのは零成分除数のケース(下の 2 件)。
    ((1.0, 1.0), (1000.0, 1.0)),  # 実部優勢分岐
    ((1.0, 1.0), (1.0, 1000.0)),  # 虚部優勢分岐
    ((1.0, 0.0), (1e-200, 1e-200)),
    # 微小除数: 素朴な f64 分母は 0 に潰れる(Rust 側の退行を捕まえる)。
    ((1e149, 0.0), (1e155, 0.0)),
    # 巨大除数: 素朴な f64 分母は inf になり商が 0 に潰れる(Rust 側の退行を
    # 捕まえる)。商(1e-6)が abs tol より大きいので、素朴式への書き換えは
    # ここで赤になる。(1e200,0) 系は mul が inf になって生成が落ちるため
    # 使えない——『1 ペアに 4 演算』設計の制約。
    ((1e-8, 1e-8), (1e8, -1e8)),  # スケールの離れた組
    ((430.27, 0.0040323), (0.87, -0.54)),  # 成分比 ~1e-5(issue #3 の領域)
    # プローブ(Python 側で Smith 法を f64 のまま再実装し、SymPy の厳密値と
    # 突き合わせて 20 万件探索。p と b がほぼ平行で、除算の虚部が
    # Smith 法の減算 (im - re*t) で桁落ちする組。Rust 側で {:?} 出力を
    # 突き合わせてビット単位一致を確認済み)で発見。このプローブ専用の
    # Smith 再実装は使い捨てであり、参照実装本体には入れない
    # (CONTRIBUTING: 参照実装を Rust の移植にしない)。
    #
    # golden(参照 vs Rust)が測る虚部の差は 1.3567895166488597e-05。ただし
    # このうち約 97%(相対誤差 1.356e-8 相当)は Rust ではなく参照側の
    # 入力丸めに由来する: _exact() は f64 の二進値ではなく 10 進 repr を
    # 厳密有理数化するため、expect は「実際の f64 入力の厳密商」ではなく
    # 「10 進丸めした入力の厳密商」であり、この凍結ケースは条件数が
    # 大きく(~6e8)、この 1e-16 級の入力差が増幅される。Rust の Smith 法
    # 自身が f64 入力の厳密商から外れる分だけを見ても相対誤差
    # 3.89e-10(絶対誤差 3.78e-7)あり、これだけで testdata の tolerance
    # (rel)を桁違いに超える —— componentwise なら単独でも赤になる水準。
    # ノルムの相対誤差は 2.156010e-16(close_complex なら緑。spec §3 の
    # 実証)。
    #
    # なお componentwise の再実証をするときは serde_json が期待値を最大
    # 1 ULP ずれて読む点に注意(ノルム比較では 1e-16 相当で無害)。
    #
    # 1 回目に見つけた候補(恒等式 (a*b)/b の乖離で選んだもの)が
    # componentwise でも green のままだった真因: 恒等式そのものに上と同種の
    # 丸め混入があったことに加え、その候補は商の小さい成分自体が極小
    # (~1e-5)だったため絶対誤差も極小に収まり、close() の abs tol の
    # OR 枝(golden.rs の `diff <= tol.abs || ...`)に救われていた。
    # componentwise 赤を実証するには「成分比の偏り」だけでなく「abs tol
    # では救われない大きさの商」も要る —— 同種のケースを足すときに必要な
    # 知識としてここに残す。
    ((539594894.3741664, 266271866.26477954), (0.000947201505172183, 0.00046741196785890884)),
]

# (count, dimensions, dtype)。文字列なのは u128 の定義域を JSON/JS の
# number(2^53)で殺さないため(設計書 §4・§5)。
DATA_SCALE_INPUTS: list[tuple[str, str, str]] = [
    ("100000000", "768", "float32"),  # 基準例(§49 M4): 307.2 GB / 286.1 GiB
    ("1000000000", "65536", "int64"),  # base-spec §25 の例
    # 9 データ型それぞれ 1 件。1×1 なので bytes のみ(単位行は None)。
    ("1", "1", "int8"),
    ("1", "1", "uint8"),
    ("1", "1", "int16"),
    ("1", "1", "float16"),
    ("1", "1", "bfloat16"),
    ("1", "1", "int32"),
    ("1", "1", "float32"),
    ("1", "1", "int64"),
    ("1", "1", "float64"),
    ("0", "768", "float32"),  # 0 は正当な入力
    # 単位の境界(非対称: 1000..=1023 は 10 進だけが出る)
    ("999", "1", "uint8"),
    ("1000", "1", "uint8"),
    ("1023", "1", "uint8"),
    ("1024", "1", "uint8"),
    # half ちょうど(round-half-to-even の実証、10 進と 2 進)
    ("1050000000", "1", "uint8"),  # 1.05 GB -> 1.0 GB(偶数へ)
    ("1150000000", "1", "uint8"),  # 1.15 GB -> 1.2 GB(偶数へ)
    ("1280", "1", "uint8"),  # 1.25 KiB -> 1.2 KiB
    ("1792", "1", "uint8"),  # 1.75 KiB -> 1.8 KiB
    # 丸め繰り上がりが単位境界を越える(設計書 §3 の再選択規則、10 進と 2 進)
    ("999999999999", "1", "uint8"),  # -> 1.0 TB
    ("1099460000000", "1", "uint8"),  # -> 1.0 TiB
    # 最上位単位は再選択しない(999.95 TB の half が繰り上がって 1000.0 TB)
    ("999950000000000", "1", "uint8"),  # -> 1000.0 TB
    # u128 上限近傍の成功と、上限超の Overflow(u128 契約)
    (str((1 << 127) - 1), "2", "uint8"),
    (str(1 << 127), "2", "uint8"),  # 2^128 -> Overflow
    (str(1 << 64), str(1 << 64), "uint8"),  # 2^128 -> Overflow(積の経路違い)
    # パース不能(SyntaxError)
    ("abc", "1", "float32"),
    ("100", "1", "float128"),  # 未知のデータ型
]

# Loan(M6)。設計書 §7 の必須ケース列挙と 1:1 で対応させる——各項に spec の
# 項目名をコメントで書く(植え漏れ検査が読む)。金額は文字列(u64 は JSON
# number の 2^53 を超える)。回数は整数。
#
# 期間逆算の境界に使う元本は「その月額・その回数で借りられる最大額」であり、
# 生成時に参照実装が解く(下の EXACT_TERM_PRINCIPAL)。手で書いた数字ではない。
U64_MAX_TEXT = str((1 << 64) - 1)

LOAN_INPUTS: list[dict] = [
    # 住宅基準例(3,000 万・35 年・1.5% 級)
    {"op": "loan_forward", "principal": "30000000", "rate": "1.5", "n": 420, "residual": "0"},
    # 最長 600 回
    {"op": "loan_forward", "principal": "30000000", "rate": "1.5", "n": 600, "residual": "0"},
    # 車例(300 万・5 年・残価 40% 級)
    {"op": "loan_forward", "principal": "3000000", "rate": "3.9", "n": 60, "residual": "1200000"},
    # 残価を階段が飛ばす組。最終回の支払 X + floor(X×月利) は 1 か 2 ずつしか
    # 増えないので、残価そのものが像に無いことがある。車例と同じ 300 万・5 年・
    # 年 3.9% で、残価 1,200,195 円は飛ばされ、最終回は B−1 = 1,200,194 円になる
    # (切り捨てに揃える規約。numerical-policy の既知の制約)。
    {"op": "loan_forward", "principal": "3000000", "rate": "3.9", "n": 60, "residual": "1200195"},
    # B=0 の残価退化恒等式(上と同じ入力で残価だけ 0)
    {"op": "loan_forward", "principal": "3000000", "rate": "3.9", "n": 60, "residual": "0"},
    # B = P−1 近傍
    {"op": "loan_forward", "principal": "3000000", "rate": "2.0", "n": 36, "residual": "2999999"},
    # 最終回調整が大きい組(短期・高金利・端数元本)
    {"op": "loan_forward", "principal": "999999", "rate": "7.5", "n": 13, "residual": "0"},
    # 金利 0%(正算の 0 割分岐)。端数元本で採る(設計書 §1-4)
    {"op": "loan_forward", "principal": "2999999", "rate": "0", "n": 12, "residual": "0"},
    # 金利 0% × 残価(均等部分が (P−B)/(n−1) になる分岐)
    {"op": "loan_forward", "principal": "2999999", "rate": "0", "n": 12, "residual": "1000000"},
    # 1 回払い(端数元本で。設計書 §1-4 の注意)
    {"op": "loan_forward", "principal": "2999999", "rate": "2.4", "n": 1, "residual": "0"},
    # u64 域境界(0% の厳密経路なら f64 を通らないので採録できる)
    {"op": "loan_forward", "principal": U64_MAX_TEXT, "rate": "0", "n": 600, "residual": "0"},
    # u64 越え → Overflow(1 回払いで P + 利息があふれる)
    {"op": "loan_forward", "principal": U64_MAX_TEXT, "rate": "1.5", "n": 1, "residual": "0"},
    # 縮退入力(極小元本 × 長期間。残高が n 回より前に 0 になる)
    {"op": "loan_forward", "principal": "10000", "rate": "1.0", "n": 600, "residual": "0"},
    # 元本 0 / 回数 0 / 残価 ≥ 元本(設計書 §2 のエラー表)
    {"op": "loan_forward", "principal": "0", "rate": "1.5", "n": 12, "residual": "0"},
    {"op": "loan_forward", "principal": "1000000", "rate": "1.5", "n": 0, "residual": "0"},
    {"op": "loan_forward", "principal": "1000000", "rate": "1.5", "n": 12, "residual": "1000000"},
    # 借入可能額逆算(正算との往復一致は単体テストが見る)
    {"op": "loan_principal", "payment": "85000", "rate": "1.5", "n": 420},
    {"op": "loan_principal", "payment": "50000", "rate": "2.0", "n": 24},
    # 金利 0%(借入可能額の r=0 分岐)
    {"op": "loan_principal", "payment": "100000", "rate": "0", "n": 12},
    # 月額 0(エラー)
    {"op": "loan_principal", "payment": "0", "rate": "1.5", "n": 12},
    # 期間逆算: ちょうど割り切れる n と、+1 円で繰り上がる境界(元本は生成時に解く)
    {"op": "loan_term", "principal": "EXACT_TERM_PRINCIPAL", "rate": "2.0", "payment": "50000"},
    {"op": "loan_term", "principal": "EXACT_TERM_PRINCIPAL+1", "rate": "2.0", "payment": "50000"},
    # 金利 0%(期間逆算の log(1+r)=0 割 分岐)。割り切れる回と +1 円
    {"op": "loan_term", "principal": "1200000", "rate": "0", "payment": "100000"},
    {"op": "loan_term", "principal": "1200001", "rate": "0", "payment": "100000"},
    # 月額 ≤ 初回利息(発散)と、100 年でも終わらない入力
    {"op": "loan_term", "principal": "1000000", "rate": "12.0", "payment": "10000"},
    {"op": "loan_term", "principal": "100000000", "rate": "12.0", "payment": "1000001"},
    # ボーナス併用(半年利の丸めが効く 7 年・14 回)
    {
        "op": "loan_bonus_forward",
        "principal": "5000000",
        "bonus_principal": "2000000",
        "rate": "2.7",
        "n": 84,
    },
    # ボーナス割合 50% ちょうど(境界)
    {
        "op": "loan_bonus_forward",
        "principal": "30000000",
        "bonus_principal": "15000000",
        "rate": "1.5",
        "n": 420,
    },
    # ボーナス 0 円 = 通常式一致(回帰恒等式。上の住宅基準例と同じ答になる)
    {
        "op": "loan_bonus_forward",
        "principal": "30000000",
        "bonus_principal": "0",
        "rate": "1.5",
        "n": 420,
    },
    # 50% 超(エラー)と、ボーナス回が 1 度も来ない n<6(エラー)
    {
        "op": "loan_bonus_forward",
        "principal": "3000000",
        "bonus_principal": "1500001",
        "rate": "1.5",
        "n": 60,
    },
    {
        "op": "loan_bonus_forward",
        "principal": "1000000",
        "bonus_principal": "100000",
        "rate": "1.5",
        "n": 5,
    },
    # 借入可能額 × ボーナス(2 本の独立逆算 → 合算)
    {
        "op": "loan_bonus_principal",
        "monthly_payment": "80000",
        "bonus_payment": "100000",
        "rate": "1.5",
        "n": 420,
    },
    # ≤50% 境界の両側。ボーナス回 481,140 円までは通り、481,141 円で
    # ボーナス分が元本の半分を越える(境界は解いた後にしか分からない)。
    {
        "op": "loan_bonus_principal",
        "monthly_payment": "80000",
        "bonus_payment": "481140",
        "rate": "1.5",
        "n": 420,
    },
    {
        "op": "loan_bonus_principal",
        "monthly_payment": "80000",
        "bonus_payment": "481141",
        "rate": "1.5",
        "n": 420,
    },
    # ≤50% を大きく踏み外す(エラー)
    {
        "op": "loan_bonus_principal",
        "monthly_payment": "10000",
        "bonus_payment": "500000",
        "rate": "1.5",
        "n": 60,
    },
    # ボーナス 0 円 = 通常の借入可能額に退化
    {
        "op": "loan_bonus_principal",
        "monthly_payment": "80000",
        "bonus_payment": "0",
        "rate": "1.5",
        "n": 420,
    },
]

# 複利・積立（設計書 2026-08-14）。期待値は plan 起草時に Decimal で実測した。
# **golden は銀行方式（各期切り捨て）の値である**——閉形式の値とは違う。
COMPOUND_INPUTS: list[dict] = [
    # 種①: 100 万・年 1%・5 年・半年複利 → 1,051,136（閉形式は 1,051,140）
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "1",
        "periods_per_year": 2,
        "periods": 10,
        "tax": False,
    },
    # 同じ入力に税。国税 7,831 + 地方税 2,556 = 10,387
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "1",
        "periods_per_year": 2,
        "periods": 10,
        "tax": True,
    },
    # 積立: 月 3 万・年 3%・20 年 → 9,848,906（閉形式の 9,849,059 ではない）
    {
        "op": "compound_grow",
        "principal": "0",
        "deposit": "30000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 同じ積立に税。**別切り捨てと合算切り捨てが 1 円違う組**（設計書 §6）
    {
        "op": "compound_grow",
        "principal": "0",
        "deposit": "30000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": True,
    },
    # 一括 + 積立の混合: 1000 万 + 月 5 万・年 3%・50 年 → 114,198,545
    {
        "op": "compound_grow",
        "principal": "10000000",
        "deposit": "50000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 600,
        "tax": False,
    },
    # 周期 3 種（同じ年利で分母が期/年ぶん動くことを固定する）
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 1,
        "periods": 10,
        "tax": False,
    },
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 2,
        "periods": 10,
        "tax": False,
    },
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 10,
        "tax": False,
    },
    # 金利 0% の退化（一括はそのまま、積立は deposit×periods）
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 12,
        "tax": False,
    },
    {
        "op": "compound_grow",
        "principal": "0",
        "deposit": "30000",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 12,
        "tax": False,
    },
    # 1 期だけ / 最長 1200 期
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 1,
        "tax": False,
    },
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "1",
        "periods_per_year": 12,
        "periods": 1200,
        "tax": False,
    },
    # u64 Overflow（**新設のエラー経路**。ローンには無かった。設計書 §3）
    {
        "op": "compound_grow",
        "principal": U64_MAX_TEXT,
        "deposit": "0",
        "rate": "100",
        "periods_per_year": 12,
        "periods": 12,
        "tax": False,
    },
    # 税の小さい側の境界: 元本 1,000 円・年 1%・1 期 → 利息 10 円。
    # 別切り捨てなら 国税 1 + 地方税 0 = 1、合算 20.315% だと 2 になる。
    {
        "op": "compound_grow",
        "principal": "1000",
        "deposit": "0",
        "rate": "1",
        "periods_per_year": 1,
        "periods": 1,
        "tax": True,
    },
    # エラー（設計書 §3）: 期数 0 / 元本も積立も 0 / 上限超の期数
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 0,
        "tax": False,
    },
    {
        "op": "compound_grow",
        "principal": "0",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 12,
        "tax": False,
    },
    {
        "op": "compound_grow",
        "principal": "1000000",
        "deposit": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 1201,
        "tax": False,
    },
    # ここから逆算（設計書 2026-08-15 §7）。期待値は spec 起草時に実測済み。
    # 必要積立額: 元本 0・年 3%・月次・240 期・目標 1,000 万 → 30,461（残高 10,000,251）
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 1 円少ないと届かないことを固定する（上のケースの対）。
    {
        "op": "compound_grow",
        "principal": "0",
        "deposit": "30460",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 必要年数: 元本 100 万・積立 3 万・年 3%・月次・目標 1,000 万 → 211 期
    {
        "op": "compound_periods_for",
        "principal": "1000000",
        "deposit": "30000",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "tax": False,
    },
    # **非単調ペア (a)**: 目標 1,016（手取り）→ 19 期。
    # **対は次のケース**。片方だけ消すと numerical-policy の注記が根拠を失う。
    {
        "op": "compound_periods_for",
        "principal": "999",
        "deposit": "0",
        "target": "1016",
        "rate": "1.5",
        "periods_per_year": 12,
        "tax": True,
    },
    # **非単調ペア (b)**: 同じ入力の 20 期は手取り 1,015 で目標を下回る。
    # 「届いた直後に下回る期がある」が仕様であることの証拠（設計書 §3 帰結 2）。
    {
        "op": "compound_grow",
        "principal": "999",
        "deposit": "0",
        "rate": "1.5",
        "periods_per_year": 12,
        "periods": 20,
        "tax": True,
    },
    # 0%: 整数の ceil になる。境界の +1 円も置く。
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "12000000",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "12000001",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # 税あり必要積立額: 目標 1,000 万（手取り）→ 32,221
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": True,
    },
    # 目標が元本以下 → 1 期（エラーにしない。設計書 §5）
    {
        "op": "compound_periods_for",
        "principal": "1000000",
        "deposit": "0",
        "target": "500000",
        "rate": "3",
        "periods_per_year": 12,
        "tax": False,
    },
    # 発散: 積立 0・利率 0 では増えない → SyntaxError
    {
        "op": "compound_periods_for",
        "principal": "1000000",
        "deposit": "0",
        "target": "2000000",
        "rate": "0",
        "periods_per_year": 12,
        "tax": False,
    },
    # 往復: #1 の残高を目標にすると 240 期に戻る
    {
        "op": "compound_periods_for",
        "principal": "0",
        "deposit": "30461",
        "target": "10000251",
        "rate": "3",
        "periods_per_year": 12,
        "tax": False,
    },
    # 目標 0 は入力が足りていない → SyntaxError
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "0",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
    # u64 を超える目標 → Overflow。**2 期であることに意味がある**——0%・1 期なら
    # 答はちょうど u64::MAX で収まってしまう(残高 = 積立額)。2 期なら 2d ≥ u64::MAX
    # が要り、最小の d = 2^63 で残高が 2^64 になってあふれる。
    {
        "op": "compound_deposit_for",
        "principal": "0",
        "target": "18446744073709551615",
        "rate": "0",
        "periods_per_year": 12,
        "periods": 2,
        "tax": False,
    },
    # **答が 0 になるケース**(spec §5)。積立をしなくても元本の成長だけで届く。
    # Rust は `principal > 0 && probe(0)`、Python は `_reached_or_nothing(...) >= target`
    # と**書き方が違う短絡経路**なので、言語間で突き合わせる価値がここにある。
    {
        "op": "compound_deposit_for",
        "principal": "1000000",
        "target": "500000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 12,
        "tax": False,
    },
    # 元本ありで答も非ゼロ。`deposit_for` の principal > 0 の経路(Python の種の
    # `principal * (1 + r)^n` 項を含む)を golden で初めて覆う。
    {
        "op": "compound_deposit_for",
        "principal": "1000000",
        "target": "10000000",
        "rate": "3",
        "periods_per_year": 12,
        "periods": 240,
        "tax": False,
    },
]

I128_MAX_TEXT = str((1 << 127) - 1)
U128_MAX_TEXT = str((1 << 128) - 1)

# 式入力（設計書 2026-08-15 §8）。**単位を含む式そのもの**が入る——単位を
# 解釈するのはコアだからである（訂正 2）。
EXPR_INPUTS: list[dict] = [
    # 丸めが着地の 1 回だけであることの証明。各演算で丸めるなら 999999。
    {"op": "expr_integer", "text": "1000000/3*3", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "1000000/3", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 優先順位と括弧
    {"op": "expr_integer", "text": "3000+500*2", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "(3000+500)*2", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 単位を含む式（訂正 2。UI は展開しない）
    {"op": "expr_integer", "text": "3000万*2", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "100万+50万", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "1億6000万-500万", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 昇る向きの単位と、綴り違いは文法違反（綴りはワイヤ契約）
    {"op": "expr_integer", "text": "1万億", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "3000萬", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 期間の単位（月次のローン）と、複利の周期依存
    {"op": "expr_integer", "text": "35年", "unit_set": "months", "max": "1200"},
    {"op": "expr_integer", "text": "3年6", "unit_set": "months", "max": "1200"},
    {"op": "expr_integer", "text": "10年", "unit_set": "periods:12", "max": "1200"},
    {"op": "expr_integer", "text": "10年", "unit_set": "periods:2", "max": "1200"},
    {"op": "expr_integer", "text": "10年", "unit_set": "periods:1", "max": "1200"},
    # 件数の単位
    {"op": "expr_integer", "text": "100M/4", "unit_set": "count", "max": U128_MAX_TEXT},
    # 定義域。f64 なら壊れる桁
    {"op": "expr_integer", "text": f"{I128_MAX_TEXT}/3", "unit_set": "count", "max": U128_MAX_TEXT},
    # 継ぎ目（訂正 1）: i128::MAX ちょうどは通る / +1 は式に入れられない
    {"op": "expr_integer", "text": I128_MAX_TEXT, "unit_set": "count", "max": U128_MAX_TEXT},
    {"op": "expr_integer", "text": str(1 << 127), "unit_set": "count", "max": U128_MAX_TEXT},
    # 着地の Overflow
    {"op": "expr_integer", "text": "1000000*2", "unit_set": "yen", "max": "1000000"},
    # 中間の Overflow。数学的には戻るが仕様としてエラー（§8 の角）
    {
        "op": "expr_integer",
        "text": f"{I128_MAX_TEXT}*2/2",
        "unit_set": "count",
        "max": U128_MAX_TEXT,
    },
    # 0 除算
    {"op": "expr_integer", "text": "100/0", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 負の中間は許し、負の着地は拒む
    {"op": "expr_integer", "text": "(500-1000)+2000", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "500-1000", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 期間の上限（1200 ちょうど / 超え）
    {"op": "expr_integer", "text": "100*12", "unit_set": "months", "max": "1200"},
    {"op": "expr_integer", "text": "100*12+1", "unit_set": "months", "max": "1200"},
    # 文法違反
    {"op": "expr_integer", "text": "3000+", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "(3000+500", "unit_set": "yen", "max": U64_MAX_TEXT},
    {"op": "expr_integer", "text": "", "unit_set": "yen", "max": U64_MAX_TEXT},
    # 年利（4 桁の線と 100% の線）
    {"op": "expr_percent", "text": "1.5+0.25"},
    {"op": "expr_percent", "text": "1/8"},
    {"op": "expr_percent", "text": "1/3"},
    {"op": "expr_percent", "text": "3*40"},
]

# 60 進表示（S-4 設計書 §7 の必須ケース）。
SEXAGESIMAL_INPUTS: list[float] = [
    1.5,  # 1°30'0"（設計書 §1 の見出し例）
    0.001,  # 0°0'3.6"（秒に小数が要る証拠）
    -3.75,  # 符号は先頭に 1 つ
    0.0,  # 0°0'0"
    30.5,  # 24 を超えてもそのまま（裁定 5）
    0.1,
    0.3333333333333333,  # 1/3
    0.999999999,  # **秒 → 分 → 度と二段繰り上がる**
    2.75,
    999999.5,  # 度が 6 桁。まだ出せる
    1e10,  # 度が 10 桁 → None（裁定 6）
    1e308,  # 同上
    123.456,
]
