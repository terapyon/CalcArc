"""複素除算の境界専用 golden（F7、0.9.4）。

**なぜ通常のコーパスではなくここなのか。**
`complex-000.json` の生成器は大きさを `1e-6`〜`1e9` の帯に制限しており、
**コミット済みシャードの実測は最大 `|z| = 9.933e8`**(2026-09-18)。
**帯を外しても届かない**——20 万本生成して 27,046 件の除算を真値と突き合わせても、
**この壊れ方を踏んだのは 0 件**だった。**引き金は「分母の大きい成分が上端 1 オクターブ
(`MAX/2`〜`MAX`)に入ること」**で、**乱択は 2,046 ある binade の最後の 1 つを踏まない**。
**＝ 通常域を広げる案では埋まらない。構成したケースが要る**(設計の記録は
`docs/superpowers/sdd/2026-09-18-f7-complex-division.md`)。

**独立: 別手順。** 期待値は mpmath の任意精度で「真の商」を出し、**最後に 1 度だけ**
f64 へ落とす。engine は Smith 法で**成分ごとに丸める**ので、手順を共有していない
（CLAUDE.md「参照実装を Rust の移植にしない」）。

**そのうえで、恒等式は代数でも決まる。** ここが置くのは
`z/z = 1`、`a/(a+aj) = 0.5-0.5j`、`z/(2z) = 0.5`、`z/(z÷2) = 2` で、
**どれも z の大きさに依らない**——**参照実装が無くても期待値が言える**。
**次に境界を作る人は、真値の生成から始めなくてよい。**

**数は十進の文字列で持ち、生成時にビット往復を確かめる**(`_exact`)。
**端の値は十進の往復で動きうる**ので、**「読み直したら同じ f64 か」を毎回 assert する**。

**0.9.5（F16）で足した 3 族と、0.9.4 の表が F16 を通した理由。**
0.9.4 の表は**成分間の指数差が最大 3**（形が 1:1 / 8:1 / 1:8 だけ）で、
**有限の 560 行がすべて恒等式**（分子と分母が同じ z から作られる）だった。
**結合形は F16 を原理的に隠す**——分子と分母で同じ成分が同じように消え、
答えが実数に戻る（2026-09-18 に 7 行足して全部厳密一致を実測）。
**だから 0.9.5 の 3 族は、成分間の指数差を軸にし、分子と分母の尺度を切り離す:**

- `gap/` — 分子の成分間の指数差 g。除数は ±1・2・±j（`t = 0` で成分が混ざらない）
- `den_gap/` — 分母の成分間の指数差。分子の大きさは分母と別に振る
- `chain/` — 大きい成分を相殺して小さい成分を取り出す列と、それを拡大する列

**仮数を満たした値を使う（`_M_BIG`・`_M_SMALL`）。2 や 10 の冪を使わない。**
**仮数が 1〜2 ビットの値は、精度を落とす帯を隠す**——F16 は g ≥ 1023 で精度を失い、
g ≥ 1076 で 0 になるが、仮数 2 ビットの `1.5 × 2^k` では**1074 まで何も見えない**
（2026-09-18 実測）。**10^n も同じ**（`1e-20` の仮数は 2 進で満ちていない桁が多い）。
**次に軸を足す人へ: 値を選ぶときは、まず仮数が満ちているかを見ること。**
"""

from __future__ import annotations

import math
import struct

import mpmath as mp

mp.mp.dps = 120

SCHEMA = 1

#: 許容は**相対のみ**。
#:
#: **`abs` を置かない。** 期待値が `1e-320` 前後の行に対して `abs` は桁違いに緩く、
#: **表の下端が丸ごと無検査になる**——**許容を置いた側が無検査の帯を作る**形である。
#: **0 であるべき成分は「厳密に 0」**で別に見張る(`_ZERO_IS_EXACT`)ので、
#: 相対が定義できない行はここでは扱わない（非正規化域は下の `TOLERANCE_ABS_FLOOR`）。
#:
#: 値は実測から決めた——**Smith 法の残差は、ビット一致しない行で最大 1 ULP
#: (相対 2.220e-16 = 2^-52)**で、`1e-15` はその約 4.5 倍。0.9.4（2 の冪で寄せる方式）でも
#: 0.9.5（仮数と指数の組で評価する方式）でも同じ 1 ULP だった（2026-09-18 に両方で実測）。
#: **直した壊れ方(F7 の相対 2.4e-4)より 11 桁厳しい**ので、**あの形はこの許容をすり抜けない**。
TOLERANCE_REL = 1e-15

