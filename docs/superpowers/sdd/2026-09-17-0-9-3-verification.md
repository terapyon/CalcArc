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

## C-2 衝突マーカーの検査の範囲を広げる（案 D） — **完了**

**広げる前に数えた**（緑を作りに行かない）: `git ls-files` **582 本**・**読めた 575 本**・
**行頭のマーカー 0 行**。**広げても今日は緑**と分かってから広げた。

**変えたもの（4 本）**:

- `tools/check-conflict-markers.mjs`——`readTrackedDocs()`（`ls-files docs/`）を
  **`readTrackedFiles()`（`ls-files` 全部）**に。**2 進（NUL を含む）は飛ばし、飛ばした数を印字**する。
- 同ファイルの**註 4 か所**——見出し・「`docs/` の外は見ない」・`=======` の説明・「自己違反しないこと」。
  **範囲を変えたら理由も同じコミットで直す**（今日 `FinancePanel.tsx` で見た「直した文が註に移って生き残る」形を作らない）。
- `tools/tests/check-conflict-markers.test.ts`——import 名、実物のリポジトリを読む 3 件。
  **`docs/` の外も読んでいることを主張する行**を足した（`CLAUDE.md` と `.github/` が読めていること、
  **全部が `docs/` で始まるわけではないこと**）。`docs/` に戻った日に赤くなる。
- `.github/workflows/ci.yml`——段の註（「`docs/` に…」→「追跡下の全ファイルに…」）。

**床は 2 つ**:

- `MIN_SCANNED_FILES = 100`——**読んだ**数の下限。**今日の数（576）を焼かない**。
- `MAX_SKIPPED_FILES = 50`——**飛ばした**数の上限（**新設**）。
  **「読めないので見なかった」を「見て 0 だった」と同じ緑にしない**ため（監視役の指摘）。
  実測は 7 件。**読み方が壊れて全部飛ばし始めたら、ここで落ちる。**

**赤の確認（新しい覆いを名指しで確かめた）**: **`docs/` の外**にマーカーを置いた——
リポジトリ根に `zz-redcheck.tmp`（`x` / `<<<<<<< HEAD` / `y`）を作り `git add -N`:

```
check:conflict-markers NG — 衝突マーカーが残っている(1 行)
  zz-redcheck.tmp:2: <<<<<<< — <<<<<<< HEAD
rc=1
```

**広げる前なら、このファイルは見えていない。** 片付けて再実行し、緑に戻ることも確かめた
（`git rm --cached` ＋ 削除 → `OK — 追跡ファイル 576 件を読み、7 件を飛ばした…`、木は 3 本の変更だけ）。

**緑の印字**:

- `node tools/check-conflict-markers.mjs` → **576 件を読み、7 件を飛ばし、マーカー 0**
- `pnpm vitest run ../tools/tests/check-conflict-markers.test.ts` → **14 passed**
- `cd heavy && pnpm test` → **20 files・360 passed**（`tools/tests` を含む）
- `cd heavy && pnpm lint` → 緑（既存の info 2 件のみ。`report.ts` の `useTemplate`）

**型検査について（訂正つき）**: はじめ、この作業木の `pnpm typecheck` は
`web/src/calc/index.ts` の 2 件で落ちた——**`web/src/wasm/` がまだ無い**ためである
（CLAUDE.md「新しいクローンでは先に `cd web && pnpm wasm`」）。
**そのとき私は「この変更とは関係が無い（`tools/tests/` にはエラーが 1 件も出ていない）」と報告した。偽だった。**

**`web/src/wasm/` をビルド済みの作業木（`wt-092d`）から写して走らせ直すと、
私の変更に 2 件のエラーが出た**——`tools/tests/check-conflict-markers.test.ts(164,24)`・`(165,25)`、
`Parameter 'f' implicitly has an 'any' type`。**原因は私の JSDoc**で、戻り値を
`{files, skipped}` に変えたのに `@returns {SourceFile[]}` のままだった
（**説明文も「`docs/` の下で追跡されている…」のまま**——**註の直しを 4 か所やって、
この 1 か所を落としていた**）。直しは `596ddec`。

