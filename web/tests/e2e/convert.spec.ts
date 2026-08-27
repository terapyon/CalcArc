import { expect, type Page, PROVIDER_GLOB, test } from "./fixtures";

const panel = (page: Page) => page.getByRole("region", { name: "単位変換" });
const echo = (page: Page) => page.getByTestId("display-entry-active");
const main = (page: Page) => page.getByTestId("display-main");

/** 測れなかったことの印。相対座標は負にもなるので `-1` では代用できない。 */
const UNMEASURED = "unmeasured";

/**
 * Convert の全カテゴリ。**U-1 の 3 つ + U-2 の 4 つ + U-4 の為替**(spec §2・
 * U-4 spec §7)。`web/src/convert/types.ts` の `CONVERT_CATEGORY_TOKENS` と
 * 同じ並びだが、**E2E は境界の定数を import しない**——実ブラウザに出ている
 * 面を、外から名前で数えるのがこのファイルの仕事である。
 */
const CATEGORIES = [
  "length",
  "mass",
  "temperature",
  "area",
  "volume",
  "speed",
  "data-size",
  "currency",
] as const;

async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

/**
 * いま出ている面の区画。**単位面の名前はカテゴリで変わらない**
 * (`Keypad/convert.ts` の `unitFace`)——変換元と変換先で同じ面が出る。
 */
const face_ = (page: Page, name: "数字と演算のキー" | "単位のキー") =>
  panel(page).getByRole("group", { name });

/**
 * 面ごとのキー総数。**予約スロットも disabled な `<button>` として描かれる**
 * ので、面の総数はキー配列の長さと一致する。単位面は 5 列 × (3 単位/行) で、
 * 行数は `ceil(単位数 / 3)`、総数は 行数 × 5:
 *
 * | カテゴリ | 単位数 | 行 | キー総数 |
 * |---|---|---|---|
 * | length | 11 | 4 | 20 |
 * | mass | 7 | 3 | 15 |
 * | temperature | 3 | 1 | 5 |
 * | area | 11 | 4 | 20 |
 * | volume | **15** | **5** | **25** |
 * | speed | 4 | 2 | 10 |
 * | data-size | 12 | 4 | 20 |
 * | **currency** | **16** | **4** | **20** |
 *
 * **為替だけは 2 行目以降が 5 列である**(`Keypad/convert.ts` の `ROW_WIDTH`)
 * ——16 通貨は左 3 列では 6 行になり、枠からあふれる(U-4 spec §7 の実測)。
 * 3 + 5 + 5 + 3 で 4 行、キー総数は 20 で length と同じである。
 *
 * **Volume の 5 行が枠の容量そのものである**(U-2 spec §0.0-4 の【訂正
 * 2026-08-20】)。16 個目を足すと 6 行になり、`swapping faces moves neither
 * the frame nor DEL and AC` が赤くなる。
 *
 * **件数のハードコードはここと `every category has a deep link` の 2 箇所に
 * ある。** 片方だけ直すともう片方が緑のまま古い件数を主張し続ける。
 */
const FACES = [
  ["length", "数字と演算のキー", "値を入力", 25],
  ["length", "単位のキー", "変換元の単位を選ぶ", 20],
  ["mass", "単位のキー", "変換元の単位を選ぶ", 15],
  ["temperature", "単位のキー", "変換元の単位を選ぶ", 5],
  ["area", "単位のキー", "変換元の単位を選ぶ", 20],
  ["volume", "単位のキー", "変換元の単位を選ぶ", 25],
  ["speed", "単位のキー", "変換元の単位を選ぶ", 10],
  ["data-size", "単位のキー", "変換元の単位を選ぶ", 20],
  ["currency", "単位のキー", "変換元の単位を選ぶ", 20],
] as const;

