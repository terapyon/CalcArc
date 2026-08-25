import type { Page } from "@playwright/test";

/**
 * ハーネス 1 ケースの結果。表示は整形済み文字列で、数値は取り出せない(設計書 §6.3)。
 *
 * src/heavy-harness.ts にも同じ形の宣言がある。**重複は意図的**である——
 * あちらはブラウザで動く配線、こちらは Node で動くテスト側の型で、
 * import で繋ぐと Playwright の実行文脈にブラウザ用モジュールが引き込まれる。
 * 境界をまたぐ形は、境界の両側に書く。
 */
export interface HarnessResult {
  main: string;
  error: string | null;
}

interface HarnessWindow {
  __calcarc: {
    ready: Promise<void>;
    runAll(sequences: string[][]): HarnessResult[];
    version(): string;
  };
}

/**
 * ハーネスページを開き、wasm の初期化を待つ。シャードごとに 1 回だけ呼ぶ。
 * ページの開き直しは高価なので、以後は同じページで回す。
 */
export async function openHarness(page: Page): Promise<void> {
  await page.goto("/harness/heavy-harness.html");
  await page.waitForFunction(() => "__calcarc" in window);
  await page.evaluate(async () => {
    await (window as unknown as HarnessWindow).__calcarc.ready;
  });
}

/** 計算コア(wasm)の版。報告書の素性に載せる。 */
export async function coreVersion(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as HarnessWindow).__calcarc.version(),
  );
}

/** キー列の束を 1 往復で流す。往復を増やさないことが速度の要である。 */
export async function runAll(
  page: Page,
  sequences: string[][],
): Promise<HarnessResult[]> {
  return page.evaluate(
    (batch) => (window as unknown as HarnessWindow).__calcarc.runAll(batch),
    sequences,
  );
}