#: **非正規化域の許容（0.9.5、F16）。** 判定は**成分ごと**に
#: `|得た値 − 期待| ≤ max(rel·|期待|, abs_floor)`。
#:
#: **`abs_floor` は新しい定数ではなく、相対の規則を非正規化域へ延ばしたもの**である:
#: `rel × 2^-1022`（正規化数の下端）。正規化域では `rel·|期待|` のほうが必ず大きいので
#: **効かない**。非正規化域では仮数の桁が減って相対が定義できなくなるので、
#: **下端での相対の幅をそのまま絶対の幅として使う**。`1e-15 × 2^-1022` は f64 で
#: `2.5e-323` に丸まり、**実効は最小の非正規化数（`5e-324`）のちょうど 5 個分**である
#: （2026-09-19 に `2.5e-323 / 5e-324 = 5.0` を印字で確かめた）。
#:
#: **0.9.4 の「`abs` を置かない」とは両立する**——あのとき退けたのは `1e-320` の行を
#: 丸ごと呑む大きさの `abs` で、これは**最小の非正規化数の 5 個分**しかない
#: （`1e-320` の行なら相対 0.25%。仮数が 11 ビットしか無い値の、最下位の桁 5 つ分）。
#: **成分が 0 に潰れることは、この幅では通さない**——期待が非零なら、得た値も非零で
#: 同じ符号であることを別に見る（Rust の比較器）。
TOLERANCE_ABS_FLOOR = TOLERANCE_REL * 2.2250738585072014e-308

#: **0 であるべき成分は厳密に 0 でなければならない**(許容を当てない)。
#: `complex-rules.spec.ts` の「a component that should be zero is not allowed to
#: appear」と同じ教義。実測では 512 個の 0 成分すべてが厳密に 0 だった。
_ZERO_IS_EXACT = True

_MAX = 1.7976931348623157e308
_MIN_NORMAL = 2.2250738585072014e-308
_MIN_SUB = 5e-324

#: 大きさの階級。**名前は「なぜその値か」を言う。**
_MAGNITUDES: list[tuple[str, float, str]] = [
    ("max", _MAX, "f64 の最大"),
    ("just_over_half", math.nextafter(_MAX / 2, _MAX), "MAX/2 の次の f64（最初に壊れた点）"),
    ("half_max", _MAX / 2, "MAX/2 ちょうど（最後に通った点）"),
    ("e308", 1e308, "利用者の報告値"),
    ("e307", 1e307, "1 桁下（報告でも通っていた）"),
    ("one", 1.0, "通常域"),
    ("e-6", 1e-6, "コーパスの帯の下端"),
    ("min_normal", _MIN_NORMAL, "正規化数の下端"),
    ("e-320", 1e-320, "非正規化数（仮数 11 ビット）"),
    ("min_sub", _MIN_SUB, "最小の非正規化数（仮数 1 ビット）"),
]

#: 分母の形。**純実数・純虚数は原理的に踏まないので、対照として置く。**
#: `im = 0` なら Smith の分母 `d = |re| <= MAX` で**決して溢れない**——
#: **この 2 行が緑であることが、引き金の条件（両成分が非零）を裏から支える。**
_SHAPES: list[tuple[str, str]] = [
    ("sym", "対称（引き金が最も広い: |re| > MAX/2）"),
    ("re_heavy", "実部優勢（|re| > MAX/1.016 まで狭まる）"),
    ("im_heavy", "虚部優勢"),
    ("pure_re", "実部のみ（対照: 壊れないはず）"),
    ("pure_im", "虚部のみ（対照: 壊れないはず）"),
]

_SIGNS: list[tuple[str, int, int]] = [("pp", 1, 1), ("pm", 1, -1), ("mp", -1, 1), ("mm", -1, -1)]


def _shape(name: str, a: float) -> tuple[float, float]:
    if name == "sym":
        return (a, a)
    if name == "re_heavy":
        return (a, a / 8)
    if name == "im_heavy":
        return (a / 8, a)
    if name == "pure_re":
        return (a, 0.0)
    if name == "pure_im":
        return (0.0, a)
    raise ValueError(name)


def _bits(x: float) -> int:
    return struct.unpack("<Q", struct.pack("<d", x))[0]