test("every face keeps 44px touch targets", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**単位の押し間違いは答えを
  // 壊す**ので、メインの枠に載る面はどれも守る(項目行だけは押し直せば
  // 戻るので縦を詰める——下の別の検査が幅だけを見る)。
  //
  // **測ったキーの件数も主張する**——ループが 0 周でも緑になる書き方はしない。
  let measured = 0;
  for (const [category, faceName, field, expectedCount] of FACES) {
    await page.goto(`/#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    await press(page, [field]);
    const buttons = await face_(page, faceName).getByRole("button").all();
    expect(
      buttons,
      `${category}/${faceName} should render its full key set`,
    ).toHaveLength(expectedCount);
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      measured += 1;
    }
  }
  // **件数の下限も主張する。** 面の綴りが変わって 0 件になった日から、
  // この検査が何も測らないまま緑を返し続けるのを止める。
  expect(measured).toBe(FACES.reduce((sum, [, , , n]) => sum + n, 0));
  expect(measured, "no key was ever measured").toBeGreaterThan(0);
});

/**
 * ラベルが横にはみ出してよい量。**`a72281d`(ユーザー裁定 2026-08-20)が
 * ページの横溢れに置いた許容と同じ 8px** で、理由も同じである
 * ——**本物の崩れは 2 桁 px で出る**。詳しくは下の検査の註。
 */
const SIDEWAYS_ALLOWANCE = 8;

test("keeps every key label inside its key, within the 8px the fonts move it", async ({
  page,
}) => {
  // **44px は「押せる大きさか」で、これは「読めるか」である。** 別の問いで、
  // 別の壊れ方をする——キーは 44px を保ったまま、中の字だけがはみ出す。
  // U-2 の spec §4 は「**機械が見張っていないもの**」としてこれを名指しで
  // 繰り越していた(手で測っただけだった)。ここで機械に渡す。
  //
  // ## `scrollWidth` では見えない(実測)
  //
  // 最初は `scrollWidth - clientWidth` で書いたが、**ラベルを伸ばしても
  // 赤くならなかった**。理由は 2 つある:
  //
  // - **字は切れずに折り返す。** キーは `white-space: normal` のままで、
  //   長い字は幅を越えずに行が増える(実測: 幅の超過は -1px)。
  // - **`<button>` は scroll 系の値ではみ出しを見せない。** 器いっぱいに
  //   折り返しても `scrollHeight === clientHeight` のままだった(実測 61/61)。
  //
  // ## だから字そのものの箱を測る
  //
  // `Range.selectNodeContents` で**描かれた行の外接矩形**を取り、キーの箱と
  // 比べる。長いラベルを入れると `ink 84 / key 61` = **縦に 23px** はみ出す
  // のが見える。
  //
  // ## 【訂正 2026-08-27】「幅はまず越えない」は誤りだった。CI が反証した
  //
  // ここには当初「**縦が本体である**——折り返す作りなので、溢れるのは高さの
  // ほうで、**幅はまず越えない**」と書いてあった。**CI で 3 つ落ちた**:
  //
  //     area/単位のキー:   畳(1.62m²)    横 5px・縦 -24px
  //     volume/単位のキー: gal(Imp)      横 2px・縦 -43px
  //     volume/単位のキー: カップ(200mL) 横 3px・縦 -24px
  //
  // **縦は 24〜43px 余っていて、横だけが足りない。** 3 つとも括弧で切れ目が
  // 無く、**折り返せないので幅が越える**。私が見ていたのは、たまたま手元の
  // フォントで収まっていた状態だった。
  //
  // **原因はフォントである。** `tokens.css` の `body` は
  // `font-family: system-ui` で、**どの字形になるかは端末が決める**。
  // 手元は Noto Sans CJK JP、CI は DejaVu Sans に解決される
  // ——`"DejaVu Sans"` を手元で強制すると**横の値が CI と 1px も違わず一致した**。
  //
  // | | `畳(1.62m²)` | `gal(Imp)` | `カップ(200mL)` |
  // |---|---|---|---|
  // | Noto Sans CJK JP(手元、15px) | −1px | −2px | −4px |
  // | DejaVu Sans(CI、15px) | **+5px** | **+2px** | **+3px** |
  //
  // **手元で 1〜4px しか余っていなかった**、というのがこの検査が見つけたもの
  // である。**許容したのは、余裕があるからではない。**
  //
  // ## 横は 8px まで許容する。理由は 3 段ある
  //
  // **1. 横一般(3 件すべてに掛かる)。** 2〜5px の食い込みは崩れではない
  // ——実測で `ink` はキーの縁に触れるが、**隣のキーとは重ならない**。
  // **本物の崩れは 2 桁 px で出る。** これは新しい判断ではなく、
  // `a72281d`(ユーザー裁定 2026-08-20)が**ページの横溢れに同じ 8px を
  // 許容した**ときの理由そのものである——**同じリポジトリが同じ問いに
  // 一度答えているので、値も理由も揃える**。実測の最大値(5px)のすぐ上に
  // 置かないのは、**次に 6px のフォントが来たときに同じ議論をしない**ため。
  //
  // **2. `畳(1.62m²)` と `カップ(200mL)` について。** **利用者は CJK フォントを
  // 持っている前提である**(ユーザー裁定 2026-08-27)。**CI(DejaVu)で CJK が
  // どの字形に落ちているかは未確認**——いずれにせよ**利用者が見る字ではない**。
  //
  // **3. `gal(Imp)` について。これは化けていない。** DejaVu は Latin を正しく
  // 持つので、**まっとうに描かれたうえで 2px 広い**。**CJK の前提は効かず**、
  // 上の 1 の許容だけで通っている。**「文字化けだから問題なし」で 3 件すべてを
  // 説明しないこと**——この 1 件に当てはまらない。
  //
  // ## 縦には許容を入れない
  //
  // **縦が本体である**(`ink 84 / key 61` = 23px)。いま 24〜43px 余っており、
  // ここが越えるのは**行が 1 つ増えた**ときで、それは字幅の差ではない。
  //
  // 幅は**対応する下限の実機幅**で見る(360px)。390px で入っていても、
  // 360px ではみ出せば読めない人が出る。
  await page.setViewportSize({ width: 360, height: 800 });
  const spilled: string[] = [];
  let measured = 0;
  for (const [category, faceName, field, expectedCount] of FACES) {
    await page.goto(`/#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    await press(page, [field]);
    const buttons = await face_(page, faceName).getByRole("button").all();
    expect(
      buttons,
      `${category}/${faceName} should render its full key set`,
    ).toHaveLength(expectedCount);
    for (const button of buttons) {
      const over = await button.evaluate((el) => {
        const key = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const ink = range.getBoundingClientRect();
        return {
          text: (el.textContent ?? "").trim(),
          w: Math.round(ink.width - key.width),
          h: Math.round(ink.height - key.height),
        };
      });
      // **横は 8px まで、縦は 1px も許さない**(上の 3 段の理由)。
      if (over.w > SIDEWAYS_ALLOWANCE || over.h > 0) {
        spilled.push(
          `${category}/${faceName}: ${over.text} が 横 ${over.w}px・縦 ${over.h}px はみ出す`,
        );
      }
      measured += 1;
    }
  }
  // **測った件数を先に主張する。** 0 周でも `spilled` は空で緑になる。
  expect(measured).toBe(FACES.reduce((sum, [, , , n]) => sum + n, 0));
  expect(spilled).toEqual([]);
});

