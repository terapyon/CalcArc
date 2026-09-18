use crate::{CalcError, CalcResult};
use serde::{Deserialize, Serialize};

/// 計算コアが扱う唯一の数値型。
///
/// 実数も虚部 0 の複素数として保持する（base-spec §10、設計書 D8）。
/// 実数型と複素数型を分けないことで、演算ごとの型分岐が生じない。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Value {
    pub re: f64,
    pub im: f64,
}

impl Value {
    pub const ZERO: Value = Value { re: 0.0, im: 0.0 };

    pub fn new(re: f64, im: f64) -> Value {
        Value { re, im }
    }

    pub fn real(re: f64) -> Value {
        Value { re, im: 0.0 }
    }

    pub fn imag(im: f64) -> Value {
        Value { re: 0.0, im }
    }

    /// 虚部が 0 のとき真。表示を実数として描画するかの判定に使う。
    pub fn is_real(&self) -> bool {
        self.im == 0.0
    }

    /// 非有限な結果を Overflow として弾き、-0.0 を均す関門。
    ///
    /// f64 の演算は溢れても panic せず inf / NaN を返すため、
    /// 表示に到達する前にここで捕まえる（base-spec §25、§27）。
    /// atan2 は零の符号で ±π を返し分けるため、-0.0 を残さない。
    pub(crate) fn finalize(self) -> CalcResult<Value> {
        if self.re.is_finite() && self.im.is_finite() {
            Ok(Value::new(
                without_negative_zero(self.re),
                without_negative_zero(self.im),
            ))
        } else {
            Err(CalcError::Overflow)
        }
    }

    pub fn checked_add(self, rhs: Value) -> CalcResult<Value> {
        Value::new(self.re + rhs.re, self.im + rhs.im).finalize()
    }

    pub fn checked_sub(self, rhs: Value) -> CalcResult<Value> {
        Value::new(self.re - rhs.re, self.im - rhs.im).finalize()
    }

    pub fn checked_mul(self, rhs: Value) -> CalcResult<Value> {
        Value::new(
            self.re * rhs.re - self.im * rhs.im,
            self.re * rhs.im + self.im * rhs.re,
        )
        .finalize()
    }