def _exact(x: float) -> str:
    """f64 を十進の文字列にし、**読み直して同じ f64 になることを確かめる。**

    **端の値ほど往復で動く**ので、golden に書く前にここで止める。
    """
    text = repr(x)
    if _bits(float(text)) != _bits(x):
        raise AssertionError(f"十進の往復で値が動いた: {x!r} -> {text} -> {float(text)!r}")
    return text


def _quotient(num: tuple[float, float], den: tuple[float, float]) -> tuple[str, float, float]:
    """真の商を任意精度で出し、f64 に落として分類する。

    **engine の手順（Smith 法）を写さない**——ただ割る。
    """
    q = mp.mpc(mp.mpf(num[0]), mp.mpf(num[1])) / mp.mpc(mp.mpf(den[0]), mp.mpf(den[1]))
    re, im = float(mp.re(q)), float(mp.im(q))
    if not (math.isfinite(re) and math.isfinite(im)):
        return "overflow", 0.0, 0.0
    return "finite", re, im


def _component_ok(
    cid: str, num: tuple[float, float], den: tuple[float, float], re: float, im: float
) -> bool:
    """**成分ごとの判定が意味を持つ行か**を、真の値の 2 項から確かめる（0.9.5、F16）。

    商の成分は `re = (ac + bd)/|den|²`、`im = (bc − ad)/|den|²`。**2 項が打ち消し合う成分は、
    正しい手順でも成分ごとの相対誤差が大きくなる**（`docs/numerical-policy.md` の
    「成分ごとに見れば桁違いに超える」）。**ここはそういう行を置かない表**なので、
    条件数 `(|項1| + |項2|) / |和|` が 2 を超えたら**生成を止める**（行を黙って落とさない）。

    **真の値が非零なのに f64 で 0 に落ちる成分**は、期待値の「厳密に 0」と区別できないので
    **行ごと置かない**（False を返す）。
    """
    a, b = mp.mpf(num[0]), mp.mpf(num[1])
    c, d = mp.mpf(den[0]), mp.mpf(den[1])
    for name, t1, t2, got in (("re", a * c, b * d, re), ("im", b * c, -a * d, im)):
        total = t1 + t2
        if total == 0:
            continue
        if got == 0.0:
            return False
        kappa = (abs(t1) + abs(t2)) / abs(total)
        if kappa > 2:
            raise AssertionError(f"{cid}: 成分 {name} の 2 項が打ち消し合う（条件数 {kappa}）")
    return True


def _case(cid: str, why: str, num: tuple[float, float], den: tuple[float, float]) -> dict | None:
    if den == (0.0, 0.0):
        return None
    # **inf を含む入力は engine に届かない**——`Value` は `finalize()` を通ったものしか
    # 存在しない。最初の版は `z/(2z)` の `2z` が上端で inf になり、**届かない入力を
    # 60 件数えていた**（2026-09-18 に気づいて `z/(z÷2)` を足した）。
    if not all(math.isfinite(v) for v in (*num, *den)):
        return None
    kind, re, im = _quotient(num, den)
    # **0.9.4 の行（F7）には当てない**——あの表は 1 バイトも変えない（案 5）。
    # 実際、`e-320` の `double` 族 8 件は虚部が打ち消しで作られる（条件数 505）。
    if (
        kind == "finite"
        and cid.startswith(NEW_FAMILIES)
        and not _component_ok(cid, num, den, re, im)
    ):
        return None
    case = {
        "id": cid,
        "why": why,
        "num": [_exact(num[0]), _exact(num[1])],
        "den": [_exact(den[0]), _exact(den[1])],
        "expect": kind,
    }
    if kind == "finite":
        case["re"] = _exact(re)
        case["im"] = _exact(im)
    return case


