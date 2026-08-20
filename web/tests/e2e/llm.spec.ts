import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) =>
  page.getByRole("region", { name: "LLM のメモリ計算" });

/** 測れなかったことの印。相対座標は負にもなるので `-1` では代用できない。 */
const UNMEASURED = "unmeasured";

/**
 * **ボタン名は実物の aria-label(Task 8 の `llm.ts`)に合わせてある。**
 * plan の brief に書かれていた文字列("パラメータ数を選ぶ"、候補キーの
 * "27B"/"8K" など)は、実際の `FIELD_ARIA_LABELS` / `valueKey` の出力
 * (「〜を入力」、候補の読み上げ名は展開済みの数そのもの)と食い違って
 * いた——LlmPanel.test.tsx の同じ注記を参照。ここでも同じ修正を反映する。
 */
async function press(page: Page, names: string[]) {
  for (const name of names) {
    await panel(page).getByRole("button", { name, exact: true }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#scale/llm");
  await expect(panel(page)).toBeVisible();
});

test("the headline case: 27B INT4 with an 8K context", async ({ page }) => {
  for (const [field, value] of [
    ["パラメータ数を入力", "27000000000"],
    ["重みの精度を選ぶ", "INT4"],
    ["KVヘッド数を入力", "16"],
    ["ヘッド次元を入力", "128"],
    ["文脈長を入力", "8192"],
    ["KVの精度を選ぶ", "FP16"],
  ] as const) {
    await panel(page).getByRole("button", { name: field, exact: true }).click();
    await panel(page).getByRole("button", { name: value, exact: true }).click();
  }
  await press(page, ["層数を入力", "6", "2"]);
  await expect(page.getByTestId("llm-result")).toContainText(
    "17,660,749,568 bytes",
  );
  await expect(page.getByTestId("display-main")).toHaveText("17.7 GB");
});

/**
 * 7 つの面 = (項目のボタン名, 面の aria-label, その面のキー数)。
 *
 * **名前は `web/src/ui/Keypad/llm.ts` の実物から取っている**(`FIELD_ARIA_LABELS`
 * と `CANDIDATE_SECTIONS` / `llmPad` の `ariaLabel`)。「KVヘッド数の候補キー」
 * 「KVの精度のキー」に**スペースは入らない**——1 字ずれると、その面だけ
 * 別物として扱われる。件数は `buildCandidateFace` / `llmPad` の配り方から
 * 出た実測値(予約スロットも disabled な <button> として描かれる)。
 */
const FACES = [
  ["層数を入力", "数字と演算のキー", 25],
  ["パラメータ数を入力", "パラメータ数の候補キー", 15],
  ["重みの精度を選ぶ", "重みの精度のキー", 10],
  ["KVヘッド数を入力", "KVヘッド数の候補キー", 15],
  ["ヘッド次元を入力", "ヘッド次元の候補キー", 10],
  ["文脈長を入力", "文脈長の候補キー", 15],
  ["KVの精度を選ぶ", "KVの精度のキー", 10],
] as const;

test("the keys hold 44px on every face", async ({ page }) => {
  // 44px はタッチの推奨最小(base-spec §43)。**7 つの面すべてを回る**
  // (Global Constraints)——LLM は面が最も多いパネルで、1 つでも漏らすと
  // その面だけ枠が伸び縮みしても誰も気づかない。**測ったキーの件数も
  // 主張する**——0 件でも緑になる書き方はしない。
  let measured = 0;
  for (const [field, faceName, expectedCount] of FACES) {
    await panel(page).getByRole("button", { name: field, exact: true }).click();
    const face = panel(page).getByRole("group", { name: faceName });
    const buttons = await face.getByRole("button").all();
    expect(buttons, `${faceName} should render its full key set`).toHaveLength(
      expectedCount,
    );
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      measured += 1;
    }
  }
  // **件数の下限も主張する。** 7 面 × 実測件数の合計が 0 なら、ループが
  // 何も測っていないのに緑になる。
  expect(measured).toBe(FACES.reduce((sum, [, , n]) => sum + n, 0));
  expect(measured, "no key was ever measured").toBeGreaterThan(0);
});

