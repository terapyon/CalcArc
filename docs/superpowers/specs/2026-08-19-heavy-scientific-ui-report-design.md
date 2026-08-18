# Heavy corpus 改善 D+E — Scientific の残り・Heavy UI・レポート

改善指示書（2026-08-17 受領）の **§7.5〜7.7・§8**（D）と
**§3.2・§3.4・§3.6**（E）を担う。3 分割の 3 本目、最後。

**A と B+C の両方に依存する。**

- §7.7 は A が作る `expectShards` に `associativity-flip` の期待を書き換える。
- §3.4 は B+C が書く `stratum` と `rejections` の理由分けを読む。
- §3.2 の「ブラウザやビルド自体の失敗」は A が書く `heavy-run.json` から来る。

**この spec の完了をもって指示書 §10 の完了条件がすべて埋まる。**
§12 の実装報告もここで書く。

## 1. いま何が踏まれていないか（実測）

### §7.5 編集と状態

| 項目 | 状態 |
|---|---|
| `AC` | **踏んでいる** — `corrections-000.json` 2,000 件が `[でたらめ, ac, 正しい列]` ≡ `[正しい列]` を主張 |
| `DEL` | **踏んでいる** — 同シャードの `_inject_typo` 経路 |
| 入力途中の演算子 | **未踏** |
| 括弧編集中 | **未踏** |
| エラー後の復帰 | **未踏** |
| モード切替後の状態 | 角度モードと表示形式は踏んでいる（`angle-mode` / `display`）。入力途中の切替は未踏 |

**全ケースが `eq` で終わる。** そのため確定した値の表示しか踏んでいない。
`1e10` を打鍵すると平坦な `10000000000` が出るが、計算で作ると `1e10` になる
——この差はコーパスに 1 件も無い。

### §7.6 エラーと境界

**0 件。** 生成器は定義域の外に落ちたケースを `OutOfShard` で捨てる設計で、
エラーになる入力はコーパスに入らない。`engine_table.rs` は 10 種類以上の
エラー経路をテストしているが（`:312` `:340` `:531` `:578` `:622` `:659` `:731`）、
**重量級コーパスはそのどれも通らない。**

### §7.7 結合方向

**0 件。** `precedence-000.json` は同順位の入れ子を**括弧を残して**生成しており
（`report.ts:1407` がその判断を記録している）、結合方向が変わっても答えが変わらない。
`detection-power` の `associativity-flip` が「どこも赤くならない」を期待して
いるのは、この不在の裏返しである。

### §8 Heavy UI

- **どのキーが実際に押されたかを、誰も数えていない。** `reachability.spec.ts` は
  「盤面に在って押せる」ことを確かめるが、`corpus-ui.spec.ts` は等間隔サンプリング
  なので、`j` や `°'"` が 1 度も押されない走行がありうる。
  **押していないのに「UI も通した」と読める。**
- **call シャードは UI 走行の対象外。** `corpus-ui.spec.ts` は `loadShards()` と
  `loadDisplayShards()` しか読まない。Finance は 1 件も画面から入っていない。

### §3.2 / §3.4

- レポートのエラー経路は 1 行にまとまっている（`report.ts:1237`）。
  Scientific の定義域エラー・Finance の SyntaxError・Finance の Overflow・
  Data Scale の入力エラー・走行そのものの失敗が区別されていない。
- Finance の内訳が無い。`report.ts` に finance が現れるのはドメイン名の
  対応表（`:361` `:375`）だけである。

## 2. 目的

1. **編集中と誤り側の経路をコーパスに入れる**（§7.5・§7.6）。
2. **結合方向を検証し、レポートの「踏んでいない」を撤回する**（§7.7）。
3. **画面から実際に押されたキーを数え、下限を主張する**（§8）。
4. **Finance を実画面から通す**（§8）。
5. **レポートの矛盾を消し、Finance の内訳を出す**（§3.2・§3.4）。
6. **矛盾が同時に出ないことをテストで見張る**（§3.6）。

## 3. 非目標

- 判定名（`完全に正しい` など）を変えない。許容誤差を変えない。
- Chromium 以外を足さない。本番スモークを拡張しない。
- Heavy を必須ゲートにしない。
- **Finance の全コーパスを UI から入れない**（指示書 §8 が明示的に免除している）。

## 4. 設計 D-1 — 入力途中の表示（§7.5）

