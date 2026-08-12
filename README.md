# CalcArc

ブラウザで動く計算ツール群。計算は端末内で完結し、サーバへ送信しない。

計算コアは Rust で実装し、WebAssembly としてブラウザから呼び出す。計算結果の
正しさは Rust のテストだけに頼らず、Python による独立した参照実装と突き合わせて
検証する。

## 現状

3 つのモジュールが動く。ナビのタブで切り替える。

- **Scientific Calculator** — 複素数と極座標変換。
- **Data Scale Calculator** — 要素数 × 次元 × データ型のメモリ量。
- **Loan Calculator** — 元利均等の月額（残価つきも可）、借入可能額と返済期間の
  逆算、ボーナス併用。実額の機関一致は目標にせず、**決定的な概算**を返す
  （画面に免責を常設している）。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `crates/calcarc-core` | 計算コア。WASM と UI に依存しない |
| `crates/calcarc-wasm` | WASM adapter。計算ロジックを持たない |
| `web` | React + Vite の UI |
| `reference` | Python による参照実装。期待値を生成する |
| `testdata` | 参照実装が生成した期待値 |
| `docs` | 仕様と数値方針 |

## Numerical Policy

数値の扱いは [docs/numerical-policy.md](docs/numerical-policy.md) に定める。
要点は次のとおり。

- モジュールごとに数値の扱いが違う。Scientific は浮動小数点、Data Scale は
  厳密整数、Loan は決定的概算（月額の決定だけが f64 で、償還表は厳密整数）。
- すべての値を複素数として保持する。実数は虚部 0 の複素数である。
- 表示は有効数字 10 桁、丸めは round-half-to-even。
- 表示のための丸めは保持している値に書き戻さない。極形式への切り替えは
  表示の変更であって計算ではないため、丸めた値が次の計算に入り込まない。
- 計算コアは panic しない。すべてのエラーは `Result` を通り、UI には
  戻り値として届く。

## 開発

必要なもの: Rust (stable)、wasm-pack、Node.js + pnpm、uv。

```bash
# 計算コアのテスト
cargo test --workspace

# WASM 境界のテスト
wasm-pack test --headless --chrome crates/calcarc-wasm

# Web
cd web && pnpm install && pnpm dev

# 参照実装と期待値の再生成
cd reference && uv sync && uv run pytest
cd reference && uv run python scripts/generate.py
```

`crates/calcarc-core` の数値を変更したときは期待値の再生成が必要になる。
再生成せずに `testdata/` を手で書き換えないこと。

## ライセンス

Apache License 2.0。[LICENSE](LICENSE) を参照。
