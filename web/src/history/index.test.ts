import { describe, expect, it } from "vitest";
import {
  clearAll,
  HISTORY_LIMIT,
  type HistoryEntry,
  pushEntry,
  readHistory,
  removeAt,
  writeHistory,
} from ".";

const entry = (n: number): HistoryEntry => ({
  expression: `${n}`,
  answer: `${n}`,
  angle: "Deg",
  error: false,
});

/** localStorage と同じ形の素のオブジェクト。**jsdom を要らなくする。** */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set("calcarc.history", initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: () => map.get("calcarc.history") ?? null,
  };
}

describe("履歴の貯め方", () => {
  it("puts the newest first", () => {
    const after = pushEntry([entry(1)], entry(2));
    expect(after.map((e) => e.expression)).toEqual(["2", "1"]);
  });

  it("drops the oldest when it overflows", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++)
      list = pushEntry(list, entry(i));
    expect(list).toHaveLength(HISTORY_LIMIT);
    // 一番古い 5 件(0..4)が消え、一番新しいものが先頭に居る。
    expect(list[0]?.expression).toBe(`${HISTORY_LIMIT + 4}`);
    expect(list.at(-1)?.expression).toBe("5");
  });

  it("removes one and keeps the rest in order", () => {
    expect(
      removeAt([entry(1), entry(2), entry(3)], 1).map((e) => e.expression),
    ).toEqual(["1", "3"]);
  });

  it("clears everything", () => {
    expect(clearAll()).toEqual([]);
  });

  it("does not stack an entry whose expression is empty", () => {
    // **`=` の 2 度押しがここへ来る**(Task 10 が列を空にするため。§D-2)。
    const before = [entry(1)];
    expect(
      pushEntry(before, {
        expression: "",
        answer: "6",
        angle: "Deg",
        error: false,
      }),
    ).toBe(before);
  });

  it("does not stack an entry identical to the one on top", () => {
    const before = [entry(1)];
    expect(pushEntry(before, entry(1))).toBe(before);
  });

  it("stacks an entry that differs only in the angle mode", () => {
    // **3 つのうち 1 つでも違えば別の計算である**(§D-2)。
    const after = pushEntry([entry(1)], { ...entry(1), angle: "Rad" });
    expect(after).toHaveLength(2);
  });

  it("stacks an identical entry that is not on top", () => {
    // **止めるのは直前だけ。** 間に別の計算が挟まれば積む。
    const after = pushEntry([entry(2), entry(1)], entry(1));
    expect(after).toHaveLength(3);
  });
});

describe("履歴の読み書き", () => {
  it("round-trips", () => {
    const s = fakeStorage();
    writeHistory(s, [entry(1), entry(2)]);
    expect(readHistory(s)).toEqual([entry(1), entry(2)]);
  });

  it("falls back to empty when the stored value is garbage", () => {
    // **壊れた保存で落ちない。** 設定と同じ考え方(settings/index.ts)。
    expect(readHistory(fakeStorage("{{{"))).toEqual([]);
    expect(readHistory(fakeStorage('{"not":"a list"}'))).toEqual([]);
  });

  it("drops entries that are missing a field", () => {
    // 欄が欠けた 1 件は落とし、**残りは残す**。
    const raw = JSON.stringify([
      { expression: "1", answer: "1", angle: "Deg", error: false },
      { expression: "2" },
    ]);
    expect(readHistory(fakeStorage(raw))).toEqual([entry(1)]);
  });

  it("drops entries whose angle is not one we know", () => {
    const raw = JSON.stringify([
      { expression: "1", answer: "1", angle: "Grad", error: false },
    ]);
    expect(readHistory(fakeStorage(raw))).toEqual([]);
  });

  it("drops entries whose error field is missing or not a boolean", () => {
    // error は表示に出ないが、欠けている・型違いなら他の欄と同じく落とす
    // (CLAUDE.md の「一部/未確認」を残さない設計と同じ考え方)。
    const raw = JSON.stringify([
      { expression: "1", answer: "1", angle: "Deg" },
      { expression: "2", answer: "2", angle: "Deg", error: "yes" },
      { expression: "3", answer: "3", angle: "Deg", error: true },
    ]);
    expect(readHistory(fakeStorage(raw))).toEqual([
      { expression: "3", answer: "3", angle: "Deg", error: true },
    ]);
  });

  it("never writes more than the limit", () => {
    const s = fakeStorage();
    writeHistory(
      s,
      Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => entry(i)),
    );
    expect(readHistory(s)).toHaveLength(HISTORY_LIMIT);
  });
});
