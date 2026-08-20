"""エラー種別のコーパス(`errors-000.json`、`kind: "display"`)。設計書 §5。

**このモジュールは Rust を見ない。** `CalcError` の**種別名**
(`DivisionByZero` / `Overflow` / `TrigPole` / `DomainError` / `SyntaxError`)は
`crates/calcarc-core/src/error.rs` が定める WASM 境界越しの公開契約なので、
綴りを共有してよい——共有しなければ「同じ意味の値を、両側が違う名前で呼ぶ」
という無意味な不一致しか生めない。**しかし、どの式がどの種別になるかは、
`error.rs` の docstring とここに書く数学的な定義域だけから決める。**
`engine_table.rs` や `state.rs`、`expr/parse.rs` の実装は一度も読んでいない。
一致しなければ、どちらかが間違っている——それが二経路検証の意味である
(設計書 §5.1、計画 Task 2)。

各関数の docstring に、その式がどの `CalcError` になるかを**数学の言葉だけ**
で書く。`error.rs` のコメントを根拠として引用してよいのは、それが変種の
**意味の定義**(公開契約)であって、**個別の式がどう分類されるかの答え**では
ないからである——「`Overflow` は結果が f64 の有限範囲を超えたときに使う」は
契約だが、「`200!` がそれに当たる」は数学(200! ≈ 7.9e374 > f64 の最大値
1.7976931348623157e308)で決めている。

**オーバーフローとアンダーフローは非対称である。** f64 の値域は有限区間
[-1.7976931348623157e308, 1.7976931348623157e308] ではなく、そこに 0 を含む
——0 は f64 で厳密に表現できる値であり、「範囲外」ではない。IEEE 754
binary64 の最小の非正規化数は 2^-1074 ≈ 4.9406564584124654e-324 で、それより
絶対値が小さい非零の実数は、最も近い表現可能な値である 0.0 に丸められる。
**この丸めは値域を外れたことにならない**——0.0 は最初から f64 の値域の
要素だからである。したがって、真の値が大きすぎて表現できない(オーバーフロー)
ときだけ `Overflow` になり、真の値が小さすぎて 0.0 に丸まる(アンダーフロー)
ときは**エラーにならない**——これがこのシャードで最も主張が強い経路である。
"""

from __future__ import annotations

from . import real_ref

SCHEMA = 1

# `crates/calcarc-core/src/error.rs` が定める 5 つの変種名。**綴りだけを
# 契約として共有する**(この定数はテストが「5 種すべてに 1 件以上ある」ことを
# 固定するのに使う)。
CALC_ERROR_KINDS = (
    "DivisionByZero",
    "Overflow",
    "TrigPole",
    "DomainError",
    "SyntaxError",
)

# `crates/calcarc-core/src/engine/display.rs` の `ERROR_TEXT`。エラー発生時の
# `main` は種別によらずこの 1 文字列である(設計書 §4)。
ERROR_TEXT = "Math ERROR"


def _case(keys: list[str], expr: str, error: str | None, main: str | None = None) -> dict:
    """`id` を持たない 1 件。`id` は `build_errors_shard` が連番で振る。

    `error` が `None` のときは「エラーにならない」という主張になる——
    アンダーフローの 2 件がこれを使う。`main` を省くと `error` の有無から
    決める(エラーなら `ERROR_TEXT`、そうでなければ渡された値が必須)。
    """
    if error is not None and main is None:
        main = ERROR_TEXT
    if main is None:
        raise ValueError(f"{expr}: a non-error case must state its display")
    expect: dict = {"main": main}
    if error is not None:
        expect["error"] = error
    return {
        "kind": "display",
        "mode": "Deg",
        "keys": keys,
        "expr": expr,
        "expect": expect,
    }


def division_by_zero_cases() -> list[dict]:
    """除算の定義域は除数 ≠ 0(`error.rs`: 「0 による除算」)。

    `1 ÷ 0` と `0 ÷ 0` はどちらも除数が 0 で、除算という演算そのものの
    定義域を外れる(商は存在しない)。逆数(`1/x`)も同じ演算——
    `x` の逆数は `1/x` であり、`x = 0` のとき同じ理由で未定義になる。
    """
    return [
        _case(["1", "div", "0", "eq"], "1 ÷ 0", "DivisionByZero"),
        _case(["0", "div", "0", "eq"], "0 ÷ 0", "DivisionByZero"),
        _case(["0", "recip"], "1/0 (逆数)", "DivisionByZero"),
    ]


