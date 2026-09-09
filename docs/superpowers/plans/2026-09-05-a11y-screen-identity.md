# 画面の現在地と読み上げ — 実装計画

設計書: `docs/superpowers/specs/2026-09-05-a11y-screen-identity-design.md`（**裁定済み**）
枝: `docs/a11y-review-intake`（`origin/main` = `7070f95` の上）
実行方法: **Subagent-Driven**（利用者方針。毎回聞かない）

---

## 全体の制約（**毎タスクのブリーフに写す**）

- **13 個の画面名の綴りを変えない。** 設計書 §2 の表は**利用者がその文字列を見て
  承認したもの**である。「より自然な言い回し」を思いついても**変えない**。
- **`CHANGELOG.md` に触らない。** `## 0.8.0 — 未リリース` は
  `calcarc-e6` が別の枝（`docs/changelog-history` = `9dde4f8`）で起こしている。
  **a11y のぶんは実装が終わってから `###` を足す**（`##` を二重に起こさない）。
- **`UpdateToast.tsx:45-54` の `Escape` の effect に触らない**（設計書 §6.2）。
  capture であることが必須で、**本物の番人が在る**（変異で赤を実測済み）。
  変えるのは `if (!waiting) return null` の 1 行と JSX の入れ子だけ。
- **`aria-current` に触らない**（設計書 §7）。
- **優先度 2（`useKeyboard` の汎用化）に触らない。** 別リリースである。
- **`git push` と PR は行わない。** コミットまで。
- **共有ワークツリー（`/home/terapyon/dev/CalcArc`・`/home/terapyon/dev/CalcArc-e2e`）の
  HEAD を動かさない。** 作業は隔離ワークツリーで行う。
- **コミット前に `git branch --show-current`** が `docs/a11y-review-intake` であること。
  **`git add -A` を打たない**（ファイルを名指しする）。
- **赤確認は一時コミットしてから壊し、戻しは再編集**（`git checkout <file>` を使わない
  ——同じファイルの別作業を巻き戻す）。
- コミットの末尾:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BWysjEZm5GHRCYaC373V2S
  ```

### 環境（**新しいワークツリーでは先に要る**）

```
cd web   && pnpm install && pnpm wasm    # E2E も typecheck も src/wasm を要る
cd heavy && pnpm install                 # tools/tests/ を走らせる runner は heavy が持つ
```

**`tools/` のテストは `cd heavy && pnpm test` で走る**（`heavy/vitest.config.ts:22` が
`../tools/tests/**/*.test.ts` を include している）。**Task 3 の番人はそこに居る。**

---

## ★ 順序の縛り — **Task 1 は `<h1>` より必ず前**

設計書 §9-1 の実測:

| | `main` の 1 番目の子 | `viewport-budget.spec.ts` が測る「余白」 |
|---|---|---|
| いま | `SECTION`（パネル） | **16.3125px**（要求は 8 以上） |
| `<h1>` を先に足したら | `H1` | **742**（`main` の高さそのもの） |

**逆順にすると「余白 742 の緑」が出る。赤くならない壊れ方**なので、
**間に 1 コミットでも挟むと、その版は「検査が通っている」という嘘を持つ。**

---

## Task 1 — 余白検査が**本当にパネルを測る**ようにする（**`<h1>` より前**）

**変える**: `web/tests/e2e/viewport-budget.spec.ts` の
`the tallest tab still has slack inside the screen` 1 本だけ。

1. パネルの取り方を `main.firstElementChild` から**「見出しではない子」**に変える
   （`main.querySelector(":scope > :not(h1)")` など）。**なぜそうするのかを註に書く**
   ——`<h1>` を `<main>` に置くのはこの計画の Task 5 であり、**置いた瞬間に
   この検査が `<h1>` を測り始める**から。
2. **測った物がパネルであることを assert する。** 下限は
   **`panel` の高さが `main` の高さの半分以上**。
   **「1×1 の要素を測って緑になった」を二度と起こさないため**の下限である。
   **いまの実測は `main` 743 / `panel` 726.6875**（`#finance`、390×844）。

