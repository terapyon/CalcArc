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
