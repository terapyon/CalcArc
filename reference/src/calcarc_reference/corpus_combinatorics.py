"""組合せの誤入力を体系的に確かめるコーパス（`combinatorics-display-000.json`）。

## なぜこの 1 枚が在るのか

**表を埋めるために作ったのではない。**

試験空間モデル `scientific-v1` が `combinatorics/path=domain` を「データに
1 件も入力が無いセル」と指したとき、**そのケース自体は `errors-000.json` に
在った**（`C(5,6)` / `P(5,6)` / `C(5,-1)` / `C(5,2.5)` / `C(-5,2)`）。
**足りなかったのは件数ではなく、場所と体系性である:**

- **`errors-000.json` は全領域の寄せ集め 30 件**である。除算・対数・平方根・
  逆三角・極・階乗・組合せ・値域・括弧が 1 枚に同居している
- **組合せの誤入力を体系的に確かめる場所が、どこにも無かった。** 実際、
  そこに在る 5 件は **`nCr` に 4 件・`nPr` に 1 件**で、**`n` が非整数の形は
  1 件も無かった**（2026-08-30 実測）

**ユーザーの裁定（2026-08-30）は「3 件を複製する」を退け、「体系的な 2 枚目を
作る」だった。** **表を埋めるためではなく、確かめるために作る。**

## 何から起こしたか

**Rust の実装を読まない**（`corpus_errors` と同じ規律、CLAUDE.md「参照実装を
Rust の移植にしない」）。**組合せ・順列の数学の定義だけから起こす:**

`nPr` は「`n` 個から `r` 個を選んで並べる」、`nCr` は「`n` 個から `r` 個を
選ぶ」である。**個数は非負の整数**であり、**手持ちより多くは選べない。**
したがって定義を外れる形は、引数ごとに次の 5 つで尽きる:

| 破れ方 | なぜ定義を外れるか |
|---|---|
| `n` が負 | 個数が負になれない |
| `n` が非整数 | 個数は整数である（`Γ` への拡張は採らない——実数に閉じる） |
| `r` が負 | 同上 |
| `r` が非整数 | 同上 |
| `r > n` | 手持ちより多くを選べない |

**`n!` は引数が 1 つなので、前の 2 つだけ**である。

**これは「値が大きすぎる」とは別の話である**——`Overflow` は定義域の中に
入ったうえで値域を外れることで、そちらは `errors-000.json` の
`value_range_cases` と、この 1 枚の末尾が持つ。

## 独立: 別手順

**どの式がどの誤りになるかは、上の表の数学だけで決めている。** engine の
`non_negative_integer` も `check_pair` も読んでいない——**読めば移植になり、
同じ見落としが両側に入って照合が意味を失う。**
"""

from __future__ import annotations

SCHEMA = 1

#: 表示。`corpus_errors.ERROR_TEXT` と同じ綴りだが、**写しではなく同じ契約**
#: （`error.rs` が定める種別名と同じ扱い）。下のテストが 2 つの一致を見る。
ERROR_TEXT = "Math ERROR"

#: **定義の破れ方**（上の表）。**引数の位置ごとに名前を持つ**——
#: `n` の非整数と `r` の非整数を 1 つにまとめると、**片方だけ落ちる欠陥が
#: 隠れる**（実測: `errors-000.json` には `r` の非整数しか無かった）。
DOMAIN_VIOLATIONS = (
    "negative_n",
    "fractional_n",
    "negative_r",
    "fractional_r",
    "r_exceeds_n",
)

#: 2 引数の組合せ関数。**キーと表示名の対**。
BINARY_FUNCTIONS = (("n_c_r", "C"), ("n_p_r", "P"))

#: **健全な土台。** どの破れ方も、この対を 1 か所だけ壊して作る——
#: **2 か所同時に壊すと、どちらで落ちたのか分からない。**
SOUND_N, SOUND_R = 5, 2


def _digits(text: str) -> list[str]:
    """十進の文字列をキー列にする。**負号は `neg` を後ろに押す。**"""
    negative = text.startswith("-")
    body = text.removeprefix("-")
    keys = ["dot" if ch == "." else ch for ch in body]
    return keys + (["neg"] if negative else [])