**教訓（記録に残す）: 検査の rc だけを見て「エラーが無い」と書かない。どこまで走ったかを見る。**
**型検査は最初のエラーで止まる**ので、**落ちた場所より後ろは「緑」でも「赤」でもなく「走っていない」**。
**走っていない範囲を、当てた範囲のように書かない。**

**`pnpm wasm` は回さずに済んだ**——**ビルド済みの作業木から写せばよい**（gitignore 済みなので差分に出ない。
コアの API を変えていない枝なら、写したもので型検査は正しく通る）。**重い段を 1 つ節約できる。**

## C-1 マニュアルの上限値とコードの定数の突合 — **紐づけの表（番人を書く前に固める）**

**番人を書きながら紐づけを決めると、「書きやすい紐づけ」に寄る**（監視役の指摘）。
**先に表を固め、現物で当て直してから書く。** 以下はすべて **`2be381d`（= `v0.9.2` = いまの `main`）で当て直した**。
**`main` は設計のときから動いておらず、7 つの定数はどれも同じ行・同じ値である。**

**マニュアルの表は既に 2 つに分かれている**（0.9.2 の直し）——
**打鍵で止まる**ものと、**打てるが答えで断られる**もの。**番人の当て方も 2 種類に分かれる。**

### 打鍵で止まる（打てなくなる）

| マニュアルの文 | 通る経路（打鍵 → 止める所） | 定数 | 番人が読む所 | 導き方 |
|---|---|---|---|---|
| `:761` Scientific の入力 **12 文字** | `engine/state.rs:291`（数字）・`:369`（小数点）が `digits.len() >= MAX_ENTRY_LEN` で**黙って落とす** | `pub const MAX_ENTRY_LEN: usize = 12`（`engine/state.rs:26`） | `engine/state.rs` | そのまま |
| `:761` `Exp` の指数 **3 桁** | `engine/state.rs:282` が `exponent.digits.len() >= MAX_EXPONENT_LEN` で落とす | `const MAX_EXPONENT_LEN: usize = 3`（`engine/state.rs:30`、**非公開**） | `engine/state.rs` | そのまま |
| `:762` Convert の値 **39 桁** | `UnitPanel.tsx:271`・`:279`（数字）→ `convert/entry.ts:46-48`、`:284`（小数点）→ `:50-52` → `units/entry.ts` | `const MAX_VALUE_DIGITS = 39`（`convert/entry.ts:44`） | `convert/entry.ts` | そのまま |
| `:763` Finance の金額 **20 桁** | `FinancePanel.tsx:590-592` `pressDigit`（**項目で分岐しない**）→ `finance/entry.ts:44-45` | `const MAX_YEN_DIGITS = 20`（`finance/entry.ts:42`） | `finance/entry.ts` | そのまま |
| `:782` 小数点は **7 文字**までのあいだ | `FinancePanel.tsx:662`（`case "dot"`、**全項目共通**）→ `units/entry.ts:81` の `tail.text.length >= maxDigits` | `const MAX_RATE_LEN = 8`（`FinancePanel.tsx:147`） | `FinancePanel.tsx` | **8 − 1**（`>=` で拒むので、7 文字までは打てる） |

**`MAX_ENTRY_LEN` だけは境界を渡る。** `calcarc-wasm/src/lib.rs:139` の `max_entry_len()` が公開し、
web は `calc.maxEntryLen()` で受ける（`web/src/calc/index.ts:63`、`ScientificPanel.tsx:246`）。
**web 側に写しが無い**——註に理由も書いてある（**写しを置いた日、履歴の呼び戻しが上限を跨ぐ答を黙って切り詰めた**）。

### 打てるが、答えで断られる

