import { describe, expect, it } from "vitest";
import {
  findConflictMarkers,
  readTrackedDocs,
} from "../check-conflict-markers.mjs";

describe("findConflictMarkers", () => {
  it("`<<<<<<<` は単独でも無条件で違反", () => {
    const found = findConflictMarkers([
      { path: "docs/a.md", text: "本文\n<<<<<<< HEAD\n続き\n" },
    ]);
    expect(found).toEqual([
      { path: "docs/a.md", line: 2, marker: "<<<<<<<", text: "<<<<<<< HEAD" },
    ]);
  });

  it("`>>>>>>>` は単独でも無条件で違反", () => {
    const found = findConflictMarkers([
      { path: "docs/a.md", text: ">>>>>>> feature/x\n" },
    ]);
    expect(found).toEqual([
      {
        path: "docs/a.md",
        line: 1,
        marker: ">>>>>>>",
        text: ">>>>>>> feature/x",
      },
    ]);
  });

  it(
    "`=======` だけの行は、`<<<<<<<` が開いていなければ違反にしない" +
      "(setext 見出しの下線として正当)",
    () => {
      const found = findConflictMarkers([
        { path: "docs/a.md", text: "見出し\n=======\n\n本文\n" },
      ]);
      expect(found).toEqual([]);
    },
  );

  it("本物の衝突ブロックは 3 行とも拾う(3 本の非対称の核心)", () => {
    const text = [
      "うちの版",
      "<<<<<<< HEAD",
      "こちらの変更",
      "=======",
      "あちらの変更",
      ">>>>>>> feature/x",
      "続き",
    ].join("\n");
    const found = findConflictMarkers([{ path: "docs/x.md", text }]);
    expect(found.map((v) => v.marker)).toEqual([
      "<<<<<<<",
      "=======",
      ">>>>>>>",
    ]);
    expect(found.map((v) => v.line)).toEqual([2, 4, 6]);
  });

  it("閉じたあとの `=======` はもう数えない(区間の外)", () => {
    const text = [
      "<<<<<<< HEAD",
      "a",
      "=======",
      "b",
      ">>>>>>> x",
      "=======", // 衝突の外——setext 見出しかもしれない、無条件では判定しない
    ].join("\n");
    const found = findConflictMarkers([{ path: "docs/x.md", text }]);
    expect(found.map((v) => v.marker)).toEqual([
      "<<<<<<<",
      "=======",
      ">>>>>>>",
    ]);
  });

  it("7 文字より多く並んでいても違反(`{7}` は「以上」を拾う)", () => {
    const found = findConflictMarkers([
      { path: "docs/a.md", text: "<<<<<<<<< HEAD\n" },
    ]);
    expect(found).toHaveLength(1);
  });

  it("split spelling(文字を割った引用)は行頭でも通す", () => {
    // 本文が定める逃げ道: `<<` と `<<<<<` の 2 つに割って引用すれば、
    // 行頭に 7 個連続の `<` が並ばない。**行頭に置いてこそ意味のある
    // テストである**——行の途中なら、割らない引用(本物の 7 個)ですら
    // `^<{7}` に当たらないので、割ったかどうかの違いを確かめたことに
    // ならない。
    const split = "<<" + " " + "<<<<< のように割って書く";
    const found = findConflictMarkers([
      { path: "docs/a.md", text: `${split}\n` },
    ]);
    expect(found).toEqual([]);
  });

  it("フェンスの中でも無条件で違反(例外を作らない)", () => {
    const text = ["```", "<<<<<<< HEAD", "```"].join("\n");
    const found = findConflictMarkers([{ path: "docs/a.md", text }]);
    expect(found).toHaveLength(1);
  });

  it("CRLF でも `=======` を見逃さない", () => {
    const text = "<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> x\r\n";
    const found = findConflictMarkers([{ path: "docs/a.md", text }]);
    expect(found.map((v) => v.marker)).toEqual([
      "<<<<<<<",
      "=======",
      ">>>>>>>",
    ]);
  });

  it("複数ファイルにまたがっても、ファイルごとに正しく報告する", () => {
    const found = findConflictMarkers([
      { path: "docs/a.md", text: "きれいな文書\n" },
      { path: "docs/b.md", text: "<<<<<<< HEAD\n" },
    ]);
    expect(found).toEqual([
      { path: "docs/b.md", line: 1, marker: "<<<<<<<", text: "<<<<<<< HEAD" },
    ]);
  });
});

// **実物のリポジトリを読む。** `readTrackedDocs` は git を直接呼ぶので、
// 文字列だけでは検査できない(`check-citations.mjs`・`check-manual-freshness.mjs`
// のテストと同じ形)。
describe("実物のリポジトリ", () => {
  it("`docs/` の追跡ファイルに衝突マーカーは 1 件も無い", () => {
    const files = readTrackedDocs();
    const found = findConflictMarkers(files);
    expect(
      found,
      `衝突マーカーが残っている: ${JSON.stringify(found, null, 2)}`,
    ).toEqual([]);
  });

  it("何件見たかを主張する(0 件で緑を返さない)", () => {
    // **これが本題である。** `git ls-files docs/` の結果が空になった日
    // (根の解決が壊れた、パスが変わった)から、上の「0 件」は何も
    // 意味しなくなる。**下限だけを主張する**——実数はコミットのたびに
    // 動くので、書けばその日のうちに腐る(今日の実測は 139 件)。
    expect(
      readTrackedDocs().length,
      "docs/ の追跡ファイルを 1 件も読めなかった",
    ).toBeGreaterThan(100);
  });

  it("`git ls-files` に `docs/` が実在する(道具立ての確認)", () => {
    const files = readTrackedDocs();
    expect(files.every((f) => f.path.startsWith("docs/"))).toBe(true);
    expect(files.some((f) => f.path === "docs/base-spec.md")).toBe(true);
  });
});
