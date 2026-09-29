# 広い配置（1.1）実装計画

> **実行方法は Subagent-Driven。** 担当は実行役・検証役・レビュー役の 3 人で、監視役が枠と中継を持つ。

**目標**: タブレットで枠を広げ、スマホ横持ちを「短い画面」として使えるようにする。
**キーの並べ替え（Shift の裏を表に）は 1.2**。

**設計書**: `docs/superpowers/specs/2026-09-29-wide-layout-design.md`
（**この計画は設計書から論じている。両方読むこと。**）

**起点**: `2b478f0`（= v1.0.0）。枝は `feat/wide-layout`。

---

## 全体の制約

- **スマホ縦持ち（390×844）の見え方を 1px も変えない。** `panel-sizing.spec.ts:61`（板 366px）
  と `:90`（キー 67px）が緑のままであることが、その証拠になる。
- **Playwright の project を増やさない。** `tools/tests/webkit-gate.test.ts:27-30` が
  `toEqual(["webkit"])` で数を固定している。**各 spec の中で `setViewportSize` する**
  （`panel-sizing.spec.ts:102`・`footer.spec.ts:118` の既存流儀）。
- **`narrowSize()` を新しい検査から呼ばない**（`webkit-gate.test.ts:417-424` が
  `finance-layout.spec.ts` の 2 か所ちょうどで固定）。
- **新しい検査で `browserName` を使わない**（同 `:426-441` が 4 ファイルちょうどで固定）。
- **段の条件は `@media (min-width: 600px) and (min-height: 600px)`**（＝短辺 600px 以上。
  **2026-09-29 に 700 から下げた**——当たるのは画面の短辺ではなく viewport で、
  **Safari のタブではツールバーの分だけ横持ちの高さが小さい**。レビュー役の阻止 A1）。
- **キーの天井は `--touch-target-max: 88px`**、**タブレットの `--shell-max-width` は
  そこから導く**（`calc(5 * 88 + 4 * 8 + 24) = 496px`）。**選ぶ数ではない。**
- **貼り付きに条件を付けるかは実測で決める**（阻止 A4。第 1 候補は条件なし）。
- **新しい spec に `browserName` の綴りを書かない——註の中にも**
  （`webkit-gate.test.ts:436` が本文全体に `\bbrowserName\b` を当てる。レビュー役の条件 B5）。
- **コミット前に 3 つ揃える**（`pnpm test`・lint・`tsc`）。**`cargo fmt` は不要**（Rust を触らない）。
- **重い段（E2E）は監視役の枠で 1 人ずつ。** 取る前に声をかける。

---

## 先に読むべき 2 つの実測

**① 貼り付きは、過去に巡回を赤くしている。**
`ManualPage.module.css:39-44` の註——**2026-09-23、低い画面でお知らせが出ていると
`scrollIntoView({ block: "nearest" })` がボタンを `.backBar` の真下に置き、
`elementFromPoint` が `<a>` を返した（「covered by <a>」で 4 本赤）。**
**巡回は `block: "nearest"` をわざと使っている**（`short-screens.spec.ts:34-35` の註:
「**真ん中へ寄せると、端に固定された物の下に隠れたキーを見逃す**」）。
**直し方も残っている**——`scroll-margin-top: calc(var(--touch-target-min) + 8px)`
（`ManualPage.module.css:44`・`:120`）。**表示欄の貼り付きにも同じ手当てが要る。**

**② キーの天井は、枠を広げるまで何も主張しない。**
天井 88px は、`--shell-max-width` が 480px のままだと**一度も触らない**
（480px でキーは 84.8px）。**だから天井と枠の拡大は 1 つのタスクにする**
——**別々に入れると、天井の番人が「何も主張しないテスト」になる。**
**赤を撮るために、4-3 でいったん素の `560px` を置く**（`(560−24−32)÷5 = 100.8px > 88`）。
**4-4 でそれを天井から導く式に差し替える**と、キーはちょうど 88px に着地する。

---

## 触るファイル

