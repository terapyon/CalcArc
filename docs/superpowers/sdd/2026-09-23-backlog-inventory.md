# 残作業の棚卸し（2026-09-23、main = `3d8a422` / タグ `v0.9.5`）

**これは「集めて並べた一覧」ではなく「現物に当て直した一覧」である。** 台帳の記述は根拠にしていない
——**溜めた側が閉じるとは限らず、閉じた側は自分が何を閉じたか知らない**（今回も 16 件がそうだった）。

**行番号は当て直した日（2026-09-23）の座標である。** 発注のたびに現物で当て直すこと。

## 0. やり方と範囲

| | |
|---|---|
| 集めた候補 | **221 件**（台帳 23 本から 64・設計書 58 本と計画 55 本と `docs/` 直下と直下の 5 文書から 67・`crates` `web` `heavy` `reference` `tools` `functions` `.github` の 386 ファイルから 90。同じ論点の言い換えを含む） |
| 当て直した論点 | **43 件**（下の §1〜§6 がその全部） |
| GitHub | 開いている issue **0 件**・PR **0 件**（読み取り専用の `gh-ro` で確認） |
| 回した重い段 | **無し**（棚卸しに要らない） |

**この棚卸し自体の穴、2 つ:**

- **候補集めの下請けが `docs/superpowers/sdd/` の 23 本のうち 8 本（0.9.2 以降の新しい台帳）を読み落としていた**
  のに「15 本全件読了」と報告してきた。**8 本は当て直す側が自分で当たった**（§3 の「0.9.2 以降の台帳から」）。
  **数は自分で数えること。**
- **「211 件が盤面で打てない」は今回も再計算していない。** 数える仕掛けが無いためで、
  `expressible()`（`heavy/tests/ui/finance-cases.ts:248`）は面ごとに 1 件拾うためにしか使われていない。

## 0.5 ★ 「在ること」と「あるべき場所に在ること」は別（2026-09-24、0.9.6 の総ざらいで）

**文書を丸ごと grep する検査は、「一覧から外れた名前が本文のどこかに残っている」だけで緑になる。**

**現物の回数**（`docs/manual/detail.ja.md`、2026-09-24 に数えた）:

| 綴り | 文書の中の回数 | 9 章の一覧の中 |
|---|---|---|
| 「データ転送」 | **5**（`:19` 章の表・`:355`・`:377`・`:409` 本文・**`:732` 一覧**） | **1 回だけ** |
| 「LLM のメモリ」 | **8** | 1 回だけ |

**だから「画面の名前がマニュアルに在るか」を見る番人は、節を切り出してから集合で突き合わせる**
（数だけでも、文書全体でも足りない）。**0.9.6 の裁定は `tools/check-manual-limits.mjs` に置くこと。**

**0.9.7 の宿題**: **綴りの突き合わせが 2 か所に分かれている**
（`web/tests/unit/manual-key-names.test.ts` と `tools/check-manual-limits.mjs`）。
**9 組の「数 ↔ 配列」を足すときに、置き場をまとめて決める。**

## 0.6 ★ 「総数」と「要求された場所すべて」は別の問い（2026-09-24、1.0 の門 3 で）

**私は門 3 を「満たされている」と答えた。誤りだった。** 数えたのが**宣言の総数**で、
**門の問いは「規律が要求する場所すべてに在るか」**だったからである。

**現物**（`origin/main = 884f324`、2026-09-24 に数え直した）:

| 見方 | 数 |
|---|---|
| `reference/` の `独立:` の宣言（総数） | **44**（別手順 17・不可能 22・一部 5・**未確認 0**） |
| `*_ref.py` と `loan_boundary.py` の**公開 `def`** | **74** |
| そのうち `独立:` を docstring に持つもの | **31** |
| **持たないもの** | **43**（`scientific_ref` 15・`real_ref` 7・`complex_ref` 6・`convert_ref` 5・`data_scale_ref` 3・`currency_ref` 2・`eng_ref` `llm_ref` `sexagesimal_ref` `transfer_ref` 各 1） |

**モジュールの冒頭に別の綴りで書いてあるものが 3 つある**（`convert_ref` `llm_ref`
`transfer_ref` の「**Rust の実装は見ていない**」）。**規律が求める綴りではない**
（`CONTRIBUTING.md:86-91` の 4 語）。

**教訓**: **「44 件ある」は真で、「要求された場所に在る」は偽だった。**
**同じ数を 2 人が数えて割れたら、まず『何を数えれば門の問いに答えるか』を言い直す。**
数え直しても直らない（[[plan-inventories-need-grep]] と同じ形）。

## 1. 取り消し——前提が変わった（2026-09-23）

