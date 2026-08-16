import { expect, test } from "@playwright/test";
import type { Tolerance } from "./corpus";
import {
  assertNoStaleOverrides,
  assertOverridesAreSound,
  loadOverrides,
  resolveTolerance,
} from "./overrides";

const BASE: Tolerance = { abs: 5e-10, rel: 5e-10 };

test("the overrides file loads", () => {
  const overrides = loadOverrides();
  expect(overrides).toBeInstanceOf(Map);
  expect(overrides.size).toBe(0);
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

const IDS = new Set(["sci-000019", "sci-001332"]);

test("an override without a reason is refused", () => {
  const overrides = new Map([["sci-000019", { rel: 2e-9, reason: "  " }]]);
  expect(() => assertOverridesAreSound(overrides, IDS)).toThrow(/reason/);
});

test("an override pointing at a case that does not exist is refused", () => {
  const overrides = new Map([
    ["sci-999999", { rel: 2e-9, reason: "存在しないケースを指している" }],
  ]);
  expect(() => assertOverridesAreSound(overrides, IDS)).toThrow(/sci-999999/);
});

test("an override that is not looser than nothing is refused", () => {
  // rel は正の有限値でなければならない。0 や負や Infinity は、
  // 「何も通らない」か「何でも通る」で、どちらも上書きの意味を成さない。
  const overrides = new Map([
    ["sci-000019", { rel: 0, reason: "何も通らない値" }],
  ]);
  expect(() => assertOverridesAreSound(overrides, IDS)).toThrow(/rel/);
});

test("a sound override passes", () => {
  const overrides = new Map([
    [
      "sci-000019",
      {
        rel: 2e-9,
        reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
      },
    ],
  ]);
  expect(() => assertOverridesAreSound(overrides, IDS)).not.toThrow();
});

test("an override whose case now passes without it is refused", () => {
  const overrides = new Map([
    ["sci-000019", { rel: 2e-9, reason: "もう要らない上書き" }],
  ]);
  expect(() => assertNoStaleOverrides(["sci-000019"], overrides)).toThrow(
    /sci-000019/,
  );
});

test("no stale overrides is quiet", () => {
  const overrides = new Map([
    ["sci-000019", { rel: 2e-9, reason: "まだ要る" }],
  ]);
  expect(() => assertNoStaleOverrides([], overrides)).not.toThrow();
});
