"""式入力の参照実装（設計書 2026-08-15 §8）。

**独立軸**: Rust は `i128` 有界の有理数を自前で実装する。こちらは標準ライブラリの
`fractions.Fraction`（多倍長）を使う——base-spec §30 の「既存の数学ライブラリや
別手法を利用する」にそのまま当たる。

**ただし有界性は共有の契約である。** Fraction は多倍長なので、放っておくと
Rust が出せない答を出す。**各演算のあとに分子・分母が i128 に収まるかを検査**し、
超えたら Overflow にする。ここを入れないと golden が「Rust では出せない答」を持つ。

**共有する公開契約**（アルゴリズムの共有ではなく、base-spec §37 型の契約。
知らなければ独立検証を書けないもの）:

1. 優先順位（× ÷ が先）と左結合。
2. 丸めは着地の 1 回だけ、向きは floor。
3. 中間値も i128 に収まること。
4. 各項目の定義域と、超えたときのエラー種別。
5. 単位表（ラベルと scale）とその並び——`DATA_TYPE_TOKENS` と同じ位置づけ。
"""

from __future__ import annotations

from fractions import Fraction

I128_MAX = (1 << 127) - 1
PERCENT_SCALE = 10**4  # 年利は小数 4 桁まで


class ExprError(Exception):
    """Rust の CalcError に対応する。`code` は golden の error 文字列。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# 単位表。**降順に並べる**——「億 の次に 万」は置けるが逆は置けない。
UNIT_SETS: dict[str, list[tuple[str, int]]] = {
    "yen": [("億", 10**8), ("万", 10**4)],
    "count": [("G", 10**9), ("M", 10**6), ("K", 10**3)],
    "months": [("年", 12), ("月", 1)],
    "none": [],
}


def unit_table(unit_set: str) -> list[tuple[str, int]]:
    """`periods:<n>` は複利。`年` の scale が 1 年あたりの期数になる。

    どの周期でも割り切れるので、端数の期が生まれない（設計書 §5）。

    独立: 不可能（表の中身が仕様。コア側の `UnitSet::units()` と同じ係数で
    なければならない——違えば単位の意味が変わる）
    """
    if unit_set.startswith("periods:"):
        per_year = int(unit_set.split(":", 1)[1])
        if per_year not in (1, 2, 12):
            raise ExprError("SyntaxError")
        if per_year == 1:
            return [("年", 1)]
        return [("年", per_year), ("期", 1)]
    if unit_set not in UNIT_SETS:
        raise ExprError("SyntaxError")
    return UNIT_SETS[unit_set]


def _guard(value: Fraction) -> Fraction:
    """i128 の有界性。**Rust と同じ範囲でしか答を出さない。**"""
    if abs(value.numerator) > I128_MAX or value.denominator > I128_MAX:
        raise ExprError("Overflow")
    return value


def tokenize(text: str, units: list[tuple[str, int]]) -> list[str]:
    """数字列・単位・`+ - * / ( )`。**単位はコアが解釈する**（設計書 訂正 2）。

    独立: 不可能（受け付ける綴りが仕様そのもの。コア側の字句解析と同じものを
    認める必要があり、別の文法にはできない）
    """
    labels = {label for label, _ in units}
    tokens: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isdigit():
            start = index
            while index < len(text) and text[index].isdigit():
                index += 1
            # 小数点は数字列の一部として拾う（年利だけが使う）。
            if index < len(text) and text[index] == ".":
                index += 1
                while index < len(text) and text[index].isdigit():
                    index += 1
            tokens.append(text[start:index])
            continue
        if char in "+-*/()" or char in labels:
            tokens.append(char)
            index += 1
            continue
        raise ExprError("SyntaxError")
    return tokens


class _Parser:
    """再帰下降。式 := 項 (("+"|"-") 項)*、項 := 因子 (("*"|"/") 因子)*。"""

    def __init__(self, tokens: list[str], units: list[tuple[str, int]]) -> None:
        self.tokens = tokens
        self.units = units
        self.at = 0

    def peek(self) -> str | None:
        return self.tokens[self.at] if self.at < len(self.tokens) else None

    def take(self) -> str:
        token = self.peek()
        if token is None:
            raise ExprError("SyntaxError")
        self.at += 1
        return token

    def expression(self) -> Fraction:
        value = self.term()
        while self.peek() in ("+", "-"):
            operator = self.take()
            right = self.term()
            value = _guard(value + right if operator == "+" else value - right)
        return value

    def term(self) -> Fraction:
        value = self.factor()
        while self.peek() in ("*", "/"):
            operator = self.take()
            right = self.factor()
            if operator == "/":
                if right == 0:
                    raise ExprError("DivisionByZero")
                value = _guard(value / right)
            else:
                value = _guard(value * right)
        return value

    def factor(self) -> Fraction:
        token = self.take()
        if token == "(":
            value = self.expression()
            if self.take() != ")":
                raise ExprError("SyntaxError")
            return value
        if not token[0].isdigit():
            raise ExprError("SyntaxError")
        return self.number(token)

    def number(self, first: str) -> Fraction:
        """数リテラル。単位は後置修飾で、**下る向きにしか置けない**。

        `1億6000万` は 1×10^8 + 6000×10^4。`1万億` は文法違反である。
        """
        scales = dict(self.units)
        order = [label for label, _ in self.units]
        total = Fraction(0)
        digits = first
        last_rank = -1
        while True:
            unit = self.peek()
            if unit is None or unit not in scales:
                break
            rank = order.index(unit)
            if rank <= last_rank:  # 同じか昇る向きは受けない
                raise ExprError("SyntaxError")
            last_rank = rank
            self.take()
            total = _guard(total + _number(digits) * scales[unit])
            following = self.peek()
            if following is None or not following[0].isdigit():
                return total
            digits = self.take()
        return _guard(total + _number(digits))


def _number(text: str) -> Fraction:
    try:
        return Fraction(text)
    except (ValueError, ZeroDivisionError) as error:
        raise ExprError("SyntaxError") from error


def evaluate(text: str, unit_set: str = "yen") -> Fraction:
    """式を有理数で評価する。着地まで丸めない。

    独立: 別手順（**評価する道具が違う**。コアは `expr/rational.rs` の
    **`i128` 有界の自作既約分数**で、約分を正しさの一部として持ち、溢れを
    自分で見る。こちらは**標準ライブラリの `Fraction`**——多倍長なので
    溢れが無く、上限は着地の `land_*` が別に見る。**同じ式でも壊れ方が違う**）
    """
    if text == "":
        raise ExprError("SyntaxError")
    units = unit_table(unit_set)
    parser = _Parser(tokenize(text, units), units)
    value = parser.expression()
    if parser.peek() is not None:
        raise ExprError("SyntaxError")
    return value


def land_integer(value: Fraction, maximum: int) -> int:
    """floor して整数へ。負と上限超は弾く。

    独立: 不可能（着地の規則が仕様。`floor` して定義域を見るほかに手が無い）
    """
    if value < 0:
        raise ExprError("SyntaxError")
    landed = value.numerator // value.denominator
    if landed > maximum:
        raise ExprError("Overflow")
    return landed


def land_percent(value: Fraction) -> str:
    """年利へ。**小数 4 桁に収まらなければ拒む**（`Rate` と同じ線）。

    独立: 不可能（拒む線が仕様。`Rate` の受け付ける桁と同じでなければならない）
    """
    if value < 0 or value > 100:
        raise ExprError("SyntaxError")
    scaled = value * PERCENT_SCALE
    if scaled.denominator != 1:
        raise ExprError("SyntaxError")  # 4 桁で表せない
    whole, fraction = divmod(int(scaled), PERCENT_SCALE)
    if fraction == 0:
        return str(whole)
    return f"{whole}.{fraction:04d}".rstrip("0")


def compute(op: str, params: dict) -> dict:
    """生成スクリプトの入口。エラーは戻り値にする（loan_ref と同じ流儀）。

    独立: 不可能（計算をしない。op の綴りで分岐して、上の関数へ渡すだけ）
    """
    try:
        if op == "expr_integer":
            value = evaluate(params["text"], params["unit_set"])
            return {"value": str(land_integer(value, int(params["max"])))}
        if op == "expr_percent":
            return {"value": land_percent(evaluate(params["text"], "none"))}
        raise ValueError(f"unknown op {op}")
    except ExprError as error:
        return {"error": error.code}