| マニュアルの文 | 通る経路（どこで断るか） | 定数 | 番人が読む所 | 導き方 |
|---|---|---|---|---|
| `:771` Finance の期間 **1,200** | **打鍵は止まらない**。`FinancePanel.tsx:603` の `domainOf` の着地（`max: String(MAX_PERIODS)`）が先、コアの `grow` が二重目 | TS `const MAX_PERIODS = 1200`（`FinancePanel.tsx:94`）＋ Rust `pub const MAX_PERIODS: u32 = 1_200`（`finance/compound.rs:19`） | **両方**（**2 つが一致すること自体も主張する**） | そのまま |
| `:772` 月額 **10 億円** | `loan/closed_form.rs:92`（**0% と 1 回払いの早期 return の後ろ**） | `const MAX_VERIFIED_MONTHLY_YEN: u64 = 1_000_000_000`（`closed_form.rs:27`、**非公開**） | `closed_form.rs` | そのまま |
| `:775` 金額の計算の上限 **18,446,744,073,709,551,615** | u64 に収まらない値を弾く | **定数ではない。型の上限である** | **どこも読まない**——番人が **2^64 − 1 を計算する** | 型の上限 |
| `:770`・`:781` 年利 **100 まで** | 文字列の経路 `loan/rate.rs`／式の経路 `expr/mod.rs`（`evaluate_to_percent`） | **`pub const MAX_ANNUAL_PERCENT`**（両方に、**同じ綴り**で） | `loan/rate.rs` | そのまま。**2 経路の一致は 3d の `both_paths_carry_the_same_rate_limits` が持つ** |
| `:770`・`:781` 年利 **小数 4 桁**まで | 同上 | **`pub const MAX_PERCENT_DECIMALS`**（両方に） | `loan/rate.rs` | そのまま。**`PERCENT_SCALE` が桁数から導かれる形になった**ので、「表し方が違う」は**解消済み** |
| `:781` 「**5 桁以上**は答えが出ません」 | 同上 | 同上 | `loan/rate.rs` | **`+ 1`**（「4 桁までは出る」の裏返し） |

**待ちの 2 行は空けたまま PR に出さない**（監視役の指示）。**枝 6 が仕上がったら同じ枝に足し、7 行そろえてから PR。**

**`18,446,744,073,709,551,615` は「同じ数を探す」では当たらない。** ソースのどこにも書かれていない
（`u64` という型が持つ上限であり、綴りとして現れない）。**番人は計算して比べる**——
`(2n ** 64n - 1n).toLocaleString("en-US")` で作った文字列と、マニュアルの数を突き合わせる。

### 番人が置く床（§1.7 の条件①）

**行ごとに「1 件見つかった」を assert し、0 件なら落ちる。** マニュアル側の正規表現も、
ソース側の定数の綴りも、**片方でも当たらなければ赤**にする——**綴りが変わった日に黙って緑にならないため**。

## C-1 の番人 — **7 行を実装（年利の 2 行は待ち）**

**置いた場所**: `tools/check-manual-limits.mjs`＋`tools/tests/check-manual-limits.test.ts`。
**`web/package.json` の `check:manual-limits`** と **`.github/workflows/ci.yml`**（`check:conflict-markers` の次）に繋いだ
——**番人を置いても CI に繋がなければ、規律はその日から偽になる**（CLAUDE.md）。

**可視性は 1 つも広げていない。** ソースの**本文**を読んで数を取り出す
（`check-version.mjs` が 6 か所の版数でやっているのと同じ作法）。

**実装した 7 行**（打鍵で止まる 5 ＋ 答えで断られる 2）と、**型の上限 1 行**:
Scientific 12 文字／指数 3 桁／Convert 39 桁／Finance の金額 20 桁／小数点 **7 文字（= `MAX_RATE_LEN` − 1）**／
期間 1,200（**盤面とコアの 2 つが一致することも主張**）／月額 10 億円（`MAX_VERIFIED_MONTHLY_YEN` ÷ 1 億）／
**u64 の上限 18,446,744,073,709,551,615**。

**年利の 3 行は入れた**（100 まで・小数 4 桁・「5 桁以上は出ない」）——**`chore/false-rationales`（bf84012）を合流してから足した**。経緯は下の「段取りが変わった」。

### 赤の確認（5 種類、どれも別の壊れ方で鳴らした）

**戻しは再編集**（`git checkout` は使わない）。**全部戻したあと緑に戻り、木は空**であることも確かめた。