test("the swap key is wide enough even though the field row is half height", async ({
  page,
}) => {
  // **⇅ は幅を測る。** 項目行は `height: "half"`(`Keypad/convert.ts` の
  // `FIELDS`)で、実測 86 × 34 である——高さ 44px を要求すると項目行の
  // 縦の予算を変える話になり、`data-scale-keypad.spec.ts:53-62` が
  // 「幅 ≥ 44、高さ < 44」を明示的に主張している既存の規律と衝突する。
  await page.goto("/#convert/length");
  await expect(panel(page)).toBeVisible();
  const row = panel(page).getByRole("group", { name: "入力する項目" });
  const buttons = await row.getByRole("button").all();
  // 値 / 変換元 / 変換先 / ⇅ の 4 つ。
  expect(buttons, "the field row should render its 4 cells").toHaveLength(4);
  const swap = await panel(page)
    .getByRole("button", { name: "変換元と変換先を入れ替える", exact: true })
    .boundingBox();
  expect(swap?.width ?? 0).toBeGreaterThanOrEqual(44);
  // **番兵**: 測れていなければ -1 になり、`< 44` を素通りしない。
  expect(swap?.height ?? -1).toBeGreaterThanOrEqual(0);
  expect(swap?.height ?? -1).toBeLessThan(44);
});

test("the panel does not shrink to its own max-content width", async ({
  page,
}) => {
  // レビュー(round 1, Important 2b)の実測: `.panel { width: 100% }`
  // (`UnitPanel.module.css`)を外すと、390px の画面で盤面は 252px・面は
  // 252×252・キーは 44×44 ちょうどまで縮む——既存の 44px 検査
  // (`toBeGreaterThanOrEqual(44)`)はこれを素通りする。`width: 100%` が
  // 効いていれば ~366px になる(同じ CSS のコメントにある Transfer 360 /
  // Finance 366 と同じ桁)ので、実測の 252px と 366px のあいだの 300px を
  // 下限に選ぶ——max-content まで縮めば確実に赤くなり、正しい寸法では
  // 確実に緑になる。
  await page.goto("/#convert/length");
  await expect(panel(page)).toBeVisible();
  const box = await face_(page, "数字と演算のキー").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(300);
});

