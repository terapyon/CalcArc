"""入力途中の表示（`entry-000.json`、`kind: "display"`）。設計書 §4.1。

**これは外部参照ではない。** 打鍵の途中の表示に数学的な定義は無い。規則を
持っているのは `crates/calcarc-core/tests/engine_table.rs`（CLAUDE.md が
「電卓の挙動は engine_table.rs が仕様書」と定めている）と、桁数上限などの
定数を持つ `crates/calcarc-core/src/engine/state.rs` だけである。

したがってこのモジュールは値を**独立に計算しない**。SymPy も mpmath も
使わない——使えば「Python が別の方法で出した期待値」という顔をしてしまうが、
実際には仕様書の書き写しでしかない。各ケースのコメントに、元にした
`engine_table.rs` のテスト名や行番号、あるいは `state.rs` のどの規則から
導いたかを残す。

`state.rs` に直接テストが無い組み合わせ（例: 括弧を開いた直後の表示、
`+/-` の直後に新しい桁を打った場合の表示）は、`crates/calcarc-core` を
`path` 依存にした使い捨ての Rust バイナリで `reduce`/`render` を直に呼んで
実測した（`crates/` はコミット対象からは触っていない）。推測はしていない。
"""

from __future__ import annotations

SCHEMA = 1


def _provenance() -> str:
    """このシャードの素性。**「仕様書からの写し」であることを明記する。**

    レポート（Task 9、設計書 §8.3）は、外部参照・自己同値・仕様書からの写しの
    3 枠を分ける。この文字列がその 3 枠目の根拠になる——`generated_by` に
    「engine_table.rs」の文字が無いと、レポートはこのシャードをどちらの
    枠に入れればよいか判定できない。
    """
    return (
        "crates/calcarc-core/tests/engine_table.rs と "
        "crates/calcarc-core/src/engine/state.rs から起こした期待値"
        "（打鍵中の表示の規則はそこにしか無い）。"
        "SymPy/mpmath は使っていない。Python が独立に計算した値ではない"
        "——外部参照ではなく仕様書からの写しである（設計書 §4.1）。"
    )


def _case(keys: list[str], main: str, expr: str) -> dict:
    """`id` を持たない 1 件。`id` は `build_entry_shard` が連番で振る。"""
    return {
        "kind": "display",
        "mode": "Deg",
        "keys": keys,
        "expr": expr,
        "expect": {"main": main},
    }


def leading_zero_cases() -> list[dict]:
    """先頭の `0`・`00`・`0.` の扱い。

    `state.rs` の `push_digit`: `self.digits == "0"` のときだけ次の数字が
    置き換える（"05" にならない）。`push_dot`: `digits` が空でなければ
    そのまま `.` を追記する——初期状態の `digits` は `"0"` なので、
    `.` だけを押しても `"0."` になる（`starts_at_zero`・
    `replaces_a_leading_zero` の前提、`accepts_a_decimal_point` と同じ経路）。
    """
    return [
        _case(["0"], "0", "0 を打鍵しても 0 のまま(starts_at_zero)"),
        _case(["0", "0"], "0", "0 を 2 回打鍵しても 0(先頭ゼロは置き換わる)"),
        _case(["0", "5"], "5", "先頭の 0 を 5 が置き換える(replaces_a_leading_zero)"),
        _case(["dot"], "0.", ". だけを打鍵すると 0. になる(初期値の 0 に . が付く)"),
        _case(["0", "dot"], "0.", "0 の直後に . を打鍵しても 0."),
    ]


def second_decimal_point_cases() -> list[dict]:
    """小数点が 2 つ目を拒む(`engine_table.rs`
    `a_second_decimal_point_is_a_syntax_error`、assert は :70)。

    `push_dot` は `digits` が既に `.` を含んでいれば `Err(SyntaxError)` を
    即座に返す——`eq` を待たずにその場でエラー表示になる。

    **`build_entry_shard` には積まない。** `web/tests/heavy/display-cases.spec.ts`
    は現状(このシャードが作られた時点)で `DisplayCase.expect` に `error` を
    持たず、ハーネスが `error !== null` を返したケースを無条件に不一致として
    扱う——`expect.main` が `"Math ERROR"` と一致していても落ちる。エラー種別
    まで期待値に持たせる変更(`error` フィールドの追加)は計画の Task 2
    (`errors-000.json`)の担当であり、この Task では `web/tests/heavy/
    display-cases.spec.ts` を変更しない。ここではケースの中身だけを
    `engine_table.rs:70` から正しく起こして残し、Task 2 が拾えるようにする
    (計画と実物の食い違い。実装報告に書く)。
    """
    return [
        _case(
            ["3", "dot", "dot"],
            "Math ERROR",
            "小数点を 2 つ打つと、確定させる前から構文エラーになる",
        ),
    ]


