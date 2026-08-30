"""科学計算の試験空間モデル（`scientific-v1`）の因子表。

設計書 `docs/superpowers/specs/2026-08-25-coverage-model-design.md` の
**§14.2「初期モデル」**が 9 領域の要求軸と被覆規則を定めている。**この module が
足すのは、その軸に対する水準である**——§14.2 は軸を挙げるが、水準を定義していない。

## 水準はどこから起こしたか

**§14 の軸と、仕様が名指す境界から起こす。既存のコーパスからは起こさない。**

**コーパスを水準の出どころにすると、コーパスは定義上いつも満点になる**
——`Rad × 逆三角` が穴として見えるのは、**§14 が「角度モード」を軸に名指しして
いるから**である。データから起こした水準は、**データに無い穴を見つけない**。
これは「生成器を弱くすれば除外が増える」と同型の壊れ方である。

**データは「空の帯」を見つけるために当てる。** 実データが 1 件も入らない帯が
出たら、**それは帯を削る理由ではなく、発見である。**

## 一次資料（写しを作らない）

- **関数の集合**: `corpus_expr` の定数を **import する**。ここに写しを置くと、
  片方を直したときにもう片方が古くなる
- **定義域の帯**: `docs/numerical-policy.md` の「関数の定義域」の表。
  **`ln`/`log10` は `x > 0`、`asin`/`acos` は `−1 ≤ x ≤ 1`、`1/x` は `x ≠ 0`**——
  帯の切れ目はその表が決めている
- **演算子群・相殺形式・表示境界・複素の縁**: 生成器が名指ししている定数
  （`ASSOC_CHAINS` / `CANCELLATION_SHAPES` / `DISPLAY_EDGE_LITERALS` /
  `COMPLEX_EDGE_VALUES`）。**人が決めて名前を付けたもの**で、乱択の産物ではない

## 被覆規則（§14.2 の「初期の被覆規則」列）

**9 領域のうち 8 つは 1-way である。** §14.2 が「各水準 1 件以上」「各帯に最低件数」
「各経路に最低件数」と書いている。**直積を作るのは `angle_mode` だけ**
（「各組合せ 1 件以上」）。**これが金融との大きな違い**で、データが 5.7 倍でも
要求セルは金融より小さくなる。
"""

from __future__ import annotations

from calcarc_reference import corpus_coverage as coverage
from calcarc_reference.corpus_expr import (
    COMBINATORICS_BINS,
    COMBINATORICS_FNS,
    ELEMENTARY_FNS,
    INVERSE_TRIG_FNS,
    UNARY_FNS,
)

#: モデルの名前。`coverage.model` に載る。
SCIENCE_MODEL = "scientific-v1"

#: **§14.2 の 9 行を、そのまま写した対応表。**
#:
#: **人が読んで確かめるための表である。** 因子表の取りこぼし（軸を 1 本
#: 書き忘れる）は、**同じ因子表から列挙するテストには原理的に見えない**
#: ——列挙は因子表を正としてしまう。**設計書と因子表を突き合わせられるのは
#: 人だけ**なので、§14.2 の文言をここに置いて、下の `SCIENCE_FACTORS` と
#: 並べて読めるようにする。
SPEC_AXES: dict[str, tuple[str, str]] = {
    "elementary": ("関数種別 × 定義域帯", "各水準1件以上、境界近傍は名指し"),
    "inverse_trig": ("関数種別 × 角度モード × 境界帯", "1-way必須、重要ペアを選択"),
    "angle_mode": ("Deg/Rad × 三角関数", "各組合せ1件以上"),
    "precedence": ("優先順位関係 × 括弧有無", "各文法クラスに最低件数"),
    "associativity": ("演算子群 × 平坦/括弧対照", "既存層の最低件数を維持"),
    "cancellation": ("相殺形式 × 桁落ち強度帯", "各帯に最低件数"),
    "combinatorics": ("nPr/nCr × 正常/定義域/Overflow近傍", "各経路に最低件数"),
    "display": ("ENG/DMS × 表示境界", "名指し境界と最低件数"),
    "complex": ("演算種別 × 表示形式 × ゼロ成分", "各重要クラスに最低件数"),
}

#: 角度モード。**§14.2 が `angle_mode` と `inverse_trig` の両方で名指ししている。**
ANGLE_MODES = ("Deg", "Rad")

#: 定義域の帯（`elementary`）。**切れ目は `0` だけである。**
#:
#: **`docs/numerical-policy.md` の「関数の定義域」の表が名指しする切れ目を、
#: そのまま水準にする**——`sqrt` は `x ≥ 0`、`ln`/`log10` は `x > 0`、
#: `1/x` は `x ≠ 0`。**4 つとも `0` で振る舞いが変わり、表はそれ以外の切れ目を
#: 持たない。**
#:
#: **【訂正 2026-08-30】ここには 5 水準あった**——`negative` / `zero` /
#: `unit_interval` / `positive_small` / `positive_large`。そして docstring に
#: **「帯の切れ目は仕様が決めている」と書いてあった。表を当たったら、
#: `positive_small` と `positive_large` を分ける境目はどこにも無かった。**
#: **5 水準のうち 2 つは私が作ったもので、理由の文言はその事実を隠していた。**
#: `unit_interval`（`±1`）は表に在るが、**それは `asin`/`acos` の境目**であり、
#: この領域の関数（`ln` `log10` `eˣ` `1/x`）とは関係がない——
#: **下の `INVERSE_TRIG_BANDS` へ移した。**
ELEMENTARY_BANDS = ("negative", "zero", "positive")

#: 境界帯（`inverse_trig`）。**切れ目は `±1` である。**
#:
#: 表は `asin`/`acos` に `−1 ≤ x ≤ 1` と書いている。**境目そのもの（`|x| = 1`）を
#: 独立の水準にする**のは、§14.2 が `elementary` に「境界近傍は名指し」と
#: 求めているのと同じ理由である——**境界は、内と外の間ではなく、内でも外でもない
#: 1 点で壊れる。**
#:
#: **`atan` は全実数が定義域なので 3 帯すべてが正常に返る。** それは
#: **1-way ではこの軸が `atan` だけで埋まる**ことを意味する（実測: `boundary` を
#: 踏んでいるのは `atan(1)` の 1 件だけで、`asin(1)` も `acos(1)` も 0 件）。
#: **だから `(band, function)` を選択ペアに入れる**——下の `SELECTED_PAIRS`。
INVERSE_TRIG_BANDS = ("inside", "boundary", "outside")

#: 桁落ちの強度帯。**§14.2 は「各帯に最低件数」と言うだけで帯を定義していない。**
#:
#: **★ この 3 水準は私が作ったものである（実測前）。** 表に切れ目が無い。
#:
#: **【訂正 2026-08-30】ここには「`docs/numerical-policy.md` が桁落ちの許容として
#: 相対誤差 `1e-6` を名指ししており」と書いてあった。当たったら、その `1e-6` は
#: `numerical-policy.md:123` の「max(1e-6 円, 値 × 1e-9)」——Loan の月額が円境界に
#: 近すぎるケースを落とす基準であり、桁落ちとも相殺とも関係が無い。**
#: **文書を指した理由が、その文書の別の話を指していた。**
#:
#: **【訂正 2026-08-30・2 度目】ここには「相殺の両辺は式なのでリテラルから
#: 読めない」と書いてあった。偽である。** 実測: `cancellation-000.json` の
#: **2,000 件すべてで、キー列から近さの比が取れる**——両辺がリテラルの
#: `lit ± lit` が 1,100 件、残る 900 件も葉はリテラルである
#: （`sqrt(lit) - sqrt(lit)` 535 / `ln(lit)` 365）。
#:
#: **★ 同じ日に、`overflow_near` では切れ目を引くことを受け入れながら、
#: ここでは「引けない」と書いていた。基準が非対称だった。**
#:
#: **切れ目はシャード自身が宣言している許容から引く**——下の
#: `CANCELLATION_TOLERANCE_*`。**私が作った数ではない。**
CANCELLATION_BANDS = ("mild", "near_tolerance", "severe")

