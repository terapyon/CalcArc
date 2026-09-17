# 0.9.3 検査側の実装の台帳（C-1〜C-6）

**設計書**: `docs/superpowers/specs/2026-09-17-0-9-3-verification-design.md`（枝 `docs/0-9-3-verification`、
1e 承認・条件は全部閉じた）。**起点**: `2be381d`（= `v0.9.2` = main）。

**この台帳は追跡下に置く。** `.superpowers/` は `.git/info/exclude` が無視するので、
**他のクローンからも他のセッションからも読めない**（CLAUDE.md 「台帳」）。

**着手の順**: **C-4 → C-2（案 D）→ C-1 → C-3 → C-6**。
**C-6 は D-1（`DEL` の作り）の engine が固まってから**——`corpus_refused_presses` は**製品の `refuses` を呼ぶ**ので、
**engine が動いているあいだに測ると測り直しになる**。

---

## C-4 マニュアルの nCr の打鍵表に番人を置く — **完了**

**何を守るか**: `docs/manual/detail.ja.md` の「既知の計算制限」が**利用者に見せている打鍵表**。
0.9.2 で「載せたままにする」と決めた以上、**見せている主張には番人が要る**。
**この表は、これまでどのテストにも覆われていなかった**（`3,654` を主張するテストは 0 本、
heavy の組合せ 2,000 件に `eq` の答えから `nCr`/`nPr` へ続ける列は 0 件、`engine_table.rs` にも続き計算の行は無し）。

**置いた場所**: `crates/calcarc-core/tests/engine_table.rs` の
`a_combination_cannot_continue_from_the_answer`（組合せの節の末尾）。
**キー列と表示の対応を書く場所**というこのファイルの役目どおりで、**「打てるが Math ERROR」もここに書ける**。

**主張する 4 行**:

| キー列 | 表示 | 何を言っているか |
|---|---|---|
| `2 9 nCr 3 =` | `3,654` | 表の 1 行目 |
| `… = nCr 1 =` | `Math ERROR` | **答えから続けると拒まれる** |
| `… = nPr 1 =` | `Math ERROR` | `nPr` でも同じ |
| `3 6 5 4 nCr 1 =` | `3,654` | **打ち直せば通る——「数が大きすぎる」ではない** |

**赤の確認（先に赤くしてから緑にした）**:

1 行目の期待を **`3,655`**（誤った値）にして走らせ、**赤を見た**:

```
thread 'a_combination_cannot_continue_from_the_answer' panicked at
crates/calcarc-core/tests/engine_table.rs:419:5:
assertion `left == right` failed
  left: "3,654"
 right: "3,655"
test result: FAILED. 0 passed; 1 failed; 0 ignored; 108 filtered out
```

**この赤が示すこと**: assert は**実物のエンジンを通した表示と比べている**（`main_of` は
`Key::from_token → reduce → render` を通る）。**空振りしていない。**
そのうえで `3,654` に直して緑にした。

**緑の印字**:

- `cargo test -p calcarc-core --test engine_table a_combination_cannot_continue_from_the_answer` → **1 passed**
- `cargo test -p calcarc-core --test engine_table` → **109 passed**（この変更の前は 108）
- `cargo test --workspace` → **ok 行 25・失敗 0**
- `cargo fmt --all -- --check` → 緑、`cargo clippy --workspace --all-targets -- -D warnings` → 緑

**裁定は要らなかった**（設計書 §6）。**表の内容は 2 度独立に確かめてある**——
私の一時テスト（0.9.3 の調べ）と、1e が 0.9.2 のマニュアル審査で打った結果が
**3,654 / Math ERROR / Math ERROR / 3,654 で一致**している。

---

## 次: C-2 衝突マーカーの検査の範囲を広げる（案 D）

**先に数えてから広げる。** 設計書 §2.3 の実測では**追跡下の全ファイルで行頭のマーカーは 0 行**だが、
**広げた瞬間に赤くなるなら、それは新しい発見**である——**緑を作りに行かない**。

**注意（1e の指摘、2026-09-17）**: 追跡ファイルの総数は**数え方で食い違う**
（私の走査で 582・読めたのは 575、1e は 581）。`ls-files` を撮った時点や symlink の扱いの差と見られる。
**番人が置く床に今日の数を焼かない**——**今日の数を床にすると、明日ファイルが 1 つ減っただけで赤くなる。**