def build_cases() -> list[dict]:
    """恒等式 × 大きさ × 形 × 符号 と、**真に範囲外**の対照群。"""
    cases: list[dict] = []

    def add(cid: str, why: str, num: tuple[float, float], den: tuple[float, float]) -> None:
        case = _case(cid, why, num, den)
        if case is not None:
            cases.append(case)

    for mname, a, mwhy in _MAGNITUDES:
        for sname, swhy in _SHAPES:
            for signame, sre, sim in _SIGNS:
                br, bi = _shape(sname, a)
                den = (sre * br, sim * bi)
                if den == (0.0, 0.0):
                    continue
                add(f"{mname}/{sname}/{signame}/self", f"z/z = 1。{mwhy}・{swhy}", den, den)
                if sname == "sym":
                    add(
                        f"{mname}/{sname}/{signame}/real_over_sym",
                        f"a/(a+aj) = 0.5-0.5j。{mwhy}",
                        (den[0], 0.0),
                        den,
                    )
                add(
                    f"{mname}/{sname}/{signame}/half",
                    f"z/(2z) = 0.5。{mwhy}・{swhy}",
                    den,
                    (den[0] * 2, den[1] * 2),
                )
                # **半分にするのは上端でも安全**なので、`2z` が inf になる帯まで届く。
                add(
                    f"{mname}/{sname}/{signame}/double",
                    f"z/(z÷2) = 2。{mwhy}・{swhy}",
                    den,
                    (den[0] / 2, den[1] / 2),
                )

    # **真に範囲外の答え**（入力は有限、商が f64 を超える）。**ここはエラーが正しい。**
    #
    # **逆向きの主張が要る。** 上の行は「有限の正解を壊すな」を測り、ここは
    # 「壊れていないふりをして値を返すな」を測る。**片方だけだと、全部エラーにする
    # 実装でも、全部値を返す実装でも、どちらかが緑になる。**
    for dname, den in [
        ("min_sub_re", (_MIN_SUB, 0.0)),
        ("min_sub_sym", (_MIN_SUB, _MIN_SUB)),
        ("min_normal_sym", (_MIN_NORMAL, _MIN_NORMAL)),
        ("e-320_re", (1e-320, 0.0)),
    ]:
        for nname, num in [
            ("max_sym", (_MAX, _MAX)),
            ("max_re", (_MAX, 0.0)),
            ("e308_sym", (1e308, 1e308)),
        ]:
            add(f"genuine/{nname}_over_{dname}", "真に範囲外——エラーが正しい", num, den)

    _add_gap_family(add)
    _add_den_gap_family(add)
    cases.extend(_chain_family())

    _assert_shape(cases)
    return cases


#: 0.9.5 で足した族の id の頭。**これ以外の行は 0.9.4 の表そのまま**
#: （`test_complex_div_boundary.py` が指紋で見張る）。
NEW_FAMILIES = ("gap/", "den_gap/", "chain/")

#: **仮数を満たした値**（52 ビットが埋まる）。モジュールの docstring の理由による。
_M_BIG = 4 / 3
_M_SMALL = 12 / 7
_M_OTHER = 10 / 9

#: 成分間の指数差。**1022〜1076 が F16 の帯**（精度を失い始める 1023、0 に潰れる 1076 の両側）、
#: 0・3・52 は対照（0.9.4 でも壊れない）、1100・2000 は帯の外の奥。
_GAPS = [0, 3, 52, 1021, 1022, 1023, 1024, 1050, 1074, 1075, 1076, 1100, 2000]
#: 大きい成分の 2 進指数。**F16 は大きい側を下へ寄せるときだけ起きる**ので、
#: 1 以下（-500）は対照。
_TOPS = [1023, 700, 1, -500]
#: 除数。**実数か純虚数だけ**——`t = 0` で成分が混ざらず、期待値が成分ごとに決まる。
_UNIT_DIVISORS: list[tuple[str, tuple[float, float]]] = [
    ("d1", (1.0, 0.0)),
    ("dm1", (-1.0, 0.0)),
    ("d2", (2.0, 0.0)),
    ("dj", (0.0, 1.0)),
    ("dmj", (0.0, -1.0)),
]


def _wide(top: int, gap: int, m_big: float, m_small: float) -> tuple[float, float] | None:
    """大きい成分 `m_big·2^top` と小さい成分 `m_small·2^(top−gap)`。表せなければ None。"""
    big = math.ldexp(m_big, top)
    small = math.ldexp(m_small, top - gap)
    if small == 0.0 or not math.isfinite(big):
        return None
    return big, small


def _add_gap_family(add) -> None:
    """分子の成分間の指数差 × 大きさ × 実虚入替え × 符号 × 除数（F16 の本体）。

    **符号 4 通りは除数 1 にだけ掛ける**（F16 は符号に依らないことを 1 本で見て、
    表の大きさを抑える）。ほかの除数は `++` だけ。
    """
    for top in _TOPS:
        for gap in _GAPS:
            pair = _wide(top, gap, _M_BIG, _M_SMALL)
            if pair is None:
                continue
            for swap in ("re_big", "im_big"):
                a, b = pair if swap == "re_big" else (pair[1], pair[0])
                for signame, sre, sim in _SIGNS:
                    for dname, den in _UNIT_DIVISORS:
                        if signame != "pp" and dname != "d1":
                            continue
                        add(
                            f"gap/t{top}/g{gap}/{swap}/{signame}/{dname}",
                            f"分子の成分間の指数差 {gap}（大きい側 2^{top}）",
                            (sre * a, sim * b),
                            den,
                        )