**受け入れ**: `pnpm e2e viewport-budget.spec.ts` が緑。余白の値がいままでと同じ
（**16.3125px 前後**。数字が動いたら、測る対象を変えてしまっている）。

**★ 赤くなるものは、いまはまだ無い。** `<h1>` が存在しないので、
`firstElementChild` に戻しても**緑のままである**（当然、同じ要素を指す）。
**この番人の赤は Task 5 で実測する。** ブリーフにこの一文を必ず書くこと
——「変異させたが赤くならなかった」を欠陥と誤解させないため。

---

## Task 2 — 画面名を 1 か所で持つ

**新設**: `web/src/ui/screenName.ts` / `web/src/ui/screenName.test.ts`

```ts
export const SCREEN_NAMES: {
  scientific: string;
  finance: string;
  convert: Record<ConvertCategoryId, string>;   // 8。1 つ抜けたら typecheck が落ちる
  scale: Record<ScaleCategory, string>;         // 3。同上
};
export function screenName(route: Route): string;
```

**綴りは設計書 §2 の表そのまま**（13 個）。`route.category` が `null` のときと、
知らないカテゴリが来たときの落とし先も決めること（`routeFromHash` が既定へ倒すので
通常は来ないが、型の上では来る——`ScalePanel` の `isCategory` と同じ形で受ける）。

**番人（`screenName.test.ts`）**:

| 主張 | 形 |
|---|---|
| 画面名は **13 個** | `1 + CONVERT_CATEGORY_IDS.length + SCALE_CATEGORIES.length + 1` と実際の件数が一致（**数を導く。手で `13` と書かない**） |
| convert の 8 個は `CATEGORY_LABELS[id]` を**含む** | `expect(name).toContain(CATEGORY_LABELS[id])` |
| scale の 3 個は `LABELS[id].ja` を**含む** | 同上（**`ScalePanel` の `LABELS` を export する**） |
| `screenName(route)` が 13 route それぞれで表どおり | **期待値は逐一書く**（表から組み立てない。組み立てると両方が同時に間違っても緑になる） |

**赤くなるもの**: `CATEGORY_LABELS.length` を「長さ」→「距離」に改名すると
`toContain` が赤。1 行消すと件数が赤。**両方を実測すること。**

---

## Task 3 — 「視覚的に隠す」の綴りを 1 か所にし、規則で見張る

**変える**:

1. `web/src/ui/tokens.css` に `.visually-hidden` を足す。中身は
   `web/src/ui/Keypad/Keypad.module.css:65-75` の `.offDescription` **そのまま**
   （`position:absolute; width:1px; height:1px; margin:-1px; padding:0;
   overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0`）。
   **`display:none` と `visibility:hidden` は読み上げからも消える**という理由を
   註に書く（`.offDescription` の註にある一文を引き継ぐ）。
2. `Keypad.module.css` の `.offDescription` を**そこから引く**形にする。
   第一案は `composes: visually-hidden from global;`。**動かなければ**
   `Keypad.tsx` 側でグローバルのクラス名を直に当てる。
   **どちらでも `clip-path` の綴りが `tokens.css` に 1 つになればよい。**
3. `tools/check-boundary.mjs` に **5 本目の規則**:
   **`clip-path: inset(50%)` を宣言として書いてよいのは `web/src/ui/tokens.css` だけ。**
   **4 本目（`findTouchTargetOutsideTokens`）と同じ形にする**——宣言の行だけを見る／
   `.css` だけを見る／**註の中の綴りは違反にしない**。`main()` の集計と
   `report()` にも足す。
4. `tools/tests/check-boundary.test.ts` に 4 本足す（**既存 4 本と同じ並び**）:
   「外で書いていたら見つける」「`tokens.css` 自身は通す」「註の中は違反にしない」
   「**いまの web は 1 件も無い（実物で確かめる）**」。

**受け入れ**: `cd web && pnpm check:boundary` が OK、`cd heavy && pnpm test` が緑、
`cd web && pnpm test` `pnpm typecheck` `pnpm lint` が緑。
**`cd heavy && pnpm lint`（`tools/` も見る）を回すこと**——`tools/` を触ったので
**`heavy/` だけ緑でも CI は赤い**（CLAUDE.md「踏んだ罠」）。

