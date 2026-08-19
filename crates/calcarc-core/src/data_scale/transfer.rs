//! Data Transfer(S-0 設計書 §3.5)。帯域幅 × 時間 → バイト数。
//!
//! **帯域幅は 10 進である**——`kbps` の `k` は 1024 ではない。出典は SI
//! 接頭辞(k = 10³、M = 10⁶、G = 10⁹)と、時間の 60 / 3600 / 86400 秒。
//! **入力は bit、表示は byte** で、ここが混同されやすい。
//!
//! **切り上げはここで実際に発火する**(1 bit は 1 byte に満たない)。
//! LLM 側の KV cache と違い、bit 数が 8 の倍数になる保証は無い。

use crate::{CalcError, CalcResult};

/// 帯域幅の単位。係数は 1 秒あたりのビット数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BandwidthUnit {
    Bps,
    Kbps,
    Mbps,
    Gbps,
}

impl BandwidthUnit {
    pub const ALL: [BandwidthUnit; 4] = [
        BandwidthUnit::Bps,
        BandwidthUnit::Kbps,
        BandwidthUnit::Mbps,
        BandwidthUnit::Gbps,
    ];

    pub fn from_token(token: &str) -> Option<BandwidthUnit> {
        Some(match token {
            "bps" => BandwidthUnit::Bps,
            "kbps" => BandwidthUnit::Kbps,
            "mbps" => BandwidthUnit::Mbps,
            "gbps" => BandwidthUnit::Gbps,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
            BandwidthUnit::Bps => "bps",
            BandwidthUnit::Kbps => "kbps",
            BandwidthUnit::Mbps => "mbps",
            BandwidthUnit::Gbps => "gbps",
        }
    }

    /// 1 秒あたりのビット数。**10 進である**(1024 ではない)。
    pub fn bits_per_second(self) -> u128 {
        match self {
            BandwidthUnit::Bps => 1,
            BandwidthUnit::Kbps => 1_000,
            BandwidthUnit::Mbps => 1_000_000,
            BandwidthUnit::Gbps => 1_000_000_000,
        }
    }
}

/// 時間の単位。係数は秒。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DurationUnit {
    Second,
    Minute,
    Hour,
    Day,
}

impl DurationUnit {
    pub const ALL: [DurationUnit; 4] = [
        DurationUnit::Second,
        DurationUnit::Minute,
        DurationUnit::Hour,
        DurationUnit::Day,
    ];

    pub fn from_token(token: &str) -> Option<DurationUnit> {
        Some(match token {
            "second" => DurationUnit::Second,
            "minute" => DurationUnit::Minute,
            "hour" => DurationUnit::Hour,
            "day" => DurationUnit::Day,
            _ => return None,
        })
    }

    pub fn token(self) -> &'static str {
        match self {
            DurationUnit::Second => "second",
            DurationUnit::Minute => "minute",
            DurationUnit::Hour => "hour",
            DurationUnit::Day => "day",
        }
    }

    pub fn seconds(self) -> u128 {
        match self {
            DurationUnit::Second => 1,
            DurationUnit::Minute => 60,
            DurationUnit::Hour => 3_600,
            DurationUnit::Day => 86_400,
        }
    }
}

/// 転送量をバイトで返す。あふれたら Overflow(§3.6)。
pub fn transferred_bytes(
    bandwidth: u128,
    unit: BandwidthUnit,
    duration: u128,
    per: DurationUnit,
) -> CalcResult<u128> {
    // 左から順に checked_mul する(§3.6)。
    let mut bits = bandwidth;
    for factor in [unit.bits_per_second(), duration, per.seconds()] {
        bits = bits.checked_mul(factor).ok_or(CalcError::Overflow)?;
    }
    Ok(bits.div_ceil(8))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_headline_case() {
        // 100 Mbps × 3 時間 = 135,000,000,000 bytes(§3.5)
        assert_eq!(
            transferred_bytes(100, BandwidthUnit::Mbps, 3, DurationUnit::Hour),
            Ok(135_000_000_000)
        );
    }

    #[test]
    fn kilo_is_a_thousand_not_1024() {
        assert_eq!(BandwidthUnit::Kbps.bits_per_second(), 1_000);
        assert_eq!(
            transferred_bytes(512, BandwidthUnit::Kbps, 30, DurationUnit::Minute),
            Ok(115_200_000)
        );
    }

    #[test]
    fn a_partial_byte_rounds_up() {
        assert_eq!(
            transferred_bytes(1, BandwidthUnit::Bps, 1, DurationUnit::Second),
            Ok(1)
        );
        assert_eq!(
            transferred_bytes(8, BandwidthUnit::Bps, 1, DurationUnit::Second),
            Ok(1)
        );
        assert_eq!(
            transferred_bytes(9, BandwidthUnit::Bps, 1, DurationUnit::Second),
            Ok(2)
        );
    }

    #[test]
    fn every_unit_has_its_factor() {
        let bandwidth: [(BandwidthUnit, u128); 4] = [
            (BandwidthUnit::Bps, 1),
            (BandwidthUnit::Kbps, 1_000),
            (BandwidthUnit::Mbps, 1_000_000),
            (BandwidthUnit::Gbps, 1_000_000_000),
        ];
        for (u, factor) in bandwidth {
            assert_eq!(u.bits_per_second(), factor, "{u:?}");
        }
        let duration: [(DurationUnit, u128); 4] = [
            (DurationUnit::Second, 1),
            (DurationUnit::Minute, 60),
            (DurationUnit::Hour, 3_600),
            (DurationUnit::Day, 86_400),
        ];
        for (u, seconds) in duration {
            assert_eq!(u.seconds(), seconds, "{u:?}");
        }
    }

    #[test]
    fn tokens_round_trip() {
        for u in BandwidthUnit::ALL {
            assert_eq!(BandwidthUnit::from_token(u.token()), Some(u), "{u:?}");
        }
        for u in DurationUnit::ALL {
            assert_eq!(DurationUnit::from_token(u.token()), Some(u), "{u:?}");
        }
        assert_eq!(BandwidthUnit::from_token("tbps"), None);
        assert_eq!(DurationUnit::from_token("week"), None);
    }

    #[test]
    fn overflow_is_an_error_not_a_wrap() {
        assert_eq!(
            transferred_bytes(1u128 << 127, BandwidthUnit::Gbps, 1, DurationUnit::Second),
            Err(CalcError::Overflow)
        );
    }

    #[test]
    fn zero_is_a_valid_input() {
        assert_eq!(
            transferred_bytes(0, BandwidthUnit::Gbps, 1, DurationUnit::Hour),
            Ok(0)
        );
    }

    #[test]
    fn a_zero_after_an_overflow_does_not_rescue_it() {
        // **積は左から順に検査する**(spec §3.6)。2^127 × 10^9 は 2 手目で
        // あふれるので、そのあとに時間 0 が来ても 0 バイトにはならない。
        // **まとめて 1 回だけ検査する実装ならここが緑になる**——順序が
        // 契約であることは、この 1 件でしか見えない。
        assert_eq!(
            transferred_bytes(1u128 << 127, BandwidthUnit::Gbps, 0, DurationUnit::Second),
            Err(CalcError::Overflow)
        );
    }
}