| 壊し方 | 出た赤 |
|---|---|
| マニュアルの数を動かす（12 → 13） | `NG — マニュアルの数と製品の数が違う(1 行)` / `Scientific の入力の文字数: マニュアル 13 / 製品 12` |
| **導き方の行**（`MAX_RATE_LEN` 8 → 9、マニュアルは 7 のまま） | `小数点を打てる文字数: マニュアル 7 / 製品 8(MAX_RATE_LEN(9) − 1 …)` |
| **盤面とコアの食い違い**（TS の 1200 → 1201） | `期間の上限が盤面(1201)とコア(1200)で食い違っている。**どちらも計算は正しいままなので、ほかのどの検査にも映らない**` |
| **型の錨**（`parse::<u64>` → `parse::<u128>`） | `finance/loan/mod.rs に \`parse::<u64>\` が 0 回現れた(1 回であること)` |
| **床**（マニュアルの言い回しを変える） | `マニュアルの「小数点は、いま打っている数が … 文字までのあいだ」が 0 件見つかった(1 件であること)` |

**3 つ目と 4 つ目が、この番人の価値そのもの**である——
**盤面とコアの 1200 が食い違っても、計算は正しいままなのでほかのどの検査にも映らない**
（`token_parity.rs:204-212` の註が先に名指ししている穴）。
**型の上限は数として書かれていない**ので、**数を比べるだけでは `u128` に変わった日に黙って緑になる**。

### 緑の印字

- `pnpm check:manual-limits` → **上限 7 行と u64 の上限 1 行が一致**
- `cd heavy && pnpm test` → **21 files・363 passed**（前は 20 files・360）
- `pnpm lint` → **rc=0**、`pnpm typecheck` → **rc=0**
- `check-conflict-markers` → 576 読み・7 飛ばし・0／`check-citations` → 緑

### 書くときに踏んだもの（記録）

- **biome の設定はディレクトリごとに違う。** `heavy` から `../tools/...` を指定して整形すると、
  **`heavy` の設定で整形され、`tools` の設定では赤いまま**になる。**`tools/` の中で走らせる。**
- **`@ts-expect-error` を足したら「未使用」で赤くなった**——`.mjs` の import は通るので要らなかった。
  **兄弟のテスト（`check-conflict-markers.test.ts`）を先に見ていれば書かずに済んだ。**

### この番人は、どの段で走るか（現物で確かめた）

**#144 で踏んだ形を避けるため、2 つとも名指しで書く**（番人は `Web build and unit tests` に繋いだのに、
番人のテストは `Heavy tooling` で走っていた、という食い違い）。

- **番人そのもの**（`pnpm check:manual-limits`）——**`web` のジョブ**（`Web build and unit tests`）。
  `ci.yml:187`、`check:conflict-markers` の次。
- **番人のテスト**（`tools/tests/check-manual-limits.test.ts`）——**`heavy` のジョブ**（`Heavy tooling`）の
  `pnpm test`（`ci.yml:231`）。**`tools/tests/` はこのジョブが回す**と `ci.yml:211` の註にも書いてある。
- **この番人は git を呼ばない**——`child_process`・`execSync`・`execFileSync`・`spawn` を grep して **0 件**。
  **したがって `fetch-depth` に依存しない**（`check-manual-freshness` とはそこが違う）。

## C-3 賞与の worked example に番人を置く — **完了**

**両端を置いた**（設計書 §3 の裁定「両方」）:

1. **値の裏づけ**——`reference/src/calcarc_reference/cases.py` に**マニュアルの入力そのもの**を足し、
   `testdata/finance.json` に golden を生やした（**125 → 126 件**）。
   **参照実装（Python）が値を出し、Rust の golden テストが製品と突き合わせる。**
   出た数は**マニュアルの 4 つとぴったり一致**——`monthly_payment 73484`・`bonus_payment 110487`・
   `bonus_rows 70`・`total_payment 38597286`。
2. **文との結びつけ**——`tools/check-manual-limits.mjs` に `collectWorkedExample()` を足し、
   **マニュアルの文と golden の数**を突き合わせる（6 行）。

**JS で計算し直していない。** 償還を組み直せば**3 つ目の実装**になり、**同じ間違いを 2 か所に書く**ことになる。
**差額 18,279 は 2 つの golden の引き算**で出す——マニュアルは「賞与なしの総支払より 18,279 円多い」と
書いており、**その 2 つの総支払はどちらも golden に在る**（賞与なしは既存の
`loan_forward/30000000/1.5/420/0`）。

