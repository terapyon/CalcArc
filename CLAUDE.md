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
| `heavy` | 重量級の検証。独立した pnpm パッケージで、`web` はこれを知らない |

## コマンド

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
wasm-pack test --headless --chrome crates/calcarc-wasm

cd web && pnpm test        # vitest
cd web && pnpm e2e         # Playwright（内部で wasm をビルドする）

cd reference && uv run pytest
cd reference && uv run mypy                          # *_ref.py の型検査（範囲は pyproject）
cd reference && uv run python scripts/generate.py   # golden の再生成

cd heavy && pnpm heavy         # 生成コーパスと参照の照合（32 秒）
cd heavy && pnpm heavy:ui      # 本物の盤面を叩く（12 分）
cd heavy && pnpm heavy:power   # 変異の検出力（11 分）
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
  入って検証の意味がなくなる。**これは機械では検出できない**（同じ手順で書いても照合は
  一致して緑になる）ので、**公開関数の docstring に `独立: 別手順／不可能／一部／未確認` を
  1 行書く**。書き方は [CONTRIBUTING.md](CONTRIBUTING.md) の「参照実装を足すとき」。
- **規律を書いたら、同じコミットで番人を置く。** 番人とは**破ったときに赤くなるもの**
  （テスト・lint の規則・CI の 1 段・生成器の assert）。**置けないなら、置けない理由と
  代わりに何が守るのかを書く。**
- **電卓の挙動は `crates/calcarc-core/tests/engine_table.rs` が仕様書。** キー列と表示の
  対応を先に変えてから実装を直す。
- **版数を上げるときは 5 箇所を揃える。** `Cargo.toml`（workspace）、
  `web/package.json`、`README.md` の「現在の版」、`README.en.md` の
  「Current version」、`CHANGELOG.md` の見出し。**`pnpm check:version` が
  5 箇所すべてを見る**（毎回の CI が回している）。
  **タグを打つときは 1 段厳しくなる**——`node tools/check-version.mjs --tag v0.5.0`
  は、4 つの版数がタグ名と一致し、CHANGELOG の見出しに**日付が入っている
  （「未リリース」でない）**ことまで見る。これは Release のワークフローが
  タグから走ったときに最初のジョブとして自動で回すので、**リリース前に手で
  打つ必要はない**。画面に出る版数は `web/package.json` からビルド時に埋まる。
- **本番へ出る扉は `v*` タグだけである。** main への push はどこにも配らない。
  タグを打つと `release.yml` が
  **版数ゲート → CI 全部 → 重量級コーパス → 本番展開 → 証拠と GitHub Release**
  の順に回す（実測で 40 分強）。1 つでも落ちれば本番へは出ない。
  Release にはその走行が作った証拠が 3 つ添付される——各ジョブの結論
  （`gh api` が走行から読む）、重量級の報告書、**実際に配った `dist`**。
  戻すときは revert を main に積んで**パッチ版のタグを打つ**。緊急時だけ
  `Deploy` を古いタグの ref で手動起動できるが、**それは検査を迂回する経路**で、
  使ったら Release に書き足す（[docs/deploy.md](docs/deploy.md)）。
- **重量級のテストを `web/` に置かない。** `heavy/` が持つ。`web` から
  重量級への参照は 0 件であり、この向きを保つ。

## 踏んだ罠

- **コミット前に `cargo fmt` を実行する。** `--check` は直してくれない。
- **`uv lock` / `uv sync` は `--no-config` を付ける。** 付けないと手元の
  `~/.config/uv/uv.toml` の `exclude-newer` がロックファイルに書き込まれ、CI の
  `uv sync --locked` が落ちる。
- **pnpm のバージョンは `web/package.json` の `packageManager` が持つ。** CI の
  `pnpm/action-setup` はそこを見る。
- **道具の版は固定する。範囲で書かない。** 実例が 3 つある。
  - **`wasm-pack`（CI）**: 指定しないと実行ごとに違うものが入る。実際に `v0.9.1` が
    降ってきて、`license.workspace = true` を解釈できずマニフェストの解析に失敗した。
  - **`wrangler`（`deploy.yml`）**: `wranglerVersion: "3.90.0"` と明示する。
    action の既定への暗黙依存を残さない。
  - **`biome`（`web` と `heavy`）**: `2.5.8` と厳密に綴る（2026-08-28 に `^2.0.0` から)。
    **範囲のままだと、lockfile が 2 本あるので片方だけ `pnpm install` が走った日にずれる**
    ——実際に web 2.5.6 / heavy 2.5.8 の 2 版が同居していた。**揃えるだけでは再発する。**
    揃えるだけなら手数は小さいが、**その手数で何も解決しない**。
- **jsdom はアクセシビリティツリーを組み立てない。** ロールの意味論に関わる回帰は
  vitest では捕まらないので、E2E で実ブラウザに確認させる。

## git

コミットとブランチ作成は行ってよい。**`git push` と PR 作成は行わない。**
コミットメッセージの末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。

## 台帳

**横断的な台帳は `docs/superpowers/sdd/` に置く**（引き継ぎ・未消化の一覧・レビュー結果）。
`specs/` `plans/` と同じく**追跡下**である。

**`.superpowers/` に置かない。** あそこは `.git/info/exclude` が無視しており、
**その規則はクローンごとのローカルファイルなのでリポジトリに含まれない**——
他の人のクローンからも、他のセッションからも読めない。2026-08-28 に
「台帳に載っているつもり」で 2 回つまずいた。

**`.superpowers/sdd/<日付>-<題>/` は 1 つのタスクの作業ファイル**（`task-N-brief.md` ほか）。
そちらは追跡しない。**閉じる主体が居るあいだだけ生きる**からである。