#: **表示の有効数字**（`docs/numerical-policy.md`「有効数字 10 桁」）。
#: **2 か所が使う**——表示境界（`display_edges`）と、相殺の帯の切れ目
#: （`CANCELLATION_FULL_LOSS`）。**同じ「10 桁」を指しているので 1 つにする。**
DISPLAY_SIGNIFICANT_DIGITS = 10

#: **帯の切れ目 2 つ。どちらも無次元の比である。**
#:
#: **判定に使うのは `|a-b| / max(|a|,|b|)`**——**比**であり、単位を持たない。
#: **だから切れ目も比でなければならない。**
#:
#: **【訂正 2026-08-30・3 度目】ここには `abs 5e-10` を使っていた。次元が合わない。**
#: シャードが宣言する `tolerance` の `abs` は、生成器のコメントが
#: **「表示分解能」**と書いているとおり**結果の絶対誤差の単位を持つ数**である。
#: **比と比べてよい数ではなかった。** `rel 1e-6` のほうは比なので整合する。
#:
#: **これは同じ日に 2 度目の「借りた数の量が違う」である**——1 度目は
#: `numerical-policy.md` の `1e-6` が Loan の月額の話だった件
#: （`CANCELLATION_BANDS` の訂正を見よ）。**「シャード自身が宣言している数だから
#: 安全」ではない。何を測った数かを見る。**
#:
#: **下の切れ目は、どちらも比として意味が立つ:**
#:
#: - `CANCELLATION_FULL_LOSS` = `10 ** -DISPLAY_SIGNIFICANT_DIGITS` = `1e-10`。
#:   **電卓が表示する有効数字は 10 桁**（`docs/numerical-policy.md`）なので、
#:   **比がここを下回ると、表示できる桁が 1 つも残らない**
#: - `CANCELLATION_TOLERANCE_REL` = `1e-6`。**シャードが宣言している相対許容**
#:   ——**ここを下回ると、合否を決めているのは相対許容のほうになる**
#:
#: **実データ**（2026-08-30 実測、2,001 件）:
#:
#: ```
#: r < 1e-10            severe            571 件   表示できる桁が残らない
#: 1e-10 <= r < 1e-6    near_tolerance  1,429 件   相対許容が合否を決める帯
#: r >= 1e-6            mild                1 件   許容の中に収まる
#: ```
#:
#: **`mild` は最初 0 件だった**——**このシャードは「桁がほとんど落ちない
#: 引き算」を 1 件も作っていなかった。対照が無かった。**
CANCELLATION_FULL_LOSS = 10.0**-DISPLAY_SIGNIFICANT_DIGITS

#: **シャードが `tolerance.rel` として宣言している数の写し。**
#: **一致はテストが見る**（`test_the_cancellation_cuts_are_the_shards_own_tolerance`）。
CANCELLATION_TOLERANCE_REL = 1e-6


def cancellation_band(ratio: float) -> str:
    """**近さの比 → 帯。** 切れ目はシャードが宣言している許容そのもの。"""
    if ratio < CANCELLATION_FULL_LOSS:
        return "severe"
    return "near_tolerance" if ratio < CANCELLATION_TOLERANCE_REL else "mild"


#: 相殺の形。**生成器が名指ししている 4 つ**（`CANCELLATION_SHAPES`）。
#:
#: **【訂正 2026-08-30・2 度目】「測れない」と書いてあった。書いていなかっただけである。**
#:
#: **生成器は形を名前で選んでいる**——`CANCELLATION_SHAPES[rng.randrange(...)]`
#: （`generate_corpus.py`）。**`associativity` が `stratum` に層の名前を書いて
#: いるのと同じ手が、そのまま使える。** 骨格が他領域と重なる（`ln(リテラル)` は
#: `elementary` に 233 件ある）という測定は正しかったが、**それは「キーだけで
#: 見分けられない」であって「生成器が知らない」ではない。**
#:
#: **`stratum` に書く**（Task 18）。`associativity/shape` と同じ扱いである。
#:
#: **★ ただし、shape の突合は「2 つの読み経路」ではない。**
#: **観測側も記録側も同じ `stratum` を読む**ので、**一致は定義上成り立つ。**
#: **`stratum` が木と食い違っても、両側から同じ値が出るだけで assert は鳴らない**
#: ——鳴るのは**帯のほう**（木とキーで別々に比を計算するので）である。
#: **shape を守っているのは分布の pin**（`stratum` が壊れれば帯の合計が
#: 2,001 でなくなる）で、**間接的である。**
CANCELLATION_SHAPES = (
    "near_subtraction",
    "sqrt_difference",
    "log_near_one",
    "absorption",
)

#: 演算子群。**`ASSOC_CHAINS` のキー**（生成器の一次資料）。
ASSOC_GROUPS = ("additive", "multiplicative", "combinatorial", "power")

#: 平坦／括弧の対照。**`ASSOC_CONTROL_STRATUM` が対照群の名前**である。
ASSOC_SHAPES = ("flat", "parenthesized")

#: 組合せ関数の経路。**§14.2 が「正常/定義域/Overflow近傍」と名指ししている。**
COMBINATORICS_PATHS = ("normal", "domain", "overflow_near")

#: **「Overflow 近傍」の下限。**
#:
#: **【訂正 2026-08-30】射影が「近傍」を「した」に写していた。** 元は
#: `error == "Overflow"` のときだけ `overflow_near` にしていた——**それは
#: 溢れ**た**ケースであって、近傍ではない。§14.2 の語は「近傍」である。**
#:
#: **★ この訂正で、赤が 1 つ消えた。** `combinatorics/path=overflow_near` は
#: 「データに 1 件も入力が無いセル」として門に名指しされていたが、**直した
#: 射影では 9 件が踏んでいる。** **穴が埋まったのではなく、穴ではなかった。**
#:
#: **★ 切れ目は私が選んだ。しかも、選び方はデータを見てである。** `f64` が
#: 表せる最大の指数が 308 であることは**形式が決めている**が、
#: **「その 1 つ下（指数 307 以上）までを近傍とする」の部分は私の選択**であり、
#: **候補を実データの件数で比べて決めている。**
#:
#: **これはこの module 自身の規則 1（「水準を既存コーパスから起こさない」）に
#: 反する。** 書いておく——**コーパスから起こした水準は、コーパスに無い穴を
#: 見つけない。** ここでは**上限 308 という形式の事実が骨**で、
#: **どこまでを「近傍」と呼ぶかだけがデータ由来**だが、**その区別は
#: 読む人には見えない**ので、明示する。**（新しい定義は旧定義の上位集合なので、
#: 緩めてはいない——旧定義で `overflow_near` だったケースは、すべて新定義でも
#: そうである。）** 候補と実測（2026-08-30）:
#:
#: ```
#: >= 1e308        2 件    薄い。種を変えると 0 になりうる
#: >= 1e307        9 件    ← これを採った
#: >= f64max/10    6 件    上と同じ発想だが、切れ目が 1.7977e307 と読みにくい
#: >= 1e300       38 件
#: n >= 171     1,753 件   素朴な階乗が溢れる帯。**2,000 件中 1,753 件では、
#:                         水準として何も区別しない**
#: ```
#:
#: **この帯がこのシャードの存在理由である**——生成器の docstring が
#: `ncr_does_not_overflow_on_the_way_to_an_answer_that_fits` を独立に検証すると
#: 書き、engine のコメントが **「n = 1022〜1028 の中心二項係数は答が収まるのに
#: 落ちる」**と名指ししている。実測の最大は `(1099 nPr 102) = 1.2037e308`。
OVERFLOW_NEAR_FLOOR = 1e307

#: 表示の種別。**§14.2 が「ENG/DMS」と名指ししている。**
DISPLAY_KINDS = ("eng", "dms")

#: 表示の境界。**`DISPLAY_EDGE_LITERALS` の 14 個を、指数の位置で帯にまとめた。**
#: 14 個をそのまま水準にすると「境界を 1 つ足したら要求セルが 1 つ増える」だけの
#: 表になり、**何を確かめたいのかが読めなくなる。**
DISPLAY_EDGES = (
    "exponent_zero",
    "exponent_step",
    "rounding_carry",
    "sub_unit",
    "long_mantissa",
)

