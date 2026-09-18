import { expect, test } from "@playwright/test";
import { KEY_TOKENS } from "../../../web/src/calc";
import { ACTION_BUTTONS, BUTTON_FOR, SHIFT_ARIA_LABEL } from "./keys";

/** 盤面の押せる面の全部。**トークンと操作の両方**(設計書 2026-09-10 §3)。 */
const PRESSABLE: [string, import("./keys").ButtonFor][] = [
  ...[...BUTTON_FOR].map(
    ([token, b]) => [token, b] as [string, import("./keys").ButtonFor],
  ),
  ...[...ACTION_BUTTONS].map(
    ([action, b]) =>
      [`action:${action}`, b] as [string, import("./keys").ButtonFor],
  ),
];

/**
 * **盤面から届くか。**
 *
 * 計算コアの経路(`playwright.heavy.config.ts`)はキートークンを直接
 * `dispatch` に渡すので、**そのキーが画面のどこにも無くても緑になる。**
 * ここはその穴を塞ぐ——実際のボタンを探し、実際に押す。
 *
 * Shift の裏にあるキー(`asin` など)は、Shift を押さないと存在しない。
 * **この違いはこの経路でしか見えない。**
 */

/**
 * **ボタンは page から直接引く。** 既存の科学計算 E2E
 * (`tests/e2e/scientific-functions.spec.ts`)と同じ作法である——盤面は
 * region で囲まれていないので、region 起点で引くと 1 つも見つからない
 * (最初にそれを書いて 40 件が「見つからない」と出た)。
 */
const panel = (page: import("@playwright/test").Page) => page;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("display-main")).toHaveText("0");
});

test("no key token is claimed by two buttons", () => {
  // `BUTTON_FOR` は同じトークンが 2 度現れたら例外を投げる——**どちらを
  // 押すかが不定になり、駆動側が任意に選んでしまう**ためである。
  // ここは「その検査が実データ(盤面の定義)に対して通っている」ことを固定する。
  //
  // **`BUTTON_FOR` を読むだけで検査が走る**（モジュールの初期化時に構築する）。
  // 例外が投げられていればこのテストに到達しない。
  expect(BUTTON_FOR.size).toBeGreaterThan(0);
});

test("every key token the engine accepts has a button on the keypad", async () => {
  // **これは盤面の定義だけで決まるので、ブラウザを開く前に分かる。**
  // それでもここに置くのは、下の 2 つと同じ「届くか」の話だからである。
  const missing = KEY_TOKENS.filter((token) => !BUTTON_FOR.has(token));
  expect(
    missing,
    `${missing.length} key token(s) the engine accepts have no button on the ` +
      "scientific keypad. Either the keypad is missing them, or they belong " +
      "to another panel (Finance / Data Scale) — say which in this test.",
  ).toEqual([]);
});

/**
 * **初期状態では engine が拒むが、前提を満たせば押せるキー**(0.9.3 の D-2)。
 *
 * **「押せないから一覧から外す」はしない。** それは
 * **「盤面が持つと言っているボタンは押せる」という主張を捨てる**ことになる。
 * `)` は**いつでも押せない**のではなく、**開いている組が無いときだけ**押せない
 * ——**前提を満たしてから押すのが筋**である。
 *
 * **条件は engine の現物から**（`calcarc-core/src/engine/mod.rs` の `refuses`。
 * calcarc-3d が 2026-09-18 に書き出したものを、要約せずにそのまま使う）:
 *
 * ```rust
 * if key == Key::RParen {
 *     return !state.operators.iter().any(|op| matches!(op, OpToken::OpenParen));
 * }
 * ```
 *
 * **`(` を 1 回押せば足りる**——**数字は要らない**（`( 3` でも `( ( 3 )` でも、
 * **開いている組が残っていれば**押せる）。**ほかの 8 つ**（数字・`000`・`.`・
 * `Exp`・`j`・`(`・`π`・`e`）**とは拒む理由が違う**——あちらは「手元の値を
 * 捨てるから」で `on_hand` の腕に居り、**`)` は「閉じる先が無いから」**拒む。
 *
 * **「深さ > 0 ⇔ 押せる」とは書かない。** ほぼ同値だが**1 点で嘘になる**
 * ——`refuses` は**先頭で `state.error.is_some()` なら常に false**（エラー中は
 * **どのキーも拒まない**）なのに、`display.rs:88` の `pending_depth` は
 * **エラー中を 0 に潰す**。**つまりエラー中は「深さ 0 なのに `)` は押せる」。**
 * 盤面の検査はエラー状態を作らないので踏まないが、**綴りとしては
 * 「開いている組が在るとき。ただしエラー中はどのキーも拒まない」**が正しい
 * （calcarc-3d の指摘、2026-09-18。私の最初の読みは「深さ > 0」で、そこが穴だった）。
 *
 * **表は一般の形で持つ**——**`)` は「初期状態で拒まれた最初のキー」であって、
 * 特別なキーではない。** `refuses` が拒みうるのは 9 種あり、**残り 8 つが
 * 初期状態で拒まれないのは `buffer` が None・`on_hand` が false だから**にすぎない。
 * **特例 1 件にすると、次に初期状態で拒むキーが出た日に、また 12.9 分の走行で見つかる。**
 */
