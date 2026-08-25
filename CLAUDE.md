# CalcArc

ブラウザで動く計算ツール群。計算コアは Rust で書き、WebAssembly としてブラウザから呼ぶ。
計算結果は Rust のテストだけでなく、Python による独立実装（SymPy / mpmath）が生成した
期待値と突き合わせて検証する。

読む順:
[docs/base-spec.md](docs/base-spec.md)（全体仕様）→
[docs/numerical-policy.md](docs/numerical-policy.md)（数値の規則と既知の制約）→
[CONTRIBUTING.md](CONTRIBUTING.md)（守ってほしいこと）

## 構成

| | |
|---|---|
| `crates/calcarc-core` | 計算コア。WASM と UI に依存しない |
| `crates/calcarc-wasm` | WASM adapter。計算ロジックを持たない |
| `web/src/calc` | TypeScript のラッパー。UI Framework に依存しない |
| `web/src/ui` | React。CSS Modules とデザイントークン |
| `reference` | Python の独立実装。`testdata/*.json` を生成する |
| `testdata` | 生成された期待値。コミットされている |

## コマンド

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
wasm-pack test --headless --chrome crates/calcarc-wasm

cd web && pnpm test        # vitest
cd web && pnpm e2e         # Playwright（内部で wasm をビルドする）

cd reference && uv run pytest
cd reference && uv run python scripts/generate.py   # golden の再生成
```

`web` の型検査・lint・build は `web/src/wasm/` を必要とする。新しいクローンでは先に
`cd web && pnpm wasm` を実行する。

## 守ること

- **計算ロジックは `calcarc-core` に置く。** `calcarc-wasm` と `web` に計算を書かない。
- **`calcarc-core` は panic しない。** `#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]` が強制している。
- **`web/src/calc/` に React を import しない。** UI Framework から独立させるための境界。
- **WASM 境界は JavaScript 例外を投げない。** 計算エラーは戻り値の一部。
- **許容誤差をテストコードに書かない。** 言語間検証は `testdata/*.json` の `tolerance`、
  Rust のユニットテストは `calcarc_core::TEST_EPSILON` から読む。
- **参照実装を Rust の移植にしない。** 同じアルゴリズムを両方に書くと、同じバグが両方に
  入って検証の意味がなくなる。
- **電卓の挙動は `crates/calcarc-core/tests/engine_table.rs` が仕様書。** キー列と表示の
  対応を先に変えてから実装を直す。
- **版数を上げるときは 5 箇所を揃える。** `Cargo.toml`（workspace）、
  `web/package.json`、`README.md` の「現在の版」、`README.en.md` の
  「Current version」、`CHANGELOG.md` の見出し。**`pnpm check:version` が
  5 箇所すべてを見る**（毎回の CI が回している）。
  **タグを打つときは 1 段厳しくなる**——`node scripts/check-version.mjs --tag v0.5.0`
  は、4 つの版数がタグ名と一致し、CHANGELOG の見出しに**日付が入っている
  （「未リリース」でない）**ことまで見る。これは Heavy corpus のワークフローが
  タグから走ったときに自動で回すので、**リリース前に手で打つ必要はない**。
  画面に出る版数は `web/package.json` からビルド時に埋まる。

## 踏んだ罠

- **コミット前に `cargo fmt` を実行する。** `--check` は直してくれない。
- **`uv lock` / `uv sync` は `--no-config` を付ける。** 付けないと手元の
  `~/.config/uv/uv.toml` の `exclude-newer` がロックファイルに書き込まれ、CI の
  `uv sync --locked` が落ちる。
- **pnpm のバージョンは `web/package.json` の `packageManager` が持つ。** CI の
  `pnpm/action-setup` はそこを見る。
- **CI の `wasm-pack` はバージョンを固定する。** 指定しないと実行ごとに違うものが
  入る。実際に `v0.9.1` が降ってきて、`license.workspace = true` を解釈できず
  マニフェストの解析に失敗した。手元と同じ版に揃えること。
- **jsdom はアクセシビリティツリーを組み立てない。** ロールの意味論に関わる回帰は
  vitest では捕まらないので、E2E で実ブラウザに確認させる。

## git

コミットとブランチ作成は行ってよい。**`git push` と PR 作成は行わない。**
コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
