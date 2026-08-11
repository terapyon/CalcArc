# Contributing

## 原則

このプロジェクトは UI の多機能化よりも次を優先する。

1. 計算仕様が明確であること
2. 数値表現と丸め規則が明確であること
3. 計算コアが UI から独立していること
4. Python による独立検証が可能であること

## 守ってほしいこと

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に
  計算を書かない。
- **`calcarc-core` で panic しない。** `unwrap()` と `expect()` を書かない。
  エラーは `CalcError` を返す。
- **`web/src/calc/` に React を import しない。** ここは UI Framework から
  独立している必要がある。
- **許容誤差をテストコードに書かない。** `testdata/*.json` の `tolerance`
  から読む。
- **参照実装を Rust の移植にしない。** 同じアルゴリズムを両方に書くと、
  同じバグが両方に入って検証の意味がなくなる。別のライブラリや別の手法を使う。

## 電卓の挙動を変えるとき

`crates/calcarc-core/tests/engine_table.rs` が挙動の仕様書である。
キー列と期待される表示の対応を先に変えてから実装を直すこと。

## 数値を変えるとき

`reference/scripts/generate.py` を実行して `testdata/` を再生成し、
差分を確認してからコミットする。CI が再生成の差分を検査する。