    /// 複素数の除算。
    ///
    /// # 何が難しいか
    ///
    /// 素朴な `(rhs.re² + rhs.im²)` を分母にすると、中間の二乗で溢れるか潰れる。
    /// `rhs = (1e-200, 1e-200)` ではゼロでない除数の分母が 0 になって
    /// DivisionByZero を返し、`rhs = (1e200, 0)` では分母が inf になって
    /// 結果が 0 に潰れる。後者は最終値が有限なので `finalize()` も捕まえられない。
    /// base-spec §25 が禁じる「暗黙の overflow」がここで起きる。
    ///
    /// # 手当て: Smith 法を、溢れも潰れもしない数で評価する
    ///
    /// **Smith 法**（大きい方の成分で規格化してから割る）は二乗を作らないので、
    /// 上の 2 例は塞がる。**ただし途中の値は f64 の端をまたぐ**:
    ///
    /// - **上端**: `d = re + im*t` は最大 `2|re|` になり、`f64::MAX` を超えると inf。
    ///   分子が有限なら **`有限/inf = 0` に潰れ、エラーも出ない**（F7）。
    /// - **下端**: 非正規化数では `t` や `im*t` が非正規化域で丸められて桁が死ぬ
    ///   （`1e-320` で相対 2.4e-4。F7）。
    /// - **成分の桁差**: `t` が `2^-1022` を下回ると、`t` との積が非正規化域に落ちる。
    ///   **どちらかの成分がもう一方より 1023 ビット以上小さい**と起きる（F16）。
    ///
    /// **だから途中の値を「仮数 `f64` ＋ 指数 `i32`」の組（[`Wide`]）で持つ。**
    /// 仮数は常に `[1,2)` に居るので、**途中の積・商・和は溢れも潰れもしない**。
    /// **f64 に戻すのは最後の 1 回だけ**で、そこで溢れたなら本物の範囲外
    /// （`finalize()` が Overflow にする）、潰れたなら本物の非正規化域である。
    ///
    /// **`Wide` の各演算は、f64 の 1 演算と同じ丸めを 1 回だけ通す**——仮数どうしの
    /// `*` `/` `+` を 1 回して、あとは 2 の冪倍（仮数を変えない）で指数を付け替える。
    /// **だから途中で端をまたがない入力では、f64 の Smith 法とビットが一致するはず**
    /// である（**これは論証**。実測は下の「測ったこと」）。
    ///
    /// **`mul_add`（融合積和）は使わない。** 「融合すれば速くて正確」は一般には
    /// 真だが、**`ai - ar*t` は桁落ちの列**で、**融合すると丸めの位置が変わる**
    /// ——**測ったら虚部が 25 ULP ぶん悪化した**（2026-09-18、88 の 572 件で）。
    /// **一般則を、測らずにこの列へ当てない。**
    ///
    /// # F16 で分かったこと（0.9.5）
    ///
    /// **0.9.4 は「分子と分母を、それぞれ 2 の冪で `[1,2)` へ寄せてから割る」**直し
    /// だった。**別々だったのは分子と分母であって、分子の中の 2 成分ではない**
    /// ——分子の大きい方の成分を `2^0` に寄せると、**同じ倍率を掛けられた小さい方の
    /// 成分**が非正規化域へ落ちる。`(1e308, 1e-20) ÷ 1` の虚部は 0 になった
    /// （エラーは出ない）。**分母側にも同じ形の後退が在った**——寄せた分子
    /// （`|ai| <= 2`）に小さい `t` を掛けると、積が非正規化域に落ちる
    /// （寄せていない 0.9.3 では積が正規数に残っていた）。
    /// **「寄せる」は途中の値を安全な帯へ移すが、帯は 1 つしか無い**——
    /// **桁の離れた 2 つの成分を 1 つの倍率で同時に帯へ入れることはできない。**
    /// `Wide` は成分ごと・途中の値ごとに指数を持つので、この制約が無い。
    ///
    /// # 測ったこと（2026-09-18、使い捨ての測定。真値は Python の `Fraction` で正しく丸めた f64）
    ///
    /// | 集合 | 件数 | 0.9.3 | 0.9.4 | いま |
    /// |---|---|---|---|---|
    /// | 外部報告の 128 例（桁差 4 種 × 入替え × 符号 × 除数 {1,−1,2,j}） | 128 | 0 に潰れ 0 | **0 に潰れ 96** | 全件ビット一致 |
    /// | 分子の成分に桁差（乱択） | 3,000 | >2ULP 8・0 に潰れ 1 | >2ULP 30・**0 に潰れ 302** | >2ULP 0・0 に潰れ 0 |
    /// | 分母の成分に桁差（乱択） | 3,000 | >2ULP 20・0 に潰れ 18 | >2ULP 9・**0 に潰れ 37** | >2ULP 0・0 に潰れ 0 |
    /// | F7 の境界 golden | 572 | 0 に潰れ 24・Err 食い違い 40 | ≤2ULP 8 | ≤2ULP 8 |
    ///
    /// **分母側の 0.9.3 の 18 件は F16 より前から在った**（Smith 法の `t` が潰れる形）。
    /// **いまはそれも閉じている**——**0.9.4 の後退を戻しただけではない。**
    /// **途中で端をまたがない帯（成分 `2^±332`、20 万組）では 0.9.3 とビット一致**
    /// （番人は `tests` の `agrees_bit_for_bit_with_smith_where_nothing_underflows`）。
    ///
    /// **golden の 8 件は 1 ULP のまま**（`e-320` の `double` 族 `z/(z÷2)`。
    /// `z÷2` という「非正規化域で入力を作る演算」が絡んだときだけ。
    /// `testdata/complex_div_boundary.json` の読み手が件数を厳密に見ている）。
    /// **Smith 法は丸めを 2 回通す**ので、**正しく丸めた商とのビット一致は保証できない。**
    ///
    /// # 呼び出し元まで届いているか
    ///
    /// **`Value::checked_div` の呼び出し元は 2 か所**である（`git grep`、2026-09-18）:
    /// **`scientific/mod.rs` の `tan = sin/cos`** と **`engine/mod.rs` の `BinOp::Div`**。
    /// `tan(1 + 710.4j)` は 0.9.3 で `Err(Overflow)`、いまは `j`（番人は
    /// `scientific/mod.rs` の `tangent_of_a_large_imaginary_part_is_not_a_false_overflow`）。
    /// **キー列の側の番人は `tests/engine_table.rs` の
    /// `dividing_keeps_a_component_far_smaller_than_the_other`**（相殺して小さい成分を
    /// 取り出す列・拡大する列）。
    ///
    /// **★ 単位換算・為替・式の評価は、この壊れ方を持っていない。**
    /// あれらが割るのは **`Rational`**（`expr/rational.rs` の `checked_div`）で、
    /// **f64 を通らない厳密計算**である——**`Value` の除算とは別の関数**。
    ///
    /// # 測っていないもの
    ///
    /// **「塞いだ」と読まないこと**——**0.9.4 の註がそう読ませ、F16 がその穴だった。**
    ///
    /// - **`checked_mul` / `checked_add` / `checked_sub`**: **論証は在るが実測は無い**
    ///   （各部分積は `|a||b|` で抑えられるので、真の積が有限なら中間は溢れない
    ///   ——**潰れる側（成分の桁差）は論証も無い**）。**測るなら乗算にも同じ表が要る。**
    /// - **`a/b/c` のように途中の商が端に着地する連鎖**
    /// - **`recip`・極形式**（`tan` は上のとおり測った）
    /// - **表示層**、**wasm 境界の向こう**
    pub fn checked_div(self, rhs: Value) -> CalcResult<Value> {
        if rhs.re == 0.0 && rhs.im == 0.0 {
            return Err(CalcError::DivisionByZero);
        }
        let (ar, ai) = (Wide::of(self.re), Wide::of(self.im));
        let (br, bi) = (Wide::of(rhs.re), Wide::of(rhs.im));
        let (qr, qi) = if rhs.re.abs() >= rhs.im.abs() {
            let t = bi.div(br);
            let d = br.add(bi.mul(t));
            (ar.add(ai.mul(t)).div(d), ai.sub(ar.mul(t)).div(d))
        } else {
            let t = br.div(bi);
            let d = br.mul(t).add(bi);
            (ar.mul(t).add(ai).div(d), ai.mul(t).sub(ar).div(d))
        };
        // **ここで初めて f64 の端に触れる。** 溢れたなら本物の範囲外（`finalize()` が見る）。
        Value::new(qr.to_f64(), qi.to_f64()).finalize()
    }
}

