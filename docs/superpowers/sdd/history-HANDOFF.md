# 履歴の実装 — 引き継ぎ（2026-09-03、マシン再起動のため中断）

## 0. 状態（2026-09-05 更新、再レビューの H-5 を直した）——**全ゲート緑**

**枝 `docs/history-plan`、`origin/main`（`a7bd0f9`）から積んでいる。作業木は汚れ 0 行。
push も PR もしていない。**

**最後のコード変更は `9e98d15`**——この節を更新したコミットはその後ろに積まれるので、
**枝の先端はここに書いた SHA より新しい**。先端は `git log --oneline -1` で取ること
（前の版はここに 1 つ古い SHA が残っていた。**自分自身の SHA を書ける文書は無い**）。

**私が回したゲート**（印字から）:

```
cargo test --workspace   "test result: ok" 20 本 / FAILED 0
cargo clippy --workspace --all-targets -- -D warnings   警告なし
cargo fmt --all -- --check                              差分なし
cd web && pnpm test      Test Files 38 (38) / Tests 453 passed
pnpm typecheck           error 0 件
pnpm lint                Checked 149 files, No fixes applied
pnpm check:boundary      OK（web→重量級 0 / calc→UI 0）
pnpm check:version       0.7.0（6 箇所が一致）
pnpm e2e                 203 passed
engine_table.rs の差分   0 行（電卓の挙動は不変）
```

**回していないもの**: `wasm-pack test`（Task 4 の 48/48 以降に `max_entry_len` と番人 2 本が
増えており未確認。CI が見る）、`pnpm heavy:ui`（**盤面を通る走行は回していない。見立てで
あって実測ではない**）。`pnpm heavy` 側は実測して不変——`j` 5189 / `▸∠` 1995 / 46 個すべて押下。

### ★ 同じ欠陥が 6 回入り、7 回目を構造で止めた

**`spell` が「engine がやっていない効果」を式に主張し、式が自分の答を生まなくなる**——
この 1 つの族が **6 回**入った: `zeros3` の `del` → 演算子の `del` → `dms` → `j`/`Exp` の `del`
→ 字数上限・指数の符号ほか → `eq` が持ち越しを読むこと。

**毎回、直し方が「engine の振る舞いを手で写す」だった。** 5 回目の前に `Buffer`
（`state.rs:129-395`）を読んで**全部の振る舞いを数えたら 16 件中 13 件が未写し**で、
**うち 6 件は誰も報告していなかった**。**つまり 5 回目を直しても 6 回目が来る形だった。**

**利用者の裁定で、写すのをやめた。** `spell` が**本物の `Buffer` を 1 つ持ち**、同じキーを
流し込み、値の部分を **`buffer.text()`** で綴る（`58995ec`）。決め手は `text()` 自身の註
——「**打鍵した通りに見せる**」。**§4a から離れるのではなく、§4a を engine 自身の実装で
満たす**形である。**13 件が写しではなく同一物になり、ずれようがなくなった。**

**直す前、表の 13 行のうち 11 行が実際にずれていた。**

### ★ 7 口目は `spell` ではなく web に居た（H-5、再レビューで発見）

**上の構造変更は `spell` の口を閉じたが、族そのものはもう 1 口あった。** 場所は
`web/src/ui/ScientificPanel.tsx` の `press` の門番である。

門番は「いまエラーか」を **effect で `step` から写した ref**（`errorRef`）から読んでいた。
その写しは**同じイベントハンドラの中では更新されない**——passive effect が流れるのは次の
離散イベント（クリック・keydown）の前だからである。**「1 打鍵 = 1 つの離散イベント」が
成り立つ限りは正しく**、盤面の打鍵はすべてそうなっている。**例外は `recall` ただ 1 つ**で、
あれは 1 つのハンドラの中で `ac` と答のキーを同期に連打する。そこで写しは古い `true` の
まま読まれ、**`ac` は通るのに続く呼び戻しのキーが `keysRef` に積まれなかった**。`dispatch`
は門の外なので engine には全キーが届く——**表示だけが進む**。

エラー表示のまま `2` を呼び戻して `3 =` と打つと、**式「3」・答「23」**。**式が自分の答を
作れない**——族の定義そのものである。