def max_entry_len_cases() -> list[dict]:
    """12 桁の上限(`MAX_ENTRY_LEN`、`state.rs:17`。先頭のゼロも数える)。

    `the_entry_buffer_stops_accepting_digits_at_its_limit` は 20 個の `7`
    が 12 個で頭打ちになることを固定する。`the_triple_zero_key_adds_three_
    zeros_at_most` は `000` が残り字数だけ入ることを固定する。
    3 件目（先頭ゼロが小数点を挟んでも 1 文字として数えられる境界）は
    `engine_table.rs` に直接のテストが無いため、`state.rs` の
    `push_digit`/`push_dot` の実装(`self.digits.len() >= MAX_ENTRY_LEN`
    を文字数で見る)から導き、使い捨ての Rust バイナリで実測して確かめた
    (`"0.1234567890"` は 12 文字ちょうど)。
    """
    return [
        _case(
            ["7"] * 20,
            "7" * 12,
            "12 桁を超えた打鍵は無視される(MAX_ENTRY_LEN、超えてもエラーにはしない)",
        ),
        _case(
            ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "zeros3"],
            "123456789000",
            "000 も残り字数に収まるぶんだけ入る",
        ),
        _case(
            ["0", "dot", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "1"],
            "0.1234567890",
            "先頭の 0 も 12 文字の内数(小数点を挟んでも 13 文字目は入らない)",
        ),
    ]


def exp_format_cases() -> list[dict]:
    """`EXP` の書式と、指数が範囲外のまま確定していない状態。

    `exp_enters_an_exponent`・`the_sign_key_follows_the_exponent_while_one_
    is_open`・`del_walks_out_of_the_exponent_one_stage_at_a_time`・
    `an_exponent_out_of_range_is_an_error_when_it_is_committed`
    (打鍵の途中はエラーにしない、`eq` を押した瞬間だけ Overflow になる。
    ここでは `eq` を押さないので `"1e309"` のまま)から。
    """
    return [
        _case(["exp", "3"], "1e3", "仮数なしの Exp は仮数 1(空の e3 にはしない)"),
        _case(["1", "dot", "5", "exp", "3"], "1.5e3", "1.5 Exp 3 の打鍵途中"),
        _case(
            ["1", "dot", "5", "exp", "3", "neg"],
            "1.5e-3",
            "Exp 入力中の +/- は指数の符号を反転する",
        ),
        _case(
            ["1", "dot", "5", "exp", "3", "neg", "neg"],
            "1.5e3",
            "+/- を 2 回押すと指数の符号が戻る",
        ),
        _case(
            ["1", "dot", "5", "exp", "neg", "3"],
            "1.5e-3",
            "桁より先に +/- を押しても同じ指数になる",
        ),
        _case(["1", "dot", "5", "exp", "exp"], "1.5e", "Exp の連打は無視される"),
        _case(
            ["1", "dot", "5", "exp", "3", "dot"],
            "1.5e3",
            "指数入力中の小数点は無視される(指数は整数)",
        ),
        _case(
            ["1", "exp", "3", "0", "9"],
            "1e309",
            "指数が範囲外でも、打鍵の途中はエラーにしない(確定は eq の仕事)",
        ),
        _case(
            ["1", "exp", "3", "0", "9", "9"],
            "1e309",
            "指数は 3 桁で頭打ち(4 桁目の 9 は無視される)",
        ),
        _case(
            ["1", "dot", "5", "exp", "zeros3"],
            "1.5e0",
            "指数入力中の 000 も先頭ゼロの規則に従う",
        ),
        _case(
            ["1", "dot", "5", "exp", "3", "del"],
            "1.5e",
            "DEL は指数の桁から 1 段ずつ戻す(1 段目: 指数の桁)",
        ),
        _case(
            ["1", "dot", "5", "exp", "3", "del", "del"],
            "1.5",
            "DEL の 2 段目で e マーカーごと消える",
        ),
        _case(
            ["1", "dot", "5", "exp", "3", "del", "del", "del"],
            "1.",
            "DEL の 3 段目でようやく仮数の文字が消える",
        ),
        _case(
            ["1", "dot", "5", "exp", "3", "j"],
            "j1.5e3",
            "指数入力中でも後置 j は効く(仮数と指数をまとめて虚部にする)",
        ),
    ]