/// 仮数 `f64` ＋ 指数 `i32` の数（`m · 2^e`）。**`checked_div` の途中の値だけに使う。**
///
/// **仮数は 0 か、絶対値が `[1,2)`**（`normalized` が保つ）。だから仮数どうしの
/// `*` `/` `+` は溢れも潰れもせず、**指数の側（`i32`）が桁の広さを全部持つ**
/// ——f64 の指数は ±1074 程度だが、ここでは途中の値が `2^±2200` でもよい。
///
/// **入口で閉じていること**: 0 は `m = 0` で表す（`binary_exponent` は 0 に 0 を返す）。
/// **非正規化数**は `binary_exponent` が本当の指数を返すので、仮数が `[1,2)` に
/// 正規化されて入る（**桁は 1 つも増えも減りもしない**——2 の冪倍だけ）。
/// **非有限**は `checked_div` へは来ない（`Value` は `finalize()` を通った値）が、
/// 来ても仮数に inf/NaN が残って `to_f64` から出ていき、`finalize()` が Overflow にする。
/// **0 で割る**のも同じ（仮数が inf/NaN になる）——`checked_div` は `rhs = 0` を
/// 先に弾き、Smith の腕は大きい方の成分で割るので、**`Wide` の 0 で割る経路は通らない**。
#[derive(Debug, Clone, Copy)]
struct Wide {
    m: f64,
    e: i32,
}