| ファイル | 役割 |
|---|---|
| `web/src/ui/tokens.css` | `--touch-target-max` 新設／段の `@media` で `--shell-max-width` |
| `web/src/ui/Key/Key.module.css` | `.key` の `scroll-margin-top`（貼り付いた表示欄の下に隠れないため） |
| `web/src/ui/Readout/Readout.module.css` | `position: sticky`（条件を付けるかは実測で決める） |
| `web/src/ui/App.module.css` | 左右の安全域 |
| `web/src/ui/Manual/ManualPage.module.css` | 本文の読み幅 |
| `web/tests/e2e/widths.ts` | 横持ち・タブレットの寸法（**定数を足すだけ。`narrowSize` は触らない**） |
| `web/tests/e2e/short-screens.spec.ts` | 横持ちを巡回に足す |
| `web/tests/e2e/wide-layout.spec.ts` | **新設**——タブレットの寸法と天井 |
| `web/tests/e2e/readout-visibility.spec.ts` | **新設**——表示欄が見えていること |
| `web/tests/unit/manual-widths.test.ts` | README 2 冊を読む |
| `web/tests/unit/safe-area.test.ts` | **新設**——左右は外枠 1 か所・下端に無い |
| `tools/check-boundary.mjs` ＋ `tools/tests/check-boundary.test.ts` | 88px の見張り |

---

## タスク

### Task 1 — README の幅の番人（設計 §4 の #7）【検証役】

**1.0 で「番人が無い」と裁定して持ち越した穴を、幅を触る前に塞ぐ。**
**後に置くと、番人は「変えた結果」を追認するだけになる。**

**Files**: Modify `web/tests/unit/manual-widths.test.ts`

- [ ] **1-1** `manual-widths.test.ts` に `describe("README の画面幅は E2E の幅と同じである")` を足す。
  **README の読み方は `readme-images.test.ts:17-22` に倣う**
  （`const REPO = join(import.meta.dirname, "..", "..", "..")`、`["README.md", "README.en.md"]`）。
  **★ 正規表現はそのままでは足りない**（**2026-09-29、検証役が実測。この計画の誤り**）。
  `README.en.md:33-34` は **`from 360px` と `wide` のあいだで行が折り返している**ので、
  既存の `EN = /from (\d+)px wide/g` は **360 を落として `[375]` だけを拾う**。
  **`/from (\d+)px\s+wide/g` に広げる**——**マニュアル 3 冊は 1 行に収まっているので、
  広げても拾う数は変わらない**（実測で確認済み）。**理由を註に書く。**
  日本語側（`README.md:33-34`）は「幅 (\d+)px 以上」が 1 行に収まっており、そのままでよい。
  **計画を書いた監視役は本文を読んだだけで、正規表現を当てていなかった**
  ——**「確かめた範囲」と「書いた範囲」がずれていた実例。**
  **主張は `toEqual([CHROMIUM_NARROW_WIDTH, WEBKIT_NARROW_WIDTH])`。**
- [ ] **1-2** `cd web && pnpm test manual-widths` → **緑であること**（いまの README は 360/375）。
- [ ] **1-3 赤確認。** **一時コミットしてから** `README.md` の `360px` を `361px` に書き換え、
  同じテストを回して**赤を撮る**。**戻しは再編集**（`git checkout HEAD -- README.md` は使わない
  ——同ファイルの別作業を巻き戻す）。
- [ ] **1-4** `pnpm test` 全体・`pnpm lint`・`npx tsc --noEmit` → コミット。

**Interfaces / Produces**: なし（既存の定数を読むだけ）。

---

### Task 2 — 横持ちを巡回に足す（#3）【検証役】

**Files**: Modify `web/tests/e2e/widths.ts`, `web/tests/e2e/short-screens.spec.ts`

- [ ] **2-1** `widths.ts` に足す（**`narrowSize` は触らない**）:
```ts
/** **スマホの横持ち**。高さが幅より小さい組み合わせは、2026-09-29 まで E2E に 0 件だった。
    844×390 は iPhone 13/14 を、667×375 は SE を横にした寸法である。 */
export const LANDSCAPE_VIEWPORTS = [
  { device: "iPhone 13", width: 844, height: 390 },
  { device: "iPhone SE", width: 667, height: 375 },
] as const;
```
- [ ] **2-2** `short-screens.spec.ts` の 1 本目のループを
  `[...SAFARI_VIEWPORTS, ...LANDSCAPE_VIEWPORTS]` にする。
  **床 428 はそのまま**（「以上」なので、対象が増えても赤くならない）。
  **註を足す**——**「428 は押せるものを何個見たかで、盤面のキーの数ではない」**という
  既存の註（`:110-117`）の続きに、**横持ちを足した日付と理由**を書く。