**直し方も同じ教訓に従った。**「AC はエラーを晴らす」を `ac` の分岐に同期で書き足せば
この 1 経路は直るが、それは**engine の振る舞いを手で写す作業をもう 1 回やること**である。
**写しをやめて、engine が返した `Step` を直接持つ**（`stepRef`、`99d0310`）。門は毎回
`display.error` を読むので**写しの鮮度という概念が無くなり**、反対向きのずれ（ハンドラの
途中でエラーに**入った**のに古い `false` を読む）も同時に消えた。

**教訓の形は 6 回と同じ**——「engine の状態を別の場所に持つと、そのコピーはいつか腐る」。
違うのは腐り方が**時間差**（effect の流れる瞬間）だったことだけである。

### 帰結（利用者に示して承認済み）

- **指数の符号は `1.5e-3` と綴る**（以前は無音で、`1.5 Exp 3 = 0.0015` という 1000 倍嘘の行ができた）
- **`j` は末尾に付く**——`3 + 5j`（以前は `3 + j 5`）。engine の表示と同じ綴り
- 仮数の符号は `+/−` のまま（`Buffer` の外で処理されるため）。**符号の綴りが仮数と指数で
  揃わないことは、示したうえでの裁定**

### 置いた番人

| 何を守るか | どこ |
|---|---|
| 綴りと engine の表示が 13 の振る舞いで一致 | `crates/calcarc-core/tests/spell_table.rs`（`assert_entry` が同じキー列を `reduce`/`render` に流して突き合わせる） |
| 綴りと盤面のラベル（固定字形のキーだけ） | `crates/calcarc-wasm/tests/label_parity.rs`。値のキー 13 個は**理由つきで除外**、比較下限 `46−7−13=26` をコードから導出 |
| **持ち越しを読むキーの集合**が engine とずれない | `crates/calcarc-wasm/tests/carried_value_parity.rs`。**振る舞いから導出**して TS の一覧と突き合わせる。**穴も docstring に明記** |
| `hist` が Shift の裏から届く | `web/tests/e2e/history.spec.ts`（重量級の到達性検査は `token: null` のキーを見ない） |
| **エラー中の呼び戻しが式に入る**（H-5） | `web/src/ui/ScientificPanel.test.tsx`「records the keys a recall sent while the display was in an error state」（偽 Calc、機構だけ）と `web/tests/e2e/history.spec.ts`「a recall made while the display was in an error state…」（実 WASM）。**両方とも `errorRef` + effect の形に戻して赤を実測** |
| `localStorage` を掴むのは 1 ファイル | `web/src/ui/storage.test.ts` |

### 残した論点 1 件（裁定済み・受け入れ）

**`3 × ( DEL =` の綴りが `3 ×` で、答 `0` を説明しない。** `(` は `state.current` を 0 へ
**副作用として**倒すので、**その 0 に対応する打鍵が存在しない**。埋めるには打っていない
記号を発明することになる。答そのものは常に正しい。

### 裁定（`=` の前のエラー）

**`=` の前に起きたエラーは 1 件も記録しない**（`0 1/x`、`1 . 5 .`）。1 件は「`=` で完了した
計算」であり、`=` が押されていないので件が存在しない。§D-1 の「エラーは残す」は
**完了した計算の答がエラーだった場合**（`1 Exp 309 =`）を指す。

### ★ 全ゲートが緑のまま、この族を 1 件も捕まえなかった

6 回とも、**私のゲートは全部緑だった**。捕まえたのは**レビュー役が書いた探針テスト**
（`spell` と engine を直接突き合わせる）である。**「ゲートが全部緑」と「出して大丈夫」は別。**
`carried_value_parity.rs` は、その探針の手法を**常設の番人にしたもの**である。

**7 回目（H-5）も同じだった。** 全ゲート緑・E2E 203 本緑のまま、レビュー役の jsdom 探針
だけが捕まえた。**E2E にその経路の検査が無かったから**である——「エラー表示のまま履歴を
開いて呼び戻す」という列を誰も書いていなかった。**緑は「そこを見た」ではなく「見た範囲で
赤が無かった」**にすぎない。

---