**赤くなるもの**: 別の `.css` に `clip-path: inset(50%)` を書くと `check:boundary` が赤。
**実測すること。**

---

## Task 4 — `document.title` と、その番人（E2E）

**変える**: `web/src/App.tsx` に effect を 1 つ。
`document.title` に `${screenName(route)} | CalcArc` を入れる。
**初期表示でも走る**（`index.html` の `CalcArc` のままにしない）。

**新設**: `web/tests/e2e/screen-identity.spec.ts`

- **13 route を巡回し、`toHaveTitle` で逐一の期待値と突き合わせる。**
  **一覧は手で書く**（期待値をアプリと同じ表から作らない）。
- **網羅だけを導く**: 一覧の件数が
  `1 + CONVERT_CATEGORY_IDS.length + SCALE_CATEGORIES.length + 1` と一致することを assert。
  **カテゴリを足して一覧に書き忘れたら赤くなる。**
- **知らないハッシュ**（`#nope`）で `関数電卓 | CalcArc` になることも 1 本。

**赤くなるもの**: 区切りを `|` から `-` に変える／1 route の名前を変える／
一覧から 1 行消す（件数）。**3 つとも実測。**

---

## Task 5 — 隠した `<h1>` と、**Task 1・Task 3 の番人の赤確認**

**変える**: `web/src/App.tsx` の `<main>` の中に `<h1 className="visually-hidden">`
を 1 つ。文字列は `screenName(route)`（**タイトルの前半と同じ文字列**）。

**足す（`screen-identity.spec.ts`）**:
- 13 route それぞれで `getByRole("heading", { level: 1, name: <画面名> })` が **1 件**。
- **`<h1>` はページ全体でちょうど 1 つ**（`getByRole("heading", { level: 1 })` が 1 件）。
- **履歴の面でも `<h1>` が在り、`<h2>履歴` がその下に来る**（設計書 §8。
  `#scientific` → Shift → 履歴 と打って確かめる）。

**★ このタスクで 3 つの赤を実測する（一時コミット → 変異 → 再編集で復元）**:

| 変異 | 赤くなるはずのもの |
|---|---|
| `viewport-budget.spec.ts` のパネルの取り方を `firstElementChild` に戻す | **Task 1 の下限**（`<h1>` を測って半分を割る） |
| `tokens.css` の `.visually-hidden` を `display: none` にする | **Task 5 の役割クエリ**（設計書 §4.3 の実測どおり 0 件になる） |
| `<h1>` を `<div>` に変える | 同上 |

**受け入れ**: `pnpm e2e`（**全部**）が緑。**とくに `viewport-budget.spec.ts` の
11 route × 2 幅**が緑であること（**巡回は 11 である。全 13 route のうち
`#scale/llm` と `#convert/currency` は理由つきで外れている**——同ファイル冒頭の註）
——設計書 §4.1 の「縦の予算は動かない」は
**390×844 の Finance 1 route でしか測っていない見立て**であり、**ここが本番の測定**である。

---

## Task 6 — 切替の通知（`aria-live`）

**変える**: `web/src/App.tsx`。`<Nav>` と `<main>` のあいだに、
**常設の** `role="status" aria-live="polite"` を 1 つ（`className="visually-hidden"`）。
`route` が変わったら `${screenName(route)}に切り替えました` を入れる。
**初回は入れない**（effect の 1 回目を飛ばす。`ScientificPanel` の `savedScientific`
が同じ形）。

**番人（`web/src/App.test.tsx` に足す。jsdom で足りる——DOM の話である）**:

| 主張 | 形 |
|---|---|
| 領域が**初期描画から在る** | `getByRole("status", { name: … })` が在り、`toBeEmpty()` |
| `polite` である | `aria-live` 属性が `polite` |
| 切替で文面が入る | ハッシュを変えて「金融計算に切り替えました」 |
| **初回は鳴らない** | 初期描画の直後は空のまま |

**赤くなるもの**: 領域を条件付きにする／`assertive` にする／1 回目を飛ばす条件を消す。
**3 つとも実測。**

