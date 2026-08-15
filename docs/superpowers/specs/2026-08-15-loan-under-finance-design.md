# `loan` を `finance` の下へ（B）— 設計

日付: 2026-08-15
対象: `crates/calcarc-core/src/loan/` → `crates/calcarc-core/src/finance/loan/`。
**機械的な移動だけ。** 機能は 1 つも足さない、1 つも変えない。
前提: main（PR #35 マージ後）から。次の A（Finance UI）はこの上に積む。
**状態: 未承認のドラフト。**

## §0 なぜ今やるか

F1 の spec §7【訂正 3】で、複利を `finance::compound` に置き、**`loan` の再配置は
別 spec に送ると決めた**。理由は「移動は wasm・テスト・web の import に波及するので、
機能追加と同じ diff に混ぜない」（API 整理 PR #19 の方式）。その別 spec がこれである。

**いま木はこうなっている:**

```
calcarc-core/src/
├── finance/          ← F1 で新設
│   ├── compound.rs
│   └── tax.rs
└── loan/             ← M6 のまま、finance の外に居る
    ├── rate.rs  schedule.rs  closed_form.rs  forward.rs  inverse.rs  bonus.rs
```

`finance::compound` が `crate::loan::rate::Rate` を import している。**金融計算の
モジュールが、金融計算のモジュールの外を参照している**——base-spec 189 行の
モジュール木（`finance` が 1 つの枠）とも食い違う。

やらない場合の実害は「読みにくい」だけで、動くものは動く。**だから小さいうちに
やる**——A（Finance UI）が入ると、UI からも両方が見えるようになって動機が薄れる。

## §1 変えること

```
crates/calcarc-core/src/finance/
├── mod.rs        ← pub mod loan; を足す。「移していない」の注記を消す
├── compound.rs   ← use crate::loan::rate::Rate → use super::loan::rate::Rate
├── tax.rs        ← 変更なし
└── loan/         ← ここへ丸ごと移動（ファイルの中身は無変更）
```

**変えるのは import のパスだけ。** ファイルの中身（アルゴリズム・テスト・
コメント）は 1 行も書き換えない。例外は次の 2 か所だけで、どちらも
「移動によって嘘になった文」の訂正である:

- `finance/mod.rs` の「**ローン（`crate::loan`）は移していない**」という注記
  ——移した以上、残すと嘘になる。
- `loan/mod.rs` の冒頭 doc に、`finance` の下に居ることを 1 行足す。

## §2 波及範囲（実測、2026-08-15）

`crate::loan` / `calcarc_core::loan` を参照しているのは **4 ファイルだけ**である。

```bash
$ grep -rln "calcarc_core::loan\|crate::loan" crates/
crates/calcarc-core/src/finance/compound.rs
crates/calcarc-core/src/finance/mod.rs
crates/calcarc-core/tests/finance_golden.rs
crates/calcarc-wasm/src/lib.rs
```

これに `crates/calcarc-core/src/lib.rs`（`pub mod loan;` の行）を足して **5 か所**。

**`loan/` の中のファイルは `super::` で相互参照している**ので、移動しても中は
無傷である（`rate.rs` を `schedule.rs` が `use super::rate::Rate` で見る形）。

### 変わらないもの

- **`testdata/finance.json`**（53 件）——計算は 1 つも動かない。
- **Python 参照実装**——Rust の木を知らない。
- **`web/`**——WASM のエクスポート名（`loan_forward` など）を変えないので、
  TS からは何も変わらない。`web/src/loan/` も動かさない（F0 §1 の「内部名は
  改名しない」がここでも効く。**これは改名ではなく移動である**）。
- **WASM の公開 API**——`#[wasm_bindgen]` の関数名は据え置く。名前を変えるのは
  公開 API の変更であって、この spec の主題ではない。

## §3 やらないこと（明示）

- **`loan` を `finance::loan` に改名しない。** 移すだけである。`Rate` は
  `calcarc_core::finance::loan::rate::Rate` になる。
- **`Rate` を `finance` 直下に上げない。** 複利も使っているので上げたくなるが、
  それは「共有される部品はどこに置くか」という別の問題で、移動と混ぜない。
  やるなら次の spec。
- **wasm のエクスポート名・TS の型名・`web/src/loan/` を変えない。**
- **`data_scale` や `units` は触らない。**

## §4 検証段（tiering、ci.yml 導出）

コアの構造を触るので **Rust と wasm**。web と Python は動かない。

```bash
cargo test --workspace          # 192 + 11 = 203、増減なし
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
wasm-pack test --headless --chrome crates/calcarc-wasm   # 20、増減なし
```

- **`testdata/` の差分が空であること**を完了報告に書く。
- `web` と `reference` は回さない（**上の差分ゼロがその根拠**）。
- スクリーンショットは不要（UI が変わらない）。

## §5 完了条件

1. `crates/calcarc-core/src/finance/loan/` に 7 ファイルが居る。
   `crates/calcarc-core/src/loan/` は無い。
2. **移動したファイルの中身が `git log --follow` で追える**
   （`git mv` を使い、内容の変更と同じコミットに混ぜない）。
3. **テストの検査内容を 1 行も書き換えていない。** `finance_golden.rs` は §2 の
   とおり `use` のパスが変わるが、**assert も期待値も入力の読み方も動かない**。
   `git diff` で、テストファイルの変更が `use` 行だけであることを示す。
4. `cargo test --workspace` が **203 件のまま緑**。`testdata/` の差分が空。
5. `wasm-pack test` が **20 件のまま緑**。
6. `web/` と `reference/` の差分が空。

## §6 赤確認

**この spec には赤確認が要らない。** 新しい検査を足さないからである
（新設検査は壊して赤を見てから信じる、という規律の対象が無い）。

代わりに置く証明は**「既存の検査が 1 行も変わらずに通ること」**である。
移動が無害でなければ、203 件のどれかがコンパイルエラーか失敗になる。

## §7 スコープ外

- `Rate` の置き場所の見直し（§3）
- wasm エクスポート名の整理
- `web/src/loan/` → `web/src/finance/loan/` の移動——**web 側は F0 で「内部名は
  据え置く」と決めたばかり**である。Rust 側を動かしたからといって自動的に
  ついてくるものではない。必要になったら別 spec で判断する。
