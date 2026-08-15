import { describe, expect, it } from "vitest";
import type { Unit } from "./entry";
import {
  backspace,
  canPushOperator,
  canPushUnit,
  EMPTY,
  hasOperator,
  isEmpty,
  openDepth,
  pushCloseParen,
  pushDigit,
  pushOpenParen,
  pushOperator,
  pushUnit,
  text,
} from "./entry";

// 架空の単位表。**Loan でも Data Scale でもない組み合わせ**で、機構が
// 単位表に依存しないことを固定する。**scale は持たない**——順番だけで
// 「下る向きか」が決まる（設計書 訂正 2）。
const BIG: Unit = { label: "B", rank: 0 };
const SMALL: Unit = { label: "s", rank: 1 };

function press(keys: string, max = 39) {
  let entry = EMPTY;
  for (const key of keys) {
    if (key === "s" || key === "B") {
      const next = pushUnit(entry, key === "s" ? SMALL : BIG);
      if (next === null) throw new Error(`文法違反: ${keys}`);
      entry = next;
    } else if (key === "+" || key === "-" || key === "*" || key === "/") {
      entry = pushOperator(entry, key);
    } else if (key === "(") {
      entry = pushOpenParen(entry);
    } else if (key === ")") {
      entry = pushCloseParen(entry);
    } else {
      entry = pushDigit(entry, key, max);
    }
  }
  return entry;
}

describe("打鍵のトークン列", () => {
  it("keeps what was typed, unit labels and all", () => {
    // **値は計算しない**——コアへ渡すのは打った通りの文字列である。
    expect(text(press("1B2s"))).toBe("1B2s");
    expect(text(press("1B2s34"))).toBe("1B2s34");
  });

  it("only accepts units that step down", () => {
    // 数字を打ってから確かめる——単位の直後は「数字の無い単位」の規則が
    // 先に効いて境界に届かない（L で踏んだ穴）。
    expect(canPushUnit(press("1s2"), BIG)).toBe(false);
    expect(canPushUnit(press("1s2"), SMALL)).toBe(false);
    expect(canPushUnit(press("1B2"), SMALL)).toBe(true);
    expect(canPushUnit(EMPTY, SMALL)).toBe(false);
  });

  it("starts a new term after an operator, so units are free again", () => {
    // `1B + 2B` は文法違反ではない。単位の順序は**項ごと**に見る。
    expect(canPushUnit(press("1B2s+3"), BIG)).toBe(true);
  });

  it("takes the digit limit from the caller", () => {
    // 呼び出し側の定義域（Loan は u64、D は u128）。
    let entry = EMPTY;
    for (const digit of "123456") entry = pushDigit(entry, digit, 3);
    expect(text(entry)).toBe("123");
  });

  it("walks back one token at a time", () => {
    expect(text(backspace(press("1B23")))).toBe("1B2");
    expect(text(backspace(press("1B")))).toBe("1");
    expect(text(backspace(press("1+")))).toBe("1");
    expect(isEmpty(backspace(press("1")))).toBe(true);
    expect(isEmpty(backspace(EMPTY))).toBe(true);
  });

  it("refuses operators where they cannot go", () => {
    expect(canPushOperator(EMPTY)).toBe(false); // 単項マイナスは持たない
    expect(text(press("1+"))).toBe("1+");
    expect(text(press("1++"))).toBe("1+"); // 連続は受けない
  });

  it("counts the parentheses it still owes", () => {
    expect(openDepth(press("(1+2"))).toBe(1);
    expect(openDepth(press("(1+2)"))).toBe(0);
    // 数の直後に開き括弧は置けない（暗黙の掛け算を持たない）。
    expect(text(press("1("))).toBe("1");
    // 閉じるものが無ければ閉じない。
    expect(text(press("1)"))).toBe("1");
  });

  it("says whether an expression is being typed", () => {
    expect(hasOperator(press("1B2s"))).toBe(false);
    expect(hasOperator(press("1+2"))).toBe(true);
    expect(hasOperator(press("(1"))).toBe(true);
  });
});