**サイト内 PDF 配信（`functions/manual/`）の撤去は取り消す。** 利用者の実機で 0.9.5 の応急（Release の添付へ
逃がす）が効かず（PDF は開くが戻れない）、方針が**「内部に PDF を持ち、表示画面を作る」**に変わったためである。

**取り消しによって嘘になる記述は 7 か所ある:**

| # | 場所 | 嘘になる文 |
|---|---|---|
| 1 | `CHANGELOG.md:47-48` | 「アプリはもう指していない……**撤去は 0.9.6**」 |
| 2 | `functions/manual/[[path]].js:94` | 「0.9.5 から、アプリはここを指していない」 |
| 3 | 同 `:112-115` | 「**撤去は 0.9.6 の宿題**……**この理由は 0.9.6 で腐る**——そのとき、ここごと消す」 |
| 4 | `.github/workflows/deploy.yml:247-248` | 「（撤去は 0.9.6、`functions/manual/[[path]].js` の註）」 |
| 5 | `web/scripts/check-sw.mjs:94` | 「配信は 0.9.6 まで残る」 |
| 6 | `web/tests/unit/manual-function.test.ts:32, 40` | テスト名「撤去は 0.9.6」／註「**Function ごと 0.9.6 で撤去する**」 |
| 7 | `docs/superpowers/sdd/2026-09-19-v0.9.5-implementation.md:61-88` | 宿題の節まるごと（対象 6 か所の一覧を含む） |

**`CHANGELOG.md:31`「この直しは iPhone の実機でまだ確かめていません」は書き換えない**（監視役の裁定
2026-09-23。**出荷済みの版の記録**である）。**確かめた結果は 0.9.6 の CHANGELOG に書く。**

## 2. 0.9.6 に入れることを推すもの

### 2-(a) マニュアル画面に直結

- **`#manual` の未実測が生き返る。** `docs/superpowers/specs/2026-09-17-v0.9.3-groundwork-design.md:74`
  「`#manual` を足したときに**読み上げ・WebKit・低い画面**がどうなるかは未実測（`<dialog>` も popover も
  **この製品では 1 度も使っていない**）」。いま `#manual` は未知のハッシュとして既定へ倒れる
  （`web/src/route.test.ts:155`）。**大**
- **PDF の出し方の決め直し。** いまリンク集は Release の添付を指す（`web/src/ui/Footer/LinksPopup.tsx:64-66`）。
  サイト内へ戻すなら `PDF_DISPOSITION = "attachment"`（0.9.4 の手）の扱いも一緒に決まる。**中**
- **§1 の 7 か所の書き換え。** **小**

### 2-(b) 安く閉じられる「嘘」

- `docs/deploy.md` の手順 4・5 と図が**0.9.3 より前の並び**（マニュアルを本番展開の**あと**に作る／
  落ちても本番は止まらない）。**同じ文書の `:62` と `release.yml`（`deploy: needs: manuals`、`:95`）は逆**。
  0.9.5 の直し（`07453bb`）は段落 1 つだけで、一覧と図に届いていない。**小**
- `docs/base-spec.md:1039-1041`「出荷済みの最新版は **0.7.0** であり、履歴を含む版はまだタグを打っていない
  ——確定した版数が分かり次第、**この 1 文だけ直す**」。履歴は 0.8.0 で出ている。**小**
- `docs/superpowers/specs/2026-09-12-calc-fixes-verification-design.md:710`「§4.8 は未決」。
  **同じ文書の `:483` は「確定、2026-09-16」**（§11 の更新漏れ）。**小**
- `CLAUDE.md:145-157` の罠「この作業機では `wasm-pack test` がセッションを作る段で落ちる……
  **`wasm-pack test` 本体は CI が回す**」。**2026-09-19 に手元で通った**
  （`--chromedriver ~/.cache/.wasm-pack/chromedriver-.../chromedriver` を渡す。64 passed）。
  **環境変数だけで足りるかは未確認。** **小**
- `docs/superpowers/sdd/two-shades-of-off-HANDOFF.md:18-25` の状態表が「Task 4〜7 **未着手**」のまま。
  実装は 0.7.0 で出ている（`web/src/ui/Key/Key.tsx` の `permanent`、`keypad-shell.spec.ts` の 3 本）。**小**

### 2-(c) 検査の穴

- **F16 の番人の床。** `crates/calcarc-core/src/value.rs:407` の `assert_eq!(compared, 10_368)` のうち
  **128 回が 0 と 0 を比べている**（大きい側が `2^1` で差が 1077〜1080 の 4 升。**升を数え直して確かめた**）。
  `small == 0` を数えなければ 10,240。**小**
