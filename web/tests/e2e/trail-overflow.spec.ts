import { expect, type Page, test } from "./fixtures";
import { LANDSCAPE_VIEWPORTS, TABLET_VIEWPORTS } from "./widths";

/**
 * **長い綴りは横に逃がす——盤面は 1px も動かさない**（1.2、入力経歴の
 * 設計書 §2.4、計画の Task 2-5）。
 *
 * **行が折り返したら、表示欄が縦に伸びて盤面が下がる。** **打っている最中に
 * 指の下でキーが動くのは事故になる**（`Readout.tsx` の註が実測 19px・22px の
 * 2 例を持っている）。**だから `.entryActive` は `white-space: nowrap` と
 * `overflow-x: auto` で、行の中を横にスクロールさせる。**
 *
 * **「入力済み 2 行」の下限も触っていない**（設計書 §2.4）——**行は 1 本のまま、
 * 枠の中で横に伸びる**ので、**全パネル共通の下限に当たらない。**
 *
 * **★ この番人が空でないことは、2 つの変異で確かめた**（2026-10-03、Chromium の
 * `mobile`。**数は走行の印字から写した**）:
 *
 * - **`white-space: nowrap` を外す** → **打っている行の高さが 26.4 → 79.2**
 *   （**3 行に折り返した**）。**4 寸法すべてが赤。**
 * - **`overflow-x: auto` を外す** → **`390×844` はページが右に 421px はみ出し**、
 *   **横持ちの 2 つ（`844×390`・`667×375`）はキーが画面の外に出て、クリックが
 *   30 秒で時間切れ**になった。**`1133×744` だけは緑**——**この寸法は
 *   `overflow-x` を見張れていない**（**理由は未確認**）。**4 つ並べる値段の
 *   半分はここに在る**：**1 寸法だけなら、この穴は見えない。**
 */

/** **設計書 §2.4 が名指しする 4 寸法。** **綴りは 1 か所から取る**（`widths.ts`）。 */
const SIZES = [
  // **縦持ちのスマホ**（E2E の既定の寸法。`playwright.config.ts` の `mobile`）。
  { device: "iPhone 13 portrait", width: 390, height: 844 },
  ...LANDSCAPE_VIEWPORTS,
  // **利用者が実機で見ている寸法**（2026-10-02、iPad mini の横）。
  ...TABLET_VIEWPORTS.filter((size) => size.device === "iPad mini landscape"),
] as const;

/**
 * **枠より長い綴り。** **いちばん広い 1133px でも枠に入らない長さ**であることは、
 * 下の「はみ出している」の主張が毎回確かめる（**入ってしまったら赤**）。
 *
 * **★ 短い列から伸ばした**（2026-10-03）——**`( 1 + 2 )` までの 24 打鍵では、
 * `1133×744` で綴りが 601px、枠も 601px で、ちょうど収まってしまった**
 * （**その寸法だけ赤になり、空振り防止の主張が先に鳴った**）。
 * **後半を足して 772px にした。**
 *
 * **★ 1.2.1（関数表記）で行が短くなった**——**括弧の空白が無くなり**（`( 1 + 2 )` →
 * `(1 + 2)`）、**`30 sin` が `sin(30)` になった**（字数は同じ）。**列は伸ばしていない**
 * ——**4 寸法とも「枠より長い」の主張が緑のまま**（2026-10-05 実測）なので、
 * 足りている。**足りなくなった日は、その主張が先に赤くなる。**
 */
const LONG = [
  "3",
  "0",
  "サイン",
  "掛ける",
  "2",
  "足す",
  "1",
  "2",
  "3",
  "4",
  "5",
  "割る",
  "6",
  "7",
  "引く",
  "8",
  "9",
  "0",
  "掛ける",
  "開き括弧",
  "1",
  "足す",
  "2",
  "閉じ括弧",
  // **ここから先は、広い画面で枠を越えさせるための後半。**
  "足す",
  "9",
  "8",
  "7",
  "6",
  "5",
  "掛ける",
  "4",
  "3",
  "2",
  "1",
  "引く",
  "8",
  "7",
  "6",
  "5",
];