test("swapping faces moves neither the frame nor DEL and AC", async ({
  page,
}) => {
  // **数字面と単位面は同じ枠に載る**(`UnitPanel.module.css`)。実測: この
  // 区画名を 1 文字変えると **vitest は緑のまま**で(jsdom は CSS Modules も
  // レイアウトも見ない)、実ブラウザでは数字面が 366x366 のまま単位面が
  // length 366x291 / mass 366x216 / **temperature 366x67** に潰れ、面を
  // 入れ替えるたびに縦が最大 299px 動く。**この壊れ方を機械で見張るのは
  // この検査だけである。**
  //
  // 温度は単位面が 1 行(3 単位)しか無く、**枠が中身の行数で決まっていたら
  // いちばん派手に潰れる面**である。逆に **volume は 15 単位 5 行で枠の容量
  // ちょうど**——**枠の「潰れ」を見張っているのはこの検査 1 本だけ**なので
  // (U-2 spec §0.0-4 の【訂正 2026-08-20】)、**8 カテゴリぶん回る**。
  // **「あふれ」のほうは 4 本が見張る**(この検査 + `every face keeps 44px…`
  // + `every category has a deep link…` + vitest の
  // `fits every category inside the frame`)。**1 本だけなのは潰れである。**
  // 単位面の名前はカテゴリで変わらないため、あとから増えた 4 つと為替も
  // 同じ区画名で拾える。**為替の単位面だけは 2 行目以降が 5 列**で組まれる
  // (U-4 spec §7)——**それでも枠と DEL・AC が動かないこと**を、この検査が
  // 他の 7 カテゴリと同じ物差しで見る。
  //
  // **volume だけを回しても潰れは見えない**(実測 2026-08-20、CSS の区画名を
  // 1 文字ずらして計測)。5 行ちょうどの volume は `grid-template-rows` を
  // 失っても 366x366.0625 のままで、**数字面と区別がつかない**——潰れを
  // 見せたのは temperature 366x66.8125 / speed 366x141.625 /
  // area・data-size 366x291.25 のほうである。**容量いっぱいの面は、
  // あふれの番人にはなれても潰れの番人にはならない。**
  //
  // **DEL と AC は枠からの相対座標で測る。** 主張は「**盤面の中で DEL が
  // 動かない**」であって、**盤面より上にある表示行の高さを巻き込むのは
  // 測り間違い**である——その行高はフォント環境で変わる。枠を原点に取れば、
  // 盤面の中で動いたかどうかだけが残る。
  const rel = (
    b: { x: number; y: number } | null,
    frame: { x: number; y: number } | null,
  ) => (b && frame ? `${b.x - frame.x},${b.y - frame.y}` : UNMEASURED);
  const seen: {
    where: string;
    box: { width: number; height: number };
    del: string;
    ac: string;
  }[] = [];
  for (const category of CATEGORIES) {
    await page.goto(`/#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    for (const [field, faceName] of [
      ["値を入力", "数字と演算のキー"],
      ["変換元の単位を選ぶ", "単位のキー"],
    ] as const) {
      await press(page, [field]);
      const box = await face_(page, faceName).boundingBox();
      const del = await panel(page)
        .getByRole("button", { name: "1文字消去", exact: true })
        .boundingBox();
      const ac = await panel(page)
        .getByRole("button", { name: "この項目を消去", exact: true })
        .boundingBox();
      seen.push({
        where: `${category}/${faceName}`,
        box: { width: box?.width ?? 0, height: box?.height ?? 0 },
        // **DEL と AC の位置も控える。** 在ることではなく**動かないこと**
        // を測る。
        del: rel(del, box),
        ac: rel(ac, box),
      });
    }
  }
  expect(seen).toHaveLength(CATEGORIES.length * 2);
  const sizes = new Set(seen.map((s) => `${s.box.width}x${s.box.height}`));
  expect(sizes.size, `the frame moved: ${JSON.stringify(seen)}`).toBe(1);
  const dels = new Set(seen.map((s) => s.del));
  expect(dels.size, `DEL moved: ${JSON.stringify(seen)}`).toBe(1);
  const acs = new Set(seen.map((s) => s.ac));
  expect(acs.size, `AC moved: ${JSON.stringify(seen)}`).toBe(1);
  // **番兵は 3 つとも置く**——計測できなかったときの `0` / `UNMEASURED` は
  // 1 通りに揃うので、**上の 3 つの `Set` は測れていなくても緑になる**。
  // S-0 では `ac` の 1 行が落ちていた。
  expect(seen[0]?.box.width, "the frame was never measured").toBeGreaterThan(0);
  expect(seen[0]?.del, "DEL was never measured").not.toBe(UNMEASURED);
  expect(seen[0]?.ac, "AC was never measured").not.toBe(UNMEASURED);
});

test("every category has a deep link that lands on it", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "計算の種類" });
  const seen: string[] = [];
  for (const category of CATEGORIES) {
    await page.goto(`/#convert/${category}`);
    await expect(select).toHaveValue(category);
    // **select の値だけでなく、そのカテゴリでしか出ない面まで見る。**
    // 名前だけの select が動いていても、パネルの分岐は 1 度も観測されない、
    // という穴を防ぐ。
    await expect(panel(page)).toBeVisible();
    await press(page, ["変換元の単位を選ぶ"]);
    const units = await face_(page, "単位のキー").getByRole("button").all();
    // **件数のハードコードの 2 箇所目。** 上の `FACES` と同じ表を持って
    // いるので、**カテゴリを足したら両方直す**——片方だけだと、直さなかった
    // ほうが古い件数のまま緑を返し続ける。
    expect(units, `${category} should render its own unit face`).toHaveLength(
      {
        length: 20,
        mass: 15,
        temperature: 5,
        area: 20,
        volume: 25,
        speed: 10,
        "data-size": 20,
        currency: 20,
      }[category],
    );
    seen.push(category);
  }
  // **件数を主張する。** ループが 0 周でも緑になる書き方をしない。
  expect(seen).toHaveLength(CATEGORIES.length);
});

test("the Convert tab lands on #convert/length", async ({ page }) => {
  // **`convert-placeholder.spec.ts` から引き取った被覆。** タブの行き先を
  // 見ていたのはあのファイルだけで、`nav.spec.ts` は見ていない(実測)。
  // 既定カテゴリまで href に書く規律(設計書 §3)を、実ブラウザで守らせる。
  await page.goto("/#scientific");
  await page.getByRole("link", { name: "Convert", exact: true }).click();
  await expect(page).toHaveURL(/#convert\/length$/);
  await expect(panel(page)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Convert", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("types the fixed point of the two temperature scales", async ({
  page,
}) => {
  // **spec §6 が名指しした不動点を、実ブラウザで 1 件。** vitest の同名検査
  // はモックの算数を通るだけなので、**符号が実際に境界を越えて core へ届く**
  // ことはここでしか見えない(計画の裁定 3)。
  await page.goto("/#convert/temperature");
  await expect(panel(page)).toBeVisible();
  await press(page, ["符号を変える", "4", "0"]);
  await press(page, ["変換元の単位を選ぶ", "摂氏"]);
  await press(page, ["変換先の単位を選ぶ", "華氏"]);
  await expect(echo(page)).toHaveText("変換先 °F");
  await expect(main(page)).toHaveText("-40 °F");
  await expect(page.getByTestId("convert-result")).toHaveText(
    "-40 °C = -40 °F",
  );
});

/**
 * **カテゴリごとに 1 件、値が盤面から core まで往復することだけを見る。**
 * 換算の正しさは golden(`testdata/convert.json`)が持っている——だから
 * **期待値はそこから引き写す**(下の `id` がその行である)。ここが見るのは
 * 「**その値をこの盤面から打てるか**」のほうで、U-1 では計算はできるのに
 * `±` キーが無くて不動点が打てない、という穴を実機で見つけた前例がある。
 *
 * **温度以外の 6 カテゴリは、盤面から値を打って計算させる検査を 1 本も
 * 持っていなかった**(実測 2026-08-20)。温度は上の
 * `types the fixed point of the two temperature scales` が持っている。
 *
 * 押すときの名前は `Keypad/convert.ts` の **`UNIT_ARIA_LABELS`** が正で、
 * 画面のラベル(`UNIT_LABELS`)ではない。表示のほうは単位付きで出るので、
 * `expect` には `UNIT_LABELS` の綴りが並ぶ——**2 つの表を 1 本の走行で
 * 突き合わせる**のはこの検査だけである。
 */
const TYPEABLE = [
  {
    category: "length",
    golden: "convert/length/1intomm",
    keys: ["1"],
    from: "インチ",
    to: "ミリメートル",
    expect: "25.4 mm",
    result: "1 in = 25.4 mm",
  },
  {
    category: "mass",
    golden: "convert/mass/1lbtokg",
    keys: ["1"],
    from: "ポンド",
    to: "キログラム",
    expect: "0.45359237 kg",
    result: "1 lb = 0.45359237 kg",
  },
  {
    category: "area",
    golden: "convert/area/1tsubotojo",
    keys: ["1"],
    from: "坪",
    to: "畳、1.62平方メートル",
    expect: "2.040608101 畳(1.62m²)",
    result: "1 坪 = 2.040608101 畳(1.62m²)",
  },
  {
    category: "volume",
    golden: "convert/volume/1gal_ustol",
    keys: ["1"],
    from: "ガロン、米国",
    to: "リットル",
    expect: "3.785411784 L",
    result: "1 gal(US) = 3.785411784 L",
  },
  {
    category: "data-size",
    golden: "convert/data-size/1gbtomib",
    keys: ["1"],
    from: "ギガバイト",
    to: "メビバイト",
    expect: "953.6743164 MiB",
    result: "1 GB = 953.6743164 MiB",
  },
  {
    category: "speed",
    golden: "convert/speed/1kntokmh",
    keys: ["1"],
    from: "ノット",
    to: "キロメートル毎時",
    expect: "1.852 km/h",
    result: "1 kn = 1.852 km/h",
  },
] as const;

for (const c of TYPEABLE) {
  test(`${c.category}: a value typed on the keypad comes back converted`, async ({
    page,
  }) => {
    await page.goto(`/#convert/${c.category}`);
    await expect(panel(page)).toBeVisible();
    await press(page, ["値を入力", ...c.keys]);
    await press(page, ["変換元の単位を選ぶ", c.from]);
    await press(page, ["変換先の単位を選ぶ", c.to]);
    await expect(
      main(page),
      `${c.golden} should show on the display`,
    ).toHaveText(c.expect);
    await expect(page.getByTestId("convert-result")).toHaveText(c.result);
  });
}

// ---------------------------------------------------------------------------
// 為替(U-4)。**ここから下はレートの状態を作ってから盤面を見る。**
// ---------------------------------------------------------------------------

// **取得先の綴りは `./fixtures` が持つ**(0.5.0 で移した)。以前はこの
// ファイルだけが塞いでおり、**別のファイルが為替を開けば黙って本物へ
// 出た**——`beforeEach` はファイルの中でしか効かない。いまは既定で
// 全 E2E が塞がっていて、ここはそのうえに**応答を返す**塞ぎを重ねる。
//
// **綴りがずれたら塞ぎは効かない。** そのときこのファイルの検査は
// 「取りに行った回数」が 0 のまま、日付も**当日のもの**になって赤くなる
// ——**塞ぎ忘れても緑になる形にしない**、がこの下の検査の書き方である。

/** 帰属表示のリンク先。**`provider.ts` の `PROVIDER_ATTRIBUTION` と二重管理**(同上)。 */
const PROVIDER_ORIGIN = "https://www.exchangerate-api.com";

/** 帰属表示の文言。**プロバイダのドキュメントが指定したもの**(U-4 spec §2.1 実装時義務 3)。 */
const PROVIDER_ATTRIBUTION_TEXT = "Rates By Exchange Rate API";

/**
 * 塞いだルートが返す応答。**プロバイダの応答そのままの形**(spec §2.1 の実測)
 * ——`rates` の値は**引用符の無い JSON 数値**で、`provider.ts` はこの生テキスト
 * から綴りを切り出す。
 *
 * **日付は当日ではない `2026-08-14` にしてある。** 本物に出ると当日の日付が
 * 返るので、**塞ぎを外したときに検査が「日付が違う」で赤くなる**。
 */
const SERVED_DATE = "2026-08-14";
const SERVED_BODY = `{"result":"success","provider":"${PROVIDER_ORIGIN}","time_last_update_utc":"Fri, 14 Aug 2026 00:02:31 +0000","base_code":"USD","rates":{"USD":1,"JPY":155.23,"KRW":1390.5,"VND":26150,"EUR":0.92,"GBP":0.78,"CHF":0.88,"CNY":7.15,"THB":34.5,"SGD":1.34,"HKD":7.8,"TWD":31.2,"AUD":1.55,"CAD":1.38,"INR":84.2,"BRL":5.45}}`;

interface RateStub {
  /** **塞いだルートが呼ばれた URL。** 塞ぎが効いていることを数で主張するために持つ。 */
  readonly calls: string[];
  /** 以後の取得に上の表を返す。 */
  serve(): void;
  /** 以後の取得を失敗させる(§5 の「取得に失敗し、キャッシュがある」)。 */
  fail(): void;
}

/**
 * ネットワークを塞ぐ。**必ずこれを通す。**
 *
 * 塞いだうえで**呼ばれた回数を数える**——0 回のままなら、塞ぎが効いていない
 * (綴りがずれた)か、盤面が取りに行っていないかのどちらかで、**どちらも
 * 検査が知りたいことである。**
 */
async function stubProvider(page: Page): Promise<RateStub> {
  const calls: string[] = [];
  let mode: "serve" | "fail" = "serve";
  await page.route(PROVIDER_GLOB, async (route) => {
    calls.push(route.request().url());
    if (mode === "fail") {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: SERVED_BODY,
    });
  });
  return {
    calls,
    serve: () => {
      mode = "serve";
    },
    fail: () => {
      mode = "fail";
    },
  };
}

test.beforeEach(async ({ page }) => {
  // **どの検査も本物には出さない。** 為替を開く検査はこのあと自分の
  // `stubProvider` を張り(あとから張ったほうが優先される)、回数を数える。
  // ここに置くのは、**為替を通りかかるだけの検査**(面の寸法・deep link)が
  // 素通りでネットワークに出るのを止めるためである。
  await stubProvider(page);
  // **オフラインは `navigator.onLine` で作る。** `context.setOffline` は
  // アプリ自身の読み込みまで止めてしまい(Service Worker の世代に結果が
  // 左右される)、測りたいものが測れない。盤面が見ているのはこの値である。
  await page.addInitScript(() => {
    const flag = window as unknown as { __calcarcOffline?: boolean };
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => flag.__calcarcOffline !== true,
    });
  });
});