- **暗テーマに機械の検査が無い。** `web/src/ui/tokens.css:86` に `--key-empty-bg` の暗テーマの値は在るが、
  `web/tests` に `prefers-color-scheme` / `colorScheme` は **0 件**。高コントラストの検査
  （`web/tests/e2e/keypad-shell.spec.ts:371`、`emulateMedia({ contrast: "more" })`）と同型で 1 本置ける。**小〜中**

## 3. 生きているが、0.9.6 でなくてよいもの

| 件 | 根拠（現物） | 大きさ |
|---|---|---|
| `(29 nCr 4) nCr 2` が Math ERROR | `scientific/mod.rs:212` の整数判定は誤差を許さない。直したテストは `crates/` に 0 件。裁定は 2026-08-20 の「後で直す」 | 中〜大 |
| n ≥ 12 の残価が境界 golden に 0 件 | `testdata/loan_boundary.json` は 2,682 件・残価 521 件・n ≥ 12 の残価 **0 件**（数えた） | 中 |
| 単位換算の `Overflow` | `docs/numerical-policy.md:373`（記録のみの裁定）。探索は `reference/scripts/find_convert_overflow.py` | 中 |
| `sin(180°)` の極近傍のゼロ吸着 | `docs/numerical-policy.md:687`。`scientific/mod.rs` に吸着のコードは 0 件 | 中 |
| 変動金利 | `crates/calcarc-core/src/finance/loan/schedule.rs:5`「受けられる形に開けてある」だけ | 中 |
| CSP が無い | `web/public/_headers` にも `web/index.html` にも `Content-Security-Policy` 0 件。`docs/deploy.md:139` が宿題と書く | 中 |
| 証明書の失敗が検出数に載らない | `heavy/tests/corpus/certificates.ts` に `record(` **0 件**、`heavy/tests/corpus/report.ts:1230` が過小計上と明記 | 中 |
| 証明書への変異の影響は 2 種だけ | `heavy/scripts/detection-power.mjs` の変異は **20 本**、証明書の語は **0 件** | 中 |
| `loan_principal` の縮退 17 件に境界の証明が無い | `certificates.ts:211` が除外、`heavy/tests/corpus/calls.spec.ts` が 431 中 17 を固定 | 中 |
| 盤面から打てない入力（1,201 か月ほか） | 盤面は `FinancePanel.tsx:94` の `MAX_PERIODS = 1200`、逆算は `loan/inverse.rs:21` の `MAX_TERM_MONTHS = 1_200`、**前進の償還表に上限は無い**。件数を数える仕掛けは無い | 中（製品の裁定） |
| ~~a11y: axe を入れるか／キーボードの展開範囲~~ **閉じた（利用者、2026-09-24）** | **入れない／広げない。理由は [`a11y-review-2026-09-03.md`](a11y-review-2026-09-03.md) の「4 と 5 の裁定」**（同じ理由をここに写さない） | — |
| a11y: 切替の読み上げが長い／通知が消えない | `web/src/App.tsx` に `setAnnouncement("")` は無い。設計書が「**実機で聞いて決める**」と指定。**こちらは開いたまま**——§6 の「人にしか閉じられないもの」 | 小〜中 |
| `mapAnswerToKeys` が虚数・極形式・60 進を写せない | `web/src/ui/ScientificPanel.tsx:185` | 中〜大 |
| lockfile 2 本・pnpm workspace 無し／`heavy` から `web` への深い相対 import | `web/pnpm-lock.yaml`・`heavy/pnpm-lock.yaml`、`heavy/tests/ui/*.ts` の `../../../web/src/calc` | 中 |
| mypy の範囲が `*_ref.py` だけ | `reference/pyproject.toml:43`「絞ったのは『あとで広げる』ため」 | 中 |
| WebKit のオフラインが `test.fixme` | `web/tests/e2e/pwa.spec.ts:62`（理由つき） | 中 |
| 縦の予算の巡回の外に 2 route | `viewport-budget.spec.ts` の `TABS` は 11、route は 13。外は `#scale/llm`（39px 溢れを許容）と `#convert/currency`（案内が出ると 10px）。**到達性は `short-screens.spec.ts` が 13 route × 4 寸法で見ている** | 小 |
| `env(safe-area-inset-top)` が 0 件 | `-bottom` は 9 件。standalone で Nav が潜るかは未実測 | 小 |
| `_needs_precedence` の `ac` 対応が効いていない | `corpus/generated/precedence-000.json` に `"ac"` **0 件** | 小 |
| `corpus/contributed/` の受け入れ方針 | ディレクトリ自体が無い（`corpus/` は `generated` と `overrides.json` だけ） | 小 |
| `KeyDef` が `token` と `action` を両方持てる | `web/src/ui/Keypad/types.ts:23-37`（型で禁じていない） | 小 |
| biome の `useTemplate` info 2 件 | `heavy/tests/corpus/report.ts:1690, 1700` 付近（文字列連結のまま、exit 0） | 小 |
| 44px の出どころが記録されていない | `docs/base-spec.md:1183` | 小 |

