import { expect, test } from "./fixtures";

/**
 * **横にして戻したとき、縦持ちの見え方が元どおりであること。**
 *
 * **利用者の実機の指摘（2026-09-30）**: 「**横位置から縦位置に戻ると、10 キーの
 * 高さが詰まってしまいます**」。**Scientific で起き、Convert では起きない**
 * ——**利用者の観察**で、**これがいちばん強い手がかり**である（あの 2 つの違いは
 * 器の入れ子で、それは「10 キーの大きさが面で違う」原因と同じ所にある）。
 *
 * **★ 2 度目の報告（2026-10-02、iPhone・staging の `a1f43d0`）**:
 * 「**横から縦に戻すと、10 キーの縦のスペースが詰まってしまってボタンが押しにくい。
 * ただ、別のメニューに行ってから戻ってくると正常になる。これは、関数電卓と
 * 金融電卓だけで発生します。また iPad mini では発生しません**」。
 *
 * **手がかりが 3 つ増えた**ので、この番人を**その形に広げた**:
 * **4 つのタブすべて**（**関数電卓・金融電卓は器が `main` の直下、Convert と
 * Scale はカテゴリ選択の器を挟む**——**実測 2026-10-02 の `boardParent`:
 * `main` / `div` / `div` / `main`）、**ホーム画面の寸法とブラウザのタブの寸法の
 * 2 つの道**、**そして「別の面へ移って戻る」と直るかどうか**。
 * **利用者の言う「直る」は、作り直されると消えるということ**なので、
 * **壊れたまま残るのか、作り直しで戻るのかを分けて撃つ。**
 *
 * **★ この番人の立場**: **Chromium では赤にならない**（2026-09-30 と
 * **2026-10-02 に 2 度目の実測**——**4 つのタブ × 2 つの道で、
 * `aspect-ratio`・`height`・10 キーと器の箱・`display` が 1px も違わなかった**）。
 * **これは iOS の証言のための記録である。** **CI は同じ spec を WebKit でも回す**
 * （`playwright.config.ts` の `webkit` project。**`a1f43d0` の走行では、
 * 広げる前のこの番人が緑だった**）——**WebKit でも鳴らないなら、
 * それは「iOS Safari だけで起きる」ことの証拠**であり、**そのときの判定者は
 * 利用者の実機だけである。**
 */
const TABS = [
  // **器が `main` の直下**（利用者が「起きる」と言った 2 面）。
  "#scientific",
  "#finance",
  // **カテゴリ選択の器を挟む**（「起きない」と言った側）。
  "#convert/length",
  "#scale/data-scale",
] as const;

/**
 * **往復の道。** **ホーム画面から開いたときと、ブラウザのタブで開いたときでは、
 * 横にしたときの寸法が違う**（`widths.ts` の `LANDSCAPE_VIEWPORTS` と
 * `LANDSCAPE_TAB_VIEWPORTS`）——**利用者がどちらで見たかは分からない**ので、
 * **両方を回る。**
 */
const TRIPS = [
  {
    name: "ホーム画面",
    portrait: { width: 390, height: 844 },
    landscape: { width: 844, height: 390 },
  },
  {
    name: "ブラウザのタブ",
    portrait: { width: 390, height: 664 },
    landscape: { width: 750, height: 342 },
  },
] as const;

