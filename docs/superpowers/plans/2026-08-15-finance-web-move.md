# web の `loan` を `finance` の下へ — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web 側の `loan` を `finance` の下へ移し、複利を抱えたまま `Loan` を名乗って
いるパネルとキー集合を `Finance` に改名する。**計算は 1 つも変えない。**

**Architecture:** ファイルの移動と識別子の改名だけ。WASM のエクスポート名
（`loan_forward` など）、TS のローン固有の型（`LoanCalc`・`LoanMode`・`Loan*Result`）、
E2E のセレクタ（region 名「金融計算」、`loan-breakdown`）は据え置く。木は Rust 側の
`calcarc_core::finance::{compound, tax, loan}`（B spec で移動済み）に揃える。

**Tech Stack:** TypeScript / React 19 / Vite / vitest / Playwright / Biome

## Global Constraints

- **`web/src/calc/` に React を import しない**（CLAUDE.md）。移動先の
  `web/src/finance/` も同じ境界の内側である。
- **計算ロジックを web に書かない。** この計画は 1 行も計算を足さない。
- **`crates/` `reference/` `testdata/` に触らない。** 完了時に diff が空であることを示す。
- コミットメッセージの末尾に
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける。
- **`git push` と PR 作成は行わない。**
- E2E のポートは 4179（`playwright.config.ts`）。

## 前提と経緯

**B spec（`2026-08-15-loan-under-finance-design.md`）§7 は、web 側の移動を
「必要になったら別 spec で判断する」と先送りした。** その判断を 2026-08-15 に
ユーザーが下した——**「UI 層まで（嘘を消し切る）」**。spec は起こさず、この計画が
決定の記録を兼ねる。

**嘘が生じている実態**（F0 spec §1 が改名の条件として挙げたもの）:

| 名前 | 実態 |
|---|---|
| `web/src/loan/` | `finance/` と兄弟。Rust では既に `finance::loan` |
| `web/src/loan/entry.ts` | 冒頭のドキュメントが自分で「**Finance の数の入力**」と名乗っている |
| `ui/Loan/LoanPanel.tsx` | `../../finance` を import し、複利モードを描いている |
| `ui/Keypad/loan.ts` | `mode:compound` `field:deposit` `field:tax` `period:*` を持つ |
| `LoanField` | `"deposit" \| "periods" \| "tax"` を含む |

**このブランチは `docs/finance-spec-corrections`（main + 訂正 2 コミット）から生やす。**
`a2a1e29` と `696d5cd` は main 未収録の spec 訂正で、「あとでどこかの PR に混ぜてよい」と
ユーザーが承認済みである。単独 PR にはしない。

## 変えるもの・変えないもの

**変える**

| 現在 | 変更後 |
|---|---|
| `src/loan/index.ts` `src/loan/types.ts` | `src/finance/loan/index.ts` `src/finance/loan/types.ts` |
| `src/loan/entry.ts` `src/loan/entry.test.ts` | `src/finance/entry.ts` `src/finance/entry.test.ts` |
| `src/ui/Keypad/loan.ts` `loan.test.ts` | `src/ui/Keypad/finance.ts` `finance.test.ts` |
| `LOAN_SECTIONS` `LoanKeyToken` `LoanField` | `FINANCE_SECTIONS` `FinanceKeyToken` `FinanceField` |
| `src/ui/Loan/LoanPanel.{tsx,module.css,test.tsx}` | `src/ui/Finance/FinancePanel.{tsx,module.css,test.tsx}` |
| testid `loan-panel` `loan-load-error` | `finance-panel` `finance-load-error` |

**変えない（理由付き）**

- **WASM のエクスポート名**（`loan_forward` `loan_term` `loan_principal`
  `loan_bonus_*`）——公開 API の変更であって、この計画の主題ではない（B spec §3 と同じ線）。
- **ローン固有の型と値**（`LoanCalc` `initLoan` `LoanMode` `LOAN_MODES`
  `LoanErrorCode` `Loan*Result`）——**これらは嘘ではない。** ローンの計算を指している。
