# 引き継ぎ: D+E の続き（2026-08-20、Task 3/11 完了時点）

> **クリア/再起動の直後は、ファイルを 1 つも変える前にまず監視役（Fable）へ点呼する。**
> **cwd と起動時の git status を役割の根拠にしない**——3 セッションとも process cwd は
> `/home/terapyon/dev/CalcArc`（重量級だけが絶対パスで `CalcArc-e2e` を触る）なので、
> クリア直後の手がかりは**全部が実装側を指す**。2026-08-20、それで自分を実装側だと
> 誤認し、隣のセッションの作業台（赤確認の変異が当たっている最中）を触った。
> 自力で確かめるなら一次資料は**クリア前の自分の transcript**
> （`~/.claude/projects/-home-terapyon-dev-CalcArc/*.jsonl` を mtime 順、
> 自分のセッション id の直前に終わっているものの最初のユーザー発言）。

このファイルは**セッションがクリアされても D+E を再開できる**ことだけを目的に書いた。
読む順は上から。詳細な判断の履歴は各 spec の `progress.md` にある。

## 1. いまの縦積み

| ブランチ | tip | 状態 |
|---|---|---|
| `feature/heavy-power-measure`（spec A） | `2651189` | 完了 |
| `feature/heavy-finance-strata`（spec B+C） | `2b2c6a0` | **完了**（Task 12 のフルスイープまで緑） |
| `feature/heavy-scientific-ui-report`（D+E） | `bf93213` | **完了（Task 11/11）。フルスイープ全緑・実装報告済み。push 待ちで静止** |
| `feature/heavy-corpus-hardening` | `b223bde`（= main） | 最後にここを縦積みの tip まで進めて 1 PR にする |

- 作業ディレクトリは **`/home/terapyon/dev/CalcArc-e2e`**。
  **`/home/terapyon/dev/CalcArc` は別セッション（実装側）が使用中なので触らない。**
  読み検証は `git show` / `git worktree add` で行う。
- **`git push` と PR 作成は行わない。** 縦積み最終まで済んだら監視役の厳格読み →
  ユーザーの push 待ちで静止する。