**★ 文面の出どころを 1 か所にする**（設計書 §12-2）——利用者の別案が出たら
差し替えるので、`「〜に切り替えました」` の綴りが 2 か所に散らないこと。
**テストは期待値を自分で持つ**（アプリと同じ定数から作らない）。

---

## Task 7 — `UpdateToast` の live 領域を常設にする

**変える**: `web/src/ui/UpdateToast/UpdateToast.tsx`

```
<div role="status" aria-label="更新のお知らせ" aria-live="polite">   ← 常に在る。空
  {waiting && <div className={styles.toast}> …メッセージとボタン… </div>}
</div>
```

- **常設にするのは領域だけ。** メッセージとボタンは `waiting` のときだけ
  ——**空のときにフォーカスの入る場所を作らない**。
- **`Escape` の effect（`:45-54`）に触らない。**

**同じコミットで直す既存の 2 本**（設計書 §9-2・§9-3。**赤くなるので嘘は残らない**）:

1. `says nothing until an update is waiting` は
   `expect(screen.queryByRole("status")).toBeNull()` ——**いまと逆のことを言う**。
   **「領域は在る。ただし空である」**に書き換え、**題も変える**
   （`says nothing` は「DOM に無い」と読める）。
   手本は `web/tests/e2e/eng-notation.spec.ts:34,58,88` の `toBeEmpty()`。
2. `swallows the Escape so the calculator does not clear` の
   `await screen.findByRole("status")` は**常設にすると即座に解決する**。
   **待つ対象を中身に変える**（`findByText(/新しいバージョンがあります/)`）。
   **この 1 本は本物の番人である**（`addEventListener` の `true` を外すと赤。実測済み）。

**受け入れ**: `cd web && pnpm test` 緑、`pnpm e2e update-toast.spec.ts` 緑
（**`update-toast.spec.ts` は変えない**）、
**`pnpm e2e viewport-budget.spec.ts` が 11 route × 2 幅で緑**
——設計書 §6 の「空の領域は通常フローで高さ 0」は**見立てであって実測ではない**。
**ここが実測である。**

**赤くなるもの**: `if (!waiting) return null;` を戻すと、書き換えた 1 本目が赤。
`true` を外すと 2 本目が赤。**両方を実測。**

---

## Task 8 — 全ゲートと、見立ての当て直し

**回す**（印字を残す）:

```
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cd web   && pnpm test / pnpm typecheck / pnpm lint / pnpm check:boundary / pnpm check:version
cd web   && pnpm e2e                       # 全部
cd heavy && pnpm test / pnpm lint          # tools/ を触ったので必須
git diff origin/main --stat -- crates/     # **0 行であること**（Rust に触っていない）
```

**当て直す見立て 2 件**（設計書 §13 が「測っていない」と書いたもの）:

1. 隠した `<h1>` の縦の予算 —— **11 route × 2 幅**（`viewport-budget.spec.ts` が持つ。
   **13 ではない**——`#scale/llm` と `#convert/currency` は同ファイルに理由つきで外してある）
2. `UpdateToast` の空の領域が高さ 0 —— 同上

**設計書の §13 と §12-4 を更新する**:
- §13 の「1 route でしか測っていない」「見立てである」の 2 行は、**実測に置き換える**
  （落ちなかったのなら、その旨と何本回したかを書く）。
- **§12-4 は消さない。** 実装が終わっても**未決である**ことが、次に読む人に見えている
  必要がある（監視役の指示）。

---

## 見張られないまま残るもの（**先に書いておく**）

| 何が | なぜ番人を置けないか |
|---|---|
| **読み上げソフトが実際に喋る** | CI に読み上げソフトが無い。**機械で言えるのは「アクセシビリティツリーに出ている」まで**（設計書 §10.1）。**この差を縮めて書かない** |
| `polite` が実際に割り込まないこと | 同上。根拠は `polite` を選んだ理由（設計書 §5）だけである |
| 切替の文面が自然に聞こえること | 主観。**監視役が既定を選んだだけ**で、利用者の裁定ではない（設計書 §12-2） |
| **読み上げが長くなること**（§12-4） | 実機で聞くまで分からない。**未決のまま残す** |