const PRECONDITION: Record<string, { keys: string[]; why: string }> = {
  rparen: {
    // **`["lparen"]` だけでも押せる**（数字は要らない）。**それでも 1 つ足すのは、
    // `["lparen", "3"]` が `engine_table.rs` に
    // `accepted_after(&["lparen", "3"], "rparen")` という行として在るから**である
    // ——**盤面の検査の前提そのものが、engine の仕様表に固定される。**
    // **前提が engine 側で崩れたら、この 12.9 分の段より先に engine_table が赤くなる。**
    keys: ["lparen", "3"],
    why: "開いている組が無いときだけ拒む(`refuses` の RParen の分岐)",
  },
};

const buttonOf = (page: import("@playwright/test").Page, token: string) => {
  const button = BUTTON_FOR.get(token as never);
  if (button === undefined) {
    throw new Error(
      `前置きに ${token} を書いたが、盤面にそのボタンが無い——` +
        "前置きの表が盤面の定義と食い違っている",
    );
  }
  return panel(page).getByRole("button", {
    name: button.ariaLabel,
    exact: true,
  });
};

/**
 * `ac` で初期状態に戻す——**戻ったことは呼び出し側が assert する。**
 *
 * **ラベルを手で書かない。** このファイルの `BUTTON_FOR` から引く
 * （`keys.ts` の「手書きの表を持たない」と同じ理由）。**最初は
 * `"オールクリア"` と書いて外した**——現物は `"全消去"` である
 * （`scientific.ts:198`）。**手で書いた時点で、盤面の改名に追随しなくなる。**
 */
const reset = (page: import("@playwright/test").Page) =>
  buttonOf(page, "ac").click();

test("every button the keypad claims can actually be pressed", async ({
  page,
}) => {
  // **定義にあることと、押せることは別である。** 描画されない、重なって
  // いる、無効化されている——どれも定義からは分からない。
  //
  // **前提を持つキーは、前提を満たしてから見る**（`PRECONDITION`）。
  // **飛ばさない**——飛ばすと、このテストの主張がそのキーの分だけ欠ける。
  const unreachable: string[] = [];
  for (const [token, button] of PRESSABLE) {
    if (button.needsShift) {
      continue; // 下のテストが見る。
    }
    const precondition = PRECONDITION[token];
    if (precondition !== undefined) {
      for (const key of precondition.keys) {
        await buttonOf(page, key).click();
      }
    }
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    const found = await locator.count();
    // **enabled を先に読み、`continue` の前に盤面を戻す。**
    // **戻さずに `continue` すると、次のトークンが「前のキーを押したあと」の
    // 盤面を見る**——`)` の前置きを踏んだ直後は組が開いたままなので、
    // **そのあとのキーが違う状態で判定される。**
    const enabled = found === 1 ? await locator.isEnabled() : false;
    if (precondition !== undefined) {
      await reset(page);
    }
    if (found !== 1) {
      unreachable.push(
        `${token}: expected exactly one button named "${button.ariaLabel}", ` +
          `found ${found}`,
      );
      continue;
    }
    // **押せることまで見る。** 上のコメントは「無効化されている」も
    // 分からないと言っているのに、**実装は数えるだけだった**——名前が
    // `can actually be pressed` のまま、無効化されたキーを緑で通す形に
    // なっていた(2026-08-26 に発見)。`disabled` なボタンは Playwright の
    // `click()` が actionability を待って**タイムアウトする**(実測: 3 秒指定で
    // 3 秒後に TimeoutError、click は要素に届かない)ので、**押せないキーは
    // 押せないと、ここで言う。**
    if (!enabled) {
      unreachable.push(
        `${token}: "${button.ariaLabel}" は在るが無効化されている(押せない)` +
          (precondition === undefined
            ? ""
            : `(前置き ${precondition.keys.join(" ")} を押したあとでも)`),
      );
    }
  }
  expect(unreachable).toEqual([]);
});