#: 分母側の指数差。**`t = 小/大` が非正規化域へ落ちる帯**（0.9.3 の `t` の潰れ、0.9.4 の
#: `ai·t` の潰れ）の両側と、奥。
_DEN_GAPS = [52, 1021, 1022, 1023, 1050, 1075, 1076, 1100, 2000]
_DEN_TOPS = [1023, 500, 1, -500]


#: 分子の大きさ（2 進指数）。**分母から切り離して振る**——分母と同じだけだと商が O(1) に固定される。
#: **1023（f64 の上端）を必ず含める。** 分母が広いとき、商の小さい成分は `b·d/c²` の 1 項で
#: 決まり、**分子が大きくないと真値そのものが f64 の下へ落ちて行が置けない**
#: （最初の版は「分母 + 600」までで、分母の大きい側が 500 以上の帯を 1 行も置けていなかった。
#: 2026-09-18、de50c40 の赤が `t1` にしか出なかったことで気づいた）。
def _num_exponents(top: int) -> list[int]:
    return sorted({top, 1023, top - 600} & set(range(-1021, 1024)), reverse=True)


def _add_den_gap_family(add) -> None:
    """分母の成分間の指数差 × 分子の形 × 分子の大きさのずらし（分子と分母の尺度の切り離し）。

    **分子と分母は同じ z から作らない**（0.9.4 の結合形の穴）。分子は分母と別の仮数で作る。
    """
    for top in _DEN_TOPS:
        for gap in _DEN_GAPS:
            pair = _wide(top, gap, _M_BIG, _M_SMALL)
            if pair is None:
                continue
            for swap in ("re_big", "im_big"):
                c, d = pair if swap == "re_big" else (pair[1], pair[0])
                for e in _num_exponents(top):
                    nums = [
                        ("real", (math.ldexp(_M_OTHER, e), 0.0)),
                        ("imag", (0.0, math.ldexp(_M_OTHER, e))),
                        ("both", (math.ldexp(_M_OTHER, e), math.ldexp(_M_SMALL, e - 1))),
                    ]
                    for nname, num in nums:
                        for signame, sre, sim in _SIGNS:
                            if signame != "pp" and (nname != "both" or e != top):
                                continue
                            add(
                                f"den_gap/t{top}/g{gap}/{swap}/n{e}/{nname}/{signame}",
                                f"分母の成分間の指数差 {gap}（大きい側 2^{top}）"
                                f"・分子の大きさ 2^{e}",
                                num,
                                (sre * c, sim * d),
                            )
    # **分子と分母の両方が広い**。指数差は両側で**わざと違える**——同じにすると虚部の 2 項が
    # 打ち消し合い、成分ごとの判定が意味を持たなくなる（`_component_ok` が止める）。
    for top in (1023, 500):
        for gn in (1023, 1076):
            for gd in (1050, 1100):
                wn = _wide(top, gn, _M_OTHER, _M_SMALL)
                wd = _wide(top, gd, _M_BIG, _M_OTHER)
                if wn is None or wd is None:
                    continue
                for nswap in ("re_big", "im_big"):
                    n = wn if nswap == "re_big" else (wn[1], wn[0])
                    for dswap in ("re_big", "im_big"):
                        dd = wd if dswap == "re_big" else (wd[1], wd[0])
                        add(
                            f"den_gap/both/t{top}/gn{gn}/gd{gd}/{nswap}/{dswap}",
                            f"分子の指数差 {gn}・分母の指数差 {gd}",
                            n,
                            dd,
                        )


def _round_c(z: mp.mpc) -> tuple[float, float]:
    return float(mp.re(z)), float(mp.im(z))


