import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import {
  backspace,
  canPushUnit,
  digits,
  EMPTY,
  grouped,
  isEmpty,
  MAN,
  OKU,
  pushDigit,
  pushUnit,
  text,
} from "./entry";

/** 打鍵列をそのまま流す。"万"/"億" は単位キー、それ以外は数字。 */
function press(keys: string): Entry {
  let entry = EMPTY;
  for (const key of keys) {
    if (key === "万" || key === "億") {
      const next = pushUnit(entry, key === "万" ? MAN : OKU);
      if (next === null) throw new Error(`文法違反: ${keys}`);
      entry = next;
    } else {
      entry = pushDigit(entry, key);
    }
  }
  return entry;
}

describe("万・億の入力", () => {
  it("commits the digits at the position the unit names", () => {
    expect(digits(press("3000万"))).toBe("30000000");
    expect(text(press("3000万"))).toBe("3000万");
  });

  it("adds the segments together", () => {
    expect(digits(press("1億2000万"))).toBe("120000000");
    expect(text(press("1億2000万"))).toBe("1億2000万");
    // 口語の「1 億 2000 万」を 12000 万と打っても同じ値になる。
    expect(digits(press("12000万"))).toBe("120000000");
  });

  it("keeps typing after the last unit as plain ones", () => {
    expect(digits(press("1億2000万500"))).toBe("120000500");
    expect(text(press("1億2000万500"))).toBe("1億2000万500");
  });

  it("refuses a unit that does not go down", () => {
    // 3000万 のあとの 億 は「3000 万億」で意味が無い(設計書 §5)。
    const after = press("3000万");
    expect(canPushUnit(after, OKU)).toBe(false);
    expect(pushUnit(after, OKU)).toBeNull();
    // 同じ単位の重ねも不可。**数字を打った後で確かめる**——単位の直後は
    // digits が空で、先に「数字の無い単位」の規則が効いてしまい、
    // 「下る単位しか受けない」の境界に届かない。
    expect(canPushUnit(press("1万2"), MAN)).toBe(false);
    expect(canPushUnit(press("1万2"), OKU)).toBe(false);
    // 下る向きなら受ける。
    expect(canPushUnit(press("1億2"), MAN)).toBe(true);
  });

  it("refuses a unit with no digits in front of it", () => {
    expect(canPushUnit(EMPTY, MAN)).toBe(false);
    expect(pushUnit(EMPTY, MAN)).toBeNull();
    // 単位の直後も同じ(1億億 を防ぐ)。下る単位なら数字を打てば押せる。
    expect(canPushUnit(press("1億"), OKU)).toBe(false);
    expect(canPushUnit(press("1億"), MAN)).toBe(false);
    expect(canPushUnit(press("1億2"), MAN)).toBe(true);
  });

  it("walks back one stage at a time", () => {
    // 入力中の数字があれば 1 文字。無ければ直前のセグメントを解いて戻す。
    expect(text(backspace(press("1億2000")))).toBe("1億200");
    expect(text(backspace(press("1億")))).toBe("1");
    expect(digits(backspace(press("1億")))).toBe("1");
    expect(text(backspace(press("1")))).toBe("");
    expect(text(backspace(EMPTY))).toBe("");
  });

  it("gives the core plain digits, never separators", () => {
    // parse_yen はカンマ・符号・小数点を拒否する(base-spec §26)。
    expect(digits(press("1億2000万500"))).toMatch(/^\d+$/);
    expect(digits(EMPTY)).toBe("");
  });

  it("drops a leading zero the way a calculator does", () => {
    expect(text(press("007"))).toBe("7");
    expect(text(press("0"))).toBe("0");
  });

  it("knows when nothing has been typed", () => {
    expect(isEmpty(EMPTY)).toBe(true);
    expect(isEmpty(press("0"))).toBe(false);
    expect(isEmpty(press("1億"))).toBe(false);
  });

  it("groups digits for display only", () => {
    expect(grouped("38579007")).toBe("38,579,007");
    expect(grouped("0")).toBe("0");
  });
});
