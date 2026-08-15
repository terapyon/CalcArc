import { expect, test } from "@playwright/test";
import { renderReport } from "./report";

const TOLERANCE = { abs: 1e-9, rel: 1e-9 };

test("the report says what was checked, not just that it passed", () => {
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 3.4e-12,
      maxAbsoluteError: 1.1e-11,
      absOnlyCases: [],
      relUndefinedCases: [],
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("2000");
  expect(markdown).toContain("scientific-000.json (values)");
  // 観測された最大誤差が読めること。
  expect(markdown).toContain("3.4");
  // 表示精度の但し書きは必ず載る(設計書 §11)。
  expect(markdown).toContain("表示");
});

test("failures are listed, not summarised away", () => {
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2,
      values: 2,
      equivalences: 0,
      mismatches: ["sci-000001: sqrt(2) → 1.41, expected 1.4142135624"],
      maxRelativeError: 0.003,
      maxAbsoluteError: 0.004,
      absOnlyCases: [],
      relUndefinedCases: [],
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("sci-000001");
});

test("cases that pass only through the abs side of the OR are disclosed with id and numbers", () => {
  // sci-001332 の裁定(2026-08-15): 絶対誤差でしか通らなかった実例をコーパスから
  // 除外せず開示する。ここではその開示が id と数値つきで載ることだけを確かめる。
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 1.34e-9,
      maxAbsoluteError: 2.32e-10,
      absOnlyCases: [
        "sci-001332: cos(rad(((815 * 412) * (747 + 422)))) → -0.173648177899..., " +
          "expected -0.17364817766693036 (rel 1.34e-9, abs 2.32e-10)",
      ],
      relUndefinedCases: [],
      tolerance: TOLERANCE,
    },
  ]);

  // 総件数(1 件)と、その 1 件の id・数値の両方が読めること。
  expect(markdown).toContain("絶対誤差の側だけで通った");
  expect(markdown).toContain("sci-001332");
  expect(markdown).toContain("1.34e-9");
  expect(markdown).toContain("2.32e-10");
});

test("zero abs-only cases is stated as zero, not omitted", () => {
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 3.4e-12,
      maxAbsoluteError: 1.1e-11,
      absOnlyCases: [],
      relUndefinedCases: [],
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("絶対誤差の側だけで通ったケース");
  expect(markdown).toContain("0 件");
});

test("the report discloses the known limit of huge-angle trig functions", () => {
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 3.4e-12,
      maxAbsoluteError: 1.1e-11,
      absOnlyCases: [],
      relUndefinedCases: [],
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("この結果が主張していないこと");
  expect(markdown).toContain("引数還元");
});

test("real precision-limit hits are not conflated with expected-zero exact matches", () => {
  // 修正ラウンド 1 のレビュー指摘: 「絶対誤差の側だけで通ったケース」の見出しが
  // rel を測定できた本物の精度限界(sci-001332 相当)と、期待値が厳密に 0 で
  // rel が定義できないだけの完全一致(sci-000023 相当)を混ぜて数えると、
  // 「精度低下が n 件あった」という誤読を招く。二つの節・二つの見出し数字に
  // 分かれて出ることを確かめる。
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 1.34e-9,
      maxAbsoluteError: 2.32e-10,
      absOnlyCases: [
        "sci-001332: cos(rad(((815 * 412) * (747 + 422)))) → -0.1736481779, " +
          "expected -0.17364817766693036 (rel 1.34e-9, abs 2.33e-10)",
      ],
      relUndefinedCases: [
        "sci-000023: (-(tan(rad(0))))^2 → 0, expected 0 (abs 0.00e+0)",
        "sci-001717: (0)^2 → 0, expected 0 (abs 0.00e+0)",
      ],
      tolerance: TOLERANCE,
    },
  ]);

  // 見出しの数字が別々に出る(1 件と 2 件、3 件とまとめて出ない)。
  expect(markdown).toContain("精度限界の実例): **1**");
  expect(markdown).toContain("厳密に 0): **2**");
  // 各節にそれぞれの id が載る。
  expect(markdown).toContain("sci-001332");
  expect(markdown).toContain("sci-000023");
  expect(markdown).toContain("sci-001717");
  // 完全一致の節は「精度低下の実例ではない」と明言する。
  expect(markdown).toContain("精度低下の実例ではない");
});

test("headline numbers aggregate correctly across multiple shards", () => {
  // 見出しの total / 最大相対誤差 / 最大絶対誤差 / abs のみ件数 / rel 未定義件数は
  // 読み手が最初に信じる数字なので、複数シャードにわたる合算・最大化を確かめる。
  const markdown = renderReport([
    {
      name: "scientific-000.json (values)",
      total: 2000,
      values: 2000,
      equivalences: 0,
      mismatches: [],
      maxRelativeError: 1.34e-9,
      maxAbsoluteError: 4.36e-2,
      absOnlyCases: ["sci-001332: ... (rel 1.34e-9, abs 2.33e-10)"],
      relUndefinedCases: [
        "sci-000023: ... (abs 0.00e+0)",
        "sci-001717: ... (abs 0.00e+0)",
      ],
      tolerance: TOLERANCE,
    },
    {
      name: "equivalence-000.json (equivalences)",
      total: 2000,
      values: 0,
      equivalences: 2000,
      mismatches: [],
      // どちらの最大値もシャード 1 より小さい — 合算後の最大がシャード 1 の
      // 値のままであることを確かめる。
      maxRelativeError: 9.9e-11,
      maxAbsoluteError: 5.0e-3,
      absOnlyCases: [],
      relUndefinedCases: ["eqv-000074: 0 vs 0 (abs 0.00e+0)"],
      tolerance: TOLERANCE,
    },
  ]);

  // 総ケース数は 2 シャードの合算(2000 + 2000)。
  expect(markdown).toContain("総ケース数: **4000**");
  // 最大相対誤差・最大絶対誤差は 2 シャードのうち大きい方(シャード 1)を拾う。
  expect(markdown).toContain("観測された最大相対誤差: **1.34e-9**");
  expect(markdown).toContain("観測された最大絶対誤差: **4.36e-2**");
  // abs のみ件数は合算(1 + 0 = 1)、rel 未定義件数は合算(2 + 1 = 3)。
  expect(markdown).toContain("精度限界の実例): **1**");
  expect(markdown).toContain("厳密に 0): **3**");
});