- [ ] **2-3** 【監視役に枠を申請してから】`cd web && npx playwright test tests/e2e/short-screens.spec.ts --project mobile`
  → **結果を印字ごと報告**。**赤なら、その `problems` の中身が次のタスクの材料になる。**
  **緑でも、それは「横にはみ出さず、全キーに届く」ことの証拠として意味がある。**
- [ ] **2-4** コミット。

**Produces**: `LANDSCAPE_VIEWPORTS`（Task 3 が使う）。

---

### Task 3 — 表示欄が見えていること（#4）と、貼り付き【検証役→実行役】

**このタスクだけ「赤を先に撮る」ことが本質である。**

**★ 3-2 は済んだ**（2026-09-29、検証役）。**赤は横持ちの 2 寸法だけ**——844×390 で表示欄の
上端が **−266.8px**、667×375 で **−281.8px**。**既存の 4 寸法（高さ 629〜667）は 4 つとも緑。**
**計画の初稿「この穴は横持ちのために生まれるのではなく、いまも在る」は偽だった**
——**横持ちを見るようにしたから、初めて見えた。**

**Files**: Create `web/tests/e2e/readout-visibility.spec.ts`;
Modify `web/src/ui/Readout/Readout.module.css`, `web/src/ui/Key/Key.module.css`

- [ ] **3-1**【検証役】新しい spec を書く。**掴み手は `data-testid`**
  （`Readout.tsx:84` の `display-main`）。**寸法は `SAFARI_VIEWPORTS` と `LANDSCAPE_VIEWPORTS`。**
```ts
import { expect, test } from "./fixtures";
import { LANDSCAPE_VIEWPORTS, SAFARI_VIEWPORTS } from "./widths";

/** **押している最中、答えが画面の中に在る。**
    低い画面ではスクロールして押すことになり、そのとき表示欄が上へ流れていく
    ——**電卓としては、押せても答えが見えなければ意味がない。** */
for (const size of [...SAFARI_VIEWPORTS, ...LANDSCAPE_VIEWPORTS]) {
  test(`the answer stays on screen while reaching the last key at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    const last = page.locator("main button").last();
    await last.scrollIntoViewIfNeeded();
    const box = await page.getByTestId("display-main").boundingBox();
    expect(box, "表示欄が見つからない").not.toBeNull();
    // **上端が画面の中に在り、下端も画面の中に在る**（部分的に見えるだけでは足りない）。
    expect(box?.y, "表示欄の上端").toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0), "表示欄の下端").toBeLessThanOrEqual(
      size.height,
    );
  });
}
```
- [ ] **3-2**【検証役】枠を申請して走らせ、**赤を撮る**。**何寸法が赤いかを印字ごと報告。**
  **もし全部緑なら、設計 §7 の前提が 1 つ崩れる**——**その場合は止めて監視役に報告する**
  （**貼り付けを入れる理由が消えるので、Task 3 を落とす判断になりうる**）。
- [ ] **3-3**【実行役】`Readout.module.css` に足す:
```css
/* **横持ちでは、答えが上に残る。** 最後のキーまでスクロールすると表示欄が画面の外へ出る
   ——844×390 で上端が −266.8px、667×375 で −281.8px（2026-09-29 に E2E で実測）。
   **既存の 4 寸法（高さ 629〜667）では起きていない**——**前から在った穴ではなく、
   横持ちを見るようにして初めて見えたものである。**
   **500px は測った数の間にある**（赤は 390・375、緑は 629〜667。どちらからも 100px 以上）。 */