#: 優先順位の文法クラス。**§14.2 が「優先順位関係 × 括弧有無」と言っている。**
#:
#: **★ この 4 つは私が起こした。** §14.2 は「優先順位関係」としか書いておらず、
#: どの関係を数えるかを決めていない。**電卓が持つ優先順位の段
#: （加減 < 乗除 < 冪 < 一価関数）から、隣り合う段の対と、同じ段の連鎖を
#: 取った**——`docs/base-spec.md` の優先順位表が段を決めているので、
#: **段そのものは仕様が持ち、対の取り方が私の選択**である。
#:
#: **【訂正 2026-08-30・2 度目】「キー側に相手が居ない」と書いてあった。
#: 言い過ぎである。**
#:
#: **演算子はキー列に在る。** 素朴に「両方の演算子が居るか」で数えると
#: （2,000 件の実測）:
#:
#: ```
#: mul_over_add       2000 / 2000
#: chained_same       1545
#: unary_over_binary  1445
#: power_over_mul        0
#: ```
#:
#: **足りないのは演算子ではなく構造である。** `mul_over_add` が 2000/2000 に
#: なるのは、この読みが**「両方在る」しか見ておらず、「括弧なしで隣り合って
#: いるか」を見ていない**からである。**正しくは「構造は、キー列を優先順位で
#: 読み直さないと出ない」**——**読めないのではなく、parser が要る。**
#:
#: **★ そして `cancellation/shape` との非対称は、逆である。**
#:
#: - **`cancellation/shape`**: 生成器が**名前で選んでいる**。
#:   **突合できない**——観測側も記録側も同じ `stratum` を読む
#: - **`precedence/grammar_class`**: 生成器は**何も選んでいない**（乱択の木）。
#:   **突合できる**——木から導くのと、キー列を優先順位で読み直すのは、
#:   **本当に別の経路**である
#:
#: **こちらのほうが強い突合になりえる。** ただし**キー列の parser が要る**
#: （`expr_ref.py` のものは単位式用で、電卓のキー列は読めない。実測）。
#:
#: **★ `power_over_mul` は、このシャードでは構造的に作れない。**
#: **`corpus_expr.BINARY_OPS` に `^` が無く**、precedence の 2,000 件に
#: **`pow` は 1 件も無い**（実測）。**測れるようにした瞬間、本当の穴になる**
#: ——埋めるには `BINARY_OPS` に `^` を足すことになり、**乱択の draw が動いて
#: 2,000 件が総入れ替え**である。**parser を書くかどうかを検討する人が、
#: 最初に知るべき事実である。**
PRECEDENCE_CLASSES = (
    "mul_over_add",
    "power_over_mul",
    "unary_over_binary",
    "chained_same",
)
PRECEDENCE_PAREN = ("bare", "parenthesized")

#: 複素の演算種別・表示形式・ゼロ成分。**`COMPLEX_EDGE_VALUES` の分類**から
#: 起こす——あの表は「実軸の正／負」「虚軸の正／負」「虚部が 0」を
#: **コメントで名指ししている。**
COMPLEX_OPS = ("add_sub", "mul_div", "power", "unary_fn")
COMPLEX_FORMS = ("rectangular", "polar")
COMPLEX_ZERO_PARTS = ("none", "real_zero", "imag_zero", "both_zero")

#: 三角関数。**`UNARY_FNS` には `sqrt` / `sqr` / `neg` も入っている**ので絞る。
#: **絞った事実を書いておく**——絞りは隠れ場所になりうる。
TRIG_FNS = tuple(fn for fn in UNARY_FNS if fn in ("sin", "cos", "tan"))

SCIENCE_FACTORS: dict[str, dict[str, tuple]] = {
    "elementary": {"function": ELEMENTARY_FNS, "band": ELEMENTARY_BANDS},
    "inverse_trig": {
        "function": INVERSE_TRIG_FNS,
        "angle_mode": ANGLE_MODES,
        "band": INVERSE_TRIG_BANDS,
    },
    "angle_mode": {"function": TRIG_FNS, "angle_mode": ANGLE_MODES},
    "precedence": {
        "grammar_class": PRECEDENCE_CLASSES,
        "parenthesis": PRECEDENCE_PAREN,
    },
    "associativity": {"operator_group": ASSOC_GROUPS, "shape": ASSOC_SHAPES},
    "cancellation": {"shape": CANCELLATION_SHAPES, "band": CANCELLATION_BANDS},
    "combinatorics": {
        "function": COMBINATORICS_FNS + COMBINATORICS_BINS,
        "path": COMBINATORICS_PATHS,
    },
    "display": {"kind": DISPLAY_KINDS, "edge": DISPLAY_EDGES},
    "complex": {
        "operation": COMPLEX_OPS,
        "form": COMPLEX_FORMS,
        "zero_part": COMPLEX_ZERO_PARTS,
    },
}

#: **直積を作るのは `angle_mode` だけ**（§14.2 の「各組合せ1件以上」）。
ALL_COMBINATION_SCOPES = ("angle_mode",)

#: **§14.2 は `inverse_trig` に「1-way 必須、重要ペアを選択」と書いている。**
#: 1-way だけでは足りない——**どのペアが「重要」かを決めるのは、この表の仕事**である。
#:
#: **選んだのは `angle_mode × function`。** 理由は実測である——**`Rad × asin` /
#: `Rad × acos` / `Rad × atan` はコーパス 18 枚のどこにも 1 件も無い**
#: （2026-08-30、着手前）。**1-way だと「`angle_mode=Rad` が未達」という 1 セルに
#: 畳まれ、どの関数が欠けているかが出ない。** ペアにすると 3 セルとして出る。
#:
#: **`band × function` も選ぶ（2026-08-30 追加）。**
#:
#: **ここには「帯と関数の相互作用は、まだ測っていないので名指しできない」と
#: 書いてあった。測ったので、その理由は期限切れである**——リテラル引数の
#: 実測（2026-08-30）:
#:
#: ```
#: asin: inside 2（すべて asin(0)）      boundary 0   outside 0
#: acos: inside 4（すべて acos(0)）      boundary 0   outside 0
#: atan: inside 3   boundary 1（atan(1)）  outside 624
#: ```
#:
#: **1-way だと 3 帯すべて緑になる**——`atan` が 1 人で 3 帯を埋めるからである。
#: **しかし表が `±1` を境目と名指ししているのは `asin`/`acos` のほうで、
#: その 2 つは境界を 1 度も踏んでいない。** **軸としては満点、確かめたい所は
#: 空**という、1-way の教科書どおりの死角である。
SELECTED_PAIRS: dict[str, tuple[tuple[str, str], ...]] = {
    "inverse_trig": (("angle_mode", "function"), ("band", "function")),
}


def _selected_pair_cells(scope: str, factors: dict[str, tuple]) -> tuple[coverage.Cell, ...]:
    """選んだ軸の組だけを直積にする。**全軸の直積は作らない**（§14.2）。"""
    cells: list[coverage.Cell] = []
    for left, right in SELECTED_PAIRS.get(scope, ()):
        # **軸の並びは因子表の順に揃える**（`all_combination_cells` と同じ）。
        # 並びが違うと `Cell` の同一性が崩れ、**同じ意味のセルが別物になる。**
        first, second = (name for name in factors if name in (left, right))
        for a in factors[first]:
            for b in factors[second]:
                cells.append(
                    coverage.Cell(
                        scope,
                        ((first, coverage.level_text(a)), (second, coverage.level_text(b))),
                    )
                )
    return tuple(cells)


SCIENCE_REQUIREMENTS: tuple[coverage.Requirement, ...] = tuple(
    coverage.Requirement(
        f"{scope}/{'-'.join(sorted(factors))}/"
        f"{'all' if scope in ALL_COMBINATION_SCOPES else 'one_way'}"
        f"{'+pairs' if scope in SELECTED_PAIRS else ''}",
        scope,
        "all"
        if scope in ALL_COMBINATION_SCOPES
        else ("one_way+pairs" if scope in SELECTED_PAIRS else "one_way"),
        coverage.all_combination_cells(scope, factors)
        if scope in ALL_COMBINATION_SCOPES
        else coverage.one_way_cells(scope, factors) + _selected_pair_cells(scope, factors),
    )
    for scope, factors in SCIENCE_FACTORS.items()
)


