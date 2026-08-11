use serde::{Deserialize, Serialize};

/// 三角関数の引数と極形式の角度表示に適用する単位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AngleMode {
    Deg,
    Rad,
}

impl AngleMode {
    /// このモードでの数値をラジアンに直す。
    pub fn radians_of(self, v: f64) -> f64 {
        match self {
            AngleMode::Deg => v.to_radians(),
            AngleMode::Rad => v,
        }
    }

    /// ラジアンをこのモードでの数値に直す。
    pub fn angle_of(self, rad: f64) -> f64 {
        match self {
            AngleMode::Deg => rad.to_degrees(),
            AngleMode::Rad => rad,
        }
    }

    pub fn toggled(self) -> AngleMode {
        match self {
            AngleMode::Deg => AngleMode::Rad,
            AngleMode::Rad => AngleMode::Deg,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn deg_converts_to_radians() {
        crate::assert_close(AngleMode::Deg.radians_of(180.0), PI);
    }

    #[test]
    fn rad_passes_through() {
        assert_eq!(AngleMode::Rad.radians_of(1.5), 1.5);
        assert_eq!(AngleMode::Rad.angle_of(1.5), 1.5);
    }

    #[test]
    fn deg_converts_from_radians() {
        crate::assert_close(AngleMode::Deg.angle_of(PI), 180.0);
    }

    #[test]
    fn toggles_between_modes() {
        assert_eq!(AngleMode::Deg.toggled(), AngleMode::Rad);
        assert_eq!(AngleMode::Rad.toggled(), AngleMode::Deg);
    }
}
