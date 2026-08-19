# Definition of Done — 0.2.0 の総点検

base-spec §50 の 14 項目に、根拠を 1 つずつ付ける。**根拠は「実装」「テスト」
「実機確認」の別を書く**——テストが緑であることと、実機で動いたことは別の
主張である。

日付: 2026-08-17（0.2.0 ベータ）
公開先: https://calc.terapyon.net/

| # | 項目 | 根拠 | 別 |
|---|---|---|---|
| 1 | Smartphone で利用可能 | ユーザー本人が iPhone / Safari で操作（2026-08-13、当時の URL は `calcarc.pages.dev`）。E2E も 390×844 の viewport で 122 件緑 | 実機確認 + テスト |
| 2 | Tablet で利用可能 | シェル寸法規約（`--shell-max-width`、タッチ target 44px）を全パネルが使う。E2E がタッチ target を検査 | 実装 + テスト |
| 3 | Desktop で利用可能 | 同上（幅は `--shell-max-width` で頭打ち）。開発時のブラウザ確認 | 実装 |
| 4 | PWA としてインストール可能 | ユーザー本人が iPhone / Safari でホーム画面に追加し standalone 起動を確認（2026-08-13）。`pnpm check:sw` が manifest と precache を検査 | 実機確認 + テスト |
| 5 | Offline で基本計算可能 | ユーザー本人が機内モードで動作を確認（Scientific / Data Scale は 2026-08-13、Finance は 2026-08-16 に本人が申告）。**確認したのはその時点で配信されていた版**であり、0.2.0 の版ではない | 実機確認 |
| 6 | Rust/WASM で計算 | 3 モジュールとも計算は `calcarc-core`。境界は `calcarc-wasm` の純関数で、`crates/calcarc-wasm/tests/web.rs` 28 件が実ブラウザで往復を確認 | 実装 + テスト |
| 7 | Scientific Calculator 動作 | `tests/engine_table.rs`（キー列と表示の仕様表）、`scientific.json` の言語間検証、E2E | テスト |
| 8 | Polar / Rectangular 変換動作 | `tests/roundtrip.rs`、`complex.json`、E2E の `▸∠` | テスト |
| 9 | Data Scale Calculator 動作 | `data_scale.json`、vitest、E2E | テスト |
| 10 | Loan Calculator 動作 | `finance.json`（完全一致）、コア単体、wasm、vitest、E2E。複利と逆算も同じ経路で検証 | テスト |
| 11 | Python Reference Validation あり | `reference/` の実装が `complex/scientific/data_scale/finance` の期待値を生成。再生成の byte 一致を CI が検査 | 実装 + テスト |
| 12 | CI ですべてのテストが成功 | `.github/workflows/ci.yml`。ローカルのフルスイープは下記のとおり全段緑（wasm 境界のみ Firefox。ローカルの Chrome と wasm-pack が持つ chromedriver が噛み合わないため。CI は自前の組を固定している） | テスト |
| 13 | README に Numerical Policy を説明 | `README.md` の Numerical Policy 節と `docs/numerical-policy.md` | 実装 |
| 14 | OSS License 明記 | `LICENSE`（Apache 2.0）と README の License 節 | 実装 |

## ローカルのフルスイープ（2026-08-17、ci.yml から導出）

| コマンド | 結果 |
|---|---|
| `cargo fmt --check` | 緑 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 緑 |
| `cargo test --workspace` | 301 件 緑 |
| `wasm-pack test --headless --firefox crates/calcarc-wasm` | 28 件 緑 |
| `pnpm typecheck` / `pnpm lint` | 緑 |
| `pnpm test`（vitest） | 159 件 緑 |
| `pnpm exec vite build` / `pnpm check:sw` / `pnpm check:version` | 緑 |
| `pnpm e2e`（Playwright） | 122 件 緑 |
| `uv run ruff check .` / `ruff format --check` | 緑 |
| `uv run pytest` | 83 件 緑 |
| `generate.py` ×2 | byte 一致、`uv.lock` 不変 |

## 0.2.0 で作った例外と、繰り越したもの

**タッチ標的の例外が 2 つある**（base-spec §43 の 44px を割る）。どちらも
理由を設計書に書いてある。