- **`finance/index.ts` と `finance/types.ts`**（複利のラッパー）——`FinanceCalc` /
  `initFinance` が複利だけを指しているのは altitude の問題で、移動とは別。§スコープ外。
- **E2E のファイル名**（`loan.spec.ts` `loan-keypad.spec.ts`）——中身はローンの
  モードしか触っていない（複利の E2E は 1 件も無い）。まだ嘘ではない。
- **testid `loan-breakdown`**——ローンの内訳であり、E2E のセレクタである。
- **`entry.ts` の中の `MAN` `OKU` `YEAR` `MONTH`**——単位そのもの。

**testid の線引き**: パネル全体のものは `finance-`、モード固有のものは `loan-` のまま。

## ファイル構成（完了後）

```text
web/src/
├── finance/
│   ├── index.ts        複利の WASM ラッパー（無変更、コメント 1 行だけ直す）
│   ├── types.ts        複利の型（無変更）
│   ├── entry.ts        Finance の数の入力（src/loan/entry.ts から移動）
│   ├── entry.test.ts   同上
│   └── loan/
│       ├── index.ts    ローンの WASM ラッパー（import のパスだけ変わる）
│       └── types.ts    ローンの型（import のパスだけ変わる）
└── ui/
    ├── Finance/
    │   ├── FinancePanel.tsx
    │   ├── FinancePanel.module.css
    │   └── FinancePanel.test.tsx
    └── Keypad/
        ├── finance.ts       FINANCE_SECTIONS ほか
        └── finance.test.ts
```

## 検証段（test-tiering、ci.yml 導出）

**web だけを触るので web 段だけ回す。** Rust・wasm・Python は動かない
（根拠は `crates/` `reference/` `testdata/` の diff が空であること）。

```bash
cd web
pnpm typecheck            # tsc --noEmit
pnpm lint                 # biome check .
pnpm test                 # vitest: 141 passed (16 files) ← 基準値、増減なし
pnpm e2e                  # Playwright: 82 ← 最後に 1 回だけ
```

- 各タスクの終わりは `typecheck` + `lint` + `test`。**E2E はブランチ末尾で 1 回**。
- **スクリーンショットは撮らない。** 描画結果が 1 ピクセルも変わらないため
  （F0 と違い、ラベルも region 名も aria-label も動かさない）。

## 赤確認

**この計画には赤確認が要らない。新しい検査を 1 つも足さないからである。**
（新設検査は壊して赤を見てから信じる、という規律の対象が無い。）

代わりに置く証明は**「既存の 141 件が、検査内容を変えずに通ること」**である。
各タスクの `git diff` で、テストファイルの変更が **import のパス・識別子名・
`describe` の文字列だけ**であり、**assert と期待値が 1 つも動いていない**ことを示す。

---

### Task 1: ブランチを作り、TS ラッパーを `finance/` の下へ移す

**Files:**
- Move: `web/src/loan/index.ts` → `web/src/finance/loan/index.ts`
- Move: `web/src/loan/types.ts` → `web/src/finance/loan/types.ts`
- Move: `web/src/loan/entry.ts` → `web/src/finance/entry.ts`
- Move: `web/src/loan/entry.test.ts` → `web/src/finance/entry.test.ts`
- Modify: `web/src/ui/Loan/LoanPanel.tsx`（import 3 行）
- Modify: `web/src/finance/index.ts`（コメント 1 行）
- Modify: `web/src/pwa/index.ts`（コメント 1 行）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `web/src/finance/loan` が `initLoan` / `LoanCalc` / `LoanMode` /
  `LOAN_MODES` / `LoanErrorCode` / `LoanForwardResult` / `LoanPrincipalResult` /
  `LoanTermResult` / `LoanBonusForwardResult` / `LoanBonusPrincipalResult` を
  export する（**名前は現状のまま**）。`web/src/finance/entry` が
  `EMPTY` `MAN` `OKU` `YEAR` `MONTH` `Entry` `Unit` `Operator` `Token`
  `backspace` `canPushCloseParen` `canPushOpenParen` `canPushOperator`
  `canPushUnit` `fromDigits` `grouped` `hasOperator` `isEmpty` `openDepth`
  `pushCloseParen` `pushDigit` `pushDot` `pushOpenParen` `pushOperator`
  `pushUnit` `text` を export する（**名前は現状のまま**）。