def _chain_family() -> list[dict]:
    """**相殺して取り出す列と、拡大する列**（engine_table の 4 列と同じ形を値の層で）。

    **各段で f64 に丸める**——電卓は 1 演算ごとに `Value` に落とすので、それが仕様である。
    期待値は mpmath で段ごとに計算して丸める（engine の手順は写さない）。
    """
    out: list[dict] = []
    # (id, 分子, 除数, 引く値, 掛ける値)。`1e308` などは利用者の報告の列のまま（キーで打つ値）。
    rows = [
        ("chain/e308_e-20", (1e308, 1e-20), (1.0, 0.0), (1e308, 0.0), (1e20, 0.0)),
        ("chain/e200_e-200", (1e200, 1e-200), (1.0, 0.0), (1e200, 0.0), (1e200, 0.0)),
        ("chain/e-20_e308", (1e-20, 1e308), (1.0, 0.0), (0.0, 1e308), (1e20, 0.0)),
        ("chain/e308_1_control", (1e308, 1.0), (1.0, 0.0), (1e308, 0.0), (2.0, 0.0)),
        (
            "chain/full_e1023",
            (math.ldexp(_M_BIG, 1023), math.ldexp(_M_SMALL, -60)),
            (2.0, 0.0),
            (math.ldexp(_M_BIG, 1022), 0.0),
            (math.ldexp(1.0, 60), 0.0),
        ),
    ]
    for cid, num, den, sub, mul in rows:
        q = _round_c(mp.mpc(*num) / mp.mpc(*den))
        s = _round_c(mp.mpc(*q) - mp.mpc(*sub))
        variants: list[tuple[str, list[tuple[str, tuple[float, float]]], tuple[float, float]]] = [
            ("sub", [("sub", sub)], s),
            ("sub_mul", [("sub", sub), ("mul", mul)], _round_c(mp.mpc(*s) * mp.mpc(*mul))),
        ]
        for tag, steps, want in variants:
            if not all(math.isfinite(v) for v in want):
                raise AssertionError(f"{cid}/{tag}: 期待値が有限でない")
            out.append(
                {
                    "id": f"{cid}/{tag}",
                    "why": "大きい成分を相殺して小さい成分を取り出す（F16 の報告の列）",
                    "num": [_exact(num[0]), _exact(num[1])],
                    "den": [_exact(den[0]), _exact(den[1])],
                    "then": [[op, [_exact(v[0]), _exact(v[1])]] for op, v in steps],
                    "expect": "finite",
                    "re": _exact(want[0]),
                    "im": _exact(want[1]),
                }
            )
    return out


def _assert_shape(cases: list[dict]) -> None:
    """**生成のたびに、表が主張の形を保っていることを確かめる**(番人)。"""
    ids = [c["id"] for c in cases]
    if len(set(ids)) != len(ids):
        raise AssertionError("id が重複している")
    finite = [c for c in cases if c["expect"] == "finite"]
    genuine = [c for c in cases if c["expect"] == "overflow"]
    if not finite or not genuine:
        raise AssertionError("有限の行と範囲外の行は両方要る（片方だけでは主張が半分）")
    # **対照（純実数・純虚数）が実在すること。** 消えると「両成分が非零」の条件を
    # 裏から支える行が無くなる。
    for shape in ("pure_re", "pure_im"):
        if not any(f"/{shape}/" in c["id"] for c in cases):
            raise AssertionError(f"対照の {shape} が 1 件も無い")
    # **非正規化域が実在すること。** 下端の別口（0.9.4 で見つけた 8 件）はここにしか出ない。
    if not any(c["id"].startswith("e-320/") for c in cases):
        raise AssertionError("非正規化域の行が 1 件も無い")
    # **F16 の帯が実在すること（0.9.5）。** 生成の条件を変えて帯の行が消えると、
    # 表は緑のまま F16 を見なくなる——0.9.4 の表がそうだった。
    band = [c for c in cases if c["id"].startswith("gap/") and _gap_of(c["id"]) >= 1023]
    if len({c["id"].split("/")[1] for c in band}) < 3:
        raise AssertionError("分子の指数差 ≥ 1023 の行が、大きさ 3 階級以上に無い")
    if not any(c["id"].startswith("den_gap/t") and _gap_of(c["id"]) >= 1023 for c in cases):
        raise AssertionError("分母の指数差 ≥ 1023 の行が無い")
    if not any(c["id"].startswith("den_gap/both/") for c in cases):
        raise AssertionError("分子と分母の両方が広い行が無い")
    if not any(c["id"].startswith("chain/") for c in cases):
        raise AssertionError("相殺の列が無い")
    # **対照: F16 が起きない側**（差が小さい／大きい側が 1 以下）も在ること。
    if not any(c["id"].startswith("gap/t-500/") for c in cases):
        raise AssertionError("対照（大きい側が 1 以下）が無い")


def _gap_of(cid: str) -> int:
    """`gap/t…/g1023/…` や `den_gap/t…/g1023/…` から指数差を読む。"""
    return int(cid.split("/")[2][1:])
