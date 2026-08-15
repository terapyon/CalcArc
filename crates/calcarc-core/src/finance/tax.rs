//! 源泉分離課税 20.315%。
//!
//! **国税 15.315% と地方税 5% を別々に円未満切り捨てる**(国税庁
//! タックスアンサー No.1310)。合算 20.315% を 1 回切り捨てるのとは結果が
//! 違う——利息 2,648,906 円で 1 円ずれる。どちらも整数演算で表せるので、
//! 複利の厳密整数経路を降りずに済む。

use crate::{CalcError, CalcResult};

const NATIONAL_NUM: u128 = 15_315; // 15.315%
const NATIONAL_DEN: u128 = 100_000;
const LOCAL_NUM: u128 = 5; // 5%
const LOCAL_DEN: u128 = 100;

/// (国税, 地方税)。課税対象は利息で、元本は含まない。
pub fn withholding(interest: u64) -> CalcResult<(u64, u64)> {
    let national = interest as u128 * NATIONAL_NUM / NATIONAL_DEN;
    let local = interest as u128 * LOCAL_NUM / LOCAL_DEN;
    let national = u64::try_from(national).map_err(|_| CalcError::Overflow)?;
    let local = u64::try_from(local).map_err(|_| CalcError::Overflow)?;
    Ok((national, local))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_taxes_are_floored_separately() {
        // 合算 20.315% を 1 回切り捨てると 1 円ずれる(設計書 §6)。
        assert_eq!(withholding(2_648_906).unwrap(), (405_679, 132_445));
        assert_eq!(405_679 + 132_445, 538_124);
        assert_eq!(2_648_906u128 * 20_315 / 100_000, 538_125);
    }

    #[test]
    fn small_interest_falls_to_zero_on_the_local_side() {
        // 利息 10 円: 国税 1(1.5315 の切り捨て)、地方税 0(0.5 の切り捨て)。
        // 合算なら 2(2.0315)。小さい側でも別切り捨ての差が出る。
        assert_eq!(withholding(10).unwrap(), (1, 0));
        assert_eq!(withholding(0).unwrap(), (0, 0));
    }

    #[test]
    fn the_largest_interest_does_not_overflow() {
        // u64::MAX × 15315 は u128 に収まり、商は u64 に戻る。
        let (national, local) = withholding(u64::MAX).unwrap();
        assert!(national < u64::MAX && local < u64::MAX);
    }
}