**なぜ `entry.ts` だけ `finance/loan/` ではなく `finance/` 直下か:** このファイルは
自分の冒頭で「**Finance の数の入力**」と名乗っており、複利の項目（元本・積立・期間）も
これを通る。ローンの下に押し込むと、いま消そうとしている嘘を作り直すことになる。

- [ ] **Step 1: ブランチを作る**

`docs/finance-spec-corrections` に居ることを確かめてから生やす。**main からではない**
——main 未収録の spec 訂正 2 コミットをこのブランチに乗せるためである。

```bash
cd /home/terapyon/dev/CalcArc
git branch --show-current      # 期待: docs/finance-spec-corrections
git status --short             # 期待: 空
git switch -c refactor/finance-web-move
git log --oneline -3           # 696d5cd / a2a1e29 が乗っていること
```

この計画書を先にコミットする（実装より前に置き、レビューの起点にする）:

```bash
git add docs/superpowers/plans/2026-08-15-finance-web-move.md
git commit -m "$(cat <<'EOF'
Plan the web-side move that B sent to a later decision

B 設計 §7 が先送りにした「web も finance の下へ」の判断を、UI 層まで
やる方向で確定した。spec は起こさず、この計画が決定の記録を兼ねる。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: `git mv` で移す**

**内容の変更と同じコミットに混ぜない**——`git log --follow` で中身を追えるようにする
（B spec §5-2 と同じ規律）。

```bash
cd /home/terapyon/dev/CalcArc/web
mkdir -p src/finance/loan
git mv src/loan/index.ts      src/finance/loan/index.ts
git mv src/loan/types.ts      src/finance/loan/types.ts
git mv src/loan/entry.ts      src/finance/entry.ts
git mv src/loan/entry.test.ts src/finance/entry.test.ts
rmdir src/loan
git status --short             # R が 4 行、src/loan/ が消えていること
```

- [ ] **Step 3: 移した先が壊れていることを確かめる**

相対パスが 1 段深くなったので `finance/loan/` の 2 ファイルはまだ解決できない。

```bash
cd /home/terapyon/dev/CalcArc/web && pnpm typecheck
```

期待: `src/finance/loan/index.ts` の `../wasm/calcarc_wasm.js` と
`src/finance/loan/types.ts` の `../calc/types`、および
`src/ui/Loan/LoanPanel.tsx` の `../../loan` でエラー。

- [ ] **Step 4: 移した 2 ファイルの import を 1 段深くする**

`src/finance/loan/index.ts`:

```ts
import init, {
  loan_bonus_forward,
  loan_bonus_principal,
  loan_forward,
  loan_principal,
  loan_term,
} from "../../wasm/calcarc_wasm.js";
```

同ファイルの `initLoan` の上のコメントも、木が変わったので直す:

```ts
/**
 * WASM を読み込んで LoanCalc を返す。複数回呼んでも初期化は 1 度だけ。
 *
 * calc/ や datascale/ も init() を呼ぶが、生成された __wbg_init は
 * モジュール変数 wasm が設定済みなら即座に return する(二重初期化しない)。
 */
```

（`datascale/` のままでよい。変えるのは深さではなく事実で、事実は変わっていない。）

`src/finance/loan/types.ts`:

```ts
import type { CalcErrorCode } from "../../calc/types";
```

`src/finance/entry.ts` は深さが変わらないので `../units/entry` のままでよい。

- [ ] **Step 5: 呼び出し側の import を書き換える**

`src/ui/Loan/LoanPanel.tsx` の 4 行目と 28 行目:

```ts
import { initLoan, type LoanCalc, type LoanMode } from "../../finance/loan";
```

```ts
} from "../../finance/entry";
```

（`type ExprCalc` の行と `type FinanceCalc` の行は動かさない。）

- [ ] **Step 6: パスを指しているコメントを直す**

`src/finance/index.ts` の `initFinance` の上:

```ts
 * calc/ や finance/loan/ も init() を呼ぶが、生成された __wbg_init は
