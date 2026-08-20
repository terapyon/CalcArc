//! トークン配列（TypeScript）と対応する Rust 側の一致検査。
//!
//! 同じトークン列が 2 言語で二重管理されている。未知トークンは WASM 境界で
//! 黙って無視される設計（Key は no-op、DataType は SyntaxError）なので、
//! ずれてもどのテストも落ちずに 1 トークンだけ死ぬ。ここで機械的に
//! 突き合わせる。
//!
//! wasm でも E2E でもなくホストの cargo test なのは意図的である。
//! include_str! は TS 側のファイル移動をコンパイルエラーに変える。

use calcarc_core::AngleMode;
use calcarc_core::Key;
use calcarc_core::convert::{Category, Unit};
use calcarc_core::data_scale::DataType;
use calcarc_core::data_scale::llm::Precision;
use calcarc_core::data_scale::transfer::{BandwidthUnit, DurationUnit};
use calcarc_core::engine::state::{DisplayForm, Notation};

/// `marker` で始まる配列リテラルの文字列要素を、ファイル `src` から抜き出す。
///
/// TS のパースではなく「`marker` と次の `]` のあいだの引用符内」という
/// 構造依存の抽出。ファイルの形が変わったらこのテスト自体が落ちて知らせる。
/// マーカーは接頭辞付きの別配列（例: `_TOKENS` に対する `ALL_TOKENS`）を
/// 誤って掴まないよう、宣言の先頭からの完全一致にする（前ブランチの教訓）。
fn tokens_in_ts_array(src: &str, marker: &str) -> Vec<String> {
    let after = src
        .split(marker)
        .nth(1)
        .unwrap_or_else(|| panic!("{marker} の配列リテラルが見つからない"));
    let body = after
        .split(']')
        .next()
        .unwrap_or_else(|| panic!("{marker} の配列が閉じていない"));
    body.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

#[test]
fn key_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const KEY_TOKENS = [");
    let rust: Vec<String> = Key::ALL.iter().map(|k| k.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/calc/types.ts の KEY_TOKENS と Key::ALL の token() が食い違っている"
    );
}

#[test]
fn data_scale_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/datascale/types.ts");
    let ts = tokens_in_ts_array(src, "export const DATA_TYPE_TOKENS = [");
    let rust: Vec<String> = DataType::ALL.iter().map(|t| t.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/datascale/types.ts の DATA_TYPE_TOKENS と DataType::ALL の token() が食い違っている"
    );
}

#[test]
fn precision_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/datascale/types.ts");
    let ts = tokens_in_ts_array(src, "export const PRECISION_TOKENS = [");
    let rust: Vec<String> = Precision::ALL
        .iter()
        .map(|p| p.token().to_owned())
        .collect();
    assert_eq!(
        ts, rust,
        "web/src/datascale/types.ts の PRECISION_TOKENS と Precision::ALL の token() が食い違っている"
    );
}

#[test]
fn bandwidth_unit_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/datascale/types.ts");
    let ts = tokens_in_ts_array(src, "export const BANDWIDTH_UNIT_TOKENS = [");
    let rust: Vec<String> = BandwidthUnit::ALL
        .iter()
        .map(|u| u.token().to_owned())
        .collect();
    assert_eq!(
        ts, rust,
        "web/src/datascale/types.ts の BANDWIDTH_UNIT_TOKENS と BandwidthUnit::ALL の token() が食い違っている"
    );
}

#[test]
fn duration_unit_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/datascale/types.ts");
    let ts = tokens_in_ts_array(src, "export const DURATION_UNIT_TOKENS = [");
    let rust: Vec<String> = DurationUnit::ALL
        .iter()
        .map(|u| u.token().to_owned())
        .collect();
    assert_eq!(
        ts, rust,
        "web/src/datascale/types.ts の DURATION_UNIT_TOKENS と DurationUnit::ALL の token() が食い違っている"
    );
}

#[test]
fn convert_unit_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/convert/types.ts");
    let ts = tokens_in_ts_array(src, "export const CONVERT_UNIT_TOKENS = [");
    let rust: Vec<String> = Unit::ALL.iter().map(|u| u.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/convert/types.ts の CONVERT_UNIT_TOKENS と Unit::ALL の token() が食い違っている"
    );
}

#[test]
fn convert_category_tokens_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/convert/types.ts");
    let ts = tokens_in_ts_array(src, "export const CONVERT_CATEGORY_TOKENS = [");
    let rust: Vec<String> = Category::ALL.iter().map(|c| c.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/convert/types.ts の CONVERT_CATEGORY_TOKENS と Category::ALL の token() が食い違っている"
    );
}

/// serde が書く綴りを取り出す。
///
/// **手で書かない。** 保存される文字列は DisplayState 経由で TS へ渡った
/// serde の出力そのものなので(P-1 設計書 §8)、ここで serde に書かせると
/// 「実際に渡る綴り」と「白リストが受け付ける綴り」を直接突き合わせる
/// ことになる。手で並べると、その 2 つが一致している保証が消える。
fn serde_names<T: serde::Serialize>(values: &[T]) -> Vec<String> {
    values
        .iter()
        .map(|v| match serde_json::to_value(v) {
            Ok(serde_json::Value::String(s)) => s,
            other => panic!("unit variant は文字列になるはず: {other:?}"),
        })
        .collect()
}

#[test]
fn angle_modes_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const ANGLE_MODES = [");
    assert_eq!(
        ts,
        serde_names(&AngleMode::ALL),
        "web/src/calc/types.ts の ANGLE_MODES と AngleMode::ALL が食い違っている"
    );
}

#[test]
fn display_forms_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const DISPLAY_FORMS = [");
    assert_eq!(
        ts,
        serde_names(&DisplayForm::ALL),
        "web/src/calc/types.ts の DISPLAY_FORMS と DisplayForm::ALL が食い違っている"
    );
}

#[test]
fn notations_match_between_typescript_and_rust() {
    let src = include_str!("../../../web/src/calc/types.ts");
    let ts = tokens_in_ts_array(src, "export const NOTATIONS = [");
    assert_eq!(
        ts,
        serde_names(&Notation::ALL),
        "web/src/calc/types.ts の NOTATIONS と Notation::ALL が食い違っている"
    );
}