新しいシャード `entry-000.json`（`kind: "display"`）。**キー列が `eq` で
終わらない。** 期待値は打鍵の途中で画面に出ている文字列である。

```jsonc
{
  "kind": "display",
  "id": "entry-000123",
  "keys": ["1", "dot", "2", "3"],
  "expect": { "main": "1.23" },
  "expr": "1.23 を打鍵中"
}
```

踏む形:

- 先頭の `0`、`00`、`0.` の扱い
- 小数点が 2 つ目を拒む（`engine_table.rs:69`）
- **12 桁の上限**（`MAX_ENTRY_LEN`、`state.rs:17`。先頭のゼロも数える）
- `EXP` の書式と、指数が範囲外のまま確定していない状態
- 演算子を押した直後（保留演算があるが入力は始まっていない）
- 括弧を開いた直後、閉じる前
- 負号、`+/-` の途中適用

### 4.1 参照実装の位置づけ — **これは外部参照ではない**

打鍵中の表示に数学的な定義は無い。規則を持っているのは
**`crates/calcarc-core/tests/engine_table.rs`**（CLAUDE.md が「電卓の挙動の
仕様書」と定めている）だけである。参照実装はその表から規則を読み取って書く。

**したがって `entry-000.json` は「Python が独立に出した期待値」ではなく、
「仕様書から起こした期待値」である。** レポートはこれを外部参照の件数に
混ぜてはならない——指示書 §3.5 が「外部参照と自己同値を分離する」と言って
いるのと同じ理由で、**第 3 の枠**を作る（下記 6.3）。

この正直さには実利がある。混ぜると「二経路で照合したケース」の数が水増しされ、
**検証の強さについてレポートが嘘をつく**。

## 5. 設計 D-2 — エラーと境界（§7.6）

新しいシャード `errors-000.json`（`kind: "display"`）。表示と**エラー種別**の
両方を期待値に持つ。

```jsonc
{
  "kind": "display",
  "id": "err-000007",
  "keys": ["1", "div", "0", "eq"],
  "expect": { "main": "Math ERROR", "error": "DivisionByZero" },
  "expr": "1 ÷ 0"
}
```

`ERROR_TEXT` は `"Math ERROR"`（`engine/display.rs:9`）で全件共通なので、
**主張の中身は `error` の種別である**。ハーネスは既に `{ main, error }` を
返している（`heavy-harness.ts:96`）ので、新しい API は要らない。
`DisplayCase` の `expect` に `error` を足し、照合を 1 段深くする。

### 5.1 期待値の出どころ — 数学の定義域から独立に決める（ユーザー裁定）

`CalcError` の**種別名**は WASM 境界を跨ぐ公開契約なので共有してよい。
**どの式がどの種別になるかは、Rust を見ずに数学から決める。**

| 経路 | 参照実装の根拠 |
|---|---|
| 0 除算 | 除法の定義域が除数 ≠ 0 |
| `ln` `log` の定義域外 | 対数の定義域は正の実数 |
| `√` の負値 | 実数の平方根の定義域は非負 |
| `asin` `acos` の範囲外 | 逆三角関数の定義域は [−1, 1] |
| `tan` の極 | 余弦が 0 になる点 |
| 階乗の負・非整数・過大 | 階乗の定義域は非負整数、値域は f64 |
| `nPr` `nCr` の `r > n`・負・非整数 | 組合せの定義 |
| overflow / underflow | f64 の値域 |
| 括弧不一致 | 構文（`engine_table.rs:578` と同じ主張を、構文規則から独立に書く） |

**一致しなければ、どちらかが間違っている。**これが二経路検証の意味である。

### 5.2 エラー後の復帰と括弧編集中（§7.5 の残り）

**新しい期待値の仕組みを作らない。** 既存の `corrections-000.json` と同じ
**同値**の形で書ける。

- **エラー後の復帰**: `[エラーを起こす列, ac, 正しい列]` ≡ `[正しい列]`。
  `engine_table.rs:189`（`ac_recovers_from_an_error`）と `:194`
  （`keys_other_than_ac_are_ignored_while_in_error`）が主張している挙動を、
  コーパスの規模で踏む。**エラー中に押した他のキーが無視されることまで含めて
  同値になる**——これは強い主張である。
- **括弧編集中**: `[a, add, lparen, b, del, c, rparen, eq]` ≡ `[a, add, lparen, c, rparen, eq]`。

