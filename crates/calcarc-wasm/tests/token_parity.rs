//! KEY_TOKENS（TypeScript）と Key::ALL（Rust）の一致検査。
//!
//! 同じ 30 トークンが 2 言語で二重管理されている。未知トークンは
//! WASM 境界で黙って no-op になる設計なので、ずれてもどのテストも
//! 落ちずにキーが 1 つ死ぬ。ここで機械的に突き合わせる。
//!
//! wasm でも E2E でもなくホストの cargo test なのは意図的である。
//! include_str! は TS 側のファイル移動をコンパイルエラーに変える。

use calcarc_core::Key;

/// types.ts から KEY_TOKENS の文字列要素を抜き出す。
///
/// TS のパースではなく「`KEY_TOKENS = [` と次の `]` のあいだの
/// 引用符内」という構造依存の抽出。ファイルの形が変わったら
/// このテスト自体が落ちて知らせる。
fn tokens_in_types_ts() -> Vec<String> {
    let src = include_str!("../../../web/src/calc/types.ts");
    let after = src
        .split("KEY_TOKENS = [")
        .nth(1)
        .expect("types.ts に KEY_TOKENS の配列リテラルが見つからない");
    let body = after
        .split(']')
        .next()
        .expect("KEY_TOKENS の配列が閉じていない");
    body.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

#[test]
fn key_tokens_match_between_typescript_and_rust() {
    let ts = tokens_in_types_ts();
    let rust: Vec<String> = Key::ALL.iter().map(|k| k.token().to_owned()).collect();
    assert_eq!(
        ts, rust,
        "web/src/calc/types.ts の KEY_TOKENS と Key::ALL の token() が食い違っている"
    );
}