@media (max-height: 500px) {
  .readout {
    position: sticky;
    top: 0;
    z-index: 1;
  }
}
```
**★ レビュー役の阻止 A4（「500px では `SAFARI_VIEWPORTS` に効かない」）は、実測で解けた**
——**`SAFARI_VIEWPORTS` は効かせる必要が無かった**（4 つとも緑）。**懸念は正しく、答えは
逆向きに出た。** **条件なしにはしない**——**緑の 4 寸法でも貼り付くことになり、
いま通っている寸法の見え方が変わる。変える理由が無い所は変えない。**

**★ 計画書のコード片は、そのまま貼ると `biome check` が `format` で赤くする**
（2026-09-29、検証役が 3-1 で実測）。**貼ったあとに `biome check --write` を通すこと。**
- [ ] **3-4**【実行役】`Key.module.css` に足す。**これが無いと `short-screens.spec.ts` が
  「covered by」で赤くなる**——**2026-09-23 に `.backBar` で実際に起きた**
  （`ManualPage.module.css:39-44`）。**巡回は `block: "nearest"` をわざと使っている。**
```css
/* **貼り付いた表示欄の下に隠れないように、上端へ送るときの余白を持つ。**
   **`ManualPage.module.css:44` と同じ手当て**——あちらは戻る道の 1 行で、
   2026-09-23 に `short-screens.spec.ts` が「covered by <a>」で見つけた。
   **値は実測で決める**（下の註に、何 px で緑になったかを書くこと）。 */
.key { scroll-margin-top: <実測で決めた値>; }
```
**★ セレクタは `.key`**（レビュー役の条件 B3）——**`button` の型セレクタは CSS Modules でも
全域に効き、マニュアルや履歴のボタンにまで掛かる。**
**★ 表示欄の高さは幅で変わる**（`tokens.css:44` の `--display-size-main: clamp(1.75rem, 8vw, 2.5rem)`）。
**375px で足りる値が 844px 幅で足りないことがある**——ループが両方を回すので
「**両方緑になる最小**」で取れるが、**註に「どの幅の表示欄の高さに対応する数か」を書く。**
**★ 値は当てずっぽうで書かない。** `readout-visibility.spec.ts` と
`short-screens.spec.ts` の両方が緑になる最小の値を**測って**決め、**その数と測り方を註に書く。**
- [ ] **3-5** 両方の spec を走らせて緑 → `pnpm test`・lint・tsc → コミット。

**Consumes**: `LANDSCAPE_VIEWPORTS`（Task 2）。

---

### Task 4 — タブレットで広げ、キーに天井を付ける（#1・#2）【実行役】

**天井と拡大を分けない**——上の「先に読むべき 2 つの実測 ②」のとおり、
**分けると天井の番人が何も主張しない。**

**Files**: Modify `web/src/ui/tokens.css`;
Create `web/tests/e2e/wide-layout.spec.ts`; Modify `web/tests/e2e/widths.ts`

- [ ] **4-1** `widths.ts` に足す:
```ts
/** **タブレット**。短辺が 600px 以上ある寸法だけを並べる（設計 §2.2）。
    768×1024 は旧 iPad の縦、1024×768 はその横、1180×820 は iPad Air の横である。 */
export const TABLET_VIEWPORTS = [
  { device: "iPad portrait", width: 768, height: 1024 },
  { device: "iPad landscape", width: 1024, height: 768 },
  { device: "iPad Air landscape", width: 1180, height: 820 },
] as const;
```
- [ ] **4-2** 新しい spec を書いて、**先に走らせる**。
  **この時点では「キーが 88px 以下」が赤になるはず**（天井がまだ無く、
  枠も 480px なので実測 84.8px → **緑になってしまう**）。
  **だから順番はこう**: まず **4-3 の枠の拡大だけ**を入れて走らせ、**100.8px で赤を撮る**。
  **そのあと 4-4 の天井を入れて緑にする。** **この順でないと、天井が効いた証拠が残らない。**
```ts
import { expect, test } from "./fixtures";
import { TABLET_VIEWPORTS } from "./widths";