## 1. 誰が、どこで

**実装役**（セッション名 `calcarc-3b`）。作業台は **`/home/terapyon/dev/CalcArc`**、
枝は **`docs/history-plan`**。`/home/terapyon/dev/CalcArc-e2e` には触っていない。

実行方法は **Subagent-Driven**（段ごとに実装エージェント → レビュー → 直し）。
台帳は **`.superpowers/sdd/2026-09-03-history/progress.md`**
——**あれはクローンごとのローカル除外なので他のセッションから読めない**。
**この引き継ぎが読める唯一の記録である。**（裁定は §5 に写してある。）

読む順: `docs/superpowers/specs/2026-09-03-history-design.md`（裁定版の設計書）→
`docs/superpowers/plans/2026-09-03-history.md`（13 段の計画。**Task 1〜6 の
`- [x]` は付けてある**）。

## 2. どこまで終わったか

**Task 1〜6 は完了**（レビュー済み・緑）。`origin/main` = `a7bd0f9` から 13 コミット。

| コミット | 何 |
|---|---|
| `15746cc` | 設計書を裁定版に（**push 済み。`docs/history-decided` にも在る**） |
| `8d0fdd9` | 設計書の誤り 3 件を訂正（GRAD／`√` 前置／golden の置き場） |
| `0b1ac00` | 計画 13 段 |
| `be3fb25` | 裁定 2 件（エラーは残す／同じ内容は積まない）を計画に折り込み |
| `9e655b9` | **Task 1** 盤面が `action` を送れるようにする（`KeyAction`・`onAction`） |
| `8d94c57` | **Task 2** core の綴り純関数 `engine::spell::spell` |
| `b89a093` | **Task 2 直し** `del` を数の並びでは 1 文字にする |
| `81791ac` | **Task 3** 綴りと盤面ラベルの parity（`label_parity.rs`） |
| `8768431` | **Task 4** WASM 境界に `spell_keys`、TS の `Calc.spell` |
| `3f099f2` | **Task 5** `web/src/history/`（貯める・捨てる・上限 50） |
| `66f9971` | **Task 6** `localStorage` の掴み手を `web/src/ui/storage.ts` に 1 つへ |
| `60581a6` | **Task 6 直し 1** 番人を「参照」検出に（語の出現ではなく） |
| `de28e09` | **Task 6 直し 2** 番人の穴の説明を正し、`globalThis.` も拾う |

## 3. ★ 作業木が汚れている — **Task 7 の途中で止まった**

**追跡下に未コミットの変更が 3 ファイルある**（`git status` で見える）:

```
M web/src/settings/index.test.ts
M web/src/settings/index.ts
M web/src/settings/types.ts
```

**Task 7（設定に `history.enabled` を足す）の作業中**に再起動が入った。
中身は `HistorySettings { enabled: boolean }` の型・既定 `true`・
読み込みの白リスト・テスト 4 本の追加で、**Step 1〜3 相当まで進んでいる**。

**緑かどうかは確かめていない**（`pnpm test` を回す前に止めた）。
**再開する人は、まずここを検査してから続けること**——
`cd web && pnpm test src/settings/ && pnpm typecheck && pnpm lint`。
**捨てて Task 7 をやり直しても損は小さい**（40 行ほど）。

## 4. 次にやること 1 行

**Task 7 の未コミット分を検査して緑にし、コミットしてから Task 8 へ進む。**
（Task 7 と 8 は 1 つの発注にまとめてあった。Task 8 は `scientific.ts` の
`j` の `shift:` に `hist` を置くだけ。）

## 5. 裁定と申し送り（**台帳が読めないので、ここに写す**）

### 済んだ裁定

1. **`pow`/`n_p_r`/`n_c_r` は盤面のラベル**（`xʸ`/`nPr`/`nCr`）を綴る。
   `display.rs` の `op_symbol` は同じ演算子を `^`/`P`/`C` と綴るので、
   **エコー行と履歴で同じ計算が違う綴りになる**。それでもラベルを採ったのは、
   例外表を作ると parity が「N 個は一致、M 個は例外」になって静かに古くなるから。
   **実物の一覧を見て読みにくければ 1 行で変えられる。**