**この例が「覆われていなかった」ことの確認**（0.9.2 の監査の再掲）: この入力を呼ぶテストは 2 本あったが、
`crates/calcarc-wasm/tests/web.rs` は **`bonusRows == 70` と「文字列が在ること」だけ**、
`reference/tests/test_loan_ref.py` は**不等式だけ**を見ていた。**値を主張するものは 1 本も無かった。**

### 赤の確認（3 種類）

| 壊し方 | 出た赤 |
|---|---|
| マニュアルの月々（73,484 → 73,485） | `賞与の例: 月々の返済額: マニュアル 73485 / 製品 73484(golden … の monthly_payment)` |
| **差額**（18,279 → 18,280） | `賞与の例: 差額: マニュアル 18280 / 製品 18279(**2 つの golden の引き算**)` |
| golden の id が消える | `testdata/finance.json に \`loan_bonus_forward/30000000/6000000/1.5/420\` が 0 件見つかった(1 件であること)` |

### 緑の印字

- `check:manual-limits` → **上限と worked example 13 行、u64 の上限 1 行が一致**
- `cd heavy && pnpm test` → **21 files・364 passed**（C-1 の時点は 363）
- `cd reference && uv run --no-config pytest -q` → **548 passed**
- `cargo test --workspace` → **ok 行 25**／lint `rc=0`／typecheck `rc=0`
- **再生成しても差分が増えない**（`generate.py` を回し直して `git status` が同じ 4 本のまま）

## 枝どうしの合流の下見（2026-09-17） — **衝突 0・合流した木も緑**

**各枝 vs main が緑でも、同じ所に追記する枝どうしは衝突する**（09-16 に PR C/D で踏んだ形）。
**`merge-tree` の「衝突なし」は緑ではない**ので、**使い捨ての作業木で本当に合流して検査を回した**。

- **`test/goto-retry`（13f2b9e）**・**`docs/v0.9.3-design`（0ed76f0）**とも**衝突なし**。
  **触るファイルが 1 本も重なっていない**（私の 12 本 対 3d の 5 本）。
  `fix/paren-del` は `main` のままでコミット 0。
- **合流した木**: `heavy pnpm test` **21 files・369 passed**／lint `rc=0`／typecheck `rc=0`／
  `check:manual-limits` 13 行＋u64／**`check:conflict-markers` 580 件**（**3d の新しい文書 4 本を、
  広げた番人がそのまま覆っている**）／`check:citations` 緑。
- **cargo は回していない**——`git diff --name-only 8d99440..HEAD` に `crates/` も `testdata/` も **0 本**で、
  **Rust は私の先端から 1 バイトも動いていない**ことを**印字で示してから省いた**
  （**「回していない」を「確かめていない」にしない**）。

### ★ 測る作業木に `node_modules` を symlink で持ち込まない

**下見の途中で赤が 3 回出た。3 回とも合流とは無関係で、私の測り方が原因だった。**
（依存を入れる代わりに `ln -s` で借りたため。）

| 出た赤 | 本当の原因 |
|---|---|
| `check-boundary.test.ts` が「`web/node_modules` を歩いた」 | **`.gitignore` の `node_modules/` は末尾の `/` でディレクトリを指すので、symlink には当たらない**。`git ls-files --others --exclude-standard` が未追跡として吐く |
| `webkit-gate.test.ts` が**読み込みで**落ち、テスト数が 369 → **325** に減った | symlink を外したので `@playwright/test` が解決できない。**落ちたのではなく走っていない** |
| `verified-run.test.ts` の「どこから呼んでも件数が変わらない」 | `heavy/node_modules` だけ symlink のままだった |

**決め手は `git check-ignore -v` で 2 つの作業木を比べたこと**——実体では `.gitignore:2:node_modules/` に当たり、
**symlink では当たらない**。**`pnpm install --frozen-lockfile` を入れ直したら 369 passed で全部緑**（1 秒以下）。

**対になる事実**: **`web/src/wasm/` は写してよい**。**gitignore の指し方が違い、写しても未追跡として出ない**ので、
**重い `pnpm wasm` を節約できる**（C-2 の型検査でそうした）。
**依存は入れる、生成物は写す**——この 2 つは別物である。

