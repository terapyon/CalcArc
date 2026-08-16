import { expect, test } from "@playwright/test";
import type { Tolerance } from "./corpus";
import { loadOverrides, resolveTolerance } from "./overrides";

const BASE: Tolerance = { abs: 5e-10, rel: 5e-10 };

test("the overrides file loads", () => {
  const overrides = loadOverrides();
  expect(overrides).toBeInstanceOf(Map);
});

test("a case with no override keeps the shard's tolerance", () => {
  const resolved = resolveTolerance("sci-999999", BASE, new Map());
  expect(resolved).toEqual(BASE);
});

test("an override replaces rel and leaves abs alone", () => {
  const overrides = new Map([
    [
      "sci-001332",
      {
        rel: 2e-9,
        reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
      },
    ],
  ]);
  const resolved = resolveTolerance("sci-001332", BASE, overrides);
  // abs は期待値 0 専用の経路なので、上書きの対象ではない。
  expect(resolved).toEqual({ abs: 5e-10, rel: 2e-9 });
});
