import { describe, expect, it } from "vitest";
// @ts-expect-error — `.mjs` に型は無い。他の tools のテストと同じ扱い。
import { compareShas, parseIndexLine } from "../verified-run.mjs";

describe("index の 1 行を読む", () => {
  it("mode と stage を捨てて sha と path を取る", () => {
    const line = "100644 6073ef2bfd5a7a5a1e9e0e6d5d5e5e5e5e5e5e5e 0\tcorpus/generated/complex-000.json";
    expect(parseIndexLine(line)).toEqual({
      sha: "6073ef2bfd5a7a5a1e9e0e6d5d5e5e5e5e5e5e5e",
      path: "corpus/generated/complex-000.json",
    });
  });

  it("空白を含む path を切らない", () => {
    // **タブで切る。** 空白で切ると、名前に空白のあるファイルが黙って壊れる。
    const line = "100644 abc 0\tdocs/a b c.md";
    expect(parseIndexLine(line)?.path).toBe("docs/a b c.md");
  });

  it("形になっていない行は捨てる", () => {
    expect(parseIndexLine("")).toBeNull();
    expect(parseIndexLine("100644 abc\tx")).toBeNull();
  });
});

describe("index とディスクの sha を突き合わせる", () => {
  const entries = [
    { sha: "aaa", path: "a" },
    { sha: "bbb", path: "b" },
    { sha: "ccc", path: "c" },
  ];

  it("全部一致していれば、件数だけを返す", () => {
    expect(compareShas(entries, ["aaa", "bbb", "ccc"])).toEqual({
      checked: 3,
      mismatches: [],
    });
  });

  it("★ 不一致を全部返す。1 件目で止めない", () => {
    // **これがこの関数の本題である。** 2026-08-30、`cmp` を既定で使ったために
    // **2 バイト壊れていたのを 1 バイトと報告した**——`cmp` は最初の相違点で
    // 止まるが、**止めたとは言わない**。**数え上げを道具の既定値に任せない。**
    const found = compareShas(entries, ["aaa", "XXX", "YYY"]);
    expect(found.mismatches).toEqual([
      { path: "b", index: "bbb", disk: "XXX" },
      { path: "c", index: "ccc", disk: "YYY" },
    ]);
    expect(found.checked).toBe(3);
  });

  it("数が合わなければ落ちる。ずれた対で「一致」と言わない", () => {
    // **黙って `zip` すると、1 件ずれた瞬間に全件が「不一致」になるか、
    // あるいは短いほうで打ち切って「一致」と言う。** どちらも嘘である。
    expect(() => compareShas(entries, ["aaa", "bbb"])).toThrow(/数が合わない/);
  });
});