**そして**: **赤が出たら、まず「自分が作った差」を疑う。** この 3 件はどれも
**「合流の問題」として報告する 1 歩手前**だった——報告していれば、**存在しない衝突の裁定**が始まり、
**3d が自分の枝を探しに行く**ことになった。

## 2 度目の合流の下見（2026-09-17、3d がマニュアルを触ったあと）

**D-1 `fix/paren-del`（b597449）と D-3 `fix/convert-new-entry`（7d8d959）**を、私の先端（6c22365）へ順に合流。

- **衝突 0。** **`crates/calcarc-core/tests/engine_table.rs` は両者が触っている**（私は C-4 の nCr の行、
  D-1 は `DEL` の行）が、**足す場所が違うので git がそのまま合わせた**。
- **合流した木で全部緑**——`cargo test --workspace` **ok 行 25**／`heavy pnpm test` **21 files・364 passed**／
  **マニュアルの番人 5 本 48 passed**／lint `rc=0`／typecheck `rc=0`／
  `check:manual-limits` 13 行＋u64／`check-conflict-markers` **578 件**／`check-citations` 緑。

**「番人が言い回しを見失わないか」は、緑だけで答えない。** 10 個の当て先が**それぞれちょうど 1 件**の
ままであることを数えた（**2 件見つかれば床に当たって落ちる**ので、**増えた文が同じ言い回しを持ち込んで
いないか**が問題になる）。**増えたのは `DEL` と Convert の新しい値の話で、私の当て先の数には触れていない。**
**将来これを壊すのは、表の作り直し**（`[^|]*\|` で列を渡っているため）——**そのときは床が鳴る。**

**そして 3d の足した例は、ちゃんと覆われていた**——「答えのあとに数字を打つと新しい値」は
`web/src/ui/Convert/UnitPanel.wasm.test.tsx` の 2 件が、`1/3*3-1` → `0` は
`web/tests/e2e/convert.spec.ts:434` が主張している。**マニュアルに例を足して番人を置かない、という形にはなっていない。**

## 導き方のある行の一覧（**1 か所にまとめる**）

**「マニュアルの数 == 定数」で済まない行**は、**導き方を番人の中に 1 行書く**。
**その行が 2 本になったので、ここに集める**——**3 本目が増えたときに探せるように。**

| マニュアルの文 | 定数 | 導き方 | 状態 |
|---|---|---|---|
| 「小数点は、いま打っている数が **7 文字**までのあいだしか打てません」 | `MAX_RATE_LEN = 8` | **`− 1`**。`pushDot` が `tail.text.length >= maxDigits` で拒むので、**その 1 つ手前までは打てる** | **実装済み**（C-1、`9ccbdd5`） |
| 「小数点以下が **5 桁以上**の年利は、打てても答えは出ません」 | `MAX_PERCENT_DECIMALS = 4` | **`+ 1`**。「4 桁までは出る」の裏返し | **実装済み**（`chore/false-rationales` を合流して追加） |

**どちらも `==` で書くと、正しい文書が赤くなる。**

## 赤の確認についての規律（2026-09-17 に踏んだ）

**赤を見たら、鳴った検査の名前を読む。別の行が先に鳴っていることがある。**

年利の導き方の行（`+ 1`）を試したつもりで、**式の経路の `MAX_PERCENT_DECIMALS` だけを 4 → 3 にした**。
赤は出た。**しかし鳴っていたのは手前の「2 経路の一致」の検査**で、
**導き方の行はそもそも評価されていなかった**（手前で落ちるため）。
**2 経路とも 3 にして初めて**、`答えが出なくなる年利の小数桁数: マニュアル 5 / 製品 4` が出た。

**番人の並び順の問題である**——**手前に強い検査があると、後ろの行は片方を壊しただけでは試されない。**
**同じ形を今日もう 1 回踏んでいる**（`tsc` が最初のエラーで止まり、`tools/tests/` まで走っていなかったのに
「エラーが無い」と報告した）。**「赤が出た」は「その行が働いた」ではない。**

## ★ 段取りが変わった（2026-09-17）——**main 経由ではなく、枝の上に積む**