test("a key with a precondition is refused before it and accepted after", async ({
  page,
}) => {
  // **上のテストは「前提を満たせば押せる」しか見ていない。** それだけだと、
  // **`)` が『いつでも押せる』に戻った日にも緑**になる——前置きを押しても
  // 押さなくても押せるからである。**表だけが残って空回りする。**
  //
  // **だから 3 点で主張する**: **前は無効 → 後は有効 → `ac` で無効に戻る。**
  // 1 点目が**表の腐りを止め**（規則が消えたらここが鳴る）、
  // 3 点目が**上のテストの後始末が効いていることを証明する**
  // （`ac` が組を捨てる＝`cleared()` が `operators` を空にする）。
  //
  // **判定は 3 点とも同じ `isEnabled()` で読む。** 片方を `toBeDisabled` の
  // 別経路にすると、**`disabled` と `aria-disabled` の食い違いを見逃す**
  // ——盤面は `Key.tsx:90-91` で両方を同時に付けている（calcarc-3d の指摘）。
  const entries = Object.entries(PRECONDITION);
  expect(
    entries.length,
    "PRECONDITION が空——初期状態で拒まれるキーが無くなったなら、" +
      "この表と上の分岐ごと消す番である",
  ).toBeGreaterThan(0);

  const wrong: string[] = [];
  for (const [token, precondition] of entries) {
    const locator = buttonOf(page, token);

    if (await locator.isEnabled()) {
      wrong.push(
        `${token}: 初期状態で既に押せる——engine が拒まなくなったのに ` +
          `PRECONDITION に残っている(${precondition.why})`,
      );
      continue;
    }
    for (const key of precondition.keys) {
      await buttonOf(page, key).click();
    }
    if (!(await locator.isEnabled())) {
      wrong.push(
        `${token}: 前置き ${precondition.keys.join(" ")} を押しても押せない`,
      );
    }
    await reset(page);
    if (await locator.isEnabled()) {
      wrong.push(`${token}: ac のあとも押せる——ac が組を捨てていない`);
    }
  }
  expect(wrong).toEqual([]);
});

test("the keys behind Shift appear only after Shift is pressed", async ({
  page,
}) => {
  const shifted = PRESSABLE.filter(([, b]) => b.needsShift);
  expect(
    shifted.length,
    "no key is behind Shift — if the second face was removed, this test is " +
      "the one that should have told you",
  ).toBeGreaterThan(0);

  // 押す前は存在しない。**ここが緩いと「Shift を押さなくても届く」を見逃す。**
  for (const [token, button] of shifted) {
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    expect(
      await locator.count(),
      `${token} ("${button.ariaLabel}") is visible before Shift was pressed`,
    ).toBe(0);
  }

  await panel(page)
    .getByRole("button", { name: SHIFT_ARIA_LABEL, exact: true })
    .click();

  // 押した後は 1 つだけあり、**押せる**(操作の面——`hist`——も含む)。
  const stillMissing: string[] = [];
  for (const [token, button] of shifted) {
    const locator = panel(page).getByRole("button", {
      name: button.ariaLabel,
      exact: true,
    });
    if ((await locator.count()) !== 1) {
      stillMissing.push(`${token} ("${button.ariaLabel}")`);
      continue;
    }
    if (!(await locator.isEnabled())) {
      stillMissing.push(`${token} ("${button.ariaLabel}") は在るが押せない`);
    }
  }
  expect(
    stillMissing,
    "these keys are behind Shift according to the keypad definition, but " +
      "pressing Shift did not reveal them",
  ).toEqual([]);
});