2. **`del` は「数の並びなら 1 文字、それ以外は打鍵 1 つ」。**
   `engine_table.rs:168` が `main_of(["1","zeros3","del"]) == "100"` を固定しており、
   綴りが `"1"` を返すと**式が自分の答を生まない 1 件**ができる。
3. **`currency/cache.ts` の註だけは直してよい**（Task 6）。あの註は
   「localStorage を掴むのは `useSetting.ts` だけ」と書いており、**Task 6 でそれが偽になった。**
4. **`useSetting.ts` の註は「ブラウザの Storage」のままでよい**——
   あのファイルは**もう掴み手ではない**ので、一般名で `storage.ts` を指すのが正しい。
5. **隔離ワークツリーを作らない**——2 セッションで 1 ワークツリーを共有する規約に従い、
   枝を切るだけにした。

### ★ Task 10 への申し送り（**忘れると静かに壊れる**）

**`web/src/ui/ScientificPanel.test.tsx` の偽 `Calc` に `spell: () => ""` の栓がある**
（Task 4 で型を満たすために入れた）。**この栓のまま Task 10 の否定形テスト
（「記録されないこと」）を書くと、式が常に空になり `pushEntry` の
「空の式は積まない」で全件落ちて、いつでも緑になる。**
**Task 10 は、この栓を実際の打鍵を反映する綴りに替えてから否定形を書くこと。**

### 据え置きの minor（最後の全体レビューで捌く）

- Task 1: `token` と `action` を両方持つ面を書くと token が黙って捨てられる（型で塞いでいない）
- Task 3: `SEVEN_SILENT` の除外と `spelled.is_empty()` の除外が冗長
- Task 5: 重複判定が 3 欄だけを見ることを固定するテストが無い（`error` だけ違う 2 件を試していない）
- Task 5: 報告文の「settings の形に合わせた」は言い過ぎ（白リストの流儀は同じだが、
  settings は欄ごとに既定へ倒し、history は 1 件ごと捨てる）

### 実測して閉じたもの

- **50 件の実バイト数 ≒ 10,876 バイト（10.9 KB）**（Task 5）。
  `localStorage` の枠に対して十分小さく、件数で切る判断は妥当（設計書 §13-7 を閉じる）。
- **`=` の連打は繰り返さない**——`2 × 3 = = =` は 6 のまま。
  `engine/` に `last_op` に当たる状態が無く、`finish` が `operands` を空にする。

## 6. まだ触っていない段

**Task 8〜13**: `hist` キーを盤面へ／履歴の面／`ScientificPanel` の配線／
E2E 1 本／`base-spec.md:1035` と README／重量級の確認。

**Task 13 で押下台帳の数が動いていたら、先に進まず監視役（`calcarc-52`）に言うこと。**
見立ては「動かない」（`hist` は `token: null`、退けたキーも無い）。

## 7. 規約（変わっていない）

- **`git push` と PR 作成はしない。** コミットまで
- **コミット前に `git branch --show-current`。** `git add -A` を打たない
- **赤確認は一時コミットしてから壊し、戻しは再編集**（`git checkout <file>` を使わない）
- **UI を触ったら撮って見る。** `hist` は Shift の裏なので、Shift を押した絵が要る。
  **撮ったら preview を落とす**（`ss -lptn 'sport = :4179'` で pid を特定）
- **長い Playwright（`heavy:ui`）は手元で回さない**

## 8. Task 10・§13-8 の現在地 — 2026-09-03、Fix round 1・2 で追記

**Task 10(`ScientificPanel` の配線)は完了・レビュー2 巡目の直しまで済み。**
コミットは `docs/history-plan` に積んである（`76570a4` 本体 + Fix round 1・2
の直しコミット）。台帳は `.superpowers/sdd/2026-09-03-history/task-10-report.md`
——**あちらはクローンごとのローカル除外**なので、§13-8 の結論だけはここに写す
(このファイルが「他のセッションからも読める唯一の記録」という §1 の原則に従う)。

### §13-8(呼び戻しは手打ちと同じ状態になるか)—— **2026-09-03、Task 11 で閉じた**

