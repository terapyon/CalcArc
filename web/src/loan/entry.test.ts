import { describe, expect, it } from "vitest";
import {
  backspace,
  canPushUnit,
  EMPTY,
  MAN,
  MONTH,
  OKU,
  pushDigit,
  pushUnit,
  text,
  YEAR,
} from "./entry";

function press(keys: string) {
  let entry = EMPTY;
  for (const key of keys) {
    const unit =
      key === "万"
        ? MAN
        : key === "億"
          ? OKU
          : key === "年"
            ? YEAR
            : key === "月"
              ? MONTH
              : null;
    if (unit) {
      const next = pushUnit(entry, unit);
      if (next === null) throw new Error(`文法違反: ${keys}`);
      entry = next;
    } else {
      entry = pushDigit(entry, key);
    }
  }
  return entry;
}

// **値の検査はここに無い。** `3000万` を 30,000,000 にするのはコアの仕事に
// なったので（設計書 訂正 2）、値は golden が見る:
//   expr_integer/3000万*2/yen → 60000000
//   expr_integer/1億6000万-500万/yen → 155000000
//   expr_integer/35年/months → 420、expr_integer/3年6/months → 42
// ここが見るのは**打った通りに出るか**と**編集の 1 段**である。
describe("Finance の入力（表示と編集）", () => {
  it("keeps what was typed, unit labels and all", () => {
    expect(text(press("3000万"))).toBe("3000万");
    expect(text(press("1億6000万"))).toBe("1億6000万");
    expect(text(press("35年"))).toBe("35年");
    expect(text(press("3年6月"))).toBe("3年6月");
  });

  it("only accepts units that step down", () => {
    // 数字を打ってから確かめる——単位の直後は「数字の無い単位」の規則が
    // 先に効いて境界に届かない（L で踏んだ穴）。
    expect(canPushUnit(press("1万2"), OKU)).toBe(false);
    expect(canPushUnit(press("1万2"), MAN)).toBe(false);
    expect(canPushUnit(press("1億2"), MAN)).toBe(true);
    expect(canPushUnit(EMPTY, MAN)).toBe(false);
    // 期間も同じ規則で動く（年 → 月）。
    expect(canPushUnit(press("3年6"), MONTH)).toBe(true);
    expect(canPushUnit(press("3月6"), YEAR)).toBe(false);
  });

  it("walks back one token at a time", () => {
    expect(text(backspace(press("1億6000")))).toBe("1億600");
    expect(text(backspace(press("1億")))).toBe("1");
    expect(text(backspace(press("3")))).toBe("");
  });

  it("caps the digits a single number can hold", () => {
    // u64 の定義域（10 進 20 桁）。式の結果の上限はコアが見る。
    const long = press("1".repeat(25));
    expect(text(long)).toHaveLength(20);
  });
});
