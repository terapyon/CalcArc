use calcarc_core::complex::polar::{from_polar, to_polar};
use calcarc_core::{ROUNDTRIP_EPSILON, Value};
use proptest::prelude::*;

proptest! {
    /// rect -> polar -> rect の往復で元の値に戻ることを確認する
    /// （base-spec §34）。
    #[test]
    fn rect_polar_roundtrip(re in -1e6f64..1e6, im in -1e6f64..1e6) {
        let v = Value::new(re, im);
        let back = from_polar(to_polar(v));
        let scale = v.re.abs().max(v.im.abs()).max(1.0);
        prop_assert!((back.re - v.re).abs() <= ROUNDTRIP_EPSILON * scale);
        prop_assert!((back.im - v.im).abs() <= ROUNDTRIP_EPSILON * scale);
    }

    /// 半径は常に非負。
    #[test]
    fn magnitude_is_non_negative(re in -1e6f64..1e6, im in -1e6f64..1e6) {
        prop_assert!(to_polar(Value::new(re, im)).r >= 0.0);
    }
}
