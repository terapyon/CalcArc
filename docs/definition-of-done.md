# Definition of Done — MVP の総点検

base-spec §50 の 14 項目に、根拠を 1 つずつ付ける。Loan Calculator（M6）の
完成でこの表が埋まる。**根拠は「実装」「テスト」「実機確認」の別を書く**——
テストが緑であることと、実機で動いたことは別の主張である。

日付: 2026-08-13（feature/loan ブランチ）

| # | 項目 | 根拠 | 別 |
|---|---|---|---|
| 1 | Smartphone で利用可能 | ユーザー本人が iPhone / Safari で `calcarc.pages.dev` を操作（2026-08-13）。E2E も 390×844 の viewport で 41 件緑 | 実機確認 + テスト |
| 2 | Tablet で利用可能 | シェル寸法規約（`--shell-max-width`、タッチ target 44px）を全パネルが使う。E2E がタッチ target を検査 | 実装 + テスト |
| 3 | Desktop で利用可能 | 同上（幅は `--shell-max-width` で頭打ち）。開発時のブラウザ確認 | 実装 |
| 4 | PWA としてインストール可能 | ユーザー本人が iPhone / Safari でホーム画面に追加し standalone 起動を確認（2026-08-13）。`pnpm check:sw` が manifest と precache を検査 | 実機確認 + テスト |
| 5 | Offline で基本計算可能 | ユーザー本人が機内モードで Scientific と Data Scale の動作を確認（2026-08-13）。**Loan は本ブランチのマージ後の再デプロイで同じ確認が要る**（wasm は precache 対象なので構造上は同じ経路） | 実機確認（Loan は未） |
| 6 | Rust/WASM で計算 | 3 モジュールとも計算は `calcarc-core`。境界は `calcarc-wasm` の純関数で、`crates/calcarc-wasm/tests/web.rs` 15 件が実ブラウザで往復を確認 | 実装 + テスト |
| 7 | Scientific Calculator 動作 | `tests/engine_table.rs`（キー列と表示の仕様表）、`scientific.json` の言語間検証、E2E | テスト |
| 8 | Polar / Rectangular 変換動作 | `tests/roundtrip.rs`、`complex.json`、E2E の `▸∠` | テスト |
| 9 | Data Scale Calculator 動作 | `data_scale.json` 28 件、vitest、E2E | テスト |
| 10 | Loan Calculator 動作 | `finance.json` 36 件（完全一致）、コア単体 41 件、wasm 5 件、vitest 12 件、E2E 11 件 | テスト |
| 11 | Python Reference Validation あり | `reference/` の 4 実装が `complex/scientific/data_scale/finance` の期待値を生成。再生成の byte 一致を CI が検査 | 実装 + テスト |
| 12 | CI ですべてのテストが成功 | `.github/workflows/ci.yml` の 5 ジョブ。ローカルのフルスイープは下記のとおり全段緑（wasm 境界のみ Firefox。ローカルの Chrome 135 と wasm-pack が持つ chromedriver 151 が噛み合わないため。CI は自前の組を固定している） | テスト |
| 13 | README に Numerical Policy を説明 | `README.md` の Numerical Policy 節と `docs/numerical-policy.md`（Loan の第 3 分類を追記済み） | 実装 |
| 14 | OSS License 明記 | `LICENSE`（Apache 2.0）と README の License 節 | 実装 |

## ローカルのフルスイープ（2026-08-13、ci.yml から導出）

| コマンド | 結果 |
|---|---|
| `cargo fmt --check` | 緑 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 緑 |
| `cargo test --workspace` | 185 件 緑 |
| `wasm-pack test --headless --firefox crates/calcarc-wasm` | 15 件 緑 |
| `pnpm typecheck` / `pnpm lint` | 緑 |
| `pnpm test`（vitest） | 59 件 緑 |
| `pnpm exec vite build` / `pnpm check:sw` | 緑 |
| `pnpm e2e`（Playwright） | 41 件 緑 |
| `uv run ruff check .` / `ruff format --check` | 緑 |
| `uv run pytest` | 30 件 緑 |
| `generate.py` ×2 | 4 ファイルとも byte 一致、`uv.lock` 不変 |

## 残っている確認

- **項目 5 の Loan 分**: マージ後の自動デプロイのあと、機内モードで Loan を
  1 回操作する。
