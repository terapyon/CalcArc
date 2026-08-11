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
- **命名と API 形状の判断は [docs/api-style.md](docs/api-style.md) に従う。**
  基準で説明できない変更提案は「好み」であり、現状維持とする。

## 電卓の挙動を変えるとき

`crates/calcarc-core/tests/engine_table.rs` が挙動の仕様書である。
キー列と期待される表示の対応を先に変えてから実装を直すこと。

## テストをどこまで回すか

変更の影響範囲に合わせて段を選ぶ。全部を毎回回さない。

| 変更の場所 | 回すもの |
|---|---|
| calcarc-core 内部(境界・挙動不変) | fmt + clippy + `cargo test --workspace` |
| `reduce`/表示の挙動、DisplayState、トークン | 上記 + `wasm-pack test` |
| `web/src/calc`・UI | 上記 + `pnpm wasm && pnpm typecheck && pnpm lint && pnpm test` |
| ロール意味論・a11y・境界契約 | 上記 + `pnpm e2e`(jsdom は a11y ツリーを組まない) |
| 数値・アルゴリズム | fmt + clippy + `cargo test --workspace`。testdata を変えるときは `uv run --no-config pytest` と再生成の差分確認も |

フルスイープ(全レイヤー + golden 再生成の差分ゼロ確認)はブランチの
最終コミット前に 1 回。新設・変更した検査は、対応する壊し方で赤くなる
ことを確認してから信じる(機械的リネームには不要)。

## 数値を変えるとき

`reference/scripts/generate.py` を実行して `testdata/` を再生成し、
差分を確認してからコミットする。CI が再生成の差分を検査する。

## Python の依存を更新するとき

`reference/uv.lock` を作り直すときは `--no-config` を付ける。

```bash
cd reference && uv lock --no-config
```

付けないと、手元の `~/.config/uv/uv.toml` の設定がロックファイルに
書き込まれる。とくに `exclude-newer` を設定している場合、その制約が
`[options]` に残り、設定を持たない CI では

```
error: The lockfile at `uv.lock` needs to be updated, but `--locked` was provided.
```

で落ちる。ロックファイルはバージョンを固定するためのものなので、
解決時の制約を持ち越す必要はない。

**`uv sync` も同じことをする。** 依存を入れ直しただけのつもりでも
ロックファイルが書き換わるので、`git diff reference/uv.lock` を見て
`exclude-newer` が入っていないか確認すること。