/** IndexedDB に仕込むレート 1 枚。`null` は「キャッシュ無し」。 */
type RateSeed = {
  date: string;
  fetchedAt: string;
  rates: Record<string, string>;
} | null;

/** 16 通貨すべてが載った表。**値は文字列**(spec §2.1)——`number` にした時点で誤差が入る。 */
const FULL_RATES: Record<string, string> = {
  USD: "1",
  JPY: "155.23",
  KRW: "1390.5",
  VND: "26150",
  EUR: "0.92",
  GBP: "0.78",
  CHF: "0.88",
  CNY: "7.15",
  THB: "34.5",
  SGD: "1.34",
  HKD: "7.8",
  TWD: "31.2",
  AUD: "1.55",
  CAD: "1.38",
  INR: "84.2",
  BRL: "5.45",
};

/** 24 時間以内。**取りに行かない側。** */
const fresh = (rates = FULL_RATES): RateSeed => ({
  date: "2026-08-19",
  fetchedAt: new Date().toISOString(),
  rates,
});

/** 24 時間より前。**背後で取りに行く側。** */
const stale = (rates = FULL_RATES): RateSeed => ({
  date: "2026-08-01",
  fetchedAt: "2026-08-01T00:00:00Z",
  rates,
});

/**
 * IndexedDB のレコードを仕込む / 捨てる。**綴りは `web/src/currency/cache.ts` と
 * 二重管理**(E2E は境界の定数を import しない)——ずれたら仕込みが効かず、
 * 日付の検査が「キャッシュ無し」の側で赤くなる。
 */