def logarithm_domain_cases() -> list[dict]:
    """対数の定義域は正の実数(`error.rs` の例そのもの: 「`ln(0)` や…」)。

    `ln` は自然対数、`log10` は常用対数。底が違うだけで定義域は同じ
    ——0 と負の実数のどちらも対数の定義域の外にある。
    """
    return [
        _case(["0", "ln"], "ln(0)", "DomainError"),
        _case(["1", "neg", "ln"], "ln(-1)", "DomainError"),
        _case(["0", "log10"], "log10(0)", "DomainError"),
        _case(["5", "neg", "log10"], "log10(-5)", "DomainError"),
    ]


def sqrt_domain_cases() -> list[dict]:
    """実数の平方根の定義域は非負の実数(`error.rs` の例: 「`sqrt(-4)`」)。

    負の実数を 2 乗して得られる実数は存在しない(実数の 2 乗は常に非負)。
    """
    return [
        _case(["4", "neg", "sqrt"], "sqrt(-4)", "DomainError"),
        _case(["1", "neg", "sqrt"], "sqrt(-1)", "DomainError"),
    ]


def inverse_trig_domain_cases() -> list[dict]:
    """逆三角関数 asin/acos の定義域は [-1, 1](三角関数の値域そのもの)。

    sin と cos の値域が [-1, 1] である以上、逆関数の定義域もそこに限られる
    ——絶対値が 1 を超える引数に対応する角度は存在しない。
    """
    return [
        _case(["2", "asin"], "asin(2)", "DomainError"),
        _case(["2", "neg", "asin"], "asin(-2)", "DomainError"),
        _case(["2", "acos"], "acos(2)", "DomainError"),
        _case(["1", "dot", "5", "neg", "acos"], "acos(-1.5)", "DomainError"),
    ]


def tan_pole_cases() -> list[dict]:
    """tan の極は余弦が 0 になる角度(`error.rs`: 「Deg モードの 90 + 180n 度」)。

    tan(θ) = sin(θ)/cos(θ) で、cos(θ) = 0 のとき分母が 0 になり値が定義
    されない(± に発散する極であって、`DivisionByZero` の「除数がたまたま
    入力として 0 になった」とは性質が違う——`error.rs` が別の変種として
    区別している理由もそこにある)。90°、270° (= 90 + 180)、-90°
    (= 90 - 180)のどれも余弦が 0 になる角度である。
    """
    return [
        _case(["9", "0", "tan"], "tan(90°)", "TrigPole"),
        _case(["2", "7", "0", "tan"], "tan(270°)", "TrigPole"),
        _case(["9", "0", "neg", "tan"], "tan(-90°)", "TrigPole"),
    ]


def factorial_cases() -> list[dict]:
    """階乗の定義域は非負整数、値域は f64(`error.rs` の 2 つの説明の両方を踏む)。

    階乗は非負整数にしか定義されない(負の整数にも非整数にも意味がない)ので、
    定義域の違反は `DomainError`。一方 `200!` は定義域には入っている
    (200 は非負整数)が、その**値**が f64 の有限範囲(最大
    1.7976931348623157e308)を超える——200! ≈ 7.886578673647905e374——ので、
    これは定義域ではなく**値域**の違反であり `Overflow` になる
    (171! で既に超える。200 は余裕を持たせた値)。
    """
    return [
        _case(["1", "neg", "n_fact"], "(-1)!", "DomainError"),
        _case(["1", "dot", "5", "n_fact"], "(1.5)!", "DomainError"),
        _case(["2", "0", "0", "n_fact"], "(200)!", "Overflow"),
    ]


def combinatorics_domain_cases() -> list[dict]:
    """nPr・nCr の定義は非負整数 n, r かつ r ≤ n(n 個から r 個を選ぶ/並べる)。

    r > n(手持ちより多くを選べない)、負の r や n(個数は負になれない)、
    非整数の r(整数個しか選べない)は、どれも組合せ・順列という演算の
    定義そのものを外れる——値が大きすぎるという値域の問題ではない。
    """
    return [
        _case(["5", "n_c_r", "6", "eq"], "C(5,6)", "DomainError"),
        _case(["5", "n_p_r", "6", "eq"], "P(5,6)", "DomainError"),
        _case(["5", "n_c_r", "1", "neg", "eq"], "C(5,-1)", "DomainError"),
        _case(["5", "n_c_r", "2", "dot", "5", "eq"], "C(5,2.5)", "DomainError"),
        _case(["5", "neg", "n_c_r", "2", "eq"], "C(-5,2)", "DomainError"),
    ]


