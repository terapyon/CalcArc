# 引き継ぎ: 0.3.0 の計算の検証（完了・push 待ち）

> **クリア/再起動の直後は、ファイルを 1 つも変える前にまず監視役（Fable）へ点呼する。**
> **cwd と起動時の git status を役割の根拠にしない**——3 セッションとも process cwd は
> `/home/terapyon/dev/CalcArc` で、クリア直後の手がかりは**全部が実装側を指す**。
> 一次資料は**クリア前の自分の transcript**（`~/.claude/projects/-home-terapyon-dev-CalcArc/*.jsonl`
> を mtime 順、自分のセッション id の直前に終わっているものの最初のユーザー発言）。

## 1. いまの状態

| | |
|---|---|
| ブランチ | **`feature/verify-0-3-0-calculations`** @ **`234b94e`** |
| BASE | `origin/main` = **`f1fdc2e`**（PR #60 のマージ地点。0.3.0 のアプリ + 重量級の検証一式） |
| 規模 | **11 コミット**。`crates/` の差分は**テスト 18 行のみ**、`web/src/` は **0 行** |
| 状態 | **監視役の厳格読み = 無条件 Approved。ユーザーの push 待ちで静止**（0.3.1 と一緒に案内される予定） |
| 作業ディレクトリ | `/home/terapyon/dev/CalcArc-e2e`。**`/home/terapyon/dev/CalcArc` は実装側が使用中なので触らない** |

**`git push` と PR 作成は行わない**（ユーザー専権）。コミット末尾は
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。

## 2. この検証が出した地図（成果物）

`docs/corpus-measurements.md` に 3 節（Task 3・4・6）。**6 種の変異それぞれを、どの層が捕まえるか。**

| 変異 | 赤 | 見張っている層 |
|---|---:|---|
| 基数 1024→1000 | 2 | 単体（**今回追加**）+ golden |
| 華氏オフセット | 3 | 単体 2 + golden |
| um の係数 | 1 | **golden だけ** |
| 丸め half-even→up | 2 | 単体 1 + golden |
| kv の 2 倍 | 5 | 単体 4 + golden |
| ビット→バイトの端数 | 2 | 単体 1 + golden |

**足したのは単体テスト 1 件と Layer 5 e2e 6 件だけ。golden は 1 件も足していない**
——測ったら足す必要が無かった（ユーザーの「網羅的なテストは不要」の履行）。

**最後の緑の値**: cargo **374** / wasm-pack(Firefox) **34** / vitest **365** /
Layer 5 e2e **170**（12.5 秒）/ pytest **362** / `pnpm heavy` **195** /
`heavy:power:exact` **6/6**（139 秒）。**ローカル wasm = Firefox / CI = Chrome。**

## 3. 未了（この spec の外に出したもの）

- **注入による確認が 1 件未了。** 「変異 1・4 は重量級に**構造的に見えない**」は**導出**であって
  注入の実測ではない（実装者が試みたが走行が sandbox に拒否された）。導出の根拠:
  重量級の call ケースの op は `data_scale` 2000 + finance 系のみで **convert・llm・transfer は 0 件**、
  かつ `expect.binary` の 1984 件のうち**基数が効く帯に入るのは 3 件だけで 3 件とも最上位単位 TiB**
  （`scaled()` の再選択は `index + 1 < units.len()` に守られ、最上位では効かない）。
  **確かめるなら、変異 1 を当てて `pnpm heavy` を 1 度回すだけ**（1 分未満）。
- **`micrometre-off-by-thousand` は golden だけが見張っている。** 足さない判断を記録済み
  （係数表 63 行に対し golden が 63 単位すべてを覆う。1 行だけ literal 固定するのは恣意的で、
  **この spec 自身が「表の literal 固定は変異を下の層で止める」と実証した形**）。

## 4. 新しく使えるようになった道具

- **`pnpm heavy:power:exact`**（`web/scripts/exact-power.mjs`）——変異を当てて `cargo test` を回し、
  **赤くなったテスト名の集合**を期待と突き合わせる。**両側を主張する**（期待した赤が出ること
  **と**、期待していない赤が出ないこと）。実測 **139 秒 / 6 変異**。
- **`runOneMutation(mutation, { root, measure, verdict })`** の注入口——**変異を当てて戻して
  バイトで確かめる手続きを 1 か所に保ったまま**、測り先と判定を差し替えられる。
  既存 18 種のシャード変異は**バイト一致の記録**を出す（分岐で保証済み）。

## 5. この計画で私（発注側）が間違えた 6 件と、その型

**監視役の診断: 体制の問題ではない。型は「測っていないものを断定形で書いた」に集中している。**
とくに悪い 2 件は**別システムの挙動についての断定**だった。

1. 計画のテストコードが**そのファイルでは原理的に成立しない**（`node:fs` がモジュールごとモック）
2. **基準値が古い**（旧ブランチの vitest 263 を新 BASE の計画に持ち込んだ。実測 354）
3. **赤確認が空振り**（`$` を落としても赤くならない。守っていたのは ` ... ` の区切り）
4. 測定時間の見積り（「約 1 分」／実測 139 秒）
5. 繰り上がりの**手計算**（`0.9 TiB` と書いたが実測 `1.0 TiB`）
6. **「変異 1・4 は重量級にも見えるはず」**（構造的に見えない）

**規則（レビュー標準に採録済み）: 「別システムがどう見るか」を plan に書くときは、
Step 0 の実測を付けるか、（未確認）の印を付ける。** 同じ型が 2026-08-20 だけで 3 回出た
（重量級に見えるはず／Finance は欄入力／CI にフォントを入れれば直る）。

## 6. 関連する台帳

- この spec: `.superpowers/sdd/2026-08-20-verify-0-3-0-calculations/progress.md`
- 直前の仕事（重量級 D+E、マージ済み）: `docs/superpowers/sdd/heavy-HANDOFF-de.md` と
  `.superpowers/sdd/2026-08-19-heavy-scientific-ui-report/progress.md`
- **`.superpowers/` は `.gitignore:15` が丸ごと無視している。** `git show` では読めないので、
  ファイルを直接読むこと。
