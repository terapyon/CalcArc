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
#: 相対が定義できない行はここでは扱わない。
#:
#: 値は実測から決めた——**スケーリング後の残差は最大 1 ULP(相対 2.220e-16 = 2^-52)**
#: で、`1e-15` はその約 4.5 倍。**直した壊れ方(相対 2.4e-4)より 11 桁厳しい**ので、
#: **あの形はこの許容をすり抜けない**。
TOLERANCE_REL = 1e-15

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


def _case(cid: str, why: str, num: tuple[float, float], den: tuple[float, float]) -> dict | None:
    if den == (0.0, 0.0):
        return None
    # **inf を含む入力は engine に届かない**——`Value` は `finalize()` を通ったものしか
    # 存在しない。最初の版は `z/(2z)` の `2z` が上端で inf になり、**届かない入力を
    # 60 件数えていた**（2026-09-18 に気づいて `z/(z÷2)` を足した）。
    if not all(math.isfinite(v) for v in (*num, *den)):
        return None
    kind, re, im = _quotient(num, den)
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

    _assert_shape(cases)
    return cases


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
