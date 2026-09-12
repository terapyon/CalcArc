import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHROMIUM_NARROW_WIDTH, WEBKIT_NARROW_WIDTH } from "../e2e/widths";
import { readManuals } from "./manuals";

/**
 * **マニュアルが「確かめている画面の幅」として書く数字は、E2E が実際に測る幅と
 * 同じである**(2026-09-11、利用者の裁定「320px は確かめない。対応幅を書いておく」)。
 *
 * 数字の出どころは `web/tests/e2e/widths.ts` の 1 か所。**E2E の幅を変えた日に、
 * マニュアルの文が古いまま残らない**ようにする——キー名の番人
 * (`manual-key-names.test.ts`)と同じ考え方で、**文の中の数字を定数と突き合わせる。**
 */
const JA = /幅 (\d+)px 以上/g;
const EN = /from (\d+)px wide/g;

const widthsIn = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => Number(m[1]));

describe("マニュアルの画面幅は E2E の幅と同じである", () => {
  it("3 冊とも、2 つのエンジンの幅を書いている", () => {
    const manuals = readManuals();
    expect(manuals.length).toBe(3);
    for (const manual of manuals) {
      const found = widthsIn(
        manual.text,
        manual.path.endsWith(".en.md") ? EN : JA,
      );
      expect(found, `${manual.path} の画面幅`).toEqual([
        CHROMIUM_NARROW_WIDTH,
        WEBKIT_NARROW_WIDTH,
      ]);
    }
  });

  it("viewport-budget のいちばん狭い幅は、Chromium の幅と同じである", () => {
    // **もう 1 つの持ち主。** `viewport-budget.spec.ts` は幅を自分で書いている
    // ——あちらを狭めた(または広げた)日に、マニュアルの数字と食い違う。
    // **パスは `import.meta.dirname` から組む**(`manuals.ts` と同じ)。
    // vitest の jsdom 環境では、大域の `URL` が jsdom のものに差し替わっていて、
    // `readFileSync(new URL(相対, import.meta.url))` は「The URL must be of
    // scheme file」で投げる(`import.meta.url` そのものは `file:` である。
    // 2026-09-11 に実際に落ち、使い捨ての検査で原因を確かめた)。
    const budget = readFileSync(
      join(import.meta.dirname, "../e2e/viewport-budget.spec.ts"),
      "utf8",
    );
    const widths = [...budget.matchAll(/width:\s*(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBe(CHROMIUM_NARROW_WIDTH);
  });
});