`build_corrections_shard` に 2 つの形を足す（現在は `del` の打ち間違いと
`ac` のやり直しの 2 形）。**件数はシャード内で層として数える**——B+C が
Finance に入れた層の考え方を、ここにも使う。

## 6. 設計 D-3 — 結合方向（§7.7）

新しいシャード `associativity-000.json`（`kind: "value"`）。

踏む形:

| 形 | 例 | 結合方向に依存するか |
|---|---|---|
| 同順位 3 項の減算 | `9 − 4 − 3` | **する**（左結合なら 2、右結合なら 8） |
| 同順位 4 項以上 | `9 − 4 − 3 − 1` | する |
| 同順位 3 項の除算 | `8 ÷ 4 ÷ 2` | **する**（左 1、右 4） |
| 累乗の連鎖 | `2 ^ 3 ^ 2` | **する**（右結合なら 512、左結合なら 64） |
| 括弧つき（対照群） | `(9 − 4) − 3` | **しない** |

**括弧つきを対照群として同じシャードに入れる。** 括弧が構造を決めるので
結合方向を反転しても答えが変わらない——`associativity-flip` の変異が
**シャード内の一部だけを赤くする**ことになり、変異がシャード全体を無差別に
壊しているのではないことが言える。

期待値は参照実装が数式として評価する。左結合・右結合の規則は base-spec の
公開契約である（`xʸ` だけが右結合）。

### 6.1 3 か所を同時に動かす

**この変更は 3 か所が同時でなければ、レポートが自分のコーパスについて嘘をつく。**

1. `web/scripts/detection-power.mjs` — `associativity-flip` の `expectShards` を
   `[]` から `["associativity-000.json (values)"]` へ。`minRate` は実測から。
2. `web/tests/heavy/report.ts:1407` — 「結合方向は踏んでいない」の段落を、
   実測件数を出す形に置き換える。`:1463` 付近の「`xʸ` は押されるが結合方向にも
   優先順位 4 にも触れていない」も同様。
3. `web/tests/heavy/report.spec.ts` — 「the report keeps saying the power
   operator's associativity is untested」を、**踏んだことを言い続けるテスト**に
   反転する。

片方だけ動かすと、指示書 §3 が指摘したのとまったく同じ壊れ方（レポートが
自分の走行について矛盾する）に戻る。**3 つを 1 コミットにまとめる。**

## 7. 設計 D-4 — Heavy UI（§8）

### 7.1 押されたキーを数える

`corpus-ui.spec.ts` の `pressToken` が押したトークンをディスクへ逐次記録し
（`report.record()` と同じ流儀で、ワーカーが死んでも残る形）、
**`heavy-ui` の `globalTeardown` が読んで主張する。**

- 指示書 §8 の 9 キー——`.` `EXP` `j` `▸∠` `Deg/Rad` `ENG` `°'"` `AC` `DEL`
  ——が**すべて 1 回以上押されている**。足りなければ teardown が例外を投げ、
  走行が失敗する。
- 押した総数と、トークンごとの回数を `heavy-ui-run.json` に書く（レポートが読む）。

**主張を別のテストファイルに置かない。** ファイルの実行順に依存すると、
「記録より先に検査が走って空を見る」という順序の事故が起きる。
`globalTeardown` は走行そのものに紐づいていて、**テストが落ちても必ず
1 度だけ走る**——`report.ts` の `writeReport` が同じ理由でそこに居る。

`playwright.heavy-ui.config.ts` は現在 `globalTeardown` を持たないので、新設する。

**サンプリングを必須キー優先に変える。** `spread` は等間隔に選ぶだけなので、
必須キーを含むケースが 1 件も選ばれないことがありうる。**先に必須キーを含む
ケースを各 1 件確保してから、残りを等間隔で埋める。**

「押せる」ことは `reachability.spec.ts` が見ている。ここが足すのは
**「実際に押した」**——2 つは別の主張である（`tests-can-assert-nothing`）。

### 7.2 Finance を実画面から通す

`web/tests/heavy-ui/finance-ui.spec.ts` を新設する。

- **面ごとに正常 1 件・異常 1 件**。面は `payment` / `principal` / `term` /
  `compound` / `deposit-for` / `periods-for` の 6 モードに、ボーナスを使う
  `payment` と `principal` の 2 面を足した **8 面**。計 16 件。
