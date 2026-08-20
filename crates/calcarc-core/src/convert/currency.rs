//! 為替換算(U-4 設計書 §3)。
//!
//! **通貨は「factor が動的な単位」である。** 換算は U-1 と同じく基準通貨を経由する:
//!
//! ```text
//! value → 基準通貨 → 目的通貨   すなわち  value × to_rate ÷ from_rate
//! ```
//!
//! **通貨に `offset` は無い**(すべて倍率のみ)ので、U-1 のアフィン機構に**1 行も足さずに乗る**。
//! だからこのモジュールは `Unit` の表に触れないし、`expr` にも触れない。
//!
//! **レートの表は core に置かない**(§3)。レートは外から来るデータであって定義値ではない
//! ——core が持つのは「値とレート 2 つを受け取って換算する関数」だけである。
//! **小数桁の表は core に置く**(§3.1)。ISO 4217 の minor unit は定義値で、U-1 の係数表と同じ立場である。
//!
//! **レートは 10 進の文字列のまま受け取って厳密な有理数にする。** `"155.23"` は `15523/100` である。
//! **`f64` を一度も経由しない**——経由した時点で誤差が入り、`0.8532` と `1.0855` のような
//! ありふれたレートでも表示が 1 円ずれる(下の `the_tie_that_tells_f64_from_an_exact_rational`)。

use crate::expr::rational::Rational;
use crate::{CalcError, CalcResult};

/// 通貨。**並びは契約である**——盤面の並び・境界の一覧・golden がこの順で並ぶ
/// (spec §3.1 の表を左列 → 右列に読んだ順。`Unit::ALL` と同じ扱い)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Currency {
    // minor unit 0
    Jpy,
    Krw,
    Vnd,
    // minor unit 2
    Usd,
    Eur,
    Gbp,
    Chf,
    Cny,
    Thb,
    Sgd,
    Hkd,
    Twd,
    Aud,
    Cad,
    Inr,
    Brl,
}

impl Currency {
    /// 境界(WASM / JS)とテストが参照する全体。**上の並びのまま。**
    pub const ALL: [Currency; 16] = [
        Currency::Jpy,
        Currency::Krw,
        Currency::Vnd,
        Currency::Usd,
        Currency::Eur,
        Currency::Gbp,
        Currency::Chf,
        Currency::Cny,
        Currency::Thb,
        Currency::Sgd,
        Currency::Hkd,
        Currency::Twd,
        Currency::Aud,
        Currency::Cad,
        Currency::Inr,
        Currency::Brl,
    ];

    /// 境界へ渡す文字列トークン。**ASCII の小文字に倒した ISO 4217 コード。**
    ///
    /// **`Unit::token()` と綴りの規則を 2 つにしない**——U-1 / U-2 の単位トークンが
    /// 全部小文字なので、同じ flat な名前空間に大文字を混ぜない。
    pub fn token(self) -> &'static str {
        match self {
            Currency::Jpy => "jpy",
            Currency::Krw => "krw",
            Currency::Vnd => "vnd",
            Currency::Usd => "usd",
            Currency::Eur => "eur",
            Currency::Gbp => "gbp",
            Currency::Chf => "chf",
            Currency::Cny => "cny",
            Currency::Thb => "thb",
            Currency::Sgd => "sgd",
            Currency::Hkd => "hkd",
            Currency::Twd => "twd",
            Currency::Aud => "aud",
            Currency::Cad => "cad",
            Currency::Inr => "inr",
            Currency::Brl => "brl",
        }
    }

    /// 境界で使う文字列トークンから復元する。未知のトークンは None。
    pub fn from_token(token: &str) -> Option<Currency> {
        Currency::ALL
            .into_iter()
            .find(|currency| currency.token() == token)
    }

    /// 小数点以下の桁数。**典拠は ISO 4217 の minor unit**(spec §3.1。
    /// List One `Pblshd="2026-01-01"` / Amendment 180 で確認済み)。
    ///
    /// **これは定義値であって為替レートではない。** レートは日々変わるので core に
    /// 置かないが、こちらは置く——U-1 の係数表と同じ立場である。
    ///
    /// **minor unit 3 の通貨(`KWD` `BHD` `JOD` `OMR`)は入れない**(spec §3.1)。
    /// 「0 か 2 のどちらか」という単純さが崩れる。
    pub fn decimals(self) -> u8 {
        match self {
            Currency::Jpy | Currency::Krw | Currency::Vnd => 0,
            Currency::Usd
            | Currency::Eur
            | Currency::Gbp
            | Currency::Chf
            | Currency::Cny
            | Currency::Thb
            | Currency::Sgd
            | Currency::Hkd
            | Currency::Twd
            | Currency::Aud
            | Currency::Cad
            | Currency::Inr
            | Currency::Brl => 2,
        }
    }
}