- コミット末尾は `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。

## 2. D+E の続きから

rebase は済んでいる（`8663b5f` → `955542b`。重複していた B+C 設計書のコミット
`ab367a0` は patch-id が一致したので git が skip した）。plan も
`docs/superpowers/plans/2026-08-19-heavy-scientific-ui-report.md` にコミット済み
（`279d5db`）。設計書は
`docs/superpowers/specs/2026-08-19-heavy-scientific-ui-report-design.md`。

**次は Task 8「レポート — Finance の内訳（§8.2）」**（plan の「### Task 8」を grep）。BASE は `979f5db`。

**Task 4 で分かった、Step 1 の書き方の訂正**: plan と設計書は「シャードを置かずに期待だけ
反転すると**判定 4** で `measurement-failed` になる」と書いていたが**偽**である。
`detection-power.mjs:653` の判定 4 は `shardsSeen` と `ALL_SHARDS` の一致しか見ない。
実際は `caught-nothing`（測定の失敗が検出力の欠如として報告される）。Task 4 で静的な
不変条件（`expectShards ⊆ ALL_SHARDS`）をユニットテストに置いて塞いだ。

### 済んだ Task（各 Task の判断は
`.superpowers/sdd/2026-08-19-heavy-scientific-ui-report/progress.md` に全部ある）

| Task | commit | 中身 |
|---|---|---|
| 1 | `d85ff85` + `766ed4e` | `entry-000.json` 36 件（打鍵途中の表示） |
| 2 | `4a6347c` + `2ce03a4` | `errors-000.json` 30 件（エラー種別） |
| 3 | `e0f77b8` + `4f680e5` | `corrections-000.json` に 2 形・4 層 |
| 4 | `03ecd7d` | `associativity-000.json` 2000 件（平坦 1000 + 括弧の双子 1000）+ レポートの撤回 |
| 5 | `6158e52` + `722d1ab` + `7792bc7` | Heavy UI の押下記録・二層の主張・必須キー優先サンプリング |
| 6 | `12149c8` + `ad58e4d` | Finance 8 面 × 正常/異常 16 件を実画面から。エラーは `data-error` で見る |
| — | `0b19e9d` | 要約行の flake を印字の桁から直した（reference のテスト 1 本） |
| 7 | `979f5db` + `aa32388` | エラー経路を **6 枠 + 番兵**に。`errorKinds` で種別ごとに数える |
| 8 | `60d5fe5` + `493551d` | 「55 本が `=` を押さない」の最小修正 + Finance の内訳（op 8・種別 3・棄却理由） |
| 9 | `61491a1` | 検証の強さを 3 枠に。**旧見出しの 36 件水増しを是正**（28,275 → 28,239） |
| — | `0b19e9d` | `reference/` の既存 flake（要約行の 1 件あたり ms）を独立コミットで修正 |
| 7 | `979f5db` | エラー経路を 5 枠に。`errorCases` → `errorKinds`（種別ごと）。番兵つき |

いまの検査の緑の値（**Task 11 のフルスイープ実測**）: **cargo 304 / wasm-pack(Firefox) 28 / vitest 263 / Layer 5 e2e 132 / pytest 311 / `pnpm heavy` 195 / `heavy:power` 18/18 / `heavy:ui` 36 / corpus 再現性 2 / typecheck・lint 緑**。
コーパスは **18 枚 33,567 件**。

### 発注（subagent）で毎回渡すこと

- 検証コマンドに **`pnpm test`（vitest）を必ず入れる**。Task 1 でこれを落として
  赤を 1 つ持ち越した。
- 「**待つ通知は存在しない。判断に迷ったら停止でなく事実を報告**」を書く。
  書かないと「通知を待ちます」と言って turn を終える。
- 「**実測を計画に合わせない。食い違いはそのまま報告**」を書く。
- 1 行目のあとに**空行**を入れる（commit の件名が本文と繋がる事故があった）。
- **plan の行番号は書いた日の座標。発注のたびに grep で当て直し、発注文には
  行番号ではなく検索語を書く。** 実例 2 件: Task 1（`:69` は関数宣言行）、
  Task 4（`report.ts:1407`/`:1463` が別の枝。現物は「`xʸ` の右結合と優先順位 4」）。
- **`.superpowers/` は `.gitignore:15` が丸ごと無視している。** 台帳も引き継ぎも
  追跡対象外なので、コミットに含めるよう指示しない（`git add -f` を誘発する）。

### この 3 Task で繰り返し出た型（差し戻しの判断基準）

**緑にするために入力を削らない。** Task 3 の実装者は「壊れているのは engine では
なく報告専用ヒューリスティックの前提だ」と正しく突き止めたうえで、入力（括弧の
エラー経路 2 件）をプールから除いた。除けば緑になるが、その形がコーパスから
丸ごと抜ける。**原因が判定側だと分かったなら、直すのは判定側。**

## 3. 持ち越し（B+C で見つけて直さなかったもの + D+E で出たもの）

- **`errors-000.json` は `areaOfShard` 上 `display` 領域に入る。** Task 7 以降で
  「エラー経路」の集計軸と `AREAS` の軸がずれて見える可能性がある（Task 2 の申し送り）。
- ~~**`report.ts` の 5 枠化は Task 7 の担当。**~~ 済（`979f5db`）。**`errors-000.json` が
  `display` 領域に居ることは直していない**——エラー経路の軸と `AREAS` の軸は目的が違うので、
  枠 1 だけシャード名で選ぶ形にして、そのずれをテストで固定した。
- **設計書の 5 枠に入らないエラー期待値が実物に 1 件ある。** `entry-000.json` の
  SyntaxError（`3 . .`）。レポートは番兵として名前ごと本文に出している。枠を増やすなら
  Task 8/9 の文脈で裁定すること。
- **`corrections-000.json` の `stratum`/`strata` は JSON にあるが `corpus.ts` は読んで
  いない。** レポートで層別の内訳を出すなら型の拡張が要る（Task 3 の申し送り）。
- **Python 側の `_needs_precedence` の `ac` 対応はいま効いていない**
  （`precedence-000.json` に `ac` が無い）。双子を揃えるためだけに入っている。

- **証明書の失敗が検出数に載らない。** Task 10 の 4 つの逆算証明書
  （`web/tests/heavy/certificates.ts`）は `record()` を呼ばないので、
  `mismatchesByShard` に入らない。実測: `tax-combined-rate` の変異で証明書が
  124 プローブ落ちているのに `detection-power.json` には現れない。
  **静かな穴ではない**——`verdictFor` は `expectShards: []` の枝で
  `playwrightExitCode` を見るので、証明書だけが落ちる変異は `measurement-failed`
  になる。過小計上であって見逃しではない。**§8 のレポートを触る D+E の領域。**
- **証明書への変異の影響は 10 種のうち 2 種しか実測していない。**
  未確認のうち大きいのは `rate-nominal-to-effective`(64.91%) と
  `loan-final-row-no-adjustment`(46.40%)。
- **`loan_principal` の縮退 17 件**（`rows_paid < n`）は境界の証明が無いまま
  値の一致だけが確認されている。`loan_forward` だけでは組めない（両側とも
  `SyntaxError`。Python 参照でも同一挙動を確認済み）。
- **`web/heavy-ui-run.json` は「最後に回した走行」の残骸である。いまは finance 単独走行の
  もの**（実測 `ok: false` / findings 33 / typed 0、先頭は `no-presses`）。**spec E がこれを
  読むので、読む前に必ずフルの `pnpm heavy:ui` を回し直すこと**（`pnpm heavy` でも
  finance 単独でも再生成されない）。**Task 6 の報告は「緑になったので解消した」と書いたが
  誤りだった**（最後に回したのが finance 単独走行だった）。**生成物の状態は走行の順番で決まる。**
- **未裁定 3 件（Task 6 の発見）**: ①**期数 0 の複利は画面から観測できない**（答えの行が空・
  `data-error` 無し。`FinancePanel` が `periods > 0` を見てからコアを呼ぶので、コーパスが
  期待する SyntaxError が出る機会が無い）②**1,201 か月のローンはコアが答えるのに打てない**
  （`fin-000172`。`MAX_TERM_MONTHS` は逆算の探索を縛る定数で、前進の償還表に上限は無い。
  `FinancePanel` の `MAX_PERIODS` のコメントは「コアと揃えた」と言うが**数は同じで掛かる場所が違う**）
  ③3,500 件中 **211 件が盤面で打てない**（残 3,289 = 94.0%）。
- ~~**`reference/` の既存 flake**~~ → **解消済み（`0b19e9d`）。** 以下は経緯:
  `test_the_summary_line_counts_every_shard_not_just_the_cli_count`
  （`reference/tests/test_generate_corpus.py:1581`）。印字側は経過を `.2f`、1 件あたりを
  **丸めていない値**から `.4f` で出すのに、テストは**丸めた値を割ったもの**と比べている。
  ずれは総件数が小さいときだけ出る（このテストは 14 枚を 5 件に落とす）。**実測 1 回赤 → 5/5 緑。**
  フルコーパス 33,567 件では出ない。**緩めるのではなく、印字の桁から許容を導いて直すこと。**
- **`loan_term` に縮退が起きないこと**は `n` が探索で決まることからの推論で、
  総当たり確認はしていない（実測 407 件は全通過）。

- **【マージ後・タグ前の統合課題（監視役の申し送り 2026-08-20）】heavy-ui 系の 0.3.0 画面適応。**
  ユーザーが U-0/S-0（0.3.0 前半）を main に入れる方針。Heavy corpus は push では走らず
  **手動・タグ・週 1 cron（月曜 3:00 UTC）**なので、**タグ打ちか cron で初めて赤くなる**形になる
  ——製品の欠陥ではなく**ハーネスの画面適応**の問題である。
  **こちらで `git show feature/nav-restructure:…` を読んで実測した結果、危険は監視役の見立てより小さい:**
  - `route.ts` の `routeFromHash` は **知らない先頭を `{module:"scientific", category:null}` に倒す**。
    `page.goto("/")`（ハッシュ無し）は**そのまま科学計算に着く**ので、`corpus-ui.spec.ts:127,186,212` と
    `reachability.spec.ts:25` の入口は 0.3.0 でも生きる。
  - `Nav.tsx` の 4 タブは **`<a href>`（リンク）**で、ラベルは `Scientific` / `Convert` / `Scale` / `Finance`。
    **`getByRole("button", …)` とは衝突しない**（heavy-ui は盤面のボタンをアクセシブルネームで押す）。
  - `finance-ui.spec.ts:55` の **`#finance` は 0.3.0 でも実在**（`MODULES.finance.href = "#finance"`）。
    領域名 `金融計算` も同じなら、そのまま通る。
  - **本当に危ないのは `#data-scale`**——0.3.0 では **`#scale/data-scale`** になり、旧ハッシュは
    **互換分岐を作らず既定（科学計算）へ落ちる**。**heavy-ui は `#data-scale` を使っていない**（実測: 使うのは
    `/` と `#finance` だけ）ので D+E の追加分は無事だが、**`web/tests/e2e/` 側と、`data-scale` を
    ハッシュで開く他の検査は要確認**。
  - **未確認**: 0.3.0 の科学計算パネルの領域名・`display-main` / `display-angle` の `data-testid` が
    そのままか。**heavy-ui は領域で括らずページ全体から掴む**（`reachability.spec.ts:20` は
    `panel = (page) => page`）ので、**同名の要素が増えると strict mode で落ちる**。ここだけは
    マージ後の実物で確かめること。
  - **実施はスタックのマージ後・タグ前。** D+E の作業ではない。