- **ケースはコーパスの層から引く**（B+C の `stratum`）。手で書いた入力を
  ここで作らない——手書きの期待値が「コーパスを通した」顔をするのを避ける。
- 駆動方法は既存 e2e（`finance-compound.spec.ts` / `finance-inverse.spec.ts` /
  `loan.spec.ts`）が持っているので**再利用する**。
- 異常系は `data-testid="finance-load-error"` ではなく、**画面に出るエラー表示**を
  見る（`finance-load-error` は wasm 読み込み失敗の枠であって、計算のエラーでは
  ない）。実装時に実物を確認して確定する。

実行時間: `heavy:ui` は現在 16 テスト 10.6 分。Finance が 8 面 × 2 件 = 16 件
増えるだけなので、**増分は 1 分未満**の見込み（1 件あたり 0.53 秒の実測から）。
ただし Finance は打鍵ではなく欄への入力なので、1 件あたりの費用は科学計算の
実測とは違う。**実装時に測って記録する。**

## 8. 設計 E — レポート（§3.2・§3.4・§3.6）

### 8.1 エラー経路を 5 つに分ける（§3.2）

| 枠 | 出どころ |
|---|---|
| Scientific の定義域エラー | `errors-000.json` の件数（D-2 で新設） |
| Finance の `SyntaxError` | call シャードの集計（B+C の層別） |
| Finance の `Overflow` | 同上 |
| Data Scale の入力エラー | `data-scale-000.json` の `error` 件数 |
| **走行そのものの失敗** | A の `heavy-run.json`（ビルド失敗・ブラウザ起動失敗・レポート生成失敗） |

**「エラー経路はテストしていない」という一括表示を消す。** 各枠が 0 件のときだけ
その枠について未検証と書く。

### 8.2 Finance の内訳（§3.4）

`ShardSummary` に call シャード用の内訳を足す。

```ts
callBreakdown: {
  byOp: Record<string, { ok: number; SyntaxError: number; Overflow: number }>;
  byStratum: Record<string, number>;
  gaveUp: Record<"near_yen_boundary" | "compound_deposit_search_limit" | "other", number>;
}
```

`calls.spec.ts` が記録し、`report.ts` が出す。**`rejections` はシャードの
JSON が持っている**（B+C が理由別にする）ので、レポートは読むだけである。

レポートに出す最低限は指示書 §3.4 のとおり: 総件数・正常・SyntaxError・
Overflow・op ごとの内訳・`reference_gave_up` の理由別内訳。

**「Finance 2,000 件」を、すべて正常な金融計算であるかのように書かない。**

### 8.3 検証の強さを 3 つに分ける（§3.5 の延長）

現在は「外部参照」と「自己同値」の 2 枠がある。**`entry-000.json` は
どちらでもない**（4.1）。第 3 の枠を足す。

- **外部参照** — Python が独立に出した期待値との照合
- **自己同値** — 2 つのキー列が同じ表示に着くことの確認
- **仕様書からの写し** — `engine_table.rs` の規則から起こした期待値（入力途中）

3 枠目を作らずに 1 枠目へ混ぜるのが、レポートが一番静かに嘘をつく道である。

### 8.4 矛盾を見張るテスト（§3.6）

`report.spec.ts` に、指示書が名指しした 6 状態を個別に足す。

1. 指数表示あり／なし（**既にある**——`exponentDisplayCases` の 0/非 0 分岐）
2. Finance エラーあり／なし
3. UI テスト成功／失敗／**未実行**
4. core のみ成功
5. レポートの一部が生成されなかった状態
6. `reference_gave_up` が 0 件／1 件以上

**3 の「未実行」が肝である。** `heavy` と `heavy:ui` は別の走行で集計を共有
しないので（`report.ts:1484` がそう書いている）、UI の結果が無い走行と
UI が落ちた走行を区別できないと、レポートは「UI も通した」と読める顔になる。
**UI 側は別の走行なので、`heavy-run.json` には現れない。** 上で新設する
`heavy-ui-run.json`（押下キーと走行の成否を持つ）をレポートが読み、
「無い = UI は走っていない」「在って失敗 = UI が落ちた」「在って成功」の
3 状態を区別する。**2 枚とも無い走行では、レポートは両方を未実行と書く。**

## 9. 変更するファイル

