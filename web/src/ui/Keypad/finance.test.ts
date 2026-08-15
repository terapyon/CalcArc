import { describe, expect, it } from "vitest";
import {
  DEPOSIT_FOR_FIELD_SECTION,
  FINANCE_SECTIONS,
  PERIODS_FOR_FIELD_SECTION,
} from "./finance";

// Finance のキー集合そのものの検査。区画名は E2E のセレクタである(設計書 §3)。

function section(ariaLabel: string) {
  const found = FINANCE_SECTIONS.find((s) => s.ariaLabel === ariaLabel);
  if (!found) throw new Error(`no section named ${ariaLabel}`);
  return found;
}

describe("Finance のキー集合", () => {
  it("names its sections the way the design fixed them", () => {
    // 勝手に変えない——E2E がこの名前で引く。
    expect(FINANCE_SECTIONS.map((s) => s.ariaLabel)).toEqual([
      "計算の種類",
      "入力する項目",
      "数字と演算のキー",
    ]);
  });

  it("lays the number pad out five by five, like Scientific", () => {
    // **3 つのタブで AC・DEL の位置とキーの寸法を揃える**(設計書 §4)。
    // タブを行き来して AC の場所が変わるのは、押し間違いが入力のやり直しに
    // 直結する。
    const pad = section("数字と演算のキー");
    expect(pad.columns).toBe(5);
    expect(pad.height).toBe("square");
    expect(pad.keys.map((k) => k.label)).toEqual([
      "(",
      ")",
      "—",
      "DEL",
      "AC",
      "7",
      "8",
      "9",
      "÷",
      "万",
      "4",
      "5",
      "6",
      "×",
      "億",
      "1",
      "2",
      "3",
      "−",
      "—",
      "0",
      "000",
      ".",
      "+",
      "=",
    ]);
    // DEL と AC は最上段の右 2 つ——Scientific と同じ位置である。
    expect(pad.keys[3]?.token).toBe("del");
    expect(pad.keys[4]?.token).toBe("ac");
  });

  it("keeps the mode and field rows half height", () => {
    expect(section("計算の種類").height).toBe("half");
    expect(section("入力する項目").height).toBe("half");
    // ローン 3 + 複利 1 + 複利の逆算 2 (設計書 §11)。
    expect(section("計算の種類").keys).toHaveLength(6);
    expect(section("計算の種類").columns).toBe(6);
    // 月額は月額モードでは答だが、他の 2 モードでは入力である(設計書 §6)。
    expect(section("入力する項目").keys).toHaveLength(6);
    expect(section("入力する項目").columns).toBe(6);
  });

  it("swaps exactly one key for the target field", () => {
    expect(DEPOSIT_FOR_FIELD_SECTION.keys).toHaveLength(6);
    expect(DEPOSIT_FOR_FIELD_SECTION.columns).toBe(6);
    expect(DEPOSIT_FOR_FIELD_SECTION.ariaLabel).toBe("入力する項目");
    expect(DEPOSIT_FOR_FIELD_SECTION.keys.map((k) => k.token)).toEqual([
      "field:principal",
      "field:target",
      "field:rate",
      "field:months",
      "field:periods",
      "field:tax",
    ]);
    expect(PERIODS_FOR_FIELD_SECTION.keys.map((k) => k.token)).toEqual([
      "field:principal",
      "field:deposit",
      "field:rate",
      "field:target",
      "field:periods",
      "field:tax",
    ]);
  });

  it("gives every key an accessible name", () => {
    for (const s of FINANCE_SECTIONS) {
      for (const key of s.keys) {
        expect(key.ariaLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("marks the cells that hold no key as reserved slots", () => {
    // **格子の形を崩さない**ために無効なボタンを描く(裁定 Q3)。
    // 金額と件数に負の値は無いので `+/−` は置かない。
    const pad = section("数字と演算のキー");
    const reserved = pad.keys.filter((k) => k.token === null);
    expect(reserved).toHaveLength(2);
    for (const key of reserved) {
      expect(key.label).toBe("—");
    }
  });

  it("has no reserved slots in the mode and field rows", () => {
    // 予約スロットは数字面の 2 マスだけ。モード行と項目行のキーは全部働く。
    for (const name of ["計算の種類", "入力する項目"]) {
      for (const key of section(name).keys) {
        expect(key.token).not.toBeNull();
      }
    }
  });
});
