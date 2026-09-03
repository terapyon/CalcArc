# 履歴の実装 — 引き継ぎ（2026-09-03、マシン再起動のため中断）

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

## 8. Task 10・§13-8 の現在地 — 2026-09-03、Fix round 1 で追記

**Task 10(`ScientificPanel` の配線)は完了・レビュー1 巡目の直しまで済み。**
コミットは `docs/history-plan` に積んである（`76570a4` 本体 + Fix round 1 の
直しコミット）。台帳は `.superpowers/sdd/2026-09-03-history/task-10-report.md`
——**あちらはクローンごとのローカル除外**なので、§13-8 の結論だけはここに写す
(このファイルが「他のセッションからも読める唯一の記録」という §1 の原則に従う)。

### §13-8(呼び戻しは手打ちと同じ状態になるか)—— **狭めた。閉じてはいない**

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
     作らず**、**記録した時点で** `mapAnswerToKeys` の結果を見て
     `HistoryEntry.error = true` として積む選択をした——`web/src/ui/
     History/History.tsx` と `web/src/history/types.ts` は Task 10 の対象外
     ファイルで新しい欄を足せないため、既存の「エラーで終わった計算は
     押せない・でも見える」枝を「(この実装では)入力へ戻せない」に意味を
     広げて借りている。**`error` フィールドの本来の意味
     (`CalcErrorCode` が出たかどうか)とは別物であり、これは意図的な
     借用であって仕様の変更ではない**——`web/src/history/types.ts` の
     doc comment はそのまま(対象外)なので、次にあの型へ触る人はこの
     借用を知っておく必要がある。
2. **測定結果の置き場所**——本節がその対応(この節自体が §2 で指摘された
   「引き継ぎに書く」の実行)。
3. **報告の見出しと minor のテスト**——`task-10-report.md` の見出しを
   「§13-8 を閉じる」から現在地に合わせて訂正し、リード文も「一致する」から
   「コードの経路としては一致する(実機は未確認)」に直した。「切っている
   あいだは記録しない」テストは、**切る前に 1 件記録してから切る**形に
   直し、`pushEntry` ごと壊れていても緑になる形を潰した。

### 次に触る人へ

- **`mapAnswerToKeys` に虚数・極形式・60 進の変換を足す判断はしていない。**
  足すなら、まず `HistoryEntry` に「押せない理由」を持たせるかどうかから
  設計し直す必要がある(`error` の借用をやめられる)。
- **§13-8 を本当に閉じるには、Task 11(E2E)で実 WASM に対して同じ比較を
  すること。** `heavy:ui` は手元で回さない規約なので、Playwright の軽い方
  (`pnpm e2e`)で足りるはずだが未確認。
