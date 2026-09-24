"""`独立:` の規律の**適用範囲**（設計書 `2026-09-24-independence-scope-design.md`）。

**この表が範囲そのものである。** 規律は 2026-09-24 まで「公開関数の docstring に 1 行」と
だけ書いており、**どのファイルの公開関数か**を言っていなかった——**1.0 の門の判定で
3 人が 3 つの数を出し、3 つとも正しかった**（14／43／288 中 43）。**割れたのは数ではなく
問いである。**

**番人は `reference/tests/test_independence.py`。** 表に無いファイルが `reference/` に
現れたら赤、**表に在ってディスクに無い行が残っていても赤**（両向き）。

**役割は 3 つ**:

- ``expects`` —— **Rust と突き合わせる数（または文字列）を作る。** 宣言が**要る**。
- ``builds`` —— **入力を組み立てる・ふるう・並べる。** 数を作らないので要らない。
- ``tools`` —— 生成の道具（書き出し・差分）。期待値に触れないので要らない。

**`builds` と `tools` にも理由を書く**——**「要らない」と決めたことの記録が無いと、
次に読む人が同じ判断をやり直す**ことになる。
"""

from __future__ import annotations

#: 宣言に使ってよい 4 語（`CONTRIBUTING.md` の「書き方は 4 つだけ」）。
WORDS = ("別手順", "不可能", "一部", "未確認")

#: 役割 → そのファイルが何をするか。**番人はこの 3 つ以外を受け取らない。**
ROLES = ("expects", "builds", "tools")

#: **ファイル → (役割, 理由)。** 相対パスは `reference/` から。
#:
#: **`reference/tests/` は範囲外**——**あれは番人であって期待値ではない**。
#: `.venv` と `__init__.py` も外（前者は他人のコード、後者は再輸出だけ）。
SCOPE: dict[str, tuple[str, str]] = {
    # ------------------------------------------------------------------ 参照実装
    "src/calcarc_reference/complex_ref.py": (
        "expects",
        "直交と極の相互変換の期待値。Rust は f64 の hypot/atan2、こちらは SymPy の厳密式",
    ),
    "src/calcarc_reference/compound_ref.py": (
        "expects",
        "複利の期待値。関数ごとに宣言が在る（式・評価・確定で答えが割れる）",
    ),
    "src/calcarc_reference/convert_ref.py": (
        "expects",
        "単位換算の期待値。式は spec の affine 1 本、評価は Fraction",
    ),
    "src/calcarc_reference/currency_ref.py": (
        "expects",
        "為替の期待値。float を一度も経由しない Fraction。レートは外から来る入力",
    ),
    "src/calcarc_reference/data_scale_ref.py": (
        "expects",
        "Data Scale の期待値。Python の int が u128 と自然に独立する",
    ),
    "src/calcarc_reference/eng_ref.py": (
        "expects",
        "工学表記の期待値。Rust は文字列から指数を読む、こちらは Decimal で直接",
    ),
    "src/calcarc_reference/expr_ref.py": (
        "expects",
        "式の評価の期待値。関数ごとに宣言が在る",
    ),
    "src/calcarc_reference/llm_ref.py": (
        "expects",
        "LLM のメモリの期待値。両側とも厳密な整数で、式は spec が固定している",
    ),
    "src/calcarc_reference/loan_ref.py": (
        "expects",
        "ローンの期待値。関数ごとに宣言が在る（一部・不可能・別手順が混在する）",
    ),
    "src/calcarc_reference/real_ref.py": (
        "expects",
        "通常表示の期待値。Rust は 2 度整形、こちらは Decimal で 1 度だけ丸める",
    ),
    "src/calcarc_reference/scientific_ref.py": (
        "expects",
        "単項関数の期待値。モジュールは別手順、pow_real だけ規約を共有する（一部）",
    ),
    "src/calcarc_reference/sexagesimal_ref.py": (
        "expects",
        "60 進表示の期待値。Fraction の厳密有理数で、f64 の割り算を通らない",
    ),
    "src/calcarc_reference/transfer_ref.py": (
        "expects",
        "データ転送の期待値。両側とも厳密な整数で、式は spec が固定している",
    ),
    "src/calcarc_reference/loan_boundary.py": (
        "expects",
        "円の境界と上限の golden。宣言は build_cases に在る",
    ),
    "src/calcarc_reference/complex_div_boundary.py": (
        "expects",
        "複素除算の境界の golden。宣言はモジュールに在る",
    ),
    # ------------------------------------------------------- 重量級コーパスの生成
    "src/calcarc_reference/corpus_calls.py": (
        "expects",
        "金融とデータスケールの呼び出しの期待値（*_ref を呼んで作る）",
    ),
    "src/calcarc_reference/corpus_combinatorics.py": (
        "expects",
        "組合せの誤入力の期待値。宣言はモジュールに在る",
    ),
    "src/calcarc_reference/corpus_complex.py": (
        "expects",
        "複素の式木を評価して期待値にする（corpus_eval とは別経路）",
    ),
    "src/calcarc_reference/corpus_entry.py": (
        "expects",
        "打鍵の途中の表示。数学的な定義が無く、engine_table.rs から導く",
    ),
    "src/calcarc_reference/corpus_errors.py": (
        "expects",
        "エラー種別の期待値。種別名だけ共有し、どの式がどれかは定義域から決める",
    ),
    "src/calcarc_reference/corpus_eval.py": (
        "expects",
        "式木を数として評価する。キー列を見れば engine の移植になる",
    ),
    "src/calcarc_reference/corpus_opcorr.py": (
        "builds",
        "平坦な鎖を公開の優先順位で木に組むだけ。評価は corpus_eval が持つ"
        "（既存の宣言 2 本は残す。害が無く、消すほうが説明を要する）",
    ),
    "src/calcarc_reference/corpus_expr.py": (
        "builds",
        "式木と 2 つの直列化。冒頭が「このモジュールは計算しない」と書いている",
    ),
    "src/calcarc_reference/corpus_science.py": (
        "builds",
        "科学計算の試験空間の因子表。数を作らない",
    ),
    "src/calcarc_reference/corpus_coverage.py": (
        "builds",
        "要求セルの代数。金融も科学計算も知らない",
    ),
    "src/calcarc_reference/cases.py": (
        "builds",
        "Rust と突き合わせる入力の表。**独立の議論の対象は「答え」であって「問い」ではない**"
        "——入力を共有しなければ突き合わせ自体が成り立たない",
    ),
    "src/calcarc_reference/independence.py": (
        "tools",
        "この表そのもの。**範囲の表も範囲の中に在る**"
        "——置いた日に番人が「表に無い」と言って教えてくれた",
    ),
    # ------------------------------------------------------------------ スクリプト
    "scripts/generate.py": (
        "tools",
        "各モジュールの build_* を呼んで testdata/ へ書き出すだけ。式を持たない",
    ),
    "scripts/generate_corpus.py": (
        "expects",
        "重量級コーパスを組む。**mpmath を直接使って評価する**ので期待値に触る",
    ),
    "scripts/corpus_diff.py": (
        "tools",
        "2 つのコーパスの差分を並べる。数を作らない",
    ),
    "scripts/find_convert_overflow.py": (
        "expects",
        "単位換算の既知の限界を上限つきで探索する。Fraction で値を作る",
    ),
    "scripts/find_convert_half_way.py": (
        "expects",
        "丸めの半端を探索する。Decimal と Fraction で値を作る",
    ),
}