const press = async (page: Page, names: string[]) => {
  for (const name of names) {
    await page.getByRole("button", { name, exact: true }).click();
  }
};

/** **行・表示欄・盤面・ページを 1 度に撮る。** 比較は同じエンジンの前後である。 */
const measure = async (page: Page) =>
  await page.evaluate(() => {
    const round = (x: number) => Math.round(x * 10) / 10;
    const box = (selector: string) => {
      const node = document.querySelector(selector) as HTMLElement | null;
      return node === null
        ? null
        : {
            height: round(node.getBoundingClientRect().height),
            top: round(node.getBoundingClientRect().top),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
          };
    };
    const root = document.documentElement;
    return {
      entry: box('[data-testid="display-entry-active"]'),
      echo: box('[data-testid="display-echo"]'),
      board: box("[data-board]"),
      page: {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
      },
    };
  });

for (const size of SIZES) {
  test(`a long spelling scrolls inside its line and never moves the board (${size.device} ${size.width}x${size.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/#scientific");
    await expect(page.getByTestId("display-main")).toHaveText("0");

    const before = await measure(page);
    // **0 件で緑にしない。** 盤面と行が読めていなければ、下の比較は何も言わない。
    expect(before.entry, "打っている行が読めない").not.toBeNull();
    expect(before.echo, "表示欄が読めない").not.toBeNull();
    expect(before.board, "盤面が読めない").not.toBeNull();

    await press(page, LONG);
    await expect(page.getByTestId("display-entry-active")).toHaveText(
      "DEG sin(30) × 2 + 12345 ÷ 67 − 890 × (1 + 2) + 98765 × 4321 − 8765",
    );
    const after = await measure(page);

    // **(i) 行の高さが変わらない**（折り返していない）。
    expect(after.entry?.height, "打っている行の高さが変わった").toBe(
      before.entry?.height,
    );
    expect(after.echo?.height, "表示欄の高さが変わった").toBe(
      before.echo?.height,
    );

    // **(ii) 盤面の上端が動かない**（**指の下でキーが動かない**）。
    expect(after.board?.top, "盤面の上端が動いた").toBe(before.board?.top);

    // **(iii) ページがはみ出さない。** **横は 1px も**
    // ——**行の中で逃がすので、ページには出ない。**
    expect(
      after.page.scrollWidth - after.page.clientWidth,
      "ページが横にはみ出した",
    ).toBeLessThanOrEqual(0);
    // **縦は「打っても増えない」**で撃つ。**寸法によっては打つ前からスクロール
    // する**（横持ちのタブは設計書 §2.2.1 でそう決めてある）ので、
    // **`== clientHeight` は約束ではない。**
    expect(after.page.scrollHeight, "ページの縦が打鍵で伸びた").toBe(
      before.page.scrollHeight,
    );

    // **★ 空振りでないことを、最後に撃つ。** **綴りが枠に収まっていたら、
    // 上の 4 つは何も確かめていない**（短い行なら折り返しも横スクロールも
    // 起きないので、全部そのまま緑になる）。
    //
    // **★ 最後に置く理由**（2026-10-03、変異で分かった）——**`nowrap` を外すと、
    // 行は折り返して横にはみ出さなくなるので、この主張も赤くなる。**
    // **先に置いていたら、`nowrap` を外した人は「綴りが短い」と読んで
    // 列を伸ばしに行く**。**上の約束が先に鳴れば、動いたのが行の高さだと分かる。**
    expect(
      (after.entry?.scrollWidth ?? 0) - (after.entry?.clientWidth ?? 0),
      `綴りが枠に収まってしまった（${size.width}px では長さが足りない）`,
    ).toBeGreaterThan(0);
  });
}
