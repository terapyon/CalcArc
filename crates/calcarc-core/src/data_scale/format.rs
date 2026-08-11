//! バイト数の表示。厳密整数と表示丸めの分離(設計書 §3、base-spec §26 の整数版)。
//!
//! 換算経路に f64 を使わない。商と剰余の u128 演算だけで小数第 1 位を
//! round-half-to-even に丸める。丸めで表示値が基数(1000 / 1024)に達したら
//! 単位を選び直す——判断は丸めた後の値で行う。`format_real` の指数表記切替と
//! 同じ設計思想である。

/// 10 進の単位。値が 1 以上になる最大の単位を選ぶ。
const DECIMAL_UNITS: [(&str, u128); 4] = [
    ("KB", 1_000),
    ("MB", 1_000_000),
    ("GB", 1_000_000_000),
    ("TB", 1_000_000_000_000),
];

/// 2 進の単位。
const BINARY_UNITS: [(&str, u128); 4] = [
    ("KiB", 1 << 10),
    ("MiB", 1 << 20),
    ("GiB", 1 << 30),
    ("TiB", 1 << 40),
];

/// 3 桁区切り。
pub fn group_digits(bytes: u128) -> String {
    let digits = bytes.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        // 残り桁数が 3 の倍数になる位置の直前に区切りを入れる。
        if i != 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

pub fn format_decimal(bytes: u128) -> Option<String> {
    scaled(bytes, &DECIMAL_UNITS, 1_000)
}

pub fn format_binary(bytes: u128) -> Option<String> {
    scaled(bytes, &BINARY_UNITS, 1_024)
}

/// 値が 1 以上になる最大の単位で `"307.2 GB"` の形にする。最小単位未満は None。
fn scaled(bytes: u128, units: &[(&str, u128); 4], base: u128) -> Option<String> {
    let mut index = units.iter().rposition(|(_, d)| bytes >= *d)?;
    loop {
        let (unit, divisor) = units[index];
        let (whole, tenth) = round_tenth(bytes, divisor);
        // 丸めで基数に達したら 1 つ上の単位で丸め直す。最上位に上は無い。
        if whole >= base && index + 1 < units.len() {
            index += 1;
            continue;
        }
        return Some(format!("{whole}.{tenth} {unit}"));
    }
}

/// bytes / divisor を小数第 1 位まで、round-half-to-even で。
///
/// 10 × r は r < divisor <= 2^40 なのであふれない(設計書 §3)。
fn round_tenth(bytes: u128, divisor: u128) -> (u128, u128) {
    let mut whole = bytes / divisor;
    let remainder = bytes % divisor;
    let numerator = remainder * 10;
    let mut tenth = numerator / divisor;
    let leftover = numerator % divisor;
    let round_up = match (leftover * 2).cmp(&divisor) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Equal => tenth % 2 == 1, // half は偶数側へ
        std::cmp::Ordering::Less => false,
    };
    if round_up {
        tenth += 1;
        if tenth == 10 {
            tenth = 0;
            whole += 1;
        }
    }
    (whole, tenth)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_digits_in_threes() {
        assert_eq!(group_digits(0), "0");
        assert_eq!(group_digits(999), "999");
        assert_eq!(group_digits(1000), "1,000");
        assert_eq!(group_digits(307_200_000_000), "307,200,000,000");
        assert_eq!(
            group_digits(u128::MAX),
            "340,282,366,920,938,463,463,374,607,431,768,211,455"
        );
    }

    #[test]
    fn the_headline_case_in_both_systems() {
        // 307.2 GB は厳密、286.1 GiB は 286.102294921875 の丸め(設計書 §0)。
        assert_eq!(format_decimal(307_200_000_000).as_deref(), Some("307.2 GB"));
        assert_eq!(format_binary(307_200_000_000).as_deref(), Some("286.1 GiB"));
    }

    #[test]
    fn below_the_smallest_unit_there_is_no_line() {
        assert_eq!(format_decimal(999), None);
        assert_eq!(format_binary(1023), None);
        // 非対称の境界: 1000..=1023 は 10 進だけが出る。
        assert_eq!(format_decimal(1000).as_deref(), Some("1.0 KB"));
        assert_eq!(format_binary(1000), None);
        assert_eq!(format_binary(1024).as_deref(), Some("1.0 KiB"));
    }

    #[test]
    fn trailing_zero_is_kept() {
        assert_eq!(format_decimal(5_000).as_deref(), Some("5.0 KB"));
    }

    #[test]
    fn rounds_half_to_even_in_both_bases() {
        // 10 進: 1.05 GB はちょうど half。偶数側 1.0 に落ちる。
        assert_eq!(format_decimal(1_050_000_000).as_deref(), Some("1.0 GB"));
        // 1.15 GB もちょうど half。偶数側 1.2 に上がる。
        assert_eq!(format_decimal(1_150_000_000).as_deref(), Some("1.2 GB"));
        // 2 進: 1280 bytes = 1.25 KiB → 1.2、1792 bytes = 1.75 KiB → 1.8。
        assert_eq!(format_binary(1_280).as_deref(), Some("1.2 KiB"));
        assert_eq!(format_binary(1_792).as_deref(), Some("1.8 KiB"));
    }

    #[test]
    fn a_carry_that_crosses_the_unit_boundary_reselects_the_unit() {
        // 単位選択時点では GB だが、丸めで 1000.0 に達する(設計書 §3)。
        // format_real の指数切替と同じく、判断は丸めた後の値で行う。
        assert_eq!(format_decimal(999_999_999_999).as_deref(), Some("1.0 TB"));
        // 2 進版: 1024^3 × 1023.95 以上、1024^4 未満。
        assert_eq!(format_binary(1_099_460_000_000).as_deref(), Some("1.0 TiB"));
    }

    #[test]
    fn the_top_unit_does_not_reselect() {
        // TB より上は無い。1000.0 TB は連続的な表示であって異常ではない。
        // 999.95 TB ちょうどが half → 奇数の 9 なので繰り上がり → 1000.0 TB。
        assert_eq!(
            format_decimal(999_950_000_000_000).as_deref(),
            Some("1000.0 TB")
        );
        // その先も TB のまま伸びる。
        assert_eq!(
            format_decimal(5_000_000_000_000_000).as_deref(),
            Some("5000.0 TB")
        );
    }

    #[test]
    fn the_section_25_example() {
        // 1e9 × 65536 × 8 bytes = 524,288,000,000,000(base-spec §25)。
        assert_eq!(
            format_decimal(524_288_000_000_000).as_deref(),
            Some("524.3 TB")
        );
        assert_eq!(
            format_binary(524_288_000_000_000).as_deref(),
            Some("476.8 TiB")
        );
    }
}