| ファイル | 変更 |
|---|---|
| `reference/src/calcarc_reference/corpus_entry.py` | 新規。入力途中の表示（仕様書から） |
| `reference/src/calcarc_reference/corpus_errors.py` | 新規。エラー種別を数学の定義域から |
| `reference/src/calcarc_reference/corpus_assoc.py` | 新規。結合方向 |
| `reference/scripts/generate_corpus.py` | 3 シャードの追加、`corrections` に 2 形追加 |
| `reference/tests/test_corpus_entry.py` ほか | 新規テスト |
| `web/tests/heavy/corpus.ts` | `DisplayCase.expect.error` の受理 |
| `web/tests/heavy/display-cases.spec.ts` | エラー種別の照合 |
| `web/tests/heavy/report.ts` | §8.1〜8.3 |
| `web/tests/heavy/report.spec.ts` | §8.4、§7.7 の反転 |
| `web/tests/heavy/calls.spec.ts` | `callBreakdown` の記録 |
| `web/tests/heavy-ui/corpus-ui.spec.ts` | 押下キーの記録、必須キー優先サンプリング |
| `web/tests/heavy-ui/global-teardown.ts` | 新規。押下キーの検査と `heavy-ui-run.json` |
| `web/playwright.heavy-ui.config.ts` | `globalTeardown` の配線 |
| `web/tests/heavy-ui/finance-ui.spec.ts` | 新規。§7.2 |
| `web/scripts/detection-power.mjs` | `associativity-flip` の期待反転 |
| `corpus/generated/entry-000.json` ほか 3 枚 | 新規（`corrections-000.json` は再生成） |
| `docs/corpus-measurements.md` | 実測の記録 |

**`crates/` は変更しない。**

## 10. テスト計画

**Python** — 3 つの新シャードの生成テスト、`corrections` の新形が 1 件以上、
再生成一致。**エラーシャードは種別ごとに 1 件以上**（表に書いたのに 0 件、を許さない）。

**Heavy** — 新シャード 3 枚が照合を通る。`errors-000.json` は種別まで一致。

**赤確認**
- `associativity-000.json` を入れる前に `associativity-flip` の期待を反転すると
  **測定失敗で赤くなる**（A の判定が「期待シャードが読み込まれていない」を見る）。
  順序が逆だと静かに緑になりうるので、先に確かめる。
- 押下キーのテストを、必須キー優先サンプリングを入れる**前**に走らせて、
  **実際にどのキーが押されていないか**を実測する。指示書の 9 キーのうち何個が
  現状で押されていないかは、まだ誰も知らない。

**Heavy UI** — `heavy:ui` の増分を実測する（見込み 1 分未満）。

**検出力** — `associativity-flip` が新シャードだけを赤くすること。
**この変異は A の導入以降で唯一「期待を空から実体へ変える」もの**なので、
反転が正しく効いているかを実測で確かめる。

**フルスイープはブランチの末尾で 1 回。** ここは縦積みの最後なので、
A・B+C・D+E の全部を積んだ状態で指示書 §11 のコマンドを全部走らせる。

## 11. 完了条件

指示書 §10 のうち D+E が担うもの（残り全部）。

- [ ] レポートに既知の矛盾がない
- [ ] Finance の正常・異常・Overflow 件数が分離表示される
- [ ] 外部参照と自己同値（と仕様書からの写し）が分離表示される
- [ ] Rad・複素数・小数・EXP・ENG・DMS・**編集**・**エラー境界**が追加される
- [ ] 結合方向変異を最低 1 件以上検出する
- [ ] §8 の 9 キーが実画面で押されたことを測って主張している
- [ ] Finance の各モードが実画面を 1 往復している
- [ ] 既存の通常 CI・Heavy・Heavy UI がすべて成功する

## 12. 実装報告（指示書 §12）

**縦積みの末尾で 1 度だけ書く。** 3 つの spec すべての結果を含める。

- 変更ファイル一覧
- Finance の変更前後の正常／エラー／Overflow 件数（変更前は B+C §1 に実測済み）
- op ごとの正常計算件数
- `reference_gave_up` の変更前後（変更前: 探索限界 10・円境界 3）
- 新しく追加した Scientific 領域
- mutation ごとの検出件数（18 種）
- Heavy run の URL
- **残っている未検証領域**
- Finance が実金融機関一致ではなく決定的概算であることの再確認

報告書は `docs/` に置く。**`heavy-report.md` には書かない**——あれは初見の
読み手のもので、開発の経緯を持ち込まない（禁止語テストが見張っている）。