| 場所 | 高さ | 理由 |
|---|---|---|
| Scientific の関数列 | 34px | 誤爆しても DEL で戻せる（S1 設計書 §4） |
| フッタのリンク | 11px（実測。390×844、`page.getByRole("link", { name: /^CalcArc .+ @terapyon$/ }).boundingBox()`） | 広げる縦が無い。押せなくても計算に影響しない（0.2.0 設計書 §5） |

**Finance のモード行と項目行は、0.2.0 で例外から外れた**（34px → 68px）。

**繰り越した表示の問題**（計算結果には影響しない。0.2.1 以降で直す）:

- ~~**360px 幅で関数列のボタンが 8px 横に溢れる。**~~ **0.2.1 で解消。**
  原因はキーの `min-width: 44px` が grid の `1fr` の下限になり、7 列 × 44px
  ＋ gap 8px × 6 = 356px が 336px（360px − padding 24px）に入らなかったこと。
  **gap のほうを譲らせて 44px は守った**（`Keypad.module.css`）
- **`env(safe-area-inset-top)` を誰も吸っていない。** standalone 起動で Nav が
  ステータスバーに潜る可能性がある。実機確認が要る
- **更新のトーストがフッタに重なる。** 一過性

**対応する画面幅の下限は 360px とする**（0.2.1 で決めた）。**320px は対象外**——
7 列 × 44px = 308px は、gap と padding を 0 にしても 320px にほとんど隙間が
残らず、**44px と 7 列は 320px で両立しない**。算数であって、直し方の問題では
ない。gap を譲る修正の副作用として 320px でも横スクロールは出なくなったが、
**関数列の隙間が 0 になり右端に接する**ので、誤爆しやすい状態のままである。

## 縦が短い画面（0.2.1 で見つけた、未解決）

**0.2.1 の 360px 調査中に実測して見つけた。0.2.0 の時点で既にあった。**
`document.documentElement.scrollHeight − window.innerHeight` の実測値:

| | 390×844 | 360×800 | 360×640 | 320×568 |
|---|---|---|---|---|
| Scientific | 0 | 0 | **52** | **82** |
| Data Scale | 0 | 0 | **66** | **112** |
| Finance | 0（余裕 22） | 0（余裕 **11**） | **149** | **196** |

**縦に短い端末では 3 タブとも 1 画面に収まっていない**（縦スクロールが出る）。
横の 8px より大きく、Scientific だけの話でもない。**Finance が最も重い。**

**`viewport-budget.spec.ts` が測っているのは 390×844 だけ**なので、この 3 列は
どのテストにも守られていない。直すには盤面の寸法を画面高さに応じて縮める設計が
要り、44px をどこまで守るかの裁定も要る。**0.2.1 の範囲外**（ユーザー裁定）。

### 0.3.0 で悪化した分（実測 2026-08-20）

**Scale が 3 カテゴリになり、カテゴリの `<select>` が 1 行増えた。** 同じ測り方
（`scrollHeight − innerHeight`、実機ビルドを preview で配信、パネルが出てから測る）で
採った値:

| | 390×844 | 360×640 |
|---|---|---|
| Data Scale（0.2.1） | 0 | **66** |
| Data Scale（0.3.0） | 0 | **94** |
| LLM のメモリ（新規） | **33** | **204** |
| データ転送量（新規） | 0 | **66** |

**Data Scale は 360×640 で 28px 悪くなった**（66 → 94）。390×844 で 0 のままなのは、
この幅では余りが 107px あって増分が吸われるからで、**予算が増えたわけではない**。

**LLM は 390×844 でも 33px 溢れる。** iPhone 相当の幅で 1 画面に収まらないのは
3 カテゴリで LLM だけである。360×640 の 204px はフッタの免責文が画面外に完全に
出る量で、**この表で最も重い**（0.2.1 の Finance 149px より大きい）。

**上の表と縦に読まないこと**——0.2.1 の Data Scale（66）と 0.3.0 のデータ転送量（66）が
たまたま同じ値である。別の行である。

**直すのは 0.3.0 の範囲外**（S-0 spec §8。悪化量を測って記録するところまでが仕事）。
**未解決の項目がこれで 3 行増えた**ことを、次に縦を触る人へ渡す。