# ---------------------------------------------------------------------------
# 写す経路（Task 2）——**ケースから、観測できる水準だけを取り出す。**
#
# **観測と記録は別物である**（裁定 1 の (c)）。生成器は「この水準を狙って作った」
# と知っており（記録）、ここは「このケースは何を踏んでいるか」を読む（観測）。
# **両者の一致を assert するのが Task 3 の主番人**で、**この module は観測の側**
# だけを持つ。
# ---------------------------------------------------------------------------

#: **キーの綴り → 関数の名前。** 盤面のトークンと因子表の名前は綴りが違う
#: （`n_fact` と `fact`、`n_p_r` と `nPr`）。**変換表をここ 1 か所に置く。**
KEY_TO_FUNCTION: dict[str, str] = {
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "asin": "asin",
    "acos": "acos",
    "atan": "atan",
    "ln": "ln",
    "log10": "log10",
    "exp_e": "exp_e",
    "recip": "recip",
    "n_fact": "fact",
    "n_p_r": "nPr",
    "n_c_r": "nCr",
}

#: **リテラルを打つキー。** 数字と小数点だけ。**指数入力（`exp`）は入れない**
#: ——`Typed` の指数は「同じ値への別の打ち方」であり、**記録側（木）は値を持つが
#: 観測側（キー）は打ち方を持つ**ので、ここを広げると両側がずれる。
DIGIT_KEYS: frozenset[str] = frozenset("0123456789") | {"dot"}

#: **一価関数のキー。** `n_p_r` / `n_c_r` は 2 項なので**入れない**——
#: あれの直前の数字列は「引数」ではなく**左の被演算子**である。
UNARY_FUNCTION_KEYS: tuple[str, ...] = (
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "ln",
    "log10",
    "exp_e",
    "recip",
    "n_fact",
)


def literal_arguments(keys: list[str]) -> list[tuple[str, float]]:
    """**キー列から「リテラルを引数に取った一価関数」を拾う。**

    **帯（`band`）を観測する唯一の窓である。** 一価関数のキーの直前が数字列なら、
    その数字列がまるごと引数である——`['3','7','1','ln']` は `ln(371)`。
    直前が `rparen` や別の関数キーなら、引数は式なので**読まない**。

    **`expr` を読まない。** この module は「キーを一次資料にする」と決めており
    （`observed_levels` の docstring に実測つきで書いてある）、
    **`errors-000.json` の `expr` は人間向けの散文**である。

    **窓は狭い。** 実測（2026-08-30）: `elementary` の関数適用 3,345 回のうち
    **リテラル引数は 1,784 回（53.3%）**。残りは入れ子の式で、**そこは読めない。**
    **読めない分を「踏んでいない」と読ませてはいけない**ので、この窓で測った
    帯は「踏んだことが分かる帯」であって、「踏んだ帯の全部」ではない。
    """
    found: list[tuple[str, float]] = []
    for index, key in enumerate(keys):
        if key not in UNARY_FUNCTION_KEYS:
            continue
        end = index
        # **`neg` は数字列の後ろに付く**（`5` を打ってから符号を反転する）。
        # **ここを読まないと「負の帯」が窓に映らない**——`Num` は非負整数なので、
        # **負のリテラルは必ずこの形になる。**
        negative = end > 0 and keys[end - 1] == "neg"
        if negative:
            end -= 1
        start = end
        while start > 0 and keys[start - 1] in DIGIT_KEYS:
            start -= 1
        if start == end:
            continue
        text = "".join("." if k == "dot" else k for k in keys[start:end])
        if negative:
            text = "-" + text
        try:
            value = float(text)
        except ValueError:
            continue
        found.append((KEY_TO_FUNCTION[key], value))
    return found


def display_edges(text: str) -> set[str]:
    """**打った十進のリテラルが、どの表示境界に触れるか。**

    **切れ目はすべて `docs/numerical-policy.md` が名指ししている:**

    | 帯 | 仕様の記述 |
    |---|---|
    | `sub_unit` | ENG の仮数は **1 以上** 1000 未満。1 を割ると帯が変わる |
    | `exponent_zero` | 指数 0。**指数表記にならない**側の代表 |
    | `exponent_step` | ENG の**指数は常に 3 の倍数** |
    | `long_mantissa` | **有効数字 10 桁** |
    | `rounding_carry` | 10 桁に丸めた結果、**指数が 1 つ上がる** |

    **1 件が複数の帯に触れてよい**——`0.001` は `sub_unit` かつ
    `exponent_step` である。**排他にすると、後ろの 1 つで上書きして手前を
    落とす**（`observed_levels` の docstring と同じ理由）。

    **【測定 2026-08-30】`rounding_carry` を踏んでいるリテラルは 1 つも
    無かった。** 生成器の `DISPLAY_EDGE_LITERALS` には
    **「10 桁に丸めると 1000 に繰り上がり、指数が 1 つ上がる」**（`999.9999999`）
    と**「10 桁ちょうど、繰り上がりで 1e9」**（`999999999.9`）という註が
    付いていたが、**参照実装に通すとどちらも繰り上がらない**——
    `999.9999999` は**既に有効数字 10 桁**なので丸めが恒等で、
    `999999999.9` は `999,999,999.9` と表示される。**註が主張していた境界を、
    コーパスは 1 度も踏んでいなかった。**
    """
    from decimal import ROUND_HALF_UP, Context, Decimal

    size = abs(Decimal(text))
    if size == 0:
        return set()
    found: set[str] = set()
    exponent = size.adjusted()
    if size < 1:
        found.add("sub_unit")
    if exponent == 0:
        found.add("exponent_zero")
    if exponent != 0 and exponent % 3 == 0:
        found.add("exponent_step")
    if len(size.normalize().as_tuple().digits) >= DISPLAY_SIGNIFICANT_DIGITS:
        found.add("long_mantissa")
    rounded = Context(prec=DISPLAY_SIGNIFICANT_DIGITS, rounding=ROUND_HALF_UP).plus(size)
    if rounded.adjusted() != exponent:
        found.add("rounding_carry")
    return found


def leading_literal(keys: list[str]) -> str | None:
    """**キー列の先頭の数字列。** 表示のケースは `[数字…, "eq", "eng"|"dms"]`。

    **先頭以外は読まない**——`literal_arguments` と同じ「窓」の考え方である。
    式を打っているケースでは `None` を返し、**その分は「踏んでいない」ではなく
    「読めない」**として扱う。
    """
    run: list[str] = []
    for key in keys:
        if key not in DIGIT_KEYS:
            break
        run.append(key)
    if not run:
        return None
    return "".join("." if k == "dot" else k for k in run)


#: **形ごとの、近さの測り方。** どれも「失われずに残る桁の割合」である。
#:
#: - `near_subtraction` / `sqrt_difference`: `|a-b| / max(|a|,|b|)`
#: - `absorption`: `min(|a|,|b|) / max(|a|,|b|)`（小さいほうが丸めで消える）
#: - `log_near_one`: `|x - 1|`（1 からの隔たりがそのまま答の大きさになる）
#:
#: **どれも 0 に近いほど激しく桁が落ちる**ので、1 つの帯の表で読める。
def cancellation_ratio(shape: str, values: tuple[float, ...]) -> float | None:
    """**葉の値から近さの比を出す。** 形が違えば測り方も違う。

    **キー列からも木からも、同じこの関数を通す**——`ELEMENTARY_BANDS` で
    「両側の窓を揃える」と決めたのと同じ理由である。**測り方が 2 つあると、
    突合は 2 つの実装の差も拾ってしまう。**
    """
    if shape == "log_near_one":
        return abs(values[0] - 1.0) if len(values) == 1 else None
    if len(values) != 2:
        return None
    left, right = abs(values[0]), abs(values[1])
    largest = max(left, right)
    if largest == 0:
        return None
    if shape == "absorption":
        return min(left, right) / largest
    return abs(values[0] - values[1]) / largest