impl Wide {
    fn of(x: f64) -> Wide {
        Wide::normalized(x, 0)
    }

    /// `m · 2^e` を、仮数が `[1,2)` の形に直す。**2 の冪倍だけ**なので丸めない。
    fn normalized(m: f64, e: i32) -> Wide {
        if m == 0.0 {
            return Wide { m: 0.0, e: 0 };
        }
        let k = binary_exponent(m);
        Wide {
            m: scale_pow2(m, -k),
            e: e + k,
        }
    }

    fn mul(self, rhs: Wide) -> Wide {
        Wide::normalized(self.m * rhs.m, self.e + rhs.e)
    }

    fn div(self, rhs: Wide) -> Wide {
        Wide::normalized(self.m / rhs.m, self.e - rhs.e)
    }

    /// 指数の小さい方を大きい方へ揃えてから足す。**揃えて非正規化域に落ちる桁は、
    /// 大きい方の仮数の最下位ビット（`2^-52`）より 970 桁以上下**なので和を変えない。
    fn add(self, rhs: Wide) -> Wide {
        if self.m == 0.0 {
            return rhs;
        }
        if rhs.m == 0.0 {
            return self;
        }
        let (hi, lo) = if self.e >= rhs.e {
            (self, rhs)
        } else {
            (rhs, self)
        };
        Wide::normalized(hi.m + scale_pow2(lo.m, lo.e - hi.e), hi.e)
    }

    fn sub(self, rhs: Wide) -> Wide {
        self.add(Wide {
            m: -rhs.m,
            e: rhs.e,
        })
    }

    /// f64 へ戻す。**丸めるのはここだけ**（溢れれば inf、潰れれば非正規化数か 0）。
    fn to_f64(self) -> f64 {
        scale_pow2(self.m, self.e)
    }
}

/// `x` の 2 進指数（`x` が `2^e` 以上 `2^(e+1)` 未満の `e`）。
///
/// **非正規化数も正しく返す**——あそこは指数欄が 0 で、大きさは仮数に入っている。
/// **0 と非有限には 0 を返す**（寄せない。呼び出し側はそのまま割る）。
fn binary_exponent(x: f64) -> i32 {
    if x == 0.0 || !x.is_finite() {
        return 0;
    }
    let bits = x.to_bits();
    let raw = ((bits >> 52) & 0x7ff) as i32;
    if raw != 0 {
        return raw - 1023;
    }
    // 非正規化数: 最上位の立っているビットの位置から数える。
    let mantissa = bits & ((1u64 << 52) - 1);
    let leading = 63 - mantissa.leading_zeros() as i32;
    leading - 52 - 1022
}

/// `x * 2^k`。**2 の冪倍は仮数を変えない**ので、丸めを増やさない。
///
/// **倍率を 1 つの `f64` で作らない**——`k` は非正規化数の正規化で ±1000 を
/// 超えうるので、`2^k` 自体が表せない。**刻んで掛ける。**
fn scale_pow2(x: f64, k: i32) -> f64 {
    const CHUNK: i32 = 1000;
    let mut y = x;
    let mut k = k;
    while k > CHUNK {
        y *= two_pow(CHUNK);
        k -= CHUNK;
    }
    while k < -CHUNK {
        y *= two_pow(-CHUNK);
        k += CHUNK;
    }
    y * two_pow(k)
}