```

`src/pwa/index.ts` の 3 行目:

```ts
 * import してはならない(base-spec §4.3、datascale/finance の境界と同じ)。
```

- [ ] **Step 7: 通ることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc/web
pnpm typecheck && pnpm lint && pnpm test
```

期待: typecheck・lint とも無出力で成功、vitest は **141 passed (16 files)**。

- [ ] **Step 8: 検査内容が動いていないことを示す**

```bash
cd /home/terapyon/dev/CalcArc
git diff -M --stat
git diff -M -- web/src/finance/entry.test.ts   # 期待: 差分なし（純粋な移動）
```

- [ ] **Step 9: コミット**

```bash
cd /home/terapyon/dev/CalcArc
git add -A web/src
git commit -m "$(cat <<'EOF'
Move the TypeScript loan wrapper under finance

Rust の finance::loan に木を揃える。entry.ts は自分で「Finance の数の
入力」と名乗っており、複利の項目もここを通るので finance/ 直下に置く。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: キー集合を `Finance` に改名する

**Files:**
- Move: `web/src/ui/Keypad/loan.ts` → `web/src/ui/Keypad/finance.ts`
- Move: `web/src/ui/Keypad/loan.test.ts` → `web/src/ui/Keypad/finance.test.ts`
- Modify: `web/src/ui/Loan/LoanPanel.tsx`（import と型注釈）

**Interfaces:**
- Consumes: Task 1 の `web/src/finance/loan`・`web/src/finance/entry`
- Produces: `web/src/ui/Keypad/finance` が
  `FINANCE_SECTIONS: KeypadSection<FinanceKeyToken>[]`、
  `COMPOUND_FIELD_SECTION` / `PERIODS_SECTION` / `TAX_SECTION`
  （いずれも `KeypadSection<FinanceKeyToken>`）、
  型 `FinanceKeyToken` と `FinanceField` を export する。
  **`LoanKeyToken` と `LoanField` と `LOAN_SECTIONS` はもう存在しない。**

**改名の根拠:** このファイルは `mode:compound` `field:deposit` `field:periods`
`field:tax` `period:1|2|12` `tax:none` `tax:withholding` を持ち、`LoanField` は
`"deposit" | "periods" | "tax"` を含む。**ローンのキー集合ではない。**

- [ ] **Step 1: `git mv` で移す**

```bash
cd /home/terapyon/dev/CalcArc/web
git mv src/ui/Keypad/loan.ts      src/ui/Keypad/finance.ts
git mv src/ui/Keypad/loan.test.ts src/ui/Keypad/finance.test.ts
```

- [ ] **Step 2: 識別子を置き換える**

3 つの識別子だけを置き換える。**他の `Loan` / `loan` には触らない**
（`LoanCalc` などはローンを指しており、嘘ではない）。

```bash
cd /home/terapyon/dev/CalcArc/web
sed -i 's/\bLoanKeyToken\b/FinanceKeyToken/g; s/\bLoanField\b/FinanceField/g; s/\bLOAN_SECTIONS\b/FINANCE_SECTIONS/g' \
  src/ui/Keypad/finance.ts src/ui/Keypad/finance.test.ts src/ui/Loan/LoanPanel.tsx