def cancellation_leaves(keys: list[str], shape: str) -> tuple[float, ...] | None:
    """**キー列から、その形の葉を取り出す。**

    **形ごとに読む場所が違う**ので `shape` を渡す——`stratum` が持っている。
    **形を推測しない**: 骨格だけでは他領域と見分けられない（`ln(リテラル)` は
    `elementary` に 233 件ある。2026-08-30 実測）。
    """
    body = [key for key in keys if key != "eq"]
    while len(body) >= 2 and body[0] == "lparen" and body[-1] == "rparen":
        body = body[1:-1]

    def literal(part: list[str]) -> float | None:
        if not part or not all(key in DIGIT_KEYS for key in part):
            return None
        try:
            return float("".join("." if key == "dot" else key for key in part))
        except ValueError:
            return None

    if shape == "log_near_one":
        if not body or body[-1] != "ln":
            return None
        value = literal(body[:-1])
        return None if value is None else (value,)
    operator = "add" if shape == "absorption" else "sub"
    if body.count(operator) != 1:
        return None
    at = body.index(operator)
    left, right = body[:at], body[at + 1 :]
    if shape == "sqrt_difference":
        if left[-1:] != ["sqrt"] or right[-1:] != ["sqrt"]:
            return None
        left, right = left[:-1], right[:-1]
    a, b = literal(left), literal(right)
    return None if a is None or b is None else (a, b)


def elementary_band(value: float) -> str:
    """**切れ目は `0` だけ**（`numerical-policy.md` の「関数の定義域」の表）。"""
    if value < 0:
        return "negative"
    return "zero" if value == 0 else "positive"


def inverse_trig_band(value: float) -> str:
    """**切れ目は `±1`**。**境目そのものを独立の水準にする**（`INVERSE_TRIG_BANDS`）。"""
    size = abs(value)
    if size < 1:
        return "inside"
    return "boundary" if size == 1 else "outside"


#: **演算子 → 複素の演算種別**（`COMPLEX_OPS`）。**キーと木で同じ表を使う**
#: ——`KEY_TO_COMPLEX_OPERATION` がキー側、`SYMBOL_TO_COMPLEX_OPERATION` が木側で、
#: **どちらも下の 1 つの対応から作る**。写しを 2 つ置くと、片方だけ直した日にずれる。
COMPLEX_OPERATION_OF: dict[str, str] = {
    "+": "add_sub",
    "-": "add_sub",
    "*": "mul_div",
    "/": "mul_div",
    "^": "power",
}
KEY_TO_COMPLEX_OPERATION: dict[str, str] = {
    "add": "add_sub",
    "sub": "add_sub",
    "mul": "mul_div",
    "div": "mul_div",
    "pow": "power",
}

#: **複素数を通す一価関数**（`corpus_complex.COMPLEX_UNARY_FNS` と同じ 5 つ）。
#: **写しである**——`corpus_complex` を import すると SymPy を引き込むので、
#: **ここでは名前だけを持ち、下のテストが 2 つの一致を見る。**
COMPLEX_UNARY_FN_NAMES = ("neg", "sqr", "sin", "cos", "tan")

#: **演算子のキー → 演算子群**（`ASSOC_CHAINS` の分類に対応）。
KEY_TO_OPERATOR_GROUP: dict[str, str] = {
    "add": "additive",
    "sub": "additive",
    "mul": "multiplicative",
    "div": "multiplicative",
    "n_p_r": "combinatorial",
    "n_c_r": "combinatorial",
    "pow": "power",
}

#: **観測できない軸。** ここに挙げた軸は、**ケースを読んでも水準が出ない**
#: ——引数の値や式の構造が要る。
#:
#: **書き出す理由**: 裁定 1 の (c) は「記録と観測の一致を assert する」だが、
#: **観測できない軸は assert できない**。**どこまでが検算されているかを、
#: 読む人が知れなければならない**——「全部突き合わせている」と読ませない。
UNOBSERVABLE_AXES: dict[str, tuple[str, ...]] = {
    # **`elementary` と `inverse_trig` の `band` はここに在った（2026-08-30 に外した）。**
    # 理由は「キー列からは読めない」だったが、**関数適用の 53.3% は引数がリテラル**で、
    # そこはキー列に数字が並んでいる。**理由の文言が実データと食い違っていた。**
    # **`cancellation` の 2 軸は 2026-08-30 に外した**——`shape` は生成器が
    # `stratum` に書けばよいだけ（`associativity` と同じ）、`band` は
    # **2,000 件すべてでキー列から近さの比が取れる**（「両辺は式」は偽だった）。
    # 文法クラスは式の構造で決まる（括弧の有無だけは観測できる）
    "precedence": ("grammar_class",),
    # 演算種別は式の構造で決まる
    # **`complex/operation` は 2026-08-30 に外した。** 演算子はキー列にも木にも
    # 在り、**両側から読める**（門は `j` / `Imag`）。**理由は「式の構造で決まる」
    # だったが、構造はキー列にも出ている。**
    # 表示の境界は**リテラルの値**で決まる。キー列には数字が並ぶだけで、
    # 「指数がちょうど 3」「丸めで繰り上がる」はそこからは読めない
    # （2026-08-30、宣言が漏れていて `display/edge` の 5 セルが
    # 「本当の穴」に混ざっていた）。
}


def case_keys(case: dict) -> tuple[str, ...]:
    """ケースのキー列。**等価ケースは 2 本持つ**ので連結する。

    **`keys` を持たないケースが 1,292 件ある**（`display` 621 /
    `complex-display` 671。2026-08-30 実測）——それらは `kind: "equivalence"` で、
    `left` と `right` の 2 本を持つ。**片方だけ読むと、押したキーの半分を
    見落とす。**
    """
    if "keys" in case:
        return tuple(case["keys"])
    return tuple(case.get("left", ())) + tuple(case.get("right", ()))