**当初の案 A は「3d の枝が main に入ってから、main を合流して足す」だった。** 前提は
**「枝が順に main へ入っていく」**である。**利用者の方針が「全部そろってからまとめて push」に変わり、
main は当分動かない**ので、**案 A は成り立たなくなった**（監視役より）。

**新しい形**: **3d の承認済みの枝を、私の枝に直接合流してから積む。**

- **年利の 3 行** → `chore/false-rationales`（**bf84012**）を合流してから追加。**実施済み。衝突 0。**
- **C-6** → `fix/paren-del`（**019e214**）を合流してから、**D-1 の engine に対して再生成**する。
- **PR は依存の順に並ぶ**——`chore/false-rationales` → 私の C、`fix/paren-del` → C-6。

**前提が変わったのに、前提の下で書いた文を残さない**（今日 3 度踏んだ形）ので、
**この節より上の「待ち」「main に入ってから」は、すべてこの段取りに書き換えてある。**

**なお、合流した相手の枝の SHA は動いていた**——私が最初に検証したのは `f3bf388`・`b597449` で、
**いま合流したのは `bf84012`・`019e214`**。**どちらも「承認後に 1 コミット増えた」もので、
年利の定数は同じ値・同じ行だった**が、**SHA を確かめずに「検証済み」と言わない**。

## C-6 対応しない `)` の 2 件をコーパスから退役させる — **完了**

**枝** `docs/0-9-3-verification`、起点 `14ed562`（`019e214` = `fix/paren-del` を合流した点）。

### 触る前の走行（`pnpm heavy` 1 回目、監視役が枠を出した）

**267 passed / 38.4s。** **`git status --porcelain corpus/ testdata/` = 0 行**で走らせた
——**唯一変わっていたのは生成器のコメント文だけで、`pnpm heavy` は生成器を読まない**
（読むのはコミット済みの `corpus/generated/*.json` と TS 側の engine）。
**これで「赤が出たら D-1 の影響であって自分の変更ではない」と切り分けられる状態を先に作った。**

### 何を外したか

`reference/src/calcarc_reference/corpus_errors.py` の `unbalanced_parenthesis_cases()`
（`)` 単独と `3 + 4)` の 2 件）と、`build_errors_shard` からのその呼び出し。

**主張は消えたのではなく、移る予定である**——D-2 が `)` を押せなくすると
**「押すとエラーになる」が主張として成り立たなくなる**（押せないものに「押した後」は無い）。
**行き先は `engine_table.rs` の `refused_after` 2 行、D-2 の枝 `fix/unmatched-rparen`。**
**2026-09-17 時点で、その 2 行が入ったことは確認できていない**ので、**コード中の註も「移す予定」と書いた**
——**入ったら SHA で名指しに書き換える**（監視役の指示）。
**枝名は `git worktree list` の実物で確かめた**（`wt-d2` = `111e67f` `[fix/unmatched-rparen]`）。
**C-6 と D-2 のあいだは、この 2 つの主張がどこにも無い窓が開く**——**順番の裁定を承知のうえで開けている。**

### 効き目の確かめ方 — **自分の枝では赤くできないので、D-2 の engine を借りた**

**この枝で `corpus_refused_presses` は緑だが、それは「D-2 が入っていないから」であって、
C-6 が効いている証拠ではない。** **緑で当然のものを根拠にしない。**

使い捨ての**切り離した**作業木を D-2 の先端 `111e67f` に出し、**その 1 本だけ**を名指しで走らせた
（**他の 9 本は 3d が持つ赤なので、全部走らせると他人の赤を自分の結果と取り違える**）。
**3d の枝には何も書いていない**（`--detach`、終わったあと `git restore` して `worktree remove`、force 不要）。

| | コーパス | 結果 |
|---|---|---|
| 1 | D-2 の先端そのもの | **FAILED — 24 件** |
| 2 | 同じ先端に、**私の再生成後の 2 枚だけ**を差し込む | **ok（0 件）** |

**24 の内訳が、私が Python で独立に数えた内訳と完全に一致した**
——`fix-*` 22 件（`corrections-000`）＋ `err-*` 2 件（`err-000028` / `err-000029`）。
**監視役が伝えてきた 24 とも一致。** **数え方が 3 通りで合ったので、これは見立てではなく事実である。**