**追記(Task 11)**: 下の節(vitest・偽 `Calc`)が「狭めたが閉じていない」と
書いていた**実 WASM での確認**を、Task 11(E2E)で行った。

- **走らせたもの**: `web/tests/e2e/history.spec.ts` の
  `a recalled negative decimal behaves like the same digits typed by hand,
  on the real WASM core`。`cd web && pnpm wasm` のあと
  `pnpm exec playwright test tests/e2e/history.spec.ts`(実 WASM・実ブラウザ)。
- **やったこと**: `3 − 3.5 = -0.5`(負・小数を含む、非自明な値)を計算して
  記録し、履歴から呼び戻したあとに `3` をもう 1 打鍵した結果の
  `display-main` と、`ac` のあと `0`・`.`・`5`・`+/−`・`3` を手で打った結果の
  `display-main` を比較した。両者は `press` に送る打鍵列がトークン単位で
  一致する(`recall` は `ac, 0, dot, 5, neg` を送り、手打ちも同じ 4 トークン
  になる)ので、これは実 WASM の `dispatch` が同じキー列に対して決定的で
  あることの確認になる。
- **結果**: **一致した(緑)**。`pnpm exec playwright test`(全 198 本、
  history の 3 本を含む)・`pnpm lint`・`pnpm typecheck` もすべて緑
  (2026-09-03 実測)。
- **赤確認も別途行った**: `scientific.ts` の `j` の `shift` を一時的に外すと、
  この 3 本(history.spec.ts 全体)が失敗することを確認し、再編集で戻した
  (`git diff` で無変化を確認)。これは §13-8 とは別の主張(`hist` の到達性)
  の番人だが、同じコミットで両方を確認した。

**閉じた理由**: 「呼び戻しは手打ちと同じ `press` コールバックを通る」という
コードの構造上の性質(下記)に加え、**実 WASM の計算コアがその打鍵列に対して
手打ちと同じ表示に決定的に落ち着くこと**を実機で確認した。これで
「コードの経路としては一致するが実機は未確認」という保留が外れる。

以下は Fix round 1・2(vitest・偽 `Calc` に対する検証)の記録——**狭めた、
閉じてはいない**という結論は Task 11 以前の時点のものとして、そのまま残す。

**確かめたこと**: `web/src/ui/ScientificPanel.tsx` の `recall` は、答の文字列を
キー列へ写したあと、手打ちと**同じ `press` コールバック**を `ac` → 各キーの順で
呼ぶだけで、呼び戻し専用の `dispatch` 経路を持たない。つまり**コードの構造として**、
呼び戻しは「手で打ったのと同じキー列を代わりに送っている」。

`web/src/ui/ScientificPanel.test.tsx` の
`narrows whether a recalled answer behaves like the same digits typed by hand
(does not close it)` は、`0.5` を呼び戻した状態と `0` `.` `5` と手で打った状態を
比べ、それぞれもう 1 打鍵した結果の `display-main` が一致することを見た(緑)。

**確かめていないこと・閉じていない理由**: この比較は **vitest 上の手書きの偽
`Calc`**(digit・`dot`・`neg`・`exp`・`ac` だけを実装した最小限のもの)に対して
行った。**実 WASM の計算コア(`crates/calcarc-core`)に対して、ブラウザ上で
同じ比較をしたことは無い。** 「呼び戻しも手打ちも同じ `press` を通る」という
コードの性質は本物のエンジンに対しても変わらないはずだが、それは**構造からの
推測**であって実測ではない。**実機での確認は Task 11(E2E)の持ち物**にする
——閉じるにはブラウザで WASM を読み込んだ状態の比較が要る。

### Fix round 1(3 件、Important)への対応

