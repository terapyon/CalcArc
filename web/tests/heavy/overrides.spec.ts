import { expect, test } from "@playwright/test";
import type { Tolerance } from "./corpus";
import {
  assertNoStaleOverrides,
  assertOverridesAreSound,
  loadOverrides,
  resolveTolerance,
} from "./overrides";

const BASE: Tolerance = { abs: 5e-10, rel: 5e-10 };

test("the overrides file loads and every entry says why", () => {
  // 件数は数えない——**その数はコーパスと電卓が決める**ので、増減を
  // テストが握ると、増えたとき「テストを直す」で済んでしまう。
  // 件数が正当かどうかは corpus.spec.ts が実測で確かめる(上書きなしで
  // 通るものは assertNoStaleOverrides が赤にする)。ここで押さえるのは
  // **どの上書きにも理由が書いてある**ことである。
  const overrides = loadOverrides();
  expect(overrides).toBeInstanceOf(Map);
  for (const [id, override] of overrides) {
    expect(typeof override.rel, id).toBe("number");
    expect(override.reason.trim().length, id).toBeGreaterThan(0);
  }
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
const EQUIVALENCE_IDS = new Set(["equiv-000001"]);

test("an override without a reason is refused", () => {
  const overrides = new Map([["sci-000019", { rel: 2e-9, reason: "  " }]]);
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).toThrow(/reason/);
});

test("an override pointing at a case that does not exist anywhere is refused, and says so", () => {
  const overrides = new Map([
    ["sci-999999", { rel: 2e-9, reason: "存在しないケースを指している" }],
  ]);
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).toThrow(/sci-999999.*コーパスに無い/);
});

test("an override pointing at an equivalence case is refused, but not told it is missing", () => {
  // その id はコーパスに実在する——同値ケースとして。値ケースではないだけ
  // である。「このケースはコーパスに無い」と言うのは事実に反する
  // (allCaseIds が値ケースだけに絞られている経緯は corpus.spec.ts を見よ)。
  const overrides = new Map([
    ["equiv-000001", { rel: 2e-9, reason: "同値ケースを指している" }],
  ]);
  let message = "";
  try {
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS);
  } catch (cause) {
    message = String(cause);
  }
  expect(message).toContain("equiv-000001");
  expect(message).not.toContain("コーパスに無い");
  expect(message).toContain("値ケース");
});

test("an override that is not looser than nothing is refused", () => {
  // rel は正の有限値でなければならない。0 や負や Infinity は、
  // 「何も通らない」か「何でも通る」で、どちらも上書きの意味を成さない。
  const overrides = new Map([
    ["sci-000019", { rel: 0, reason: "何も通らない値" }],
  ]);
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
});

test("an override looser than the sanity ceiling is refused", () => {
  // シャードの許容には TOLERANCE_CEILING(1e-6)の正気検査が既にある
  // (corpus.ts の assertToleranceIsSane)。上書きは名指しの体裁をした静かな
  // 緩和になりうる——`rel: 1e-3` にもっともらしい理由を付ければ、reason と
  // 有限性の検査だけを見るこの関数は素通ししてしまう。同じ上限を上書きにも
  // 課す(設計書 §3.4 の「腐った上書きは大きな声で落とす」と同じ原則:
  // 緩すぎる上書きも静かに紛れ込ませない)。
  const overrides = new Map([
    [
      "sci-000019",
      { rel: 1e-3, reason: "もっともらしいが緩すぎる理由をつけてみる" },
    ],
  ]);
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).toThrow(/1e-6/);
});

test("an override exactly at the sanity ceiling is fine, one past it is refused", () => {
  // 現行の上書きは 1e-9 と 2e-9 で、1e-6 との間に 500 倍の余裕がある。
  // 境界の扱いはシャードの許容(assertToleranceIsSane)と揃える——あちらは
  // `value > TOLERANCE_CEILING` だけを弾くので、ちょうど 1e-6 は通る。
  // 上書きだけ境界の意味を変える理由が無い。
  const atCeiling = new Map([
    ["sci-000019", { rel: 1e-6, reason: "境界ちょうど" }],
  ]);
  expect(() =>
    assertOverridesAreSound(atCeiling, IDS, EQUIVALENCE_IDS),
  ).not.toThrow();

  const overCeiling = new Map([
    ["sci-000019", { rel: 1.000001e-6, reason: "境界のすぐ外" }],
  ]);
  expect(() =>
    assertOverridesAreSound(overCeiling, IDS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
});

test("an override whose rel is a string is refused", () => {
  // `overrides.json` は**人が手で書く**ファイルなので、型違いは最も
  // 起こりやすい誤りである。`"2e-9"` は JSON として妥当で、`> 0` の比較も
  // 文字列強制で通ってしまう——検査が typeof を見ていなければ、数でない
  // 値がそのまま許容として使われる。
  const overrides = new Map([
    ["sci-000019", { rel: "2e-9", reason: "型が違う" }],
  ]) as unknown as Map<string, { rel: number; reason: string }>;
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
});

test("every complaint is reported, not just the first", () => {
  // 実装は不満を全部集めてから 1 回 throw する。1 件目で投げると、直しては
  // 走らせ直す往復が違反の数だけ要る。**両方の不満がメッセージに出る**こと。
  const overrides = new Map([
    ["sci-000019", { rel: -1, reason: "   " }],
  ]) as unknown as Map<string, { rel: number; reason: string }>;
  let message = "";
  try {
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS);
  } catch (cause) {
    message = String(cause);
  }
  expect(message).toContain("reason");
  expect(message).toContain("rel");
  // 同じケースについて 2 行出ているはず(reason の行と rel の行)。
  expect(message.split("sci-000019").length - 1).toBe(2);
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
  expect(() =>
    assertOverridesAreSound(overrides, IDS, EQUIVALENCE_IDS),
  ).not.toThrow();
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