- **未裁定: `(29 nCr 4) nCr 2` が `Math ERROR`。** 除算先行の `C(29,4)` は
  `23751.000000000004`（fract = 3.64e-12）で、`nPr`/`nCr`/`n!` 共通の `fract() != 0`
  の門が弾く。**画面には `23751` と出るので表示からは見えない。** Task 4 は
  combinatorial 連鎖の内側を `nPr` に限って回避した（入力は削っていない）。
  **engine 側の是非は未裁定**（`docs/corpus-measurements.md` に記録）。

- **CI の CJK フォント: 決着。`heavy-corpus.yml` には追加しない（ユーザー裁定）。**
  一度 `d45a488` で入れたが取り下げた（`reset --hard`、reflog に残る）。実装側の
  `898d9c9` が `ci.yml` からフォントステップを削除しており、**入れても CI の px 値は
  1 つも変わらない（描画に対して no-op）と実測されている**。環境差はテスト側で吸収する
  方針に一本化された（横溢れ 8px 許容、DEL/AC は枠からの相対座標）。**この判断の根拠は
  以下の「heavy 側は測っていない」より強いので、蒸し返さないこと。**
  （元の調査記録: heavy 側は寸法を測っていない） 実測: `web/tests/heavy/`（20 ファイル）と
  `web/tests/heavy-ui/`（3 ファイル）に `boundingBox` / `scrollWidth` / `scrollHeight` /
  `clientWidth` / `offsetWidth` / `getBoundingClientRect` / `toHaveCSS` / `toHaveScreenshot`
  が **0 件**（該当するのは `web/tests/e2e/` の 14 ファイルだけで、そちらは `ci.yml` の担当。
  実装側が `fonts-noto-cjk` を追加済み）。**DOM のテキストはフォントに依らない**ので、
  アクセシブルネームで押す heavy-ui の 7 本も影響を受けない。
  - **残る小さな risk**: `heavy-ui` は本物の画面のボタンを実際に押す。豆腐字形で
    ラベル幅が変われば配置は動きうる（押下可能性そのものは Playwright が面倒を見る）。
    **`.github` を触る機会（Task 11 のフルスイープ）に、保険として同じ 1 行
    `fonts-noto-cjk --no-install-recommends` を入れるかを判断する。**費用は数秒。
  - **いま入れない理由**: Task 4 の実装者が同じワークツリーで走行中で、コミットが
    交錯する。`.github` は Task 4 の領域外でもある。

