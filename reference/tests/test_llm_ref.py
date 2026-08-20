"""LLM 参照実装の健全性テスト。突き合わせ本番は golden の仕事。"""

from calcarc_reference.llm_ref import compute


def test_headline_case() -> None:
    # spec §5: 27B INT4 / 62 層 / KV 16 ヘッド / ヘッド次元 128 / 文脈長 8192 / KV は FP16
    r = compute("27000000000", "int4", "62", "16", "128", "8192", "fp16")
    assert r["weight"] == {
        "bytes": "13500000000",
        "bytes_grouped": "13,500,000,000",
        "decimal": "13.5 GB",
        "binary": "12.6 GiB",
    }
    assert r["kv"]["bytes"] == "4160749568"
    assert r["kv"]["decimal"] == "4.2 GB"
    assert r["total"] == {
        "bytes": "17660749568",
        "bytes_grouped": "17,660,749,568",
        "decimal": "17.7 GB",
        "binary": "16.4 GiB",
    }


def test_gqa_is_not_the_attention_head_count() -> None:
    # KV ヘッド 8(アテンションヘッド 32 のモデルを想定)。取り違えると 4 倍ずれる。
    grouped = compute("8000000000", "int8", "32", "8", "128", "4096", "fp16")
    mistaken = compute("8000000000", "int8", "32", "32", "128", "4096", "fp16")
    assert grouped["kv"]["bytes"] == "536870912"
    assert mistaken["kv"]["bytes"] == "2147483648"
    assert int(mistaken["kv"]["bytes"]) == 4 * int(grouped["kv"]["bytes"])


def test_a_single_int4_parameter_rounds_up_to_one_byte() -> None:
    # 切り上げ(spec §3.1)。**重み側にしか無い端である。**
    r = compute("1", "int4", "1", "8", "128", "0", "fp16")
    assert r["weight"]["bytes"] == "1"
    assert r["kv"]["bytes"] == "0"
    assert r["total"]["bytes"] == "1"


def test_the_kv_side_is_always_a_whole_number_of_bytes() -> None:
    # spec §3.1: kv_bits = 2 × … × {4,8,16,32} bit は**常に 8 の倍数**である。
    # だから「それぞれ切り上げてから足す」(§3.4)と「まとめて割る」は、いまの
    # いまの精度では必ず一致する——**分けて書く理由は将来の精度**であって、
    # 現に食い違うからではない(§3.4 の【訂正 2026-08-19】)。
    # ここで測るのはその前提そのもの: KV 側に端数が出ないこと。
    # **コアは 5 つとも受ける**ので 5 つとも測る(盤面が KV に出すのは 4 つ)。
    # 端数が出ない根拠は「ビット幅が 4 の倍数」であって「4 以上」ではない
    # ——6 bit は 4 以上だが 2 × 6 = 12 で破れる。
    bits = {"fp32": 32, "fp16": 16, "bf16": 16, "int8": 8, "int4": 4}
    for kv, per in bits.items():
        r = compute("1", "int4", "3", "5", "7", "11", kv)
        assert int(r["kv"]["bytes"]) * 8 == 2 * 3 * 11 * 5 * 7 * per
    # 重み側だけは端が出る(int4 × 奇数パラメータ)。
    assert compute("1", "int4", "1", "1", "1", "1", "int8")["total"]["bytes"] == "3"


def test_zero_context_is_valid_not_an_error() -> None:
    r = compute("1000000", "fp16", "10", "8", "64", "0", "fp16")
    assert r["kv"]["bytes"] == "0"
    assert "error" not in r


def test_overflow_is_the_u128_contract() -> None:
    assert compute(str(1 << 127), "fp32", "1", "1", "1", "0", "fp16") == {"error": "Overflow"}
    # **積は左から順に検査する**(spec §3.6「どの積も checked_mul」)。
    # 2 × layers があふれた時点で Overflow——後ろに 0 が来ても救わない。
    assert compute("1", "int8", str(1 << 127), "1", "1", "0", "fp16") == {"error": "Overflow"}


def test_unknown_precision_is_a_syntax_error() -> None:
    assert compute("1", "fp8", "1", "1", "1", "1", "fp16") == {"error": "SyntaxError"}
    assert compute("1.5", "int8", "1", "1", "1", "1", "fp16") == {"error": "SyntaxError"}


def test_the_ceiling_is_bracketed_from_both_sides() -> None:
    # int8 は 8 bit なので、収まる最大のパラメータ数は 2^125 - 1。
    # **通る側とあふれる側を 2 件で挟む**——片側だけだと、上限が動いても
    # どちらのテストも緑のままになる。
    inside = compute(str((1 << 125) - 1), "int8", "1", "1", "1", "0", "fp16")
    assert inside["weight"]["bytes"] == str((1 << 125) - 1)
    assert compute(str(1 << 125), "int8", "1", "1", "1", "0", "fp16") == {"error": "Overflow"}
