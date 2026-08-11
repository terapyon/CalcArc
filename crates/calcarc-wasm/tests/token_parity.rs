//! トークン配列（TypeScript）と対応する Rust 側の一致検査。
//!
//! 同じトークン列が 2 言語で二重管理されている。未知トークンは WASM 境界で
//! 黙って無視される設計（Key は no-op、DataType は SyntaxError）なので、
//! ずれてもどのテストも落ちずに 1 トークンだけ死ぬ。ここで機械的に
//! 突き合わせる。
//!
//! wasm でも E2E でもなくホストの cargo test なのは意図的である。
//! include_str! は TS 側のファイル移動をコンパイルエラーに変える。

use calcarc_core::Key;
use calcarc_core::data_scale::DataType;

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