def observed_levels(case: dict) -> dict[str, dict[str, set[str]]]:
    """1 ケースが踏んでいる水準を、**観測できる軸についてだけ**返す。

    **キーを一次資料にする。`expr` は読まない。**

    実測（2026-08-30）: `expr` とキーで数が食い違う関数が 3 つあった
    （`nPr` 639/640・`nCr` 1711/1715・`recip` 902/903）。**食い違いは全部
    `errors-000.json` で、そこは `expr` が人間向けの散文である**
    （`P(5,6)`・`1/0 (逆数)`）。**キーは押した列そのもの**なので、こちらを正とする。

    **軸ごとに集合を返す。** 1 件が同じ軸で複数の水準を踏むことがある
    （`sin` と `cos` の両方を含む式）——**1 つしか持てない形にすると、
    後ろの 1 つで上書きして手前を落とす。**

    **1 件が複数の scope を踏むこともある**（設計書 §9.3）。三角関数を含む
    `precedence` のケースは、`angle_mode` の水準も踏んでいる。
    """
    keys = set(case_keys(case))
    mode = case.get("mode")
    out: dict[str, dict[str, set[str]]] = {}

    def put(scope: str, axis: str, level: object) -> None:
        out.setdefault(scope, {}).setdefault(axis, set()).add(coverage.level_text(level))

    functions = {KEY_TO_FUNCTION[k] for k in keys if k in KEY_TO_FUNCTION}

    # **帯は、引数がリテラルのときだけ読める**（`literal_arguments` の docstring）。
    # **記録側も同じ窓に絞ってある**——広いほうが多くを見るのではなく、
    # **両側の窓が違えば突合が片側検査になる。**
    for fn, value in literal_arguments(case_keys(case)):
        if fn in ELEMENTARY_FNS:
            put("elementary", "band", elementary_band(value))
        if fn in INVERSE_TRIG_FNS:
            put("inverse_trig", "band", inverse_trig_band(value))

    for fn in sorted(functions & set(TRIG_FNS)):
        put("angle_mode", "function", fn)
    for fn in sorted(functions & set(INVERSE_TRIG_FNS)):
        put("inverse_trig", "function", fn)
    for fn in sorted(functions & set(ELEMENTARY_FNS)):
        put("elementary", "function", fn)
    for fn in sorted(functions & set(COMBINATORICS_FNS + COMBINATORICS_BINS)):
        put("combinatorics", "function", fn)

    if mode in ANGLE_MODES:
        if functions & set(TRIG_FNS):
            put("angle_mode", "angle_mode", mode)
        if functions & set(INVERSE_TRIG_FNS):
            put("inverse_trig", "angle_mode", mode)

    if functions & set(COMBINATORICS_FNS + COMBINATORICS_BINS):
        # **経路はエラーの種類で決まる**（§14.2「正常/定義域/Overflow近傍」）。
        expect = case.get("expect", {})
        error = expect.get("error")
        value = expect.get("re")
        near = (
            error == "Overflow"
            # **溢れずに、上限のすぐ下に着いたケース**——`OVERFLOW_NEAR_FLOOR`。
            or (isinstance(value, (int, float)) and abs(value) >= OVERFLOW_NEAR_FLOOR)
        )
        put(
            "combinatorics",
            "path",
            "domain"
            if (error is not None and error != "Overflow")
            else ("overflow_near" if near else "normal"),
        )

    stratum = case.get("stratum")
    if stratum in CANCELLATION_SHAPES:
        # **相殺の形は生成器が名前で選んでいる**（`associativity` と同じ形）。
        # **帯はキー列の葉から計算する**——`cancellation_leaves` が窓である。
        put("cancellation", "shape", stratum)
        leaves = cancellation_leaves(case_keys(case), str(stratum))
        if leaves is not None:
            ratio = cancellation_ratio(str(stratum), leaves)
            if ratio is not None:
                put("cancellation", "band", cancellation_band(ratio))

    if "eng" in keys:
        put("display", "kind", "eng")
    if "dms" in keys:
        put("display", "kind", "dms")

    if "eng" in keys or "dms" in keys:
        # **表示境界は、打った十進のリテラルから読める**（`display_edges`）。
        # **記録側には相手が居ない**——`keys` を持つ表示のケースは木を
        # 経由せず、`levels` を持たない（実測 2026-08-30: 表示シャード
        # 2,000 件のうち `levels` を持つ 493 件はすべて同値のケースで、
        # `keys` ではなく `left`/`right` を持つ）。**だから観測専用である。**
        text = leading_literal(case_keys(case))
        if text is not None:
            for edge in sorted(display_edges(text)):
                put("display", "edge", edge)

    # **括弧の有無だけは観測できる。** 文法クラスは式の構造が要る。
    put("precedence", "parenthesis", "parenthesized" if "lparen" in keys else "bare")

    groups = {KEY_TO_OPERATOR_GROUP[k] for k in keys if k in KEY_TO_OPERATOR_GROUP}
    for group in sorted(groups):
        put("associativity", "operator_group", group)
    if groups:
        # 対照群の名前は生成器が層に書いている（`ASSOC_CONTROL_STRATUM`）。
        put(
            "associativity",
            "shape",
            "parenthesized" if case.get("stratum") == "parenthesized" else "flat",
        )

    if "j" in keys:
        # **`j` だけで門を作る**（`polar_toggle` を入れない）。**木の側の門は
        # `Imag` の有無**であり、`polar_toggle` は木の外で押されるので、
        # **入れると観測だけが鳴って突合が落ちる。**
        for key in sorted(keys):
            if key in KEY_TO_COMPLEX_OPERATION:
                put("complex", "operation", KEY_TO_COMPLEX_OPERATION[key])
        if any(k in COMPLEX_UNARY_FN_NAMES for k in keys):
            put("complex", "operation", "unary_fn")

    if "j" in keys or "polar_toggle" in keys:
        put("complex", "form", "polar" if "polar_toggle" in keys else "rectangular")
        expect = case.get("expect", {})
        re_zero, im_zero = expect.get("re") == 0, expect.get("im") == 0
        put(
            "complex",
            "zero_part",
            "both_zero"
            if re_zero and im_zero
            else ("real_zero" if re_zero else ("imag_zero" if im_zero else "none")),
        )

    return out


def observed_cells(case: dict) -> set[coverage.Cell]:
    """観測できた水準を、要求セルの単位へ写す。

    **軸の並びは因子表の順に揃える。** アルファベット順で組むと
    `all_combination_cells` が作る `(function, angle_mode)` と食い違い、
    **同じ意味のセルが別物になって被覆が 0 になる**——2026-08-30 に実際に
    そうなった（`angle_mode` が 6 中 0 被覆。`Rad` のケースは 2,000 件在るのに）。

    `SCIENCE_REQUIREMENTS` に在るセルだけを返す——**モデルの外のセルを
    被覆として数えない**（`build_payload` が同じことを検算する）。
    """
    known = {cell for req in SCIENCE_REQUIREMENTS for cell in req.cells}
    found: set[coverage.Cell] = set()
    for scope, axes in observed_levels(case).items():
        for name, levels in axes.items():
            for level in levels:
                found.add(coverage.Cell(scope, ((name, level),)))
        ordered = [name for name in SCIENCE_FACTORS[scope] if name in axes]
        for i in range(len(ordered)):
            for j in range(i + 1, len(ordered)):
                left, right = ordered[i], ordered[j]
                for a in axes[left]:
                    for b in axes[right]:
                        found.add(coverage.Cell(scope, ((left, a), (right, b))))
    return found & known


# ---------------------------------------------------------------------------
# 記録と突合（Task 3）——**生成器が作った木を歩いて、水準を記録する。**
#
# **観測（`observed_levels`）はキー列を読む。記録はこの木を読む。** 2 つの経路が
# 食い違ったら生成を止める（裁定 1 の (c)）。**捕まえるのは「木 → キー」の描画と
# 「キー → 水準」の読みであって、木そのもののバグは捕まえない**
# ——正確には「意図と観測の突合」ではなく「同じ木の、2 つの読み経路の突合」である。
# ---------------------------------------------------------------------------


def _literal_value(node: object) -> float | None:
    """**葉がリテラルなら値を返す。式なら `None`。**

    **キー側の窓と一致させるための関数である**（`literal_arguments`）。
    `Num` は非負整数（`corpus_expr.Num`）、`Typed` は打鍵の列——
    **数字と小数点だけで打たれたものに限る**。指数入力（`exp`）を含む `Typed` は
    **キー側が読めない**ので、こちらも読まない。
    """
    # **`neg` を被せた葉も literal である**（キー側と同じ窓——`literal_arguments`）。
    if getattr(node, "fn", None) == "neg":
        inner = _literal_value(getattr(node, "arg", None))
        return None if inner is None else -inner
    keys_ = getattr(node, "keys", None)
    if keys_ is not None and getattr(node, "text", None) is not None:
        if not all(k in DIGIT_KEYS for k in keys_):
            return None
        try:
            return float(node.text)  # type: ignore[attr-defined]
        except ValueError:
            return None
    value_ = getattr(node, "value", None)
    return float(value_) if isinstance(value_, int) else None


def cancellation_leaves_from_tree(node: object, shape: str) -> tuple[float, ...] | None:
    """**木から、その形の葉を取り出す。** `cancellation_leaves` のキー版と対になる。

    **読む先が違う**——あちらは `to_key_sequence` が描いたキー列、こちらは木。
    **測り方（`cancellation_ratio`）は 1 つを共有する。**
    """
    fn = getattr(node, "fn", None)
    op = getattr(node, "op", None)
    if shape == "log_near_one":
        if fn != "ln":
            return None
        value = _literal_value(getattr(node, "arg", None))
        return None if value is None else (value,)
    if op != ("+" if shape == "absorption" else "-"):
        return None
    left, right = getattr(node, "left", None), getattr(node, "right", None)
    if shape == "sqrt_difference":
        if getattr(left, "fn", None) != "sqrt" or getattr(right, "fn", None) != "sqrt":
            return None
        left, right = getattr(left, "arg", None), getattr(right, "arg", None)
    a, b = _literal_value(left), _literal_value(right)
    return None if a is None or b is None else (a, b)


def _walk(node: object) -> list[object]:
    """木の全ノードを平らに並べる。**キー列を経由しない。**"""
    out = [node]
    for attr in ("arg", "left", "right"):
        child = getattr(node, attr, None)
        if child is not None:
            out.extend(_walk(child))
    return out


