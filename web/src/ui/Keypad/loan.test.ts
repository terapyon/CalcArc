import { describe, expect, it } from "vitest";
import { LOAN_SECTIONS } from "./loan";

// Loan のキー集合そのものの検査。区画名は E2E のセレクタである(設計書 §3)。

function section(ariaLabel: string) {
  const found = LOAN_SECTIONS.find((s) => s.ariaLabel === ariaLabel);
  if (!found) throw new Error(`no section named ${ariaLabel}`);
  return found;
}

describe("Loan のキー集合", () => {
  it("names its sections the way the design fixed them", () => {
    // 勝手に変えない——E2E がこの名前で引く。
    expect(LOAN_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "求めるもの",
      "入力する項目",
      "数字と単位のキー",
    ]);
  });

  it("lays the number pad out four by four", () => {
    const pad = section("数字と単位のキー");
    expect(pad.columns).toBe(4);
    expect(pad.height).toBe("square");
    // 制御は右上、単位は右下(設計書 §2)。
    expect(pad.keys.map((k) => k.label)).toEqual([
      "7",
      "8",
      "9",
      "DEL",
      "4",
      "5",
      "6",
      "AC",
      "1",
      "2",
      "3",
      "万",
      "0",
      "000",
      ".",
      "億",
    ]);
  });

  it("keeps the mode and field rows half height", () => {
    expect(section("求めるもの").height).toBe("half");
    expect(section("入力する項目").height).toBe("half");
    expect(section("求めるもの").keys).toHaveLength(3);
    // 月額は月額モードでは答だが、他の 2 モードでは入力である(設計書 §6)。
    expect(section("入力する項目").keys).toHaveLength(6);
    expect(section("入力する項目").columns).toBe(6);
  });

  it("gives every key an accessible name", () => {
    for (const s of LOAN_SECTIONS) {
      for (const key of s.keys) {
        expect(key.ariaLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("has no reserved slots — every key does something", () => {
    // S1 の予約スロット(S2 が埋める場所)は Loan には無い。
    for (const s of LOAN_SECTIONS) {
      for (const key of s.keys) {
        expect(key.token).not.toBeNull();
      }
    }
  });
});