def value_range_cases() -> list[dict]:
    """f64 の値域(`error.rs`: 「結果が f64 の有限範囲を超えた」)。

    最大の有限 f64 は 1.7976931348623157e308。真の値がそれを超えれば
    表現できる f64 が無く `Overflow` になる——`1e309` は単体でその範囲を
    超えており、`(1e200)×(1e200) = 1e400` は演算の結果として超える。

    **アンダーフローは対称の逆ではない。** モジュールの docstring に書いた
    とおり、0.0 は f64 の値域の内側にある表現可能な値なので、真の値が
    2^-1074 ≈ 4.9406564584124654e-324 未満に潰れて 0.0 に丸まっても、
    それは値域を外れたことにならない——**エラーにならず、`0` が表示される**。
    `1e-325` は単体で丸め潰れ、`(1e-200)×(1e-200) = 1e-400` は演算の結果
    として丸め潰れる。`format_real` は独立実装の `real_ref.py`(段階 J)を使い、
    `0.0` が `"0"` と表示されることを Rust を見ずに主張する。
    """
    zero_display = real_ref.format_real(0.0)
    return [
        _case(["1", "exp", "3", "0", "9", "eq"], "1e309", "Overflow"),
        _case(
            ["1", "exp", "2", "0", "0", "mul", "1", "exp", "2", "0", "0", "eq"],
            "(1e200)×(1e200)",
            "Overflow",
        ),
        _case(
            ["1", "exp", "3", "2", "5", "neg", "eq"],
            "1e-325",
            None,
            main=zero_display,
        ),
        _case(
            [
                "1",
                "exp",
                "2",
                "0",
                "0",
                "neg",
                "mul",
                "1",
                "exp",
                "2",
                "0",
                "0",
                "neg",
                "eq",
            ],
            "(1e-200)×(1e-200)",
            None,
            main=zero_display,
        ),
    ]


def unbalanced_parenthesis_cases() -> list[dict]:
    """構文——対応しない `)` は入力列として不正(`error.rs` の例そのもの)。

    式の文法上、`)` は同じ深さで先に開かれた `(` と対応していなければならない
    ——対応する `(` が無い `)` は、その時点でどんな数式の文法にも当てはまらない
    列になる。値の計算に進む前の構文の話なので、`eq` を待たずに即座に
    エラーになる(`corpus_entry.py` の小数点の 2 つ目と同じ形の主張)。
    """
    return [
        _case(["rparen"], ")", "SyntaxError"),
        _case(["3", "add", "4", "rparen"], "3 + 4)", "SyntaxError"),
    ]


def build_errors_shard() -> dict:
    """全経路をまとめ、`id` を連番で振って 1 枚のシャードにする。

    `random` を使わない——`corpus_entry.py` の `build_entry_shard` と同じ理由
    (設計書 §5.1 の 9 経路を 1 つずつ書き写した固定の列挙であって、乱択で
    サンプリングする集合ではない)。
    """
    shapes: list[list[dict]] = [
        division_by_zero_cases(),
        logarithm_domain_cases(),
        sqrt_domain_cases(),
        inverse_trig_domain_cases(),
        tan_pole_cases(),
        factorial_cases(),
        combinatorics_domain_cases(),
        value_range_cases(),
        unbalanced_parenthesis_cases(),
    ]
    cases: list[dict] = []
    for shape in shapes:
        for case in shape:
            case = dict(case)
            case["id"] = f"err-{len(cases):06d}"
            cases.append(case)
    return {
        "schema": SCHEMA,
        "generated_by": (
            "数学の定義域・値域から独立に決めた期待値(設計書 §5.1)。"
            "CalcError の変種名(crates/calcarc-core/src/error.rs)は WASM 境界の"
            "公開契約として共有するが、どの式がどの種別になるかは"
            "engine_table.rs / state.rs / expr/parse.rs を見ずに数学だけから"
            "決めた。ただし 2 件(アンダーフローがエラーにならないことの表示"
            '"0")は real_ref.py(段階 J の独立な表示整形の参照実装)を使う。'
            "SymPy/mpmath は使っていない——値を計算する経路ではなく、"
            "定義域の内外を判定するだけの経路だからである。"
        ),
        "cases": cases,
    }
