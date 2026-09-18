use crate::Value;

/// 極形式。角度は常にラジアンで保持する。
///
/// 度への変換は表示層でのみ行う。内部表現の単位を 1 つに固定することで、
/// 角度モードの切り替えが保持している値に影響しない（設計書 D5）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Polar {
    pub r: f64,
    /// -PI 以上 PI 以下。atan2 の値域。
    pub theta_rad: f64,
}

impl Value {
    /// 直交形式から極形式へ。
    ///
    /// atan2 を使うので四象限が正しく区別される（base-spec §33）。
    pub fn to_polar(self) -> Polar {
        Polar {
            r: self.re.hypot(self.im),
            theta_rad: self.im.atan2(self.re),
        }
    }
}

/// 極形式から直交形式へ。
pub fn from_polar(p: Polar) -> Value {
    Value::new(p.r * p.theta_rad.cos(), p.r * p.theta_rad.sin())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_close as close;
    use std::f64::consts::PI;

    #[test]
    fn converts_the_headline_case() {
        // 3 + 4j -> 5 ∠ 53.13010235...°
        let p = Value::new(3.0, 4.0).to_polar();
        close(p.r, 5.0);
        close(p.theta_rad.to_degrees(), 53.13010235415598);
    }

    #[test]
    fn covers_all_four_quadrants() {
        close(Value::new(1.0, 1.0).to_polar().theta_rad.to_degrees(), 45.0);
        close(
            Value::new(-1.0, 1.0).to_polar().theta_rad.to_degrees(),
            135.0,
        );
        close(
            Value::new(-1.0, -1.0).to_polar().theta_rad.to_degrees(),
            -135.0,
        );
        close(
            Value::new(1.0, -1.0).to_polar().theta_rad.to_degrees(),
            -45.0,
        );
    }

    #[test]
    fn covers_the_axes() {
        close(Value::new(1.0, 0.0).to_polar().theta_rad, 0.0);
        close(Value::new(0.0, 1.0).to_polar().theta_rad, PI / 2.0);
        close(Value::new(-1.0, 0.0).to_polar().theta_rad, PI);
        close(Value::new(0.0, -1.0).to_polar().theta_rad, -PI / 2.0);
    }

    #[test]
    fn zero_has_zero_magnitude() {
        let p = Value::ZERO.to_polar();
        close(p.r, 0.0);
        // atan2(0, 0) は 0 を返す。NaN にならないことを固定しておく。
        close(p.theta_rad, 0.0);
    }

    #[test]
    fn magnitude_survives_inputs_that_would_overflow_naive_squaring() {
        // (re² + im²).sqrt() ならここで中間の二乗が inf になり r も inf になる。
        // **hypot は「中間の二乗では」溢れない**——それが hypot を選んだ理由である。
        //
        // **★ 範囲を書く**（0.9.4、F7 の直しと同じ語彙で揃えた）。
        // **「hypot は溢れない」は偽である**——**真の大きさが f64 に収まる限り
        // 溢れない**、が正しい。**真に範囲外なら hypot も inf を返す**:
        //
        //   hypot(MAX, MAX)         = inf        ← 真の答え √2·MAX は範囲外
        //   hypot(MAX/√2, MAX/√2)   = 1.797…e308 ← 収まるので溢れない
        //   hypot(3e200, 4e200)     = 5e200      ← この行が使う値
        //
        // （実測 2026-09-18、calcarc-88。**私も同じ 4 つを手元で確かめた**
        // ——素朴な `sqrt(MAX²+MAX²)` は inf、hypot(MAX,MAX) も inf。）
        //
        // **この区別が要る理由**: 「hypot は溢れない」を信じた人は、
        // **`try_format_polar` の `!p.r.is_finite()` の門を不要と判断しうる**
        // （`numeric/format.rs:203` がその門で、**`engine/display.rs:37` が
        // その `None` を読んで極形式を出さないと決めている**。
        // **同じファイルの `:344` に「hypot(MAX,MAX) なら None」の行も在る**
        // ——**門が要ることは、既に検査で固定されている**）。
        // **外すと、画面に `inf ∠ 45` が出る。**
        // **偽の溢れ（有限の答えを殺す）と、真の溢れ（範囲外を断る）は別物**で、
        // **hypot が塞ぐのは前者だけ**である。
        let p = Value::new(3e200, 4e200).to_polar();
        assert!(p.r.is_finite(), "magnitude overflowed: {}", p.r);
        // 5e200 との比で見る。絶対誤差はこの桁では意味を持たない。
        close(p.r / 5e200, 1.0);
        close(p.theta_rad.to_degrees(), 53.13010235415598);
    }

    #[test]
    fn converts_back() {
        let v = from_polar(Polar {
            r: 5.0,
            theta_rad: 53.13010235415598_f64.to_radians(),
        });
        close(v.re, 3.0);
        close(v.im, 4.0);
    }
}