### 0.9.2 以降の台帳から（**下請けが読み落とし、当て直す側が自分で当たった 8 本**）

- `2026-09-12-calc-fixes-verification.md` §8 の minor 4 件（`monthly_payment_exact` の `n == 1` の分岐・
  ふるいの条件が 3 回・`PER_CELL=25` の据え置き・`Outcome` の欄が欠けたときの panic）。**小**
- 同 §8 の **n ≥ 12 の残価**（上の表に再掲）と、**「関数の答えの後」の F5 の製品側の設計＝利用者の裁定待ち**。
- `2026-09-17-manual-audit.md` §4 の持ち越し（マニュアルの上限値とコアの定数の突合）は **閉じている**
  （`tools/check-manual-limits.mjs` が `state.rs` / `entry.ts` / `FinancePanel.tsx` を読む）。
- `2026-09-18-f7-complex-division.md` §6・`2026-09-18-f16-component-gap.md` §5 の穴——**重量級のシャード
  （時間で見送り）・連鎖 `a/b/c`・表示層・境界の API 越し・乗算と加減算は論証だけで実測が無い**。**中**

## 4. 閉じていた（台帳に残っていたが、現物は済んでいた）

`want ≤ cap` の wasm32（`crates/calcarc-wasm/tests/loan_boundary.rs:132`）／`corpus.ts` が `stratum` を読む
（`heavy/tests/corpus/corpus.ts:412, 779`）／`entry-000` の SyntaxError は 6 枠目 `entry-syntax` に収まった／
`heavy-ui-run.json` の残骸（`.gitignore:30` の生成物で、走行の頭で消える）／`tan` の番人
（`scientific/mod.rs:357`）／`is_tan_pole` の仕様化とテスト（`:76-93`・`:643`）／`FinancePanel.tsx:74` の註
（0.5.0。`token_parity.rs` が数を見張る）／詳細マニュアルの画面名 **13 個**／`pow_1p`・`annuity` の抽出
（`finance/loan/closed_form.rs:34, 44`）／科学計算の 8 関数（公開は 17 本）／`convert::convert` の例外条項
（`docs/api-style.md:50`）／WASM 境界の 4 状態（`crates/calcarc-wasm/src/outcome.rs:23` の `Outcome<T>`）／
ラベルが切れない検査（`web/tests/e2e/convert.spec.ts:115`）／ラベルの相異（`web/src/ui/Keypad/convert.test.ts:162`）／
為替の塞ぎの共通化（`web/tests/e2e/fixtures.ts:113`、`auto: true`）／`cases.py:1343` の `from` の註／
`LlmPanel.test.tsx` の「この項目を消去」2 件／`as LlmKeyToken` **0 件**／履歴の Task 7〜13（出荷済み）／
マニュアルの書体の固定（`web/scripts/manual/markdown.ts:241` の `PINNED_FONTS` と CDP の確認）／
マニュアルの上限値とコアの定数の突合（`tools/check-manual-limits.mjs`）／`heavy` が CI に在る
（`.github/workflows/ci.yml:200`）／道具が `tools/` に在る／タグが main の子孫かの検査（`release.yml:52`）。

## 5. 前提が変わって意味を失ったもの

- `#manual` を畳んだ（0.9.4）ことに紐づく記述——**マニュアル画面を作り直すなら全部復活する**。
- 0.4.1 のレビュー R-7「実装側にも HANDOFF を置く」——セッションの体制が変わった。

## 6. 利用者にしか確かめられないもの

- iOS の PDF から戻れるか（0.9.5 の応急は効かなかった、と 2026-09-23 に聞いている）。
- 切替の読み上げの長さと、通知の文面が残ること（設計書が「実機で聞いて決める」と指定）。
- standalone 起動で Nav がステータスバーに潜るか。

## 7. 当て直す側が踏んだ誤り（記録）

- **「テストが無い」と書きかけた。** 複素 `tan` の極は `scientific/mod.rs:643` の
  `the_pole_guard_does_not_look_at_complex_arguments` が固定していた。**関数名の綴りで探して無いと言った**
  ——**振る舞いで探すこと。**
- **下請けの「全件読了」を数えずに受けかけた。** `ls | wc -l` が 23、下請けの一覧は 15 だった。