## 4. 長走行の申告表（実測）

事前申告してから回すこと。

| 走行 | 実測時間 |
|---|---|
| `cd web && pnpm heavy` | 約 26 秒（162 passed） |
| `cd web && pnpm heavy:power` | **約 9.2 分**（18 変異。実測 558s / 552s / 551s） |
| `cd reference && uv run pytest` | 約 23 秒（274 passed） |
| `cargo test --workspace` | 数秒（304 passed） |
| コーパス再生成 `python scripts/generate_corpus.py` | 約 5.7 秒（31,501 件） |
| `cd web && pnpm heavy:ui` | **約 11.7 分**（実測 700.6s / 699.8s / 700.4s、19 テスト・1,266 ケース。plan の「10.6 分」は 2026-08-17 に 16 テストで測った古い値） |

## 5. 踏まないための注意

- **`uv` は必ず `--no-config`。** `uv run` は `reference/uv.lock` を書き換えるので、
  各作業のあと `git status` を見て `git checkout -- reference/uv.lock` で戻す。
- **`crates/` の差分は常に空を維持する。** 変異は `detection-power.mjs` が
  一時的に当てるだけ。走行のあと必ず `git diff -- crates/` を確認。
- **赤確認の戻しは再編集で行う。** ファイル単位の `git checkout` は同じファイルの
  別作業を巻き戻す。
- **実装者（subagent）は「通知を待つ」と言って turn を終えることがある。**
  待つものは無い。発注文面に「待つ通知は存在しない。判断に迷ったら停止でなく
  事実を報告」と入れると効く。