def _display_case(keys: list[str], expr: str, error: str) -> dict:
    return {
        "kind": "display",
        "mode": "Deg",
        "keys": keys,
        "expr": expr,
        "expect": {"error": error, "main": ERROR_TEXT},
    }


def _arguments(violation: str) -> tuple[str, str]:
    """1 つの破れ方に対する `(n, r)`。**壊すのは片方だけ。**"""
    if violation == "negative_n":
        return "-5", str(SOUND_R)
    if violation == "fractional_n":
        return "5.5", str(SOUND_R)
    if violation == "negative_r":
        return str(SOUND_N), "-1"
    if violation == "fractional_r":
        return str(SOUND_N), "2.5"
    if violation == "r_exceeds_n":
        return str(SOUND_N), str(SOUND_N + 1)
    raise ValueError(f"知らない破れ方: {violation}")


def domain_grid() -> list[dict]:
    """**2 関数 × 5 つの破れ方 = 10 件。** 格子を埋め残さない。

    **「よくある誤りを並べる」ではなく「定義の破れ方を尽くす」**——
    前者は書いた人が思いついた分しか無く、**思いつかなかった形が
    そのまま穴になる。**
    """
    cases: list[dict] = []
    for key, name in BINARY_FUNCTIONS:
        for violation in DOMAIN_VIOLATIONS:
            n, r = _arguments(violation)
            cases.append(
                _display_case(
                    [*_digits(n), key, *_digits(r), "eq"],
                    f"{name}({n},{r})",
                    "DomainError",
                )
            )
    return cases


def factorial_domain() -> list[dict]:
    """**階乗は引数が 1 つ**なので、破れ方は `n` の 2 つだけ。"""
    return [
        _display_case([*_digits("-5"), "n_fact", "eq"], "(-5)!", "DomainError"),
        _display_case([*_digits("5.5"), "n_fact", "eq"], "(5.5)!", "DomainError"),
    ]


#: **階乗が f64 を超える最初の引数。**
#:
#: `170! ≈ 7.257e306` は f64 の最大 `1.7976931348623157e308` の内側、
#: `171! ≈ 1.241e309` は外側である。**「余裕を持たせた 200」ではなく境目を
#: 打つ**——`errors-000.json` は `200!` を持っており、**境目そのものは
#: どこにも無かった**（2026-08-30 実測）。
FIRST_OVERFLOWING_FACTORIAL = 171


def value_range() -> list[dict]:
    """**定義域の中に入ったうえで、値域を外れる形。**

    **定義域の破れとは別の主張である**——`(-5)!` は「そんな数え方は無い」、
    `171!` は「数えられるが、f64 に入らない」。
    """
    return [
        _display_case(
            [*_digits(str(FIRST_OVERFLOWING_FACTORIAL)), "n_fact", "eq"],
            f"({FIRST_OVERFLOWING_FACTORIAL})!",
            "Overflow",
        )
    ]


def build_shard() -> dict:
    """`id` を連番で振って 1 枚にする。**`random` を使わない**——固定の格子である。"""
    cases: list[dict] = []
    for group in (domain_grid(), factorial_domain(), value_range()):
        for case in group:
            case = dict(case)
            case["id"] = f"cmbe-{len(cases):06d}"
            cases.append(case)
    return {
        "schema": SCHEMA,
        "generated_by": (
            "組合せ・順列・階乗の数学の定義だけから決めた期待値。"
            "n 個から r 個を選ぶ/並べるという定義から、定義を外れる形は"
            "「n が負／n が非整数／r が負／r が非整数／r > n」で尽きる"
            "（階乗は引数が 1 つなので前の 2 つ）。CalcError の変種名は"
            "WASM 境界の公開契約として共有するが、どの式がどの種別になるかは"
            "engine の non_negative_integer / check_pair を見ずに決めた"
            "——読めば移植になり、同じ見落としが両側に入る。"
            "SymPy/mpmath は使っていない（値を計算せず、定義の内外を判定する"
            "だけの経路である）。"
        ),
        "cases": cases,
    }