1. **写せない答の形——指数が負のケースは普通に起きる。** `crates/
   calcarc-core/src/numeric/format.rs` の `EXP_LOW_EXPONENT = -9` により、
   絶対値が 1e-9 未満の答は指数が負のまま表示される(大きい数で割るだけで
   届く)。以前の実装はこれを「先頭以外の `-`」として一律 `null`(写せない)
   にしていたが、それは一覧上は成功した行と同じ `<button>` に見えるため、
   押しても静かに何も起きないボタンを作っていた。
   - **`engine_table.rs:125`
     (`the_sign_key_follows_the_exponent_while_one_is_open`)を読み、
     「`neg` は指数入力中なら指数の符号、そうでなければ確定値(仮数)の符号」
     という規則を確認**した上で、`mapAnswerToKeys` を仮数の符号と指数の符号を
     独立に扱う形に直した(仮数の符号は `exp` を送る前、指数の符号は指数の桁を
     送った後)。`-1.5e-3` / `1.5e-3` / `-3,628,800` を含むテストを追加。
   - **それでも写せない形は残る**(虚数 `j`・極形式 `∠`・60 進 `°′″` の
     ような、数字キーの列そのものでは表せない綴り)。**回避する仕掛けは
     作らない**という判断は変わっていないが、**どう見せるかは Fix
     round 2 で直った**——下の「Fix round 2」節を見ること。当初は
     `HistoryEntry.error = true` を借りて表したが、それは**指摘の通り
     誤りだった**(このファイルの直前の版に残っていた記述もその誤りを
     含んでいたので、ここで訂正する)。
2. **測定結果の置き場所**——本節がその対応(この節自体が §2 で指摘された
   「引き継ぎに書く」の実行)。
3. **報告の見出しと minor のテスト**——`task-10-report.md` の見出しを
   「§13-8 を閉じる」から現在地に合わせて訂正し、リード文も「一致する」から
   「コードの経路としては一致する(実機は未確認)」に直した。「切っている
   あいだは記録しない」テストは、**切る前に 1 件記録してから切る**形に
   直し、`pushEntry` ごと壊れていても緑になる形を潰した。

### Fix round 2(1 件、Important)への対応

**指摘**: Fix round 1 で選んだ「写せない答は `HistoryEntry.error = true`
として積む」は、**指摘の通り誤りだった**。`History.module.css` の
`.entry[data-error]` は `--error-fg`(失敗の色)を塗るので、`3+4j` のような
**成功した**複素数の答が、失敗したかのような色で一覧に出てしまっていた。
「計算が失敗した」と「この答は入力へ戻せない」は別の事実であり、同じ欄に
混ぜてはいけない。

**直した形**: `HistoryEntry` は触らず(`web/src/history/types.ts` は今回も
対象外)、`History` に新しい prop `canRecall: (entry: HistoryEntry) =>
boolean` を足した(コーディネーターの許可でこの回だけ `web/src/ui/
History/History.tsx` と `History.module.css` に触った)。

- **行が `<button>` になるかどうかは `canRecall(entry)` だけで決まる**
  ——エラーで終わった行(`Math ERROR`)も、成功したが写せない行も、
  ここでは同じに扱ってよい(どちらも `mapAnswerToKeys` が `null` を返す)。
- **エラーの色(`data-error`)が付くかどうかは `entry.error` だけで決まる**
  ——`canRecall` とは完全に独立。
- `ScientificPanel` は `canRecall={(entry) => mapAnswerToKeys(entry.answer)
  !== null}` を渡し、記録する `HistoryEntry.error` は
  `step.display.error !== null` のまま(`history/types.ts` の本来の意味に
  戻した)。

テストを追加: `History.test.tsx` に「`error: false` だが `canRecall` が
`false` を返す答は、ボタンにならず・エラー色も付かず・それでも削除できる」
を確認する 1 本。`ScientificPanel.test.tsx` の複素数(`3j`)テストは、
記録された `HistoryEntry.error` が `false` のままであること・一覧の行に
`data-error` が付かないことを確認する形に直した。

### 次に触る人へ

- **`mapAnswerToKeys` に虚数・極形式・60 進の変換を足す判断はしていない。**
  足すなら `mapAnswerToKeys` を広げるだけでよい——`canRecall` はそれを
  そのまま使っているので、`HistoryEntry` 側の設計をやり直す必要は無い
  (Fix round 2 で `error` の借用をやめたため)。
- **§13-8 は Task 11(E2E)で閉じた(2026-09-03)。** `pnpm e2e` の軽い方
  (`playwright test`)で足りた——`heavy:ui` を回す必要は無かった。詳細は
  この節の先頭「2026-09-03、Task 11 で閉じた」を見ること。