async function writeCache(page: Page, seed: RateSeed): Promise<void> {
  await page.evaluate(
    async (record: unknown) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("calcarc-currency", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("rates")) {
            open.result.createObjectStore("rates");
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("rates", "readwrite");
        const store = tx.objectStore("rates");
        if (record === null) store.delete("latest");
        else store.put({ schemaVersion: 1, set: record }, "latest");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    seed === null
      ? null
      : { baseCurrency: "USD", provider: PROVIDER_ORIGIN, ...seed },
  );
}

/**
 * 為替の盤面を、指定した状態で開く。
 *
 * **まず為替以外で開いてキャッシュを仕込み、読み直してからハッシュで移る。**
 * 取得の抑制はモジュール変数で**ページを読み直すまで解けない**(Task 7 の
 * 申し送り 5)ので、状態を替えて測り直すにはセッションごと畳む必要がある。
 * **移るのはハッシュだけ**——読み直すと `__calcarcOffline` が消える。
 */
async function openCurrency(
  page: Page,
  state: { cache: RateSeed; offline?: boolean },
): Promise<void> {
  await page.goto("/#convert/length");
  await expect(panel(page)).toBeVisible();
  await writeCache(page, state.cache);
  await page.reload();
  await expect(panel(page)).toBeVisible();
  if (state.offline === true) {
    await page.evaluate(() => {
      (window as unknown as { __calcarcOffline?: boolean }).__calcarcOffline =
        true;
    });
  }
  await page.evaluate(() => {
    window.location.hash = "#convert/currency";
  });
  await expect(page.getByTestId("currency-rate")).toBeVisible();
}

/** 通貨キーの見え方。**`disabled` 属性ではなく、実際に計算された見た目を読む。** */
async function currencyKeyLooks(
  page: Page,
): Promise<{ token: string; off: boolean; looks: string }[]> {
  await press(page, ["変換元の単位を選ぶ"]);
  // **トークンで拾う。** 16 通貨のラベルを E2E に書き写すと、面の中身では
  // なく写した表を検査することになる。
  const keys = await panel(page).locator('[data-token^="unit:"]').all();
  const seen: { token: string; off: boolean; looks: string }[] = [];
  for (const key of keys) {
    seen.push({
      token: (await key.getAttribute("data-token")) ?? UNMEASURED,
      off: await key.isDisabled(),
      looks: await key.evaluate((el) => {
        const style = getComputedStyle(el);
        return `opacity=${style.opacity} cursor=${style.cursor}`;
      }),
    });
  }
  return seen;
}

test("shows unpressable currency keys as unpressable", async ({ page }) => {
  // **U-4 spec §7。** 0.2.0 の予約スロットの穴(有効なキーと同じ見た目で
  // 無反応)を繰り返さない。**`disabled` 属性だけでは「見え方」を主張して
  // いない**——jsdom は CSS を組み立てないので、薄くなっているかどうかは
  // 実ブラウザの computed style でしか見えない。
  await stubProvider(page);
  // レート表に 3 通貨しか無い。**残る 13 は押せない。**
  await openCurrency(page, {
    cache: fresh({ USD: "1", JPY: "155.23", EUR: "0.92" }),
  });
  await expect(page.getByTestId("currency-rate-date")).toHaveText(
    "Rate: 2026-08-19",
  );

  const keys = await currencyKeyLooks(page);
  expect(keys, "the currency face should carry all 16 keys").toHaveLength(16);
  const on = keys.filter((key) => !key.off);
  const off = keys.filter((key) => key.off);
  expect(on.map((key) => key.token)).toEqual([
    "unit:jpy",
    "unit:usd",
    "unit:eur",
  ]);
  expect(off).toHaveLength(13);

  // **見え方は 1 通りずつ**——押せるキーの見た目も、押せないキーの見た目も
  // 面の中で揃っている。
  const onLooks = new Set(on.map((key) => key.looks));
  const offLooks = new Set(off.map((key) => key.looks));
  expect(onLooks, JSON.stringify(keys)).toEqual(
    new Set(["opacity=1 cursor=pointer"]),
  );
  expect(offLooks, JSON.stringify(keys)).toEqual(
    new Set(["opacity=0.4 cursor=default"]),
  );
  // **「違う」ことも明示する。** 上の 2 つが同じ値に揃った日は、押せないキーが
  // 押せるキーと同じ見た目になった日である。
  expect([...offLooks]).not.toEqual([...onLooks]);
});

test("keeps the rate date in the same place in every state", async ({
  page,
}) => {
  // **U-4 spec §5・§0.0-3。** キャッシュが新しくても古くても、オフラインでも
  // 取得に失敗していても、**同じ場所に同じ形で**出す——古いときだけ出すと、
  // **出ていないことが「新しい」の意味になる。**
  //
  // **「同じ場所」を実ブラウザの座標で測る。** vitest は同じことを盤面の
  // 何番目の子かで見ているが、**位置は DOM の順序では決まらない**(jsdom は
  // レイアウトを組まない)。
  const stub = await stubProvider(page);
  const seen: { where: string; y: string; text: string }[] = [];

  for (const [where, state, wire, settled] of [
    [
      "新しいキャッシュ",
      { cache: fresh() },
      () => stub.serve(),
      "Rate: 2026-08-19",
    ],
    [
      "古いキャッシュ（取得は成功）",
      { cache: stale() },
      () => stub.serve(),
      `Rate: ${SERVED_DATE}`,
    ],
    [
      "オフライン",
      { cache: stale(), offline: true },
      () => stub.serve(),
      "Rate: 2026-08-01",
    ],
    ["取得に失敗", { cache: stale() }, () => stub.fail(), "Rate: 2026-08-01"],
    ["キャッシュ無し", { cache: null }, () => stub.fail(), "Rate: —"],
  ] as const) {
    wire();
    await openCurrency(page, state);
    // **状態が落ち着くまで待ってから測る。** 待たずに測ると、古いキャッシュの
    // 状態は**背後の取得が届く前の日付**を測ってしまう(2 番目の状態は
    // `2026-08-01` → `2026-08-14` と動く)。
    await expect(page.getByTestId("currency-rate-date")).toHaveText(settled);
    if (state.cache === null) {
      await expect(page.getByTestId("currency-none")).toBeVisible();
    }
    if (state.offline === true) {
      // **オフラインは状態であってエラーではない**(§5)。日付の隣に出る。
      await expect(page.getByTestId("currency-offline")).toBeVisible();
    }
    const row = await page.getByTestId("currency-rate").boundingBox();
    const frame = await panel(page).boundingBox();
    seen.push({
      where,
      y: row && frame ? `${row.y - frame.y}` : UNMEASURED,
      text: (await page.getByTestId("currency-rate-date").textContent()) ?? "",
    });
  }

  expect(seen).toHaveLength(5);
  // **同じ場所**——盤面の上端からの距離が 1 通りに揃う。
  expect(new Set(seen.map((s) => s.y)).size, JSON.stringify(seen)).toBe(1);
  // **番兵**: 測れていなければ `UNMEASURED` で 1 通りに揃ってしまう。
  expect(seen[0]?.y, "the rate row was never measured").not.toBe(UNMEASURED);
  // **同じ形**——キャッシュがある 4 つは日付、無い 1 つは印。古いキャッシュは
  // 背後の取得で日付が進み(2 番目)、オフラインと失敗では古いまま出る。
  expect(seen.map((s) => s.text)).toEqual([
    "Rate: 2026-08-19",
    `Rate: ${SERVED_DATE}`,
    "Rate: 2026-08-01",
    "Rate: 2026-08-01",
    "Rate: —",
  ]);
  for (const state of seen) expect(state.text).toMatch(/^Rate: /);
  // **塞いだルートが呼ばれた回数。** 5 つの状態のうち取りに行くのは 3 つ
  // ——新しいキャッシュは取りに行かず(24 時間以内)、オフラインは
  // `navigator.onLine` で止まる。**0 なら塞ぎ以前に取得の配線が無い。**
  expect(stub.calls.length, "the blocked route was never called").toBe(3);
});

test("guides without breaking the other seven categories when there is no cache", async ({
  page,
}) => {
  // **U-4 spec §5・§0.0-4。** キャッシュが無ければ換算できないが、
  // **他の 7 カテゴリは 1 つも壊れない。**
  const stub = await stubProvider(page);
  stub.fail();
  await openCurrency(page, { cache: null });

  const notice = page.getByTestId("currency-none");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(
    "為替レートがありません。インターネットに接続して取得してください。",
  );
  // **エラーではない。** 役も `alert` ではない。
  await expect(notice).toHaveAttribute("role", "note");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // **16 通貨すべてが押せない。**
  const keys = await currencyKeyLooks(page);
  expect(keys.filter((key) => key.off)).toHaveLength(16);
  // **塞いだルートは呼ばれている**(キャッシュが無いので 1 度は取りに行く)。
  expect(stub.calls.length, "the blocked route was never called").toBe(1);

  // **他の 7 カテゴリ。** 1 を打てば既定の単位で答えが出る。
  let converted = 0;
  for (const category of CATEGORIES) {
    if (category === "currency") continue;
    await page.goto(`/#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    await press(page, ["1"]);
    await expect(page.getByTestId("convert-result")).toContainText("=");
    converted += 1;
  }
  expect(converted, "no category was ever converted").toBe(7);
});

test("shows the attribution the provider requires", async ({ page }) => {
  // **U-4 spec §2.1 実装時義務 3: 出さない選択肢は無い。** 文言とリンク先は
  // プロバイダのドキュメントが指定したものである。
  await stubProvider(page);
  await openCurrency(page, { cache: fresh() });
  const link = page.getByTestId("currency-attribution");
  await expect(link).toBeVisible();
  await expect(link).toHaveText(PROVIDER_ATTRIBUTION_TEXT);
  await expect(link).toHaveAttribute("href", PROVIDER_ORIGIN);
  // **レート日付の行の隣**(spec §7 が予約した置き場)。
  await expect(page.getByTestId("currency-rate").locator("a")).toHaveCount(1);
  // **見えていることまで見る。** `toBeVisible` は `opacity: 0` を素通りする
  // ——**出しているつもりで消えている**のがいちばん困る出方である。
  const looks = await link.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return `opacity=${style.opacity} width=${box.width > 0}`;
  });
  expect(looks).toBe("opacity=1 width=true");
});

test("reaches the provider only after Currency is open", async ({ page }) => {
  // **U-4 spec §0.0-2: 起動時に通信しない。** ネットワークは Currency を
  // 開いたあとの話である。
  //
  // **「呼ばれない」を主張する検査は、スパイが配線されていることも同時に
  // 主張する**——配線されていなければ 0 回で緑になる(この検査の後半がそれ
  // である)。ここでは**塞いだルートそのものがスパイ**なので、後半が緑に
  // なることは「**塞ぎが効いている**」の証明でもある。
  const stub = await stubProvider(page);
  await page.goto("/#scientific");
  await expect(page.getByTestId("display-main")).toBeVisible();
  expect(stub.calls, "the app fetched rates at startup").toEqual([]);

  let opened = 0;
  for (const category of CATEGORIES) {
    if (category === "currency") continue;
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#convert/${category}`);
    await expect(panel(page)).toBeVisible();
    opened += 1;
  }
  // **ループが 0 周でも緑になる書き方をしない。**
  expect(opened).toBe(7);
  expect(stub.calls, "another category fetched rates").toEqual([]);

  // **スパイが配線されている**ことの証拠。為替を開けば 1 度だけ取りに行く。
  await page.evaluate(() => {
    window.location.hash = "#convert/currency";
  });
  await expect(page.getByTestId("currency-rate-date")).toHaveText(
    `Rate: ${SERVED_DATE}`,
  );
  expect(stub.calls).toHaveLength(1);
  expect(stub.calls[0]).toContain("open.er-api.com");
});