/// 換算。**基準通貨を経由する**(spec §3)——N × N のレート表は持たない。
///
/// **`from_rate == 0` は `DivisionByZero`。** レートは外から来るデータなので、0 が
/// 届くことはありうる(§3「レートは外から来る」)。**割り算をしているのは from 側だけ**で、
/// エラー名が言っているのはそれである——**`to_rate == 0` は正当な `0`** であって
/// エラーではない(目的通貨のレートが 0 なら、換算した金額は 0 である)。
///
/// **0 の判定を掛け算より先に置く**のは、`value × to_rate` があふれる組で
/// `Overflow` が `DivisionByZero` を隠さないようにするためである。
pub fn exchange(value: Rational, from_rate: Rational, to_rate: Rational) -> CalcResult<Rational> {
    if from_rate.is_zero() {
        return Err(CalcError::DivisionByZero);
    }
    value.checked_mul(to_rate)?.checked_div(from_rate)
}

/// 金額の表示(spec §3.1)。**小数点以下を固定桁で出す。**
///
/// **U-1 の `format_rational` に分岐を足さない**(計画の裁定 2)。あちらは
/// **有効数字 10 桁**で切り、こちらは**小数点以下の桁数**で切る。**切る場所が違うものを
/// 1 つの関数にすると、どちらの規則も読めなくなる。**
/// 共有するのは規則(round-half-to-even と 3 桁カンマ)だけで、コードは共有しない。
///
/// - **`decimals` 桁を必ず出す。** `12.5` は `12.50`(末尾の 0 を詰めない)
/// - **`decimals == 0` なら小数点を出さない**(`JPY` に `.` は無い)
/// - **整数部にだけ 3 桁カンマ**
/// - **丸めは round-half-to-even**(プロジェクトの中で丸め方向を 2 つ持たない)
/// - **丸めた結果が 0 なら符号を出さない**——`-0.001 USD` は `-0.00` ではなく `0.00`。
///   `-0.00` は「0 ではないが 0 に見える」の意味に読めてしまう
///
/// **指数表記には落ちない。** 金額は桁が増えてもカンマの付いた固定小数点で出す
/// ——`1.5e10 円` という表示は金額として読めない。
pub fn format_amount(value: Rational, decimals: u8) -> CalcResult<String> {
    let (num, den) = value.parts();
    let negative = num < 0;
    let magnitude = num.unsigned_abs();
    // 分母は常に正(`Rational` の不変条件)。
    let divisor = den.unsigned_abs();

    let scale = 10u128
        .checked_pow(u32::from(decimals))
        .ok_or(CalcError::Overflow)?;
    // **あふれたら Overflow。** 黙って f64 に落ちるより Overflow と言うほうがよい
    // (numerical-policy「表示できない値を黙って丸めない」)。
    let scaled = magnitude.checked_mul(scale).ok_or(CalcError::Overflow)?;

    let mut units = scaled / divisor;
    let rest = scaled % divisor;

    // **round-half-to-even。** `2 * rest` を作らない(あふれる)——
    // `rest` と `divisor - rest` を比べる(`convert::format` と同じ手)。
    let up = match rest.cmp(&(divisor - rest)) {
        core::cmp::Ordering::Greater => true,
        core::cmp::Ordering::Equal => !units.is_multiple_of(2),
        core::cmp::Ordering::Less => false,
    };
    if up {
        units = units.checked_add(1).ok_or(CalcError::Overflow)?;
    }

    // **丸めた結果が 0 なら符号を出さない。**
    let sign = if negative && units != 0 { "-" } else { "" };

    let digits = format!("{units:0>width$}", width = usize::from(decimals) + 1);
    // `digits` は少なくとも `decimals + 1` 文字あるので、この分割は必ず成功する。
    // **それでも添字は検査する**——core は panic しない(CLAUDE.md)。
    let (integer, fraction) = digits
        .split_at_checked(digits.len() - usize::from(decimals))
        .unwrap_or((&digits, ""));

    let integer = group(integer);
    if decimals == 0 {
        // 裸の小数点は置かない。
        Ok(format!("{sign}{integer}"))
    } else {
        Ok(format!("{sign}{integer}.{fraction}"))
    }
}

