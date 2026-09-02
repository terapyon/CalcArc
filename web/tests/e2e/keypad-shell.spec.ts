import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("the main grid keeps 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。誤爆が計算そのものを壊す
  // メイングリッドでは守る。関数列は縦だけ割る——設計書 §4 の判断で、
  // 誤爆しても DEL で戻せる軽さに見合わせている。緩めた理由をここに
  // 書いておかないと、次に読む人が「うっかり緩めた」と読む。
  const main = page.getByRole("group", { name: "数字と演算のキー" });
  for (const button of await main.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("the function row is half height but still 44px wide", async ({
  page,
}) => {
  // 44px は 8 列案を却下した唯一の測定(390px で 38.75px)。2 段化は
  // それを守るためだけに存在するので、2 段目も同じ検査に含める
  // ——含めないと将来 8 列に戻す変更が入っても緑のまま通ってしまう。
  const functions = page.getByRole("group", { name: /関数キー|第 2 関数列/ });
  for (const button of await functions.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeLessThan(44);
  }
});

test("pi is reachable through the Shift face and reaches the core", async ({
  page,
}) => {
  // メイングリッドのキーが第 2 面を持つことの検査(設計書 §3)。第 1 面は
  // Exp(S2 で有効化済み)、第 2 面が π。
  await expect(page.getByRole("button", { name: "指数入力" })).toBeEnabled();

  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await page.getByRole("button", { name: "円周率" }).click();
  await expect(page.getByTestId("display-main")).toHaveText("3.141592654");

  // ワンショット: 面は戻っている。
  await expect(page.getByRole("button", { name: "指数入力" })).toBeEnabled();
});

test("the second face is full now, not a row of placeholders", async ({
  page,
}) => {
  // S-1 で sin/cos/tan の裏が asin/acos/atan になり、「準備中」の面は
  // 1 つも残っていない。
  await page.getByRole("button", { name: "第2面に切り替え" }).click();
  await expect(
    page.getByRole("button", { name: "第2面（準備中）" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "アークサイン" }),
  ).toBeEnabled();
});

test("the board has no reserved slots left", async ({ page }) => {
  // 第 1 面の予約は S2 で、第 2 面は S-1 で、最後の 1 枠は S-4 の `°'"` で
  // 埋まった。**盤面に「空き」は 1 つも無い。**
  await expect(
    page.getByRole("button", { name: "空き", exact: true }),
  ).toHaveCount(0);
  // 埋めた当人が押せることも見る——「消えた」と「無効になった」を分ける。
  await expect(
    page.getByRole("button", { name: "60進に切り替え" }),
  ).toBeEnabled();
});

test("Shift shows its face is on, not just to the accessibility tree", async ({
  page,
}) => {
  const shift = page.getByRole("button", { name: "第2面に切り替え" });
  const background = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  const before = await shift.evaluate(background);
  await shift.click();
  await expect(shift).toHaveAttribute("aria-pressed", "true");
  expect(await shift.evaluate(background)).not.toBe(before);
});

test("the echo line is empty until something is pending", async ({ page }) => {
  await expect(page.getByTestId("display-echo")).toBeEmpty();
});

test("the board still computes after the rearrangement", async ({ page }) => {
  // 配置を変えただけで意味は変えていない。代表列で確かめる。
  for (const name of ["3", "足す", "虚数単位", "4", "計算する"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await expect(page.getByTestId("display-main")).toHaveText("3+4j");
});

test("DRG still switches the angle unit from the function row", async ({
  page,
}) => {
  // DRG はメイングリッドから関数列へ移った(設計書 §2)。移動しても効く。
  await expect(page.getByTestId("display-angle")).toHaveText("DEG");
  await page.getByRole("button", { name: "角度の単位を切り替え" }).click();
  await expect(page.getByTestId("display-angle")).toHaveText("RAD");
});

/**
 * **空きセルが「空いている箱」に見えること。**
 *
 * **0.7.0 で 2 度直した所である**（ユーザー裁定 2026-09-02）。
 * 1 度目は `—` を消しただけで、**箱ごと地に溶けて消えた**——
 * 「**薄い箱は残してください**」。2 度目に地の色を与えて戻した。
 *
 * **jsdom では見えない**——CSS を組み立てないので、`—` が無いことは
 * 分かっても「箱が見えるか」は分からない。**実ブラウザの computed style
 * でしか主張できない。**
 *
 * **値は目で合わせた。だから番人を置く**——**目で合わせた値は、次に
 * 触った人の目には見えない。**
 */
test("shows an empty slot as a box that no key would be mistaken for", async ({
  page,
}) => {
  await page.goto("/#scale/transfer");
  await expect(page.getByTestId("display-main")).toBeVisible();

  /** `rgb(...)` を 3 つの数にする。 */
  const channels = (color: string) =>
    (color.match(/\d+/g) ?? []).slice(0, 3).map(Number);

  /**
   * **地の上に置いたときの実際の色。** `background-color` は `opacity` を
   * 含まないので、**薄くして消す**変更を色の比較だけでは捕まえられない
   * ——**掛けてから比べる。**
   */
  const overSurface = (
    paint: { bg: string; opacity: string },
    base: number[],
  ) =>
    channels(paint.bg).map(
      (v, i) => (base[i] ?? 0) + (v - (base[i] ?? 0)) * Number(paint.opacity),
    );

  /** 3 つの channel のうち、いちばん離れている分。 */
  const apart = (a: number[], b: number[]) =>
    Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))));

  const paintOf = (el: Element) => {
    const style = getComputedStyle(el);
    return {
      bg: style.backgroundColor,
      opacity: style.opacity,
      borderStyle: style.borderTopStyle,
    };
  };

  const surface = channels(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  );
  const live = await page
    .getByRole("group", { name: "数字と演算のキー" })
    .getByRole("button", { name: "7", exact: true })
    .evaluate(paintOf);
  const liveApart = apart(overSurface(live, surface), surface);

  const slots = await page
    .locator(".keypad, [class*='keypad']")
    .first()
    .locator("button:not([data-token])")
    .all();
  // **件数を主張する。** 0 個を検査して緑、を作らない。
  // 実測 2026-09-02: データ転送の数字面に 5 つ。
  expect(slots, "no reserved slot was found").toHaveLength(5);

  for (const slot of slots) {
    const paint = await slot.evaluate(paintOf);
    const slotApart = apart(overSurface(paint, surface), surface);

    // **1. 箱が見える。** 地と同じ色になったら、セルの位置が読めない。
    //
    // **窓は狭い。実測で置く**（2026-09-02、390px の明るいテーマ）:
    // **空き 7 / 溶けた状態 4 / 生きた数字キー 13**。**溶けた状態というのは
    // 「地の色を与えず `opacity: 0.4` で薄めるだけ」**——**それが 0.7.0 で
    // 1 度作って撮り直した見た目**であり、**この下限はその 4 を落とすために
    // 在る**。**5 は「余裕を見た丸い数」ではなく、4 と 7 のあいだである。**
    expect(slotApart, `an empty slot melted into the surface`).toBeGreaterThan(
      5,
    );
    // **2. どのキーよりも弱い。** 空きがキターと同じ重さで出ると、
    // **押せそうに見える**——0.7.0 で 1 度そうなって撮り直した。
    // **語の選び方に注意。** `check:boundary` は `web/` に重量級の綴りが
    // 出たら「web が重量級を知っている」として落とす。**最初この文言で
    // 落ちた**（2026-09-02 実測）。**番人は正しく、私の言い回しが悪かった。**
    expect(slotApart, `an empty slot stands out like a live key`).toBeLessThan(
      liveApart,
    );
    // **3. 枠線で出していない。** 枠線はこのリポジトリでは「押せる」の
    // 合図であり、**破線で分けたときに「逆に目立って押せそう」で退けてある**。
    expect(paint.borderStyle, `an empty slot grew a border`).toBe("none");
  }
});