grep -rn "LoanKeyToken\|LoanField\|LOAN_SECTIONS" src/   # 期待: 何も出ない
```

- [ ] **Step 3: 文言を直す**

`src/ui/Keypad/finance.ts` の冒頭のドキュメント 1 行目:

```ts
/**
 * Finance のキー集合。
```

`src/ui/Keypad/finance.test.ts` の 2〜4 行目と `describe`:

```ts
import { FINANCE_SECTIONS } from "./finance";

// Finance のキー集合そのものの検査。区画名は E2E のセレクタである(設計書 §3)。
```

```ts
describe("Finance のキー集合", () => {
```

**`expect` と期待値には触らない。**（区画名「計算の種類」「入力する項目」
「数字と演算のキー」は E2E のセレクタなので、日本語の region 名は 1 つも変えない。）

- [ ] **Step 4: `LoanPanel.tsx` の import 元を直す**

```ts
import {
  COMPOUND_FIELD_SECTION,
  FINANCE_SECTIONS,
  type FinanceField,
  type FinanceKeyToken,
  PERIODS_SECTION,
  TAX_SECTION,
} from "../Keypad/finance";
```

（`sed` が名前は直しているので、残るのはパスと import の並び順である。並び順は
`pnpm format` が Biome の規則で整える。）

- [ ] **Step 5: 通ることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc/web
pnpm format && pnpm typecheck && pnpm test
```

期待: vitest **141 passed (16 files)**。

- [ ] **Step 6: 検査内容が動いていないことを示す**

```bash
cd /home/terapyon/dev/CalcArc
git diff -M -- web/src/ui/Keypad/finance.test.ts
```

期待: 差分は import 行・コメント 1 行・`describe` の文字列・`FINANCE_SECTIONS`
への置換のみ。**`toEqual` / `toBe` / `toHaveLength` の引数が 1 つも変わっていないこと。**

- [ ] **Step 7: コミット**

```bash
cd /home/terapyon/dev/CalcArc
git add -A web/src
git commit -m "$(cat <<'EOF'
Let the keypad set say Finance, because it holds compound

LoanField は deposit・periods・tax を持ち、キー集合は mode:compound を
持っている。ローンのキー集合ではない。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: パネルを `FinancePanel` にする

**Files:**
- Move: `web/src/ui/Loan/LoanPanel.tsx` → `web/src/ui/Finance/FinancePanel.tsx`
- Move: `web/src/ui/Loan/LoanPanel.module.css` → `web/src/ui/Finance/FinancePanel.module.css`
- Move: `web/src/ui/Loan/LoanPanel.test.tsx` → `web/src/ui/Finance/FinancePanel.test.tsx`
- Modify: `web/src/App.tsx:3,37`
- Modify: `web/src/App.test.tsx:13-15,50`

**Interfaces:**
- Consumes: Task 2 の `web/src/ui/Keypad/finance`
- Produces: `web/src/ui/Finance/FinancePanel` が `FinancePanel` を named export
  する（React コンポーネント、props なし）。testid は `finance-load-error`
  （読み込み失敗の alert）と `loan-breakdown`（ローンの内訳。**据え置き**）。

- [ ] **Step 1: `git mv` で移す**

```bash
cd /home/terapyon/dev/CalcArc/web
mkdir -p src/ui/Finance
git mv src/ui/Loan/LoanPanel.tsx        src/ui/Finance/FinancePanel.tsx
git mv src/ui/Loan/LoanPanel.module.css src/ui/Finance/FinancePanel.module.css
git mv src/ui/Loan/LoanPanel.test.tsx   src/ui/Finance/FinancePanel.test.tsx
rmdir src/ui/Loan
```

- [ ] **Step 2: 識別子と CSS のパスを置き換える**

```bash
cd /home/terapyon/dev/CalcArc/web
sed -i 's/\bLoanPanel\b/FinancePanel/g' \
  src/ui/Finance/FinancePanel.tsx src/ui/Finance/FinancePanel.test.tsx \
  src/App.tsx src/App.test.tsx
sed -i 's#"loan-panel"#"finance-panel"#g; s#"loan-load-error"#"finance-load-error"#g' \
  src/ui/Finance/FinancePanel.tsx src/ui/Finance/FinancePanel.test.tsx src/App.test.tsx
grep -rn "LoanPanel\|loan-panel\|loan-load-error" src/ tests/   # 期待: 何も出ない
grep -rn "loan-breakdown" src/ tests/                            # 期待: 4 行のまま
```

`sed` は `import styles from "./LoanPanel.module.css"` も
`"./FinancePanel.module.css"` に直す（`LoanPanel` を含むため）。`App.tsx` の
import パスだけは手で直す:

```ts
import { FinancePanel } from "./ui/Finance/FinancePanel";
```

`App.test.tsx` の `vi.mock` も同じく手で直す:

```tsx
vi.mock("./ui/Finance/FinancePanel", () => ({
  FinancePanel: () => <p data-testid="finance-panel" />,
}));
```

- [ ] **Step 3: 通ることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc/web
pnpm format && pnpm typecheck && pnpm test
```

期待: vitest **141 passed (16 files)**。`FinancePanel（電卓）` の 32 件と
`App` の 6 件が緑。

- [ ] **Step 4: 検査内容が動いていないことを示す**

```bash
cd /home/terapyon/dev/CalcArc
git diff -M -- web/src/ui/Finance/FinancePanel.test.tsx web/src/App.test.tsx
```

期待: 差分は `LoanPanel` → `FinancePanel`、mock のパス、testid の 2 つだけ。
**`getByRole` の region 名「金融計算」、ボタンのアクセシブルネーム、期待する
表示文字列が 1 つも動いていないこと。**

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc
git add -A web/src
git commit -m "$(cat <<'EOF'
Rename the panel to FinancePanel, since it draws compound too

testid はパネル全体のものだけ finance に寄せ、loan-breakdown は据え置く
——ローンの内訳であり、E2E のセレクタでもある。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 木を指している文書とコメントを実態に合わせる

**Files:**
- Modify: `docs/base-spec.md:193-196`
- Modify: `web/src/ui/Readout/Readout.tsx:37`
- Modify: `web/src/ui/Readout/Readout.module.css:22`
- Modify: `web/src/ui/Readout/Readout.test.tsx:88`
- Modify: `web/src/ui/Keypad/types.ts:29`
- Modify: `web/src/ui/Keypad/dataScale.test.ts:15`
- Modify: `web/src/units/entry.test.ts:19,67`
- Modify: `web/tests/e2e/data-scale.spec.ts:17`

**Interfaces:**
- Consumes: Task 1〜3 の結果（木が確定していること）
- Produces: なし（文書とコメントだけ）

**線引き:** **タブやモジュールを指している `Loan` は `Finance` に、ローンの計算
そのものを指している `Loan` は据え置く。**

- [ ] **Step 1: base-spec の訂正印を実態に合わせる**

`docs/base-spec.md` の 193〜196 行（`finance` の枠は空いている、という訂正）は
**B spec のマージで古くなった**。コアは既に `finance::{compound, tax, loan}` で、
この計画で web も `finance/` に揃う。差し替える:

```markdown
**【訂正 2026-08-15】** `finance` の枠は埋まった。`finance::{compound, tax, loan}`
であり、ローンは `finance::loan` の下に居る
（[B 設計](superpowers/specs/2026-08-15-loan-under-finance-design.md)）。
web も同じ木で、`web/src/finance/{entry.ts, loan/}` と `web/src/ui/Finance/`
である（[web 移動の計画](superpowers/plans/2026-08-15-finance-web-move.md)）。
```

- [ ] **Step 2: タブを指しているコメントを直す**

`web/src/ui/Readout/Readout.tsx:37`:

```ts
 * Scientific / Finance / Data Scale が同じ部品を使う(設計書 §6)。モジュール
```

`web/src/ui/Readout/Readout.module.css:22`:

```css
   ——Finance と Data Scale では、打った数字はここにしか出ない。 */