/// **整数部だけ**に 3 桁ごとのカンマを入れる。負号はこの外側にある。
///
/// `numeric::format::group_integer_part` / `data_scale::format::group_digits` /
/// `convert::format::group` に続く 4 つ目の同型実装。**同じ判断で共通化しない**
/// ——先行 3 つと同じ理由である(入力の型も定義域も用途も違い、5 行の処理を 1 つに
/// まとめる価値より、まとめて生まれる結合の害のほうが大きい)。
/// **裁定 2 が共有すると言っているのは「規則」であって「コード」ではない。**
fn group(integer: &str) -> String {
    let mut out = String::with_capacity(integer.len() + integer.len() / 3);
    for (i, c) in integer.chars().enumerate() {
        if i > 0 && (integer.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// 10 進リテラルを厳密な有理数にする。**受ける形は `-?\d+(\.\d+)?`、ASCII のみ。**
///
/// **値もレートも同じ規則である**(規則を 2 つ持たない)。
///
/// **式は受けない。** U-1 の `convert()` は式を受けるが(§4.3)、こちらの入力は
/// 「金額」と「レート」であって式ではない——`1e3` も `1+2` も `１２３` も
/// `SyntaxError` である。**盤面にその打ち方が無い。**
fn parse_decimal(text: &str) -> CalcResult<Rational> {
    let (negative, body) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (integer, fraction) = match body.split_once('.') {
        // 小数点があるのに小数部が空(`1.`)は受けない。
        Some((_, "")) => return Err(CalcError::SyntaxError),
        Some((left, right)) => (left, right),
        None => (body, ""),
    };
    if integer.is_empty() {
        return Err(CalcError::SyntaxError);
    }
    // **ASCII の数字だけ。** 全角数字(`１２３`)も指数(`1e3`)も 2 つ目の小数点も、
    // ここで落ちる(`split_once` は最初の `.` でしか切らないので、2 つ目は
    // `fraction` の中に残る)。
    let ascii_digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
    if !ascii_digits(integer) || !ascii_digits(fraction) {
        return Err(CalcError::SyntaxError);
    }

    let mut numerator: i128 = 0;
    for byte in integer.bytes().chain(fraction.bytes()) {
        numerator = numerator
            .checked_mul(10)
            .ok_or(CalcError::Overflow)?
            .checked_add(i128::from(byte - b'0'))
            .ok_or(CalcError::Overflow)?;
    }
    let mut denominator: i128 = 1;
    for _ in 0..fraction.len() {
        denominator = denominator.checked_mul(10).ok_or(CalcError::Overflow)?;
    }
    Rational::from_ratio(if negative { -numerator } else { numerator }, denominator)
}

/// 入口。**値もレートも 10 進の文字列で受ける**(spec §2.1・§3)。
///
/// **`f64` を経由する場所が 1 つも無いのがこの関数の要点である。**
/// 文字列 → `Rational` → 換算 → 表示、で通す。
///
/// **`from` の通貨は要らない。** 換算に効くのは `from_rate` のほうで、
/// from 側の小数桁はどこにも現れない(桁を決めるのは着地する `to` だけである)。
/// **使わない引数を「対称だから」と置かない**——境界がトークンを復元できたかどうかは
/// 境界の仕事で、`Currency::from_token` がそれを担う。
pub fn convert_currency(
    value: &str,
    to: Currency,
    from_rate: &str,
    to_rate: &str,
) -> CalcResult<String> {
    let value = parse_decimal(value)?;
    let from_rate = parse_decimal(from_rate)?;
    let to_rate = parse_decimal(to_rate)?;
    format_amount(exchange(value, from_rate, to_rate)?, to.decimals())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(num: i128, den: i128) -> Rational {
        Rational::from_ratio(num, den).unwrap()
    }

    #[test]
    fn every_currency_token_round_trips() {
        for currency in Currency::ALL {
            assert_eq!(Currency::from_token(currency.token()), Some(currency));
        }
        assert_eq!(Currency::from_token("xyz"), None);
        // **大文字は受けない**(トークンは小文字の ISO コードである)。
        assert_eq!(Currency::from_token("USD"), None);
    }

    #[test]
    fn the_minor_units_match_the_spec() {
        // **数え間違いは表の写し落としである。**
        assert_eq!(Currency::Jpy.decimals(), 0);
        assert_eq!(Currency::Krw.decimals(), 0);
        assert_eq!(Currency::Vnd.decimals(), 0);
        let two = Currency::ALL.iter().filter(|c| c.decimals() == 2).count();
        assert_eq!(two, 13);
        let zero = Currency::ALL.iter().filter(|c| c.decimals() == 0).count();
        assert_eq!(zero, 3);
        assert_eq!(Currency::ALL.len(), 16);
    }

    #[test]
    fn the_order_is_the_contract() {
        // **並びは境界の契約である**(Task 4 の `token_parity` が順序込みで見る)。
        // spec §3.1 の表を左列 → 右列に読んだ順。
        let tokens: Vec<&str> = Currency::ALL.iter().map(|c| c.token()).collect();
        assert_eq!(
            tokens,
            vec![
                "jpy", "krw", "vnd", "usd", "eur", "gbp", "chf", "cny", "thb", "sgd", "hkd", "twd",
                "aud", "cad", "inr", "brl",
            ]
        );
    }

    #[test]
    fn a_rate_of_zero_is_an_error_not_a_division() {
        // **レートは外から来る。** 0 が来たら `DivisionByZero` に落ちる。
        assert_eq!(
            exchange(r(100, 1), r(0, 1), r(1685, 10)),
            Err(CalcError::DivisionByZero)
        );
        // **値が 0 でも同じ**(0 ÷ 0 を「0」と言わない)。
        assert_eq!(
            exchange(r(0, 1), r(0, 1), r(1685, 10)),
            Err(CalcError::DivisionByZero)
        );
        // **`to_rate == 0` は正当な 0 である**(裁定 4-3)。割っているのは from 側だけ。
        assert_eq!(exchange(r(100, 1), r(10855, 10000), r(0, 1)), Ok(r(0, 1)));
    }

    #[test]
    fn the_conversion_goes_through_the_base_currency() {
        // 100 USD → JPY。100 × 168.5 ÷ 1.0855 = 33_700_000/2171。
        assert_eq!(
            exchange(r(100, 1), r(10855, 10000), r(1685, 10)),
            Ok(r(33_700_000, 2171))
        );
    }

    #[test]
    fn two_decimals_are_always_two_decimals() {
        // **末尾が 0 でも詰めない**(U-1 の表示規則との違い)。
        assert_eq!(format_amount(r(25, 2), 2).as_deref(), Ok("12.50"));
        assert_eq!(format_amount(r(0, 1), 2).as_deref(), Ok("0.00"));
        assert_eq!(format_amount(r(1, 1), 2).as_deref(), Ok("1.00"));
    }

    #[test]
    fn zero_decimals_have_no_point() {
        assert_eq!(format_amount(r(15523, 1), 0).as_deref(), Ok("15,523"));
        assert_eq!(format_amount(r(0, 1), 0).as_deref(), Ok("0"));
    }

    #[test]
    fn commas_go_in_the_integer_part_only() {
        assert_eq!(
            format_amount(r(1_234_567, 1), 0).as_deref(),
            Ok("1,234,567")
        );
        assert_eq!(
            format_amount(r(123_456_789, 100), 2).as_deref(),
            Ok("1,234,567.89")
        );
        assert_eq!(
            format_amount(r(-123_456_789, 100), 2).as_deref(),
            Ok("-1,234,567.89")
        );
    }

    #[test]
    fn rounding_is_half_to_even() {
        // 12.345 → 12.34(手前が 4 = 偶 → 据え置き)、12.355 → 12.36(5 = 奇 → 上げ)
        assert_eq!(format_amount(r(12345, 1000), 2).as_deref(), Ok("12.34"));
        assert_eq!(format_amount(r(12355, 1000), 2).as_deref(), Ok("12.36"));
        // 0 桁でも同じ。168.5 → 168、169.5 → 170
        assert_eq!(format_amount(r(1685, 10), 0).as_deref(), Ok("168"));
        assert_eq!(format_amount(r(1695, 10), 0).as_deref(), Ok("170"));
        // 半分より上/下は素直に動く(tie だけが偶数側を見る)。
        assert_eq!(format_amount(r(12346, 1000), 2).as_deref(), Ok("12.35"));
        assert_eq!(format_amount(r(12344, 1000), 2).as_deref(), Ok("12.34"));
    }

    #[test]
    fn a_carry_can_add_a_digit() {
        // 9.999 → 10.00。繰り上がりが整数部の桁を増やす。
        assert_eq!(format_amount(r(9999, 1000), 2).as_deref(), Ok("10.00"));
        // 999.5 → 1,000(繰り上がりでカンマが 1 つ増える)。
        assert_eq!(format_amount(r(9995, 10), 0).as_deref(), Ok("1,000"));
    }

    #[test]
    fn a_rounded_zero_has_no_sign() {
        // **`-0.00` は「0 でないが 0 に見える」の意味に読める**(裁定 4-4)。
        assert_eq!(format_amount(r(-1, 1000), 2).as_deref(), Ok("0.00"));
        assert_eq!(format_amount(r(-4, 10), 0).as_deref(), Ok("0"));
        // **0 に丸まらないほうは符号が残る**(符号を落とすのは 0 のときだけ)。
        assert_eq!(format_amount(r(-6, 1000), 2).as_deref(), Ok("-0.01"));
    }

    #[test]
    fn the_literal_rule_is_the_same_for_values_and_rates() {
        // 受ける形。
        assert_eq!(parse_decimal("100"), Ok(r(100, 1)));
        assert_eq!(parse_decimal("1.0855"), Ok(r(10855, 10000)));
        assert_eq!(parse_decimal("-0.001"), Ok(r(-1, 1000)));
        assert_eq!(parse_decimal("0"), Ok(r(0, 1)));
        // 受けない形。**式も指数も全角も受けない。**
        for bad in [
            "1e3",
            "１２３",
            "abc",
            "",
            "-",
            "1.",
            ".5",
            "+1",
            "1 2",
            "1.2.3",
            "1+2",
        ] {
            assert_eq!(parse_decimal(bad), Err(CalcError::SyntaxError), "{bad}");
        }
    }

    #[test]
    fn the_entry_point_takes_strings_and_never_sees_an_f64() {
        // 100 USD → JPY = 15,523(spec §8 の名指しケース)。
        assert_eq!(
            convert_currency("100", Currency::Jpy, "1.0855", "168.5").as_deref(),
            Ok("15,523")
        );
        // 不正なリテラルは `SyntaxError`(レート側も同じ規則)。
        assert_eq!(
            convert_currency("100", Currency::Jpy, "1.0855", "abc"),
            Err(CalcError::SyntaxError)
        );
        assert_eq!(
            convert_currency("100", Currency::Jpy, "0", "168.5"),
            Err(CalcError::DivisionByZero)
        );
    }

    #[test]
    fn the_tie_that_tells_f64_from_an_exact_rational() {
        // **spec §8 の赤確認 4 と同一のケースである**(golden にも同じ 1 件がある:
        // `currency/42.66gbptousd@0.8532-1.0855`)。
        //
        // **素朴な値では空振りする**——出力は 0〜2 桁に丸めるので、`f64` の誤差は
        // ほとんど常に吸収される。**実測: 既存 32 件は、レートを `f64` で持つ変異を
        // 当てても 1 件も表示が変わらなかった。** 判別力を持つ組は探索で見つけた。
        //
        // 42.66 GBP → USD、from_rate 0.8532 / to_rate 1.0855。
        //
        // 1. **厳密値**: 42.66 × 1.0855 ÷ 0.8532 = 2171/40 = **54.275**(ちょうど tie)
        //    → half-even は手前の桁 5427 が**奇数**なので切り上げ、**"54.28"**
        // 2. **`f64` でレートを持つと**(`0.8532` → 0.85319999999999995843…、
        //    `1.0855` → 1.08549999999999990940…):
        //    1158611802736029501/21347062233736150
        //    = 54.27499999999999811449465227162223927781…
        //    (`{:.20}` で 54.27499999999999857891)
        //    → 境の**下側**に落ちる
        // 3. **丸めた結果が違う**: 厳密は "54.28"、`f64` 経由は **"54.27"**
        //
        // **from も to も 2 進で厳密でないレート**を選んである——掛ける側と割る側の
        // 両方に誤差が入る(`1` や `168.5` は 2 進で厳密なので、片側しか動かない)。
        assert_eq!(
            convert_currency("42.66", Currency::Usd, "0.8532", "1.0855").as_deref(),
            Ok("54.28")
        );
        // 厳密値がちょうど tie に乗っていること自体を、丸める前に見ておく。
        assert_eq!(
            exchange(r(4266, 100), r(8532, 10000), r(10855, 10000)),
            Ok(r(2171, 40))
        );
    }
}