for (const size of TABLET_VIEWPORTS) {
  test(`the board stays usable at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.locator("main button").first()).toBeVisible();
    const spill = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(spill, "横にはみ出す量").toBeLessThanOrEqual(0);
    const boxes = await page.locator("main button").evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })),
    );
    // **0 件で緑にしない。** Scientific は 7 + 7 + 25 = 39（viewport-budget.spec.ts:241 と同じ数え方）。
    expect(boxes.length, "見たキーの数").toBeGreaterThanOrEqual(39);
    // **★ 幅だけを見る**（レビュー役の阻止 A2）。**関数列 14 本は高さ 34px** である
    // （`Keypad.module.css:48-50` の `.half > button { height: var(--function-row-height) }`、
    // `tokens.css:60` で 34px）。**高さも見ると、天井が在っても無くても常に赤**になり、
    // **4-3 で撮る赤が「天井の赤」なのか「関数列の赤」なのか見分けが付かなくなる。**
    // `viewport-budget.spec.ts:246` も幅だけを見ている——**同じ数え方に揃える。**
    expect(boxes.filter((b) => b.w < 44), "44px を割ったキー").toEqual([]);
    // **★ 天井は「等しい」で主張する**（レビュー役の条件 D1）。
    // **`> 88` が空、という形では「広げすぎていない」しか言っていない**
    // ——**段を丸ごと消して 480 に戻しても（84.8）・閾値を 800 に上げても
    // （段に入らず 84.8）・式の `5` が `columns: 5` とずれても・仮の 560 のままでも
    // （100.8）緑**になる。**1e が数で示した。変異で当てるのは実装が上がってから。**
    // **`panel-sizing.spec.ts:70-95` と同じ形にする**——**`main button` 全体では
    // 「どこかに 1 本 88 が在る」しか言えない**ので、**正方の区画のボタンだけを取る。**
    const squares = await page
      .getByRole("group", { name: "数字と演算のキー" })
      .getByRole("button")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    expect(squares.length, "正方のキーの数").toBe(25);
    expect(new Set(squares), "正方のキーの幅（丸めて）").toEqual(new Set([88]));
    const board = await page
      .getByRole("group", { name: "数字と演算のキー" })
      .boundingBox();
    expect(Math.round(board?.width ?? 0), "盤面の幅").toBe(472);
  });
}
```
- [ ] **4-3** `tokens.css` の `--touch-target-min` の隣に天井を足し、**段を「素の 560px」で入れる**
  （**この 560px は赤を撮るための仮の値**。4-4 で式に差し替える）:
```css
  /* **床と対になる天井。** 44px は指の下限で、88px は「間延びしない上限」である
     （利用者の裁定 2026-09-29「横幅はそこまで大きくしなくて良い」）。
     **いまの実質最大は 84.8px**（480px 幅のとき）なので、そのすぐ上に置いた。
     **88px を CSS の値として書いてよいのはこの 1 行だけ**——`tools/check-boundary.mjs`
     が見張る（Task 5。**この計画では Task 5 が先に済んでいる**）。 */
  --touch-target-max: 88px;
```
```css
/* **短辺が 600px 以上ならタブレットである**（設計 §2.2）。 */
@media (min-width: 600px) and (min-height: 600px) {
  :root {
    --shell-max-width: 560px; /* ← 仮。4-4 で式にする */
  }
}
```
**ここで 4-2 の spec を走らせ、赤を撮る**——**`(560 − 24 − 32) ÷ 5 = 100.8px` で、
`toContain(88)` と `toBe(472)` の両方が落ちる**（**盤面は 536px になる**）。
**この赤が、天井が効いたことの唯一の証拠である。**
- [ ] **4-4** **仮の 560px を、天井から導く式に差し替える**（設計 §2.3）:
```css
@media (min-width: 600px) and (min-height: 600px) {
  :root {
    /* **枠の幅は選ぶものではなく、キーの天井から出てくる数である。**
       5 列 × 88px ＋ 隙間 4 × 8px ＋ パネルの padding 12px × 2 = 496px。
       **1.2 で 10 列にするときは、この `5` を変えるだけでよい**（976px になる）。 */
    --shell-max-width: calc(5 * var(--touch-target-max) + 4 * var(--key-gap) + 24px);
  }
}
```
**4-2 の spec が緑になる**（キーはちょうど 88px）。
- [ ] **4-5** **`Keypad.module.css` は触らない。**
  **★ 初稿の `minmax()` ＋ `justify-content: center` は採らない**（レビュー役の条件 B1）。
  **あれは区画ごとに効くので段差ができる**——560px の枠（内側 536）では
  **正方の区画（5 列）は 472px に縮んで中央へ寄り、関数列（7 列）は
  `(536−48)÷7 = 69.7px` で 536px いっぱいに広がる**。**数字の板だけが左右 32px 内側に入る。**
  **枠の幅そのものを天井から導けば、区画はすべて同じ幅のまま揃う。**
- [ ] **4-6** 4-2 の spec が緑になることを確認。
- [ ] **4-7 いちばん大事な確認**: **`panel-sizing.spec.ts` と `viewport-budget.spec.ts` を
  走らせ、緑のままであること**（**スマホ縦持ちを 1px も変えていない証拠**）。
  **`panel-sizing.spec.ts:96-102` は 1280 / 768 / 390 の 3 幅**を回すので、
  **768×844 と 1280×844 の 2 幅が新しい段に入る**（どちらも両辺 ≥ 600）。
  **設計 §7 の「要実測」はこの 1 本の 2 幅である。赤なら止めて報告。**
- [ ] **4-8** `pnpm test`・lint・tsc → コミット。

**Produces**: `TABLET_VIEWPORTS`、`--touch-target-max`。

---

### Task 5 — 88px の番人（#5）【実行役】

**規律を書いたら同じコミットで番人を置く。** 44px がそうなっている
（`tokens.css:12-16` の註＋`check-boundary.mjs:176`）。

**Files**: Modify `tools/check-boundary.mjs`, `tools/tests/check-boundary.test.ts`

- [ ] **5-1** `findTouchTargetOutsideTokens`（`check-boundary.mjs:176`）は `44px` を
  正規表現に直書きしている。**44 と 88 の両方を見る形に一般化する**
  ——**関数を分けるか引数にするかは実行役の判断でよいが、
  「どちらが破られたか」が報告の文で分かること。**
- [ ] **5-2** `tools/tests/check-boundary.test.ts:131` の `describe` に倣って、
  **88px の判別ケースと対照ケースを書く**（`tokens.css` の中は見逃す／
  ほかの CSS に書いたら拾う／`188px` のような部分一致を拾わない）。
- [ ] **5-3** `cd heavy && pnpm lint` を回す（**`heavy` の lint は `tools/` も見る**
  ——`heavy/` だけ緑でも CI は赤い。2026-09-02 に実際に落ちた）。
- [ ] **5-4 赤確認**: 一時コミットしてから、どれかの CSS に `min-height: 88px` を足して
  `node tools/check-boundary.mjs` が落ちることを確かめ、再編集で戻す。
- [ ] **5-5** コミット。

---

### Task 6 — 左右の安全域（#6）【実行役】

**Files**: Modify `web/src/ui/App.module.css`; Create `web/tests/unit/safe-area.test.ts`

- [ ] **6-1** `.shell` に足す:
```css
  /* **横持ちのノッチ側を避ける。** `safe-area-inset-left`/`right` は 2026-09-29 まで
     0 件だった。**下端はここで吸わない**——`ScientificPanel.module.css:7-11` の註の
     とおり、フッタが持っており、**二重に吸うと standalone 起動でだけ下が 44px 伸びる。**
     **同じ間違いを左右で繰り返さないために、左右はここ 1 か所だけが持つ。** */
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
```
- [ ] **6-2** 静的な番人を書く。**主張は 2 つ**——
  **`safe-area-inset-left`/`right` を書いている CSS は `App.module.css` の 1 ファイルだけ**、
  **`App.module.css` に `safe-area-inset-bottom` は無い**。
  **`web/src/ui` 配下の `*.css` を読んで数える**（`readme-images.test.ts` の
  `REPO` の組み方に倣う）。
- [ ] **6-3 赤確認**: ほかの CSS に `padding-left: env(safe-area-inset-left)` を足して赤、再編集で戻す。
- [ ] **6-4** `pnpm test`・lint・tsc → コミット。

---

### Task 7 — マニュアル画面の読み幅（設計 §2.5）【実行役】

**Files**: Modify `web/src/ui/Manual/ManualPage.module.css`

- [ ] **7-1** `.page` に読みやすい幅の上限と中央寄せを足す。
  **`--shell-max-width` は使わない**——**盤面の幅と読み物の幅は別の理由で決まる**
  （盤面は指、読み物は 1 行の文字数）。**新しいトークンを 1 つ作り、理由を註に書く。**
- [ ] **7-2** `manual.spec.ts` の既存の検査（`:131` の 360px ではみ出さない、
  `:107` 付近の注記が PDF リンクの上に在る）が**緑のまま**であることを確認。
- [ ] **7-3** `TABLET_VIEWPORTS` で `#manual` を開き、**本文の 1 行が上限を超えないこと**を
  `wide-layout.spec.ts` に 1 本足す。
- [ ] **7-4** コミット。

---

### Task 8 — 文書と版上げ【実行役】

- [ ] **8-1** **マニュアル 3 冊と README 2 冊を点検する。**
  **変える所**: 広い画面での見え方に触れる必要があるか。
  **変えない所**: **理由を残す**（設計 §3 の「横持ちの断りを書かない理由」はすでに設計書に在る
  ——**マニュアル側にも同じ判断をした跡が要るかを、実行役が判断して報告**）。
- [ ] **8-2** `node tools/check-manual-limits.mjs`・`pnpm check:manual-freshness`・
  `check-citations`・`check-conflict-markers` を回す。
- [ ] **8-3** 版数 6 か所を 1.1.0 に（`Cargo.toml`・**`Cargo.lock` の 2 つ**・
  `web/package.json`・`README.md`・`README.en.md`・`CHANGELOG.md` の見出し）。
  **`node tools/check-version.mjs --tag v1.1.0`。**
- [ ] **8-4** CHANGELOG の 1.1.0 に書く。**利用者から見える変化**:
  タブレットで少し大きくなる／横持ちで答えが上に残る／横持ちのノッチ側が削れなくなる／
  マニュアルが読みやすい幅で止まる。**書かないこと**: 横持ちが 1 画面に収まらないこと
  （設計 §3）。
- [ ] **8-5** コミット。

---

## 検証の締め（実行役、監視役の枠で 1 回）

- `cargo test --workspace`（**Rust は触っていないので、緑の確認だけ**）
- `cd web && pnpm test`・`pnpm lint`・`npx tsc --noEmit`
- `cd web && npx playwright test --project mobile`（**全走**）
- `cd heavy && pnpm lint`（**`tools/` も見る**）・`pnpm heavy`
- `cd reference && uv run --no-config pytest`（**`--no-config` を忘れない**）
- 文書の番人 6 本＋`check-version --tag v1.1.0`

**WebKit はこの機で起動できない**（system ライブラリが無く `browserType.launch` で落ちる。
**コードの赤ではない**）。**PR の CI が回す。**

---

## レビュー役への発注（1e）

**設計と実装の両方。** 特に:

1. **Task 4 の順番が守られたか**——**枠を広げてから天井を入れ、その間に
   `toContain(88)` と `toBe(472)` が落ちる赤を撮ったか**（仮の 560px でキーは 100.8px、
   盤面は 536px）。**順番を飛ばすと、天井の番人は何も主張しない。**
   **あわせて 4 つの変異で当ててください**（段を消して 480 に戻す／閾値を 800 に上げる／
   式の `5` をずらす／仮の 560px のまま）——**4 つとも赤になるはず。**
2. **Task 3 の `scroll-margin-top` の値が、当てずっぽうでなく実測で決まっているか。**
   **その値を減らすと `short-screens.spec.ts` が「covered by」で赤くなるか**を、
   **自分の変異で確かめる。**
3. **番人 7 つが、それぞれ外すと赤くなるか**——**自分の変異で**
   （書いて赤を撮っただけでは番人ではない）。
4. **スマホ縦持ちが 1px も変わっていないこと**——`panel-sizing.spec.ts` の
   `366px`・`67px` が緑のまま。
5. **`webkit-gate.test.ts` の 3 つの `toEqual`**（project 一覧・`narrowSize` の呼び出し 2 か所・
   `browserName` の 4 ファイル）**が緑のまま**。
6. **設計書 §7 の未確認 6 件が、実測で埋まったか／埋まらなかったものが正直に残っているか。**

---

## 自己点検（この計画を書いたあとに当てた）

- **設計書の節と対応**: §2.1 → Task 2・3（横持ち）／§2.2・§2.3 → Task 4／§2.4 → Task 4／
  §2.5 → Task 7／§2.6 → Task 3・6／§3 → Task 8-1／§4 の #1〜#7 → Task 4・4・2・3・5・6・1／
  §5 の段取り → タスクの順／§6 → 触らない／§7 → レビュー役の 6 番目。**穴なし。**
- **穴埋め語**: `<実測で決めた値>` が 1 つ（Task 3-4）。**これは意図的**で、
  **当てずっぽうの数を置かないため**である（**時間差で適用される文書に腐る値を
  注意書きつきで置かない——`<…>` の穴にする**）。
- **名前の一致**: `LANDSCAPE_VIEWPORTS`（Task 2 が作り、Task 3 が使う）、
  `TABLET_VIEWPORTS`（Task 4 が作り、Task 7 が使う）、`--touch-target-max`（Task 4 が作り、
  Task 5 が見張る）——**綴りは全部揃えた。**
