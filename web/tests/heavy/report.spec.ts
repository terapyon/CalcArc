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
      tolerance: TOLERANCE,
    },
  ]);

  expect(markdown).toContain("この結果が主張していないこと");
  expect(markdown).toContain("引数還元");
});