### 再生成の影響範囲（実測）

**変わったのは 2 枚だけ**——`corrections-000.json` と `errors-000.json`。
`errors-000` は 30 → **28 件**。**対応しない `)` の押下は、全シャード合計で 24 → 0。**

層の件数が動いた: `paren-edit` 790→**784** / `ac-rebuild` 420→**427** /
`error-recovery` 418→**416** / `typo-del` 372→**373**。
**プールから 2 件抜けると `error-recovery` の乱数の消費がずれ、そのあとの層の当たり方まで動く。**
**下限は割合で書いてあるので赤くはならないが、docstring の数は腐る**ので測り直して直した
（`test_no_correction_stratum_collapses_to_a_handful`）。

### ★ 自分で書いた理由が、書いた日のうちに腐った

**退役してよい根拠として「`ac` をまたぐ括弧の判定を踏む場は 838 件残る」と書いた。**
**その 838 は退役"前"のコーパスで測った数で、再生成した瞬間に 843 になった。**
**気づいたのは、層の件数の drift を直しているときである。**
**「理由は静かに腐る」の最短の実例**——**腐るのに数時間もかからず、同じ作業の中で腐った。**
直したうえで、**docstring に「この数を変わらないものとして引用するな」と書いた。**

### ★ 番人が、私が見落としていた損失を捕まえた

**`test_every_calc_error_kind_appears_at_least_once` が赤くなった**
——`AssertionError: missing kinds: {'SyntaxError'}`。
**退役させた 2 件が、`errors-000` で唯一の `SyntaxError` だった。**
**私は「2 件抜くだけ」と思っていて、種別が 1 つ丸ごと落ちることに気づいていなかった。**

**種別そのものは失われていない**: `error.rs:18` は
**「対応しない `)` や `.` の重複など」と 2 つの作り方を挙げており**、
**`.` の重複のほうは `corpus_entry` が持っている**（`3 . .` = `entry-000035`）。
**`)` を押せなくする D-2 は、`.` の重複には触らない。**

**Ruling: 番人を弱めず、数える範囲を 1 枚から 2 枚に広げる**
— 「4 種でよい」に書き換えれば緑にはなるが、**それは主張を落として緑を買う**ことになる。
**「よそで見張っている」を散文で書かず、同じテストの中で `build_entry_shard()` を実際に数える**
——**entry 側の `SyntaxError` が消えれば、このテストが赤くなる。**
— **コストが外れた場合**: entry シャードの都合で errors シャードのテストが赤くなる結合が 1 本増える。
**それでも、種別が黙って落ちるほうが高くつく。**

**赤の確認**: `corpus_entry.py` の `error="SyntaxError"` を `"DomainError"` に変えて実行
→ **私が書いた assertion が、私が書いた文言で鳴った**
（`` `.` の重複による SyntaxError が entry シャードから消えた``、`assert 'SyntaxError' in {'DomainError'}`）。
**「何が鳴ったかの名前を読む」を満たしている。** 戻しは**再編集**（`git status` で 0 行を確認）。

### 緑の印字

- `reference`: **547 passed**（79.90s）。`ruff check` 緑 / `ruff format --check` 58 files already formatted / `mypy` 15 files 緑。
- **`uv.lock` は無変更**（`--no-config` を `run` にも付けた）。
- `cargo test --workspace`: **`test result: ok` が 25 行、FAILED 0**。`cargo clippy --workspace --all-targets -- -D warnings` 緑。

---

## 次: `pnpm heavy` 2 回目（再生成後）

**先に数えてから広げる。** 設計書 §2.3 の実測では**追跡下の全ファイルで行頭のマーカーは 0 行**だが、
**広げた瞬間に赤くなるなら、それは新しい発見**である——**緑を作りに行かない**。

**注意（1e の指摘、2026-09-17）**: 追跡ファイルの総数は**数え方で食い違う**
（私の走査で 582・読めたのは 575、1e は 581）。`ls-files` を撮った時点や symlink の扱いの差と見られる。
**番人が置く床に今日の数を焼かない**——**今日の数を床にすると、明日ファイルが 1 つ減っただけで赤くなる。**