/**
 * **「永久に押せない」と「いまだけ押せない」が、同じ見た目であること。**
 *
 * **これが 0.7.0 の主張そのものである**（ユーザー裁定 2026-09-02）。
 * **一度は破線で分けた。撮って、やめた**——「逆に目立って押せそうに思う」。
 * **分けないと決めた以上、分かれていないことを主張する側の検査が要る。**
 *
 * **★ 盤面をまたいで見る。** **1 つの盤面には両方が揃わない**からである
 * ——**Finance は式を組むので永久のキーが 1 つも無く**（項目もモードも
 * 変われば戻る）、**Scale の 3 盤面は逆に、初期状態で一時のキーが出ない**。
 * **最初 Finance だけで書いて「永久が 0 件」で落ちた**（実測 2026-09-02）。
 * **主張は「この盤面で」ではなく「どの盤面でも」**なので、これで正しい。
 *
 * **jsdom では見えない**（CSS を組み立てない）。**実ブラウザの computed style。**
 */
test("shows both kinds of unpressable key as the same kind of unpressable", async ({
  page,
}) => {
  type Seen = {
    route: string;
    name: string;
    off: boolean;
    permanent: boolean;
    looks: string;
  };
  const seen: Seen[] = [];

  for (const route of [
    "#scale/data-scale",
    "#scale/transfer",
    "#scale/llm",
    "#convert/length",
    "#finance",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.getByTestId("display-main")).toBeVisible();
    seen.push(
      ...(await page
        // **盤面まるごと**を見る。**最初の `<fieldset>` だけだと項目行しか
        // 入らない**（実測）。
        .locator(".keypad, [class*='keypad']")
        .first()
        .locator("button")
        .evaluateAll(
          (els, from) =>
            els
              // **文字を持つキーだけ。** 空きセルは別の検査が持っている
              // ——**あちらは「箱が見えるか」、こちらは「2 群が分かれて
              // いないか」**である。
              .filter((el) => (el.textContent ?? "").trim() !== "")
              .map((el) => ({
                route: from,
                name: el.getAttribute("aria-label") ?? "",
                off: (el as HTMLButtonElement).disabled,
                // **永久側だけが説明を指す。** 見た目で分けないので、
                // **ここが唯一の区別**である。
                permanent: el.getAttribute("aria-describedby") !== null,
                looks: (() => {
                  const style = getComputedStyle(el);
                  return `opacity=${style.opacity} cursor=${style.cursor}`;
                })(),
              })),
          route,
        )),
    );
  }

  // **数えたことを主張する。** 5 盤面を回って 0 件でも緑、を作らない。
  expect(seen.length, "no key was seen on any board").toBeGreaterThan(100);

  const off = seen.filter((key) => key.off);
  const on = seen.filter((key) => !key.off);
  const permanent = off.filter((key) => key.permanent);
  const transient = off.filter((key) => !key.permanent);

  // **★ 両側が空でないことを先に言う。** **片方が 0 件なら、下の「1 通り」は
  // 自明に成り立つ**——**主張が空になったことに気づけるように、先に数える。**
  expect(
    permanent.length,
    "no permanently-off key with a glyph — the claim below would be vacuous",
  ).toBeGreaterThan(0);
  expect(
    transient.length,
    "no transiently-off key — the claim below would be vacuous",
  ).toBeGreaterThan(0);
  expect(on.length, "no live key").toBeGreaterThan(0);

  // **★ 主張の本体: 押せない側の見た目は 1 通り。** 永久も一時も同じ。
  expect(
    [...new Set(off.map((key) => key.looks))],
    `the two kinds of off look different: ${JSON.stringify(
      off
        .filter(
          (key, i, all) => all.findIndex((o) => o.looks === key.looks) === i,
        )
        .map((key) => ({
          route: key.route,
          name: key.name,
          permanent: key.permanent,
          looks: key.looks,
        })),
    )}`,
  ).toEqual(["opacity=0.4 cursor=default"]);

  // **生きている側とは分かれている。** 1 通りに揃えた結果、押せるキーと
  // 見分けが付かなくなっては元も子もない。
  expect([...new Set(on.map((key) => key.looks))]).toEqual([
    "opacity=1 cursor=pointer",
  ]);
});