```

`web/src/ui/Readout/Readout.test.tsx:88`:

```tsx
    // Finance と Data Scale が同じ部品を使う(設計書 §6)。DisplayState を
```

`web/src/ui/Keypad/types.ts:29`:

```ts
 * 2 区画で、Finance と Data Scale も同じ部品に自分のキー集合を渡す(S1 設計書 §6)。
```

`web/src/ui/Keypad/dataScale.test.ts:15`:

```ts
    // 区画名は E2E のセレクタである(設計書 §3)。Finance と同名のものがあるので、
```

`web/tests/e2e/data-scale.spec.ts:17`:

```ts
 * など)は Finance と同名のものがあり、名前だけでは足りない(設計書 §3)。
```

`web/src/units/entry.test.ts:19` と `:67`:

```ts
// 架空の単位表。**Finance でも Data Scale でもない組み合わせ**で、機構が
```

```ts
    // 呼び出し側の定義域（Finance は u64、D は u128）。
```

- [ ] **Step 3: 取りこぼしを見る**

```bash
cd /home/terapyon/dev/CalcArc/web
grep -rni "loan" src/ tests/ --include=*.ts --include=*.tsx --include=*.css
```

残ってよいのは次だけ。**それ以外が出たら直す。**

- `src/finance/loan/` の中身（ローンの型とラッパー）
- `src/ui/Finance/FinancePanel.tsx` の `initLoan` / `LoanCalc` / `LoanMode` /
  `loan-breakdown` と、ローンのモードを説明するコメント
- `src/ui/Finance/FinancePanel.test.tsx` の同様のもの
- `src/App.tsx:9` のコメント（旧 `#loan` ハッシュの説明）と
  `src/App.test.tsx:56-59`（`#loan` を経路にしない検査）——**URL の話であって
  木の話ではない**