def recorded_levels(
    node: object, mode: str, stratum: str | None = None
) -> dict[str, dict[str, set[str]]]:
    """生成器が作った木から、踏んでいる水準を読む。

    **`observed_levels` と同じ形を返すが、読む先が違う**——あちらは
    `to_key_sequence` が描画したキー列、こちらは木そのもの。**2 つが食い違えば、
    描画か読みのどちらかが壊れている。**

    **観測できない軸（`UNOBSERVABLE_AXES`）はここでも読まない。** 木からは
    帯や文法クラスを出せる余地があるが、**出すと突合の相手が居なくなる**
    ——自己申告になり、(b) と同じになる。**この関数は突合できる軸だけを持つ。**

    **【2026-08-30】`elementary` と `inverse_trig` の `band` は、突合できる側へ
    移した。** 木は引数の値を持ち、**キー列も、引数がリテラルなら値を持つ**
    ——`literal_arguments` がその窓である。**だから両側から読めて、突合できる。**
    **窓を木の側で広げない**（入れ子の式まで読むと、キー側に相手が居なくなる）。
    """
    nodes = _walk(node)
    fns = {getattr(n, "fn", None) for n in nodes} - {None}
    ops = {getattr(n, "op", None) for n in nodes} - {None}
    out: dict[str, dict[str, set[str]]] = {}

    def put(scope: str, axis: str, level: str) -> None:
        out.setdefault(scope, {}).setdefault(axis, set()).add(level)

    if stratum in CANCELLATION_SHAPES:
        put("cancellation", "shape", str(stratum))
        leaves = cancellation_leaves_from_tree(node, str(stratum))
        if leaves is not None:
            ratio = cancellation_ratio(str(stratum), leaves)
            if ratio is not None:
                put("cancellation", "band", cancellation_band(ratio))

    # **複素の演算種別。** 門は `Imag` の有無——**キー側の `"j" in keys` と
    # 同じもの**である（`to_key_sequence` は `Imag` に必ず `j` を出す）。
    if any(type(n).__name__ == "Imag" for n in nodes):
        for op in sorted(ops):
            if op in COMPLEX_OPERATION_OF:
                put("complex", "operation", COMPLEX_OPERATION_OF[str(op)])
        if fns & set(COMPLEX_UNARY_FN_NAMES):
            put("complex", "operation", "unary_fn")

    # **キー側と同じ窓**——引数がリテラルの一価関数だけ（`literal_arguments`）。
    for node_ in nodes:
        fn_ = getattr(node_, "fn", None)
        if fn_ is None:
            continue
        value_ = _literal_value(getattr(node_, "arg", None))
        if value_ is None:
            continue
        if fn_ in ELEMENTARY_FNS:
            put("elementary", "band", elementary_band(value_))
        if fn_ in INVERSE_TRIG_FNS:
            put("inverse_trig", "band", inverse_trig_band(value_))

    for fn in sorted(fns & set(TRIG_FNS)):
        put("angle_mode", "function", str(fn))
    for fn in sorted(fns & set(INVERSE_TRIG_FNS)):
        put("inverse_trig", "function", str(fn))
    for fn in sorted(fns & set(ELEMENTARY_FNS)):
        put("elementary", "function", str(fn))
    for fn in sorted(fns & set(COMBINATORICS_FNS)):
        put("combinatorics", "function", str(fn))
    for op in sorted(ops & set(COMBINATORICS_BINS)):
        put("combinatorics", "function", str(op))

    if mode in ANGLE_MODES:
        if fns & set(TRIG_FNS):
            put("angle_mode", "angle_mode", mode)
        if fns & set(INVERSE_TRIG_FNS):
            put("inverse_trig", "angle_mode", mode)

    # **演算子群は木の演算子から。** キー側は `add`/`sub`… の綴りで読む。
    op_to_group = {
        "+": "additive",
        "-": "additive",
        "*": "multiplicative",
        "/": "multiplicative",
        "nPr": "combinatorial",
        "nCr": "combinatorial",
        "^": "power",
    }
    groups = {op_to_group[str(op)] for op in ops if str(op) in op_to_group}
    for group in sorted(groups):
        put("associativity", "operator_group", group)
    if groups:
        put("associativity", "shape", "parenthesized" if stratum == "parenthesized" else "flat")

    return out


def levels_as_json(levels: dict[str, dict[str, set[str]]]) -> dict[str, dict[str, list[str]]]:
    """コーパスに載る形。**並びを固定する**——走行ごとに動くとバイト一致しない。"""
    return {
        scope: {axis: sorted(vals) for axis, vals in sorted(axes.items())}
        for scope, axes in sorted(levels.items())
    }


#: **観測できるが、記録できない軸。**
#:
#: 木には無く、**期待値から出る**もの——`combinatorics` の `path` は
#: 「正常 / 定義域 / Overflow 近傍」で、**エラーの種類が決める**。木を歩いても
#: 出ない（2026-08-30、突合の assert が初回の実走で見つけた）。
#:
#: **軸には 3 つの類型がある**、と分かった:
#:
#: 1. **記録も観測もできる** → 突き合わせられる（(c) が成立する軸）
#: 2. **観測できない**（`UNOBSERVABLE_AXES`）→ 記録するしかない = (b)
#: 3. **観測できるが記録できない**（ここ）→ 観測するしかない。**突合の相手が居ない**
#:
#: **3 を宣言しないと、突合が「記録に無い」を食い違いとして毎回落とす。**
OBSERVATION_ONLY_AXES: dict[str, tuple[str, ...]] = {
    # 期待値のエラー種別から出る。木を歩いても出ない
    "combinatorics": ("path",),
    # `eng` / `dms` は**木の外で押す**——`to_key_sequence(node)` の後ろに足される
    # `eng` / `dms` は**木の外で押す**。`edge` は打った十進のリテラルから
    # 読めるが、**表示のケースは木を経由しない**ので記録側に相手が居ない。
    "display": ("kind", "edge"),
    # キー列は**括弧を省いた形**なので、木の括弧とは対応しない
    "precedence": ("parenthesis",),
    # `polar_toggle` は木の外。ゼロ成分は期待値から出る
    "complex": ("form", "zero_part"),
}


class LevelsDisagree(RuntimeError):
    """記録と観測が食い違った。**生成を止める。**"""


def assert_record_matches_observation(case: dict, node: object) -> None:
    """**この段の主番人。** 記録と観測を、**1 本の assert で**突き合わせる。

    **どちらが正しいかは決めてある**（裁定 1 の (c) の代償）——**木が事実、
    キーからの読みが解釈**である。**一致しなければ射影を直す**（記録を
    観測に合わせて書き換えない）。

    **突合できる軸だけを見る。** `UNOBSERVABLE_AXES` に挙げた軸は観測側が
    出さないので、記録側も出していない（`recorded_levels` の docstring）。
    """
    recorded = levels_as_json(recorded_levels(node, case.get("mode", ""), case.get("stratum")))
    observed_all = observed_levels(case)
    # **突き合わせるのは、両方の経路が出す軸だけ**である。片方しか出さない軸を
    # 混ぜると、**突合が毎回落ちる**（初回の実走で `combinatorics/path` が
    # そうなった）——それは食い違いではなく、**相手が居ない**だけである。
    skip = {
        (scope, axis)
        for table in (UNOBSERVABLE_AXES, OBSERVATION_ONLY_AXES)
        for scope, axes in table.items()
        for axis in axes
    }
    observed = levels_as_json(
        {
            scope: {
                axis: vals
                for axis, vals in axes.items()
                # **`scope in recorded` で絞らない。** 絞ると、**記録が空の
                # ときに観測側も空になり、記録の欠落を捕まえられない**
                # ——2026-08-30、テストがこの穴を見つけた（木を関数の無いものに
                # 差し替えても assert が通った）。**絞りが番人を片側検査に
                # していた。**
                if (scope, axis) not in skip
            }
            for scope, axes in observed_all.items()
        }
    )
    observed = {scope: axes for scope, axes in observed.items() if axes}
    if recorded != observed:
        raise LevelsDisagree(
            f"{case.get('id')}: 木から読んだ水準と、キーから読んだ水準が違う。"
            f"木={recorded} / キー={observed}。"
            "**木が事実、キーからの読みが解釈である**——射影を直すこと"
        )