def operator_pending_cases() -> list[dict]:
    """演算子を押した直後(保留演算があるが新しい入力は始まっていない)。

    `shows_the_left_operand_while_an_operator_is_pending` から。
    `xʸ`・`nCr` も同じ二項演算子の規則に従うことを、
    `the_echo_shows_the_power_operator`・`the_echo_shows_the_counting_
    operators` が保留式(echo)側で固定しているのに合わせ、main 側でも
    同じキー列を採る。
    """
    return [
        _case(["3", "add"], "3", "演算子を押した直後は左辺がそのまま見える"),
        _case(
            ["3", "add", "4", "mul"],
            "4",
            "確定した右辺のあとに次の演算子を押しても、直前の値がそのまま見える",
        ),
        _case(["2", "pow"], "2", "xʸ を押した直後も同じ規則"),
        _case(["3", "n_c_r"], "3", "nCr を押した直後も同じ規則"),
    ]


def paren_open_cases() -> list[dict]:
    """括弧を開いた直後、閉じる前。

    `reports_the_parenthesis_depth`・`the_pending_operator_shown_inside_
    parens_is_the_enclosing_one` は `pending_depth`/`pending_op` を固定するが
    `main` 自体は見ていない。`main` は `engine_table.rs` に直接のテストが
    無いため、`state.rs` の実装(開き括弧は `digits` を新しい入力欄として
    積むだけ)から導き、使い捨ての Rust バイナリで実測して確かめた。
    """
    return [
        _case(["lparen"], "0", "( だけ押しても表示は 0 のまま"),
        _case(["lparen", "lparen"], "0", "( を 2 回でも 0 のまま(深さは別に持つ)"),
        _case(
            ["3", "add", "lparen"],
            "0",
            "演算子の後に ( を押すと、( は新しい入力欄を積むので表示は 0 に戻る"
            "(pending_op は Add のまま残る)",
        ),
        _case(
            ["3", "add", "lparen", "4"],
            "4",
            "( の中で入力を始めると、中の値が見える",
        ),
    ]


def sign_toggle_cases() -> list[dict]:
    """負号、`+/-` の途中適用。

    `negation_applies_to_the_committed_value`(`eq` 後の確定値への適用)に、
    打鍵の途中への適用を足す。`+/-` の直後に新しい桁を打つと打ち直しとして
    始まる(`-12` の続きに `3` を打っても `-123` にはならず `3` になる)ことは
    `engine_table.rs` に直接のテストが無いため、`push_digit` が
    「確定値」を新しい `digits` の起点にしない実装から導き、
    使い捨ての Rust バイナリで実測して確かめた。
    """
    return [
        _case(["neg"], "0", "入力前に +/- を押しても 0 のまま"),
        _case(["0", "neg"], "0", "0 に +/- をかけても 0 のまま"),
        _case(["1", "2", "neg"], "-12", "+/- は確定した入力に即座にかかる"),
        _case(
            ["1", "2", "neg", "3"],
            "3",
            "+/- の直後に打った桁は、続きではなく新しい入力として始まる",
        ),
        _case(["1", "2", "neg", "neg"], "12", "+/- を 2 回押すと符号が戻る"),
    ]


def build_entry_shard() -> dict:
    """全形をまとめ、`id` を連番で振って 1 枚のシャードにする。

    `random` を使わない——ここは乱択でサンプリングする集合ではなく、
    仕様書の規則を 1 つずつ書き写した固定の列挙である。並び順を変えると
    既存の `id` が変わってしまうので、形の並びはこの関数の中で固定する。

    **`second_decimal_point_cases` はここに積まない。** その関数のコメントに
    書いたとおり、`web/tests/heavy/display-cases.spec.ts` が `error` を
    まだ照合できない(Task 2 の担当)ので、いま積むと `pnpm heavy` が赤くなる。
    """
    shapes: list[list[dict]] = [
        leading_zero_cases(),
        max_entry_len_cases(),
        exp_format_cases(),
        operator_pending_cases(),
        paren_open_cases(),
        sign_toggle_cases(),
    ]
    cases: list[dict] = []
    for shape in shapes:
        for case in shape:
            case = dict(case)
            case["id"] = f"entry-{len(cases):06d}"
            cases.append(case)
    return {
        "schema": SCHEMA,
        "generated_by": _provenance(),
        "cases": cases,
    }