for (const hash of TABS) {
  for (const trip of TRIPS) {
    test(`${hash} looks the same after a round trip through landscape (${trip.name})`, async ({
      page,
    }) => {
      const read = async () =>
        await page.evaluate(() => {
          const round = (x: number) => Math.round(x * 10) / 10;
          const el = (selector: string) =>
            document.querySelector(selector) as HTMLElement | null;
          const size = (node: HTMLElement | null) => {
            if (node === null) return "-";
            const r = node.getBoundingClientRect();
            return `${round(r.width)}x${round(r.height)}`;
          };
          const keyNode = el("[data-square] button");
          return {
            key: size(keyNode),
            // **箱だけでなく、計算値も見る**（2026-10-02）——**縦持ちのキーは
            // `aspect-ratio: 1 / 1`、横向きは `auto` である**。**戻ったときに
            // `1 / 1` が当たり直っていなければ、キーは「幅は縦持ち・高さは横向き」に
            // なりうる**（それが「縦のスペースが詰まる」の形である）。
            // **★ `aspectRatio` の `"1 / 1"` は綴りである**（2026-10-03）。
            // **いまは両方の engine が同じ綴りを返す**（**裏は CI の WebKit が
            // `panel-sizing` で吐いた印字——比のほうは綴りのまま届いていた**）。
            // **崩れたら座標（幅 ＝ 高さ）に替える。**
            // **ここは往復の前後を同じ engine で突き合わせる**ので、
            // **綴りが変わっても主張は壊れない**——**下の `toBe("1 / 1")` だけが
            // 綴りに依っている。**
            keyAspect: keyNode ? getComputedStyle(keyNode).aspectRatio : "-",
            keyHeight: keyNode ? getComputedStyle(keyNode).height : "-",
            square: size(el("[data-square]")),
            board: size(el("[data-board]")),
            // **器と `main` の `display` も見る**——**段は `flex` と `grid` を
            // 往復する**ので、**戻し損ねればここに出る。**
            boardDisplay: el("[data-board]")
              ? getComputedStyle(el("[data-board]") as HTMLElement).display
              : "-",
            mainDisplay: el("main")
              ? getComputedStyle(el("main") as HTMLElement).display
              : "-",
            main: size(el("main")),
          };
        });

      await page.setViewportSize(trip.portrait);
      await page.goto(`/${hash}`);
      await expect(page.locator("main button").first()).toBeVisible();
      const before = await read();
      // **0 件で緑にしない。** 盤面が読めていなければ、下の比較は何も言わない。
      expect(before.key, "縦持ちで 10 キーが読めない").not.toBe("-");
      expect(before.keyAspect, "縦持ちのキーが正方の指定を持たない").toBe(
        "1 / 1",
      );

      await page.setViewportSize(trip.landscape);
      await expect(page.locator("main button").first()).toBeVisible();
      const landscape = await read();
      // **横では別の姿になる。** **★ 「前と違う」では足りない**
      // （レビュー役の注記 2026-09-30）——**積んだままでも幅が違えばキーの幅は変わる**
      // ので、**段の閾値を 900 にしても「違う」は真**だった。
      // **段が当たったことを言うには、横向き特有の形を撃つ**
      // ——**10 キーは正方でなくなる**（縦持ちは `aspect-ratio: 1 / 1`）。
      const [w, h] = landscape.key.split("x").map(Number);
      expect(
        w === h,
        `横向きで 10 キーが正方のまま（${landscape.key}）——段が当たっていない`,
      ).toBe(false);

      await page.setViewportSize(trip.portrait);
      await expect(page.locator("main button").first()).toBeVisible();
      const after = await read();
      expect(after, `${hash} の縦持ちが、横を経て変わった`).toEqual(before);

      // **★ 利用者の「別のメニューに行ってから戻ってくると正常になる」**
      // （2026-10-02）。**作り直されると消えるなら、壊れているのは状態である。**
      // **上の比較が赤でここが緑なら、それが分かる**ので、**2 つを分けて撃つ。**
      await page.goto("/#scale/llm");
      await expect(page.locator("main button").first()).toBeVisible();
      await page.goto(`/${hash}`);
      await expect(page.locator("main button").first()).toBeVisible();
      const remounted = await read();
      expect(remounted, `${hash} が、面を移って戻っても元に戻らない`).toEqual(
        before,
      );

      // **★ 利用者の 3 度目の言葉（2026-10-02）**:
      // 「**ボタンは正常で、縦方向のスペースが無くなって、少しだけボタンが重なる**」。
      // **寸法の等値では、これは捕まらない**——**ボタンは正しい大きさだから**である。
      // **古いまま残るのは行の高さ**で、**ボタンが自分の行からはみ出して下の行に重なる。**
      //
      // **実測（2026-10-02、縦持ちで行だけ横向きの値 49px に固定して再現）**:
      // **重なり 9.8px**、**区画の箱は 366 → 277**（**ただし箱が縮むのは
      // `#scientific` と `#finance` だけ**——**Convert と Scale は面の CSS が
      // 区画に `aspect-ratio: 1 / 1` を当てているので箱は 366 のまま**。
      // **利用者が「この 2 つだけ」と言ったのと同じ組である**）。
      await page.setViewportSize(trip.portrait);
      await expect(page.locator("main button").first()).toBeVisible();
      const grid = await page.evaluate(() => {
        const round = (x: number) => Math.round(x * 10) / 10;
        const square = document.querySelector("[data-square]") as HTMLElement;
        const keys = [...square.querySelectorAll("button")].map((el) =>
          el.getBoundingClientRect(),
        );
        // **行は座標から起こす。** **`gridTemplateRows` は engine で返るものが
        // 違う**——**Chromium は指定の綴りのまま**（2026-10-02 実測: `none` /
        // `repeat(5, 1fr)`）、**WebKit は使用値の px**（2026-10-03、CI の
        // WebKit だけが `panel-sizing` を赤くして分かった）。**綴りは
        // 期待値にできない。**
        const tops = [
          ...new Set(keys.map((r) => Math.round(r.top * 10) / 10)),
        ].sort((a, b) => a - b);
        const rows = tops.map((top) => {
          const inRow = keys.filter((r) => Math.round(r.top * 10) / 10 === top);
          return {
            bottom: Math.max(...inRow.map((r) => r.bottom)),
            height: Math.max(...inRow.map((r) => r.height)),
          };
        });
        let overlap = 0;
        for (let i = 1; i < rows.length; i += 1) {
          const upper = rows[i - 1];
          const lower = tops[i];
          if (upper !== undefined && lower !== undefined) {
            overlap = Math.max(overlap, round(upper.bottom - lower));
          }
        }
        const gap = Number.parseFloat(getComputedStyle(square).rowGap);
        return {
          rows: rows.length,
          overlap,
          sum: round(
            rows.reduce((total, r) => total + r.height, 0) +
              (rows.length - 1) * gap,
          ),
          box: round(square.getBoundingClientRect().height),
        };
      });
      // **0 件で緑にしない。** 5×5 なので行は 5 つである。
      expect(grid.rows, "10 キーの行の数").toBe(5);
      // **① 重なっていない**（**利用者が見ているものそのもの**）。
      // **床は 0**——**1px でも重なれば、下のキーの上端が隠れる。**
      expect(
        grid.overlap,
        `${hash} でキーが下の行に重なる量`,
      ).toBeLessThanOrEqual(0);
      // **② 区画の箱 ＝ 行の和 ＋ 隙間の和**（**行が古いままなら、ここがずれる**）。
      // **±1px は小数の丸めのぶん**（実測の差は 0.1px）。
      expect(
        Math.abs(grid.box - grid.sum),
        `${hash} の区画の箱（${grid.box}）と行の和（${grid.sum}）が合わない`,
      ).toBeLessThanOrEqual(1);
    });
  }
}