- `tests/e2e/loan.spec.ts` `tests/e2e/loan-keypad.spec.ts`（ファイル名と中身）

- [ ] **Step 4: 通ることを確かめる**

```bash
cd /home/terapyon/dev/CalcArc/web
pnpm typecheck && pnpm lint && pnpm test
```

期待: vitest **141 passed (16 files)**。

- [ ] **Step 5: コミット**

```bash
cd /home/terapyon/dev/CalcArc
git add -A web/src web/tests docs/base-spec.md
git commit -m "$(cat <<'EOF'
Stop the comments from pointing at a tree that moved

base-spec の「finance の枠はまだ空いている」は B のマージで古くなった。
タブを指す Loan は Finance に、ローンの計算を指す Loan は据え置く。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ブランチ末尾のフルスイープ

**Files:** なし（検証のみ）

**Interfaces:**
- Consumes: Task 1〜4 のすべて
- Produces: 完了報告に貼る証拠

- [ ] **Step 1: web を全部回す**

```bash
cd /home/terapyon/dev/CalcArc/web
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

期待: vitest **141 passed**、Playwright **82 passed**。

**E2E が落ちたらそれは本物の回帰である**——この計画は region 名も
アクセシブルネームも `loan-breakdown` も変えていないので、E2E から見て
変わったものは 1 つも無いはずである。

- [ ] **Step 2: 触っていない層の diff が空であることを示す**

```bash
cd /home/terapyon/dev/CalcArc
git diff --stat main -- crates/ reference/ testdata/    # 期待: 無出力
```

- [ ] **Step 3: 移動が追えることを示す**

```bash
cd /home/terapyon/dev/CalcArc
git log --oneline --follow -- web/src/finance/loan/index.ts | head -5
git log --oneline --follow -- web/src/ui/Finance/FinancePanel.tsx | head -5
```

期待: 移動より前のコミットが続いて見えること。

- [ ] **Step 4: ブランチの中身を確かめる**

```bash
cd /home/terapyon/dev/CalcArc
git log --oneline main..HEAD
```

期待: **7 コミット**——spec 訂正 2 件（`a2a1e29` `696d5cd`）+ この計画書 1 件
（Task 1 の前に置く）+ 実装 4 件（Task 1〜4）。

- [ ] **Step 5: 完了報告**

次を報告に書く:

1. vitest 141 / e2e 82 が**基準値のまま**緑。
2. `crates/` `reference/` `testdata/` の diff が空。
3. `git log --follow` が移動を跨いで続いている。
4. テストファイルの変更が import・識別子名・`describe` 文字列だけで、
   **assert と期待値が 1 つも動いていない**。
5. push と PR は行っていない（CLAUDE.md）。

---

## スコープ外

- **`FinanceCalc` / `initFinance` の改名**（`finance/index.ts`）——複利のラッパーが
  Finance を名乗っている altitude の問題。`finance/compound.ts` に分けて
  `finance/index.ts` を barrel にする案があるが、**移動と混ぜない**。
- **WASM のエクスポート名**（`loan_forward` ほか）の整理。
- **E2E のファイル名**——複利の E2E が書かれた時点で判断する。
- **`crates/` の追加移動**（`Rate` の置き場所など、B spec §3 が送ったもの）。
- **複利の逆算**（目標額から必要積立額・必要年数）——spec 要。像が区間になる
  問題があるので、どちらの端を返すかを spec で決める必要がある。