/// `2^k`（`-1022 <= k <= 1023`）。指数欄を直に組む。
fn two_pow(k: i32) -> f64 {
    f64::from_bits((((k + 1023) as u64) & 0x7ff) << 52)
}

/// -0.0 を +0.0 に均す。それ以外はそのまま返す。
fn without_negative_zero(x: f64) -> f64 {
    if x == 0.0 { 0.0 } else { x }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **F7 の代表だけを置く**（0.9.4、外部報告）。**網羅の表は検査側の持ち物**
    /// である（calcarc-88 の 572 件：分母の形 5 種 × 符号 4 種 × 大きさ 10 階級）。
    /// **ここに在るのは、壊れ方 1 つにつき 1 本**——**次に読む人が「何が起きて
    /// いたか」を 5 行で掴めるように。**
    #[test]
    fn division_near_the_ceiling_keeps_a_finite_answer() {
        // **静かに嘘の答え**だった形: `d = re + im*t` が inf になり、
        // **有限の分子を inf で割って 0**。`finalize()` は最終値が有限なので
        // 捕まえない。**0.9.3 は `0` を返していた**（エラーも無く）。
        let a = f64::MAX;
        let q = Value::real(a)
            .checked_div(Value::new(a, a))
            .expect("有限の答えが在る");
        assert_eq!((q.re, q.im), (0.5, -0.5));
    }

    #[test]
    fn dividing_the_largest_value_by_itself_is_one() {
        // **偽 Overflow** だった形: 分子も溢れて `inf/inf = NaN` になり、
        // `finalize()` が Overflow にしていた。**答えは 1 である。**
        let z = Value::new(f64::MAX, f64::MAX);
        let q = z.checked_div(z).expect("z/z は 1");
        assert_eq!((q.re, q.im), (1.0, 0.0));
    }

    #[test]
    fn division_in_the_subnormal_range_keeps_its_digits() {
        // **値違い**だった形（**下端の別口**）: 非正規化数は仮数が 11 ビット
        // しか無く、`t = im/re` と `im*t` が**非正規化域で丸められて桁が死ぬ**。
        // **0.9.3 は 0.5001216… を返していた**（真値は `0.5` ちょうど。相対 2.4e-4）。
        let num = Value::new(1e-320, 1.25e-321);
        let den = Value::new(2e-320, 2.5e-321);
        let q = num.checked_div(den).expect("有限の答えが在る");
        assert_eq!((q.re, q.im), (0.5, 0.0));
    }

    #[test]
    fn a_pure_real_divisor_at_the_ceiling_was_never_the_problem() {
        // **対照**。`im = 0` なら `d = |re| <= MAX` で**決して溢れない**
        // ——**引き金は「両成分が非零」**である（88 の実測: 純実数・純虚数は
        // 104/104 健全）。**直しがここを動かしていない**ことを見る。
        let q = Value::real(f64::MAX)
            .checked_div(Value::real(f64::MAX))
            .expect("1 である");
        assert_eq!((q.re, q.im), (1.0, 0.0));
    }

    #[test]
    fn a_genuinely_out_of_range_quotient_still_errors() {
        // **逆向きを作らない**（**範囲外を通し始めたら、それは新しい不具合**）。
        // 最小の非正規化数で `MAX` を割れば、真の答えは f64 の外である。
        let out = Value::real(f64::MAX).checked_div(Value::real(f64::from_bits(1)));
        assert_eq!(out, Err(CalcError::Overflow));
    }

    /// **F16 の仮数**。**仮数を満たした値で測る**——`2^k` や `10^k` の仮数は
    /// 数ビットしか無いので、非正規化域で落ちる下位ビットを持たず、
    /// **「精度を落とす帯」が見えずに「0 に潰れる帯」だけが見える**（calcarc-be の実測）。
    const FULL_MANTISSA: f64 = 1.234_567_890_123_456_7;

    #[test]
    fn dividing_keeps_a_component_far_smaller_than_the_other() {
        // **F16（0.9.4 の後退）。** 0.9.4 は分子の**大きい方の成分**を `2^0` に寄せて
        // いたので、**同じ倍率を掛けられた小さい方の成分**が非正規化域へ落ち、
        // 桁差 1023 ビットから精度を失い、1076 ビットで 0 になった（エラーは出ない）。
        // **`÷1` に限らない**——`÷(−1)`・`÷2`・`÷j` の答えは分子から厳密に決まる。
        let divisors = [
            Value::real(1.0),
            Value::real(-1.0),
            Value::real(2.0),
            Value::imag(1.0),
        ];
        let mut compared = 0;
        for big in [1, 300, 700, 1023] {
            for gap in 1000..=1080 {
                for (sr, si) in [(1.0, 1.0), (1.0, -1.0), (-1.0, 1.0), (-1.0, -1.0)] {
                    let large = sr * FULL_MANTISSA * two_pow(big.min(1023) - 1);
                    let small = si * scale_pow2(FULL_MANTISSA, big - gap);
                    for z in [Value::new(large, small), Value::new(small, large)] {
                        for d in divisors {
                            let want = if d.im != 0.0 {
                                (z.im, -z.re)
                            } else {
                                (z.re / d.re, z.im / d.re)
                            };
                            let q = z.checked_div(d).expect("有限の答えが在る");
                            assert_eq!(
                                (q.re, q.im),
                                (want.0 + 0.0, want.1 + 0.0),
                                "({:e}, {:e}) ÷ ({}, {})",
                                z.re,
                                z.im,
                                d.re,
                                d.im
                            );
                            compared += 1;
                        }
                    }
                }
            }
        }
        // **何も比べずに緑にならない**ための床（4 × 81 × 4 × 2 × 4）。
        assert_eq!(compared, 10_368);
    }

    #[test]
    fn dividing_by_a_value_whose_components_are_far_apart_keeps_the_small_part() {
        // **F16 の分母側。** `(0, A) ÷ (1, 2^-g)` の実部は `A·2^-g` である
        // （`|b|² = 1 + 2^-2g` の `2^-2g` は丸めに届かない）。0.9.4 は分子を `2^0` に
        // 寄せたので、**`ai·t` が非正規化域で計算されて桁を落とした**
        // ——0.9.3 は寄せていない `ai` を掛けていたので積は正規数に残っていた。
        let mut compared = 0;
        for gap in 1000..=1074 {
            let a = FULL_MANTISSA * two_pow(1000);
            let b = Value::new(1.0, scale_pow2(1.0, -gap));
            let q = Value::imag(a).checked_div(b).expect("有限の答えが在る");
            assert_eq!((q.re, q.im), (scale_pow2(a, -gap), a), "2^-{gap}");
            compared += 1;
        }
        assert_eq!(compared, 75);
    }

    /// 0.9.3 までの Smith 法（f64 のまま割る）。**下の比較の相手としてだけ置く。**
    fn plain_smith(a: Value, b: Value) -> (f64, f64) {
        if b.re.abs() >= b.im.abs() {
            let t = b.im / b.re;
            let d = b.re + b.im * t;
            ((a.re + a.im * t) / d, (a.im - a.re * t) / d)
        } else {
            let t = b.re / b.im;
            let d = b.re * t + b.im;
            ((a.re * t + a.im) / d, (a.im * t - a.re) / d)
        }
    }

    #[test]
    fn agrees_bit_for_bit_with_smith_where_nothing_underflows() {
        // **`Wide` は端でだけ違い、それ以外では f64 の Smith 法と同じ丸めを通る**
        // ——註ではこれを**論証**と書いた。**ここがその実測**である。
        // 成分を `2^±332` に置くと、Smith の途中の値（`t`・`d`・積・和）は
        // どれも f64 の端に届かない。**20 万組**（間引いていない。debug で 1 秒未満）。
        let mut s: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = move || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        let mut draw = || {
            let bits = next();
            let mantissa = 1.0 + (bits >> 11) as f64 / (1u64 << 53) as f64;
            let exponent = (next() % 665) as i32 - 332;
            let sign = if next() & 1 == 0 { 1.0 } else { -1.0 };
            sign * scale_pow2(mantissa, exponent)
        };
        let mut compared = 0;
        for _ in 0..200_000 {
            let a = Value::new(draw(), draw());
            let b = Value::new(draw(), draw());
            let q = a.checked_div(b).expect("この帯では有限");
            let (re, im) = plain_smith(a, b);
            assert_eq!(
                (q.re, q.im),
                (without_negative_zero(re), without_negative_zero(im)),
                "{a:?} ÷ {b:?}"
            );
            compared += 1;
        }
        assert_eq!(compared, 200_000);
    }

    #[test]
    fn wide_closes_its_entrances() {
        // **0**: 仮数 0 で表し、足しても掛けても 0 のまま。
        let zero = Wide::of(0.0);
        assert_eq!((zero.m, zero.e), (0.0, 0));
        assert_eq!(zero.add(Wide::of(3.0)).to_f64(), 3.0);
        assert_eq!(zero.mul(Wide::of(3.0)).to_f64(), 0.0);
        // **非正規化数**: 仮数が `[1,2)` に正規化され、戻すとビットまで同じ。
        let tiny = f64::from_bits(1);
        let w = Wide::of(tiny);
        assert_eq!((w.m, w.e), (1.0, -1074));
        assert_eq!(w.to_f64().to_bits(), 1);
        let sub = 1.2345e-310;
        assert_eq!(Wide::of(sub).to_f64(), sub);
        // **途中は f64 の外でもよい**: `2^-1074 × 2^-1074` は `2^-2148` として残り、
        // `2^2148` を掛け戻すと 1 に戻る。
        let deep = w.mul(w);
        assert_eq!(deep.e, -2148);
        assert_eq!(deep.to_f64(), 0.0);
        assert_eq!(deep.mul(Wide { m: 1.0, e: 2148 }).to_f64(), 1.0);
        // **非有限と 0 除算**: 仮数に inf/NaN が残り、`to_f64` から出ていく
        // ——`finalize()` が Overflow にする（`checked_div` はここへ来る前に
        // `rhs = 0` を DivisionByZero で弾く）。
        assert!(!Wide::of(f64::INFINITY).to_f64().is_finite());
        assert!(!Wide::of(f64::NAN).to_f64().is_finite());
        assert!(!Wide::of(1.0).div(Wide::of(0.0)).to_f64().is_finite());
        assert_eq!(
            Value::new(1.0, 0.0).checked_div(Value::ZERO),
            Err(CalcError::DivisionByZero)
        );
        // **溢れ**: 最後に f64 へ戻す段で inf になり、Overflow になる。
        assert_eq!(
            Value::real(f64::MAX).checked_div(Value::real(0.5)),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn real_has_zero_imaginary_part() {
        let v = Value::real(3.0);
        assert_eq!(v.re, 3.0);
        assert_eq!(v.im, 0.0);
        assert!(v.is_real());
    }

    #[test]
    fn imag_has_zero_real_part() {
        let v = Value::imag(4.0);
        assert_eq!(v.re, 0.0);
        assert_eq!(v.im, 4.0);
        assert!(!v.is_real());
    }

    #[test]
    fn zero_is_real() {
        assert!(Value::ZERO.is_real());
        assert_eq!(Value::ZERO, Value::new(0.0, 0.0));
    }

    #[test]
    fn negative_zero_imaginary_still_counts_as_real() {
        // -0.0 == 0.0 は true なので実数扱いになる。
        // atan2 の符号が -0.0 で変わるため、この前提を明示的に固定しておく。
        assert!(Value::new(1.0, -0.0).is_real());
    }

    #[test]
    fn adds_complex_numbers() {
        let r = Value::new(3.0, 4.0)
            .checked_add(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(4.0, 6.0));
    }

    #[test]
    fn subtracts_complex_numbers() {
        let r = Value::new(3.0, 4.0)
            .checked_sub(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(2.0, 2.0));
    }

    #[test]
    fn multiplies_complex_numbers() {
        // (3+4j)(1+2j) = 3 + 6j + 4j + j^2*8 = -5 + 10j
        let r = Value::new(3.0, 4.0)
            .checked_mul(Value::new(1.0, 2.0))
            .unwrap();
        assert_eq!(r, Value::new(-5.0, 10.0));
    }

    #[test]
    fn divides_complex_numbers() {
        // (-5+10j) / (1+2j) = 3+4j
        let r = Value::new(-5.0, 10.0)
            .checked_div(Value::new(1.0, 2.0))
            .unwrap();
        crate::assert_close(r.re, 3.0);
        crate::assert_close(r.im, 4.0);
    }

    #[test]
    fn divides_reals() {
        let r = Value::real(7.0).checked_div(Value::real(2.0)).unwrap();
        assert_eq!(r, Value::real(3.5));
    }

    #[test]
    fn division_by_zero_is_an_error() {
        assert_eq!(
            Value::real(1.0).checked_div(Value::ZERO),
            Err(CalcError::DivisionByZero)
        );
        // 複素数のゼロでも同じ。
        assert_eq!(
            Value::new(1.0, 1.0).checked_div(Value::new(0.0, 0.0)),
            Err(CalcError::DivisionByZero)
        );
    }

    #[test]
    fn overflow_is_an_error() {
        let big = Value::real(f64::MAX);
        assert_eq!(big.checked_mul(Value::real(10.0)), Err(CalcError::Overflow));
    }

    #[test]
    fn a_tiny_but_nonzero_divisor_is_not_treated_as_zero() {
        // b.re^2 は f64 の最小非正規数を下回って 0 に潰れるが、b はゼロではない。
        // 1e-200 / (1e-200 + 1je-200) = 1/(1+j) = 0.5 - 0.5j
        let r = Value::real(1e-200)
            .checked_div(Value::new(1e-200, 1e-200))
            .unwrap();
        crate::assert_close(r.re, 0.5);
        crate::assert_close(r.im, -0.5);
    }

    #[test]
    fn a_huge_divisor_does_not_collapse_to_zero() {
        // 素朴な式では分母が inf になり、結果が 0 に潰れる。
        let r = Value::real(1.0).checked_div(Value::real(1e200)).unwrap();
        assert!(r.re > 0.0, "expected a tiny positive value, got {}", r.re);
        // 相対誤差で見る。絶対誤差では 1e-200 と 0 の区別がつかない。
        crate::assert_close(r.re / 1e-200, 1.0);
        assert_eq!(r.im, 0.0);
    }

    #[test]
    fn finalize_rejects_nan_and_infinity() {
        assert_eq!(Value::real(f64::NAN).finalize(), Err(CalcError::Overflow));
        assert_eq!(
            Value::new(1.0, f64::INFINITY).finalize(),
            Err(CalcError::Overflow)
        );
        assert_eq!(Value::real(1.0).finalize(), Ok(Value::real(1.0)));
    }

    #[test]
    fn multiplication_never_produces_a_negative_zero() {
        // 1 × -1 × 0 のような経路は素朴な IEEE 754 の乗算では -0.0 を
        // 生む。atan2 が符号違いの角度を返すのを防ぐため、finalize() で
        // 均す。
        assert!(
            Value::real(-1.0)
                .checked_mul(Value::ZERO)
                .unwrap()
                .re
                .is_sign_positive()
        );
    }
}