test("the field row is half height but wide enough", async ({ page }) => {
  // 項目行は **4 列 × 2 段**(`LLM_FIELD_SECTION`)。Data Scale の 3 列 × 1 段
  // より詰まっている側なので、幅 44px の主張はこちらにこそ要る。縦は
  // 押し直せば戻る列なので詰める(設計書 §4 の half)。
  const row = panel(page).getByRole("group", { name: "入力する項目" });
  const buttons = await row.getByRole("button").all();
  // 7 項目 + 恒久の空き 1。空きも disabled な <button> として描かれる。
  expect(buttons, "the field row should render its 4x2 cells").toHaveLength(8);
  for (const button of buttons) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    // **番兵**: 測れていなければ -1 になり、`< 44` を素通りしない。
    expect(box?.height ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.height ?? -1).toBeLessThan(44);
  }
});

test("swapping faces moves neither the frame nor DEL and AC", async ({
  page,
}) => {
  // **7 面が同じ枠に載る**(Global Constraints、設計書 §4.2)。
  // `LlmPanel.module.css` は 7 つの aria-label をセレクタに並べているが、
  // 1 面を落としても 1 字ずれても、キー 1 個ずつの 44px を見る検査は緑の
  // まま——その面だけ中身の行数ぶんに枠が伸び縮みする(DataScale で実測
  // 済みの事故、19px)。だから枠そのものと、枠の中で位置が動いてはいけない
  // DEL・AC を、7 面ぶん突き合わせる。
  // **DEL と AC は枠からの相対座標で測る。** 主張は「**盤面の中で DEL が
  // 動かない**」であって、**盤面より上にある表示行の高さを巻き込むのは
  // 測り間違い**である——その行高はフォント環境で変わる(CI 実測: 数字面
  // だけ y=390、他 6 面は y=375.625。枠の 366.0625 は 7 面とも不動だった)。
  // 枠を原点に取れば、盤面の中で動いたかどうかだけが残る。
  const seen: {
    face: string;
    box: { width: number; height: number };
    // 測れなかったときは `UNMEASURED`。相対座標は負にもなりうるので、
    // `-1` を番兵に使うことはできない。
    del: string;
    ac: string;
  }[] = [];
  const rel = (
    b: { x: number; y: number } | null,
    frame: { x: number; y: number } | null,
  ) => (b && frame ? `${b.x - frame.x},${b.y - frame.y}` : UNMEASURED);
  for (const [field, face] of FACES) {
    await press(page, [field]);
    const box = await panel(page)
      .getByRole("group", { name: face })
      .boundingBox();
    const del = await panel(page)
      .getByRole("button", { name: "1文字消去", exact: true })
      .boundingBox();
    const ac = await panel(page)
      .getByRole("button", { name: "この項目を消去", exact: true })
      .boundingBox();
    seen.push({
      face,
      box: { width: box?.width ?? -1, height: box?.height ?? -1 },
      // **在ることではなく動かないことを測る**(data-scale-keypad.spec.ts
      // の同名の検査と同じ形)。
      del: rel(del, box),
      ac: rel(ac, box),
    });
  }
  expect(seen).toHaveLength(FACES.length);
  const sizes = new Set(seen.map((s) => `${s.box.width}x${s.box.height}`));
  expect(sizes.size, `the frame moved: ${JSON.stringify(seen)}`).toBe(1);
  const dels = new Set(seen.map((s) => s.del));
  expect(dels.size, `DEL moved: ${JSON.stringify(seen)}`).toBe(1);
  const acs = new Set(seen.map((s) => s.ac));
  expect(acs.size, `AC moved: ${JSON.stringify(seen)}`).toBe(1);
  // **番兵は 3 つとも要る**: 1 度も測っていなければ枠は -1、DEL と AC は
  // `UNMEASURED` のまま 1 通りに揃い、**上の 3 つの Set は緑になる**。
  expect(
    seen[0]?.box.width,
    "the frame was never measured",
  ).toBeGreaterThanOrEqual(0);
  expect(seen[0]?.del, "DEL was never measured").not.toBe(UNMEASURED);
  expect(seen[0]?.ac, "AC was never measured").not.toBe(UNMEASURED);
});

test("a candidate key says its number out loud", async ({ page }) => {
  // jsdom はアクセシビリティツリーを組み立てない(CLAUDE.md)。
  // 「8K と書いてあるキーの読み上げ名が 8192 である」は実ブラウザで見る。
  await panel(page)
    .getByRole("button", { name: "文脈長を入力", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "8192", exact: true }),
  ).toHaveText("8K");
});
