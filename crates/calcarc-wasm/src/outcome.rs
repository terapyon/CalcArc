//! 境界を渡る結果の形。**tag の形を知っているのはこのファイルだけ**である。
//!
//! `CalcResult<T>` を潰さずにそのまま渡す。潰すと、payload と error が
//! 同時に在る／同時に無い状態を型が許してしまう(設計書 §0)——10 個の結果型が
//! 「ありうる」と言っていた状態は 256 通りで、実際に起きるのは 2 通りだった。

use calcarc_core::{CalcError, CalcResult};
use serde::Serialize;

/// 境界を渡る 2 択。**内側 tag**——payload のフィールドは平らに並ぶ。
///
/// ```text
/// {"kind":"ok","monthlyPayment":"85000","bonusRows":40}
/// {"kind":"error","code":"Overflow"}
/// ```
///
/// **`rename_all` はここでは tag の値しか決めない**(`Ok` → `"ok"`)。
/// **payload のフィールド名は payload 構造体自身が決める**(設計書 §4)
/// ——`camelCase` を構造体側に書き忘れると `monthly_payment` のまま出る。
/// `tests/boundary_shape.rs` がそれを見張る。
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Outcome<T> {
    Ok(T),
    Error { code: CalcError },
}

impl<T> From<CalcResult<T>> for Outcome<T> {
    fn from(r: CalcResult<T>) -> Self {
        match r {
            Ok(v) => Outcome::Ok(v),
            Err(code) => Outcome::Error { code },
        }
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use super::*;
    use calcarc_core::CalcError;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Probe {
        monthly_payment: String,
        bonus_rows: u32,
    }

    #[wasm_bindgen_test]
    fn the_outcome_carries_its_kind_inside() {
        let ok: Outcome<Probe> = Ok(Probe {
            monthly_payment: "85000".into(),
            bonus_rows: 40,
        })
        .into();
        let json = js_sys::JSON::stringify(&crate::to_js_value(&ok)).unwrap();
        assert_eq!(
            String::from(json),
            r#"{"kind":"ok","monthlyPayment":"85000","bonusRows":40}"#
        );

        let err: Outcome<Probe> = Err(CalcError::Overflow).into();
        let json = js_sys::JSON::stringify(&crate::to_js_value(&err)).unwrap();
        assert_eq!(String::from(json), r#"{"kind":"error","code":"Overflow"}"#);
    }
}
