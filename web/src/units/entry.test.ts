import { describe, expect, it } from "vitest";
import type { Unit } from "./entry";
import {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  isEmpty,
  pushDigit,
  pushUnit,
  text,
} from "./entry";

// 架空の単位表。**Loan でも Data Scale でもない組み合わせ**で、機構が
// 単位表に依存しないことを固定する——それが D の前提だからである。
const SMALL: Unit = { label: "s", scale: 10n ** 2n };
const BIG: Unit = { label: "B", scale: 10n ** 5n };

function press(keys: string, max = 39) {
  let entry = EMPTY;
  for (const key of keys) {
    if (key === "s" || key === "B") {
      const next = pushUnit(entry, key === "s" ? SMALL : BIG);
      if (next === null) throw new Error(`文法違反: ${keys}`);
      entry = next;
    } else {
      entry = pushDigit(entry, key, max);
    }
  }
  return entry;
}

describe("位取り入力の機構", () => {
  it("adds the segments together, whatever the units are", () => {
    expect(digits(press("1B2s"))).toBe("100200");
    expect(text(press("1B2s"))).toBe("1B2s");
  });

  it("keeps typing after the last unit as plain ones", () => {
    expect(digits(press("1B2s34"))).toBe("100234");
  });

  it("only accepts units that step down", () => {
    // 数字を打ってから確かめる——単位の直後は digits が空で、先に
    // 「数字の無い単位」の規則が効いて境界に届かない(L で踏んだ穴)。
    expect(canPushUnit(press("1s2"), BIG)).toBe(false);
    expect(canPushUnit(press("1s2"), SMALL)).toBe(false);
    expect(canPushUnit(press("1B2"), SMALL)).toBe(true);
    expect(canPushUnit(EMPTY, SMALL)).toBe(false);
  });

  it("takes the digit limit from the caller", () => {
    // 呼び出し側の定義域(Loan は u64 の 20 桁、D は u128 の 39 桁)。
    let entry = EMPTY;
    for (const digit of "123456") entry = pushDigit(entry, digit, 3);
    expect(text(entry)).toBe("123");
  });

  it("walks back one stage at a time", () => {
    expect(text(backspace(press("1B23")))).toBe("1B2");
    expect(text(backspace(press("1B")))).toBe("1");
    expect(isEmpty(backspace(press("1")))).toBe(true);
    expect(isEmpty(backspace(EMPTY))).toBe(true);
  });

  it("gives plain digits, never separators", () => {
    expect(digits(press("1B2s34"))).toMatch(/^\d+$/);
    expect(digits(EMPTY)).toBe("");
  });
});