def build_science_coverage(
    cases_by_shard: dict[str, list[dict]],
    rejections: dict[str, int] | None = None,
) -> dict:
    """9 領域を横断して数えた `coverage` ブロック（裁定 2 の B・裁定 5）。

    **10 枚すべてに同じものを載せる。** モデルがシャードをまたぐので、
    金融の「1 枚 = 1 モデル」と同じ形にならない——**任意の 1 枚を選ぶ恣意性を
    避け、どれを開いても同じ会計が読めるようにする。**

    **`not_measured_axes` を持たせる**（裁定 4）。**「測れない軸に起因する未達」と
    「本当の穴」は別物**で、**読み手の門は後者だけで落とす**。宣言せずに
    落とさないと、**「測れない」が緩めれば緑になるパラメータになる。**

    **【訂正 2026-08-30】`generation_rejections` に `{}` を載せていた。**
    実物のシャードは棄却の数を持っている——**`elementary` 11,564 /
    `inverse-trig` 6,945 / `combinatorics` 6,656、合計 25,165**。
    **裁定 3 が「無い と 0 は別」と決めた当のものを、ブロック側で潰していた。**
    **渡されなければ `{}`** だが、**生成器は渡す。**
    """
    covered: set[coverage.Cell] = set()
    for cases in cases_by_shard.values():
        for case in cases:
            covered |= observed_cells(case)
    payload = coverage.build_payload(
        SCIENCE_MODEL, SCIENCE_REQUIREMENTS, covered, science_exclusions(), rejections or {}
    )
    # **未達を種類で分けて載せる**（裁定 4）。**数だけでは読み手が分けられない**
    # ——`inverse_trig` は「測れない軸（帯）」と「本当の穴（Rad）」の両方を
    # 持つので、**軸の宣言だけで領域ごと見逃すと、穴が緑で通る。**
    by_scope = {r.scope: r for r in SCIENCE_REQUIREMENTS}
    excluded = set(science_exclusions())
    for summary in payload["requirements"]:  # type: ignore[attr-defined]
        requirement = by_scope[summary["scope"]]
        # **除外したセルを未達に数えない。** 2026-08-30、ここが除外を引いて
        # おらず、**理由を貼ったセルが「本当の穴」として名指しされ続けた**
        # ——`required = covered + excluded + unmet` の会計と、門が読む一覧が
        # 食い違っていた。**数は正しく、名前だけが嘘**という壊れ方である。
        unmet = [c for c in requirement.cells if c not in covered and c not in excluded]
        from_unmeasured = [
            c for c in unmet if unmet_is_only_from_unmeasured_axes(requirement.scope, c)
        ]
        summary["unmet_from_unmeasured_axes"] = len(from_unmeasured)
        # **本当の穴は id を載せる。** 数だけだと、報告書が「どこが空か」を
        # 言えない——**穴を可視化するのがこのモデルの値打ちである。**
        summary["unmet_real_cells"] = sorted(c.id for c in unmet if c not in from_unmeasured)
    reasons = {
        ("precedence", "grammar_class"): (
            "演算子はキー列に在るが、構造はそこから直接は出ない"
            "——キー列は括弧を省いた形なので、優先順位で読み直す parser が要る。"
            "書けば木との突合ができる（この軸は生成器が選んでいないので、"
            "木から導くのとキーを読み直すのは別経路である）が、まだ書いていない"
        ),
    }
    payload["covered_outside_model"] = [
        {"cell_id": cell_id, "where": where}
        for cell_id, where in sorted(COVERED_OUTSIDE_MODEL.items())
    ]
    # **理由の写しが本体より長生きしないようにする。** 軸を「測れる」側へ移した日に
    # 理由だけ残ると、**参照されない説明が正しいふりをして残る**——2026-08-30 に
    # `elementary/band` と `inverse_trig/band` で実際にそうなった。
    # **足りない側は `reasons[...]` が KeyError で落ちる。余る側をここで落とす。**
    declared = {(scope, axis) for scope, axes in UNOBSERVABLE_AXES.items() for axis in axes}
    orphans = sorted(set(reasons) - declared)
    if orphans:
        raise LevelsDisagree(
            "測れない軸として宣言されていないのに理由が書いてある: "
            + " / ".join(f"{scope}/{axis}" for scope, axis in orphans)
        )
    payload["not_measured_axes"] = [
        {"scope": scope, "axis": axis, "why": reasons[(scope, axis)]}
        for scope, axes in sorted(UNOBSERVABLE_AXES.items())
        for axis in axes
    ]
    return payload


#: **理由付き除外。** **1 件だけである**（2026-08-30 時点）。
#:
#: **空でよい、が前提だった。** 第 1 段階（金融）で「一律 `source_overflow`」を
#: 貼って表を綺麗にした失敗があるので、**理由が 1 つも貼れないことは
#: 正しい成果物**として扱ってきた。**貼るのは、貼らないと嘘になるときだけ。**
def science_exclusions() -> dict[coverage.Cell, coverage.Exclusion]:
    """**`complex/operation=power` は、engine が受け付けない。**

    **一次資料は engine 自身のテストである**——
    `crates/calcarc-core/src/scientific/mod.rs` の `power_rejects_complex_operands`
    が、**複素数を底にしても指数にしても `DomainError`** になることを固定して
    いる。参照側の `COMPLEX_BINARY_OPS` に `^` が無いのはその帰結である。

    **「生成器が作らない」ではなく「作っても engine が拒む」**——だから
    `not_applicable` である。**生成器を強くすれば埋まる類ではない。**

    **`covered_elsewhere` は付けない。** 実数の `^` は `elementary` と
    `precedence` に山ほど在るが、**それは複素の冪を確かめたことにならない**
    （設計書 §7.2）。
    """
    cell = coverage.Cell("complex", (("operation", "power"),))
    return {
        cell: coverage.Exclusion(
            cell=cell,
            reason=coverage.Reason.NOT_APPLICABLE,
            detail=(
                "engine が複素数の冪を受け付けない。底でも指数でも DomainError"
                "（crates/calcarc-core/src/scientific/mod.rs の"
                " power_rejects_complex_operands が固定している）"
            ),
        )
    }


def unmet_is_only_from_unmeasured_axes(requirement_scope: str, cell: coverage.Cell) -> bool:
    """この未達セルは、**測れない軸に起因する**か。

    **読み手の門はこれで種類を分ける**（裁定 4）——**測れない軸では落とさず、
    本当の穴では落とす。**
    """
    unmeasured = {(scope, axis) for scope, axes in UNOBSERVABLE_AXES.items() for axis in axes}
    return any((requirement_scope, name) in unmeasured for name, _ in cell.axes)


#: **9 領域の外が踏んでいるセル**（裁定 2 の B の帰結）。
#:
#: **これは除外ではない。** B は「9 領域を横断して数え、外は数えない」と決めた
#: ので、**外が踏んでいることを理由に除外すると、裏口から C を採ることになる。**
#: **未達のまま残し、「外の 1 枚が踏んでいる」を別欄で見せる**——
#: 埋めるかどうかの判断材料であって、埋まったことにはしない。
#:
#: 実測（2026-08-30）: `combinatorics` の 2 経路は、**この領域の生成器が設計上
#: 作らない**——`nCr` の定義域外は `OutOfShard: nCr with r greater than n` で
#: 弾かれ、溢れは `_within_range` が False を返す。**`errors-000.json` が
#: 別の作り方で持っている**（`C(5,6)` と `C(5,-1)`）。
COVERED_OUTSIDE_MODEL: dict[str, str] = {
    # **`combinatorics/path=domain` はここに在った（2026-08-30 に外した）。**
    # `combinatorics-display-000.json` を作って、**9 領域の内側で踏むようにした**
    # ——`errors-000.json` の 8 件（組合せ 5・階乗 3）を複製したのではなく、**定義の破れ方を
    # 尽くした格子 13 件**である（`corpus_combinatorics` を見よ）。
    # **`combinatorics/path=overflow_near` はここに在った（2026-08-30 に外した）。**
    # 「errors-000.json（定義域と溢れのシャード）」と書いてあったが、**外に在る
    # というより、内に在るのに射影が読めていなかった**——`OVERFLOW_NEAR_FLOOR`
    # を見よ。**「よそが覆っている」という札が、自分の見落としを隠していた。**
}
