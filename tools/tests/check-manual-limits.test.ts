import { describe, expect, it } from "vitest";
import { checkTypeCeiling, collectRows } from "../check-manual-limits.mjs";

/**
 * **マニュアルの上限の数と、製品の数の突き合わせ**（0.9.3 検証側 C-1）。
 *
 * **この番人は実物のリポジトリを読む。** マニュアルの文とソースの綴りの両方に
 * 依るので、文字列だけでは検査できない（`check-conflict-markers.test.ts` と同じ形）。
 */
describe("マニュアルの上限", () => {
  it("すべての行で、マニュアルの数と製品の数が一致する", () => {
    const rows = collectRows() as {
      name: string;
      manual: number;
      source: number;
      why: string;
    }[];
    const wrong = rows.filter((row) => row.manual !== row.source);
    expect(wrong, `食い違い: ${JSON.stringify(wrong, null, 2)}`).toEqual([]);
  });

  // **何行見たかを主張する（0 行で緑を返さない）。**
  // 実数はマニュアルが育てば動くので、**下限だけ**を置く
  // （2026-09-17 の実測は 7 行。年利の 2 行は 3d の定数化を待っている）。
  it("行を 1 つも見ないまま緑にならない", () => {
    const rows = collectRows() as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  // **型の上限は、ソースに数として現れない。** 計算して比べ、
  // **`parse::<u64>` が実在すること**も確かめる——型が変われば赤くなる。
  it("金額の上限が u64 の上限と一致し、その受け口が実在する", () => {
    const { written, ceiling } = checkTypeCeiling() as {
      written: string;
      ceiling: string;
    };
    expect(written).toBe(ceiling);
    expect(ceiling).toBe("18446744073709551615");
  });
});
