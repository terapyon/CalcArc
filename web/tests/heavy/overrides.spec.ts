import { expect, test } from "@playwright/test";
import type { Tolerance } from "./corpus";
import {
  assertNoStaleOverrides,
  assertOverridesAreSound,
  loadOverrides,
  type Override,
  parseOverridesFile,
  resolveTolerance,
} from "./overrides";

const BASE: Tolerance = { abs: 5e-10, rel: 5e-10 };

/** 手で書くファイルの見本。個々のテストは見たい欄だけ上書きする。 */
function override(fields: Partial<Override> = {}): Override {
  return {
    rel: 2e-9,
    expr: "tan(rad((376 * (788)^2)))",
    reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
    ...fields,
  };
}

test("the overrides file loads and every entry says why", () => {
  // 件数は数えない——**その数はコーパスと電卓が決める**ので、増減を
  // テストが握ると、増えたとき「テストを直す」で済んでしまう。
  // 件数が正当かどうかは corpus.spec.ts が実測で確かめる(上書きなしで
  // 通るものは assertNoStaleOverrides が赤にする)。ここで押さえるのは
  // **どの上書きにも理由が書いてある**ことである。
  const overrides = loadOverrides();
  expect(overrides).toBeInstanceOf(Map);
  for (const [id, entry] of overrides) {
    expect(typeof entry.rel, id).toBe("number");
    expect(entry.reason.trim().length, id).toBeGreaterThan(0);
    // 上書きは id ではなく**式**に結びつく。実在の expr との一致は
    // corpus.spec.ts が実コーパスに対して確かめる。
    expect(entry.expr.trim().length, id).toBeGreaterThan(0);
  }
});

test("a case with no override keeps the shard's tolerance", () => {
  const resolved = resolveTolerance("sci-999999", BASE, new Map());
  expect(resolved).toEqual(BASE);
});

test("an override replaces rel and leaves abs alone", () => {
  const overrides = new Map([["sci-001332", override({ rel: 2e-9 })]]);
  const resolved = resolveTolerance("sci-001332", BASE, overrides);
  // abs は期待値 0 専用の経路なので、上書きの対象ではない。
  expect(resolved).toEqual({ abs: 5e-10, rel: 2e-9 });
});

const EXPR = "tan(rad((376 * (788)^2)))";
const EXPRS = new Map([
  ["sci-000019", EXPR],
  ["sci-001332", "cos(rad(((815 * 412) * (747 + 422))))"],
]);
const EQUIVALENCE_IDS = new Set(["equiv-000001"]);

test("an override without a reason is refused", () => {
  const overrides = new Map([["sci-000019", override({ reason: "  " })]]);
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/reason/);
});

test("an override pointing at a case that does not exist anywhere is refused, and says so", () => {
  const overrides = new Map([
    ["sci-999999", override({ reason: "存在しないケースを指している" })],
  ]);
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/sci-999999.*コーパスに無い/);
});

test("an override pointing at an equivalence case is refused, but not told it is missing", () => {
  // その id はコーパスに実在する——同値ケースとして。値ケースではないだけ
  // である。「このケースはコーパスに無い」と言うのは事実に反する
  // (allCaseExprs が値ケースだけに絞られている経緯は corpus.spec.ts を見よ)。
  const overrides = new Map([
    ["equiv-000001", override({ reason: "同値ケースを指している" })],
  ]);
  let message = "";
  try {
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS);
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
  const overrides = new Map([["sci-000019", override({ rel: 0 })]]);
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
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
      override({
        rel: 1e-3,
        reason: "もっともらしいが緩すぎる理由をつけてみる",
      }),
    ],
  ]);
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/1e-6/);
});

test("an override exactly at the sanity ceiling is fine, one past it is refused", () => {
  // 現行の上書きは 1e-9 と 2e-9 で、1e-6 との間に 500 倍の余裕がある。
  // 境界の扱いはシャードの許容(assertToleranceIsSane)と揃える——あちらは
  // `value > TOLERANCE_CEILING` だけを弾くので、ちょうど 1e-6 は通る。
  // 上書きだけ境界の意味を変える理由が無い。
  const atCeiling = new Map([
    ["sci-000019", override({ rel: 1e-6, reason: "境界ちょうど" })],
  ]);
  expect(() =>
    assertOverridesAreSound(atCeiling, EXPRS, EQUIVALENCE_IDS),
  ).not.toThrow();

  const overCeiling = new Map([
    ["sci-000019", override({ rel: 1.000001e-6, reason: "境界のすぐ外" })],
  ]);
  expect(() =>
    assertOverridesAreSound(overCeiling, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
});

test("an override whose rel is a string is refused", () => {
  // `overrides.json` は**人が手で書く**ファイルなので、型違いは最も
  // 起こりやすい誤りである。`"2e-9"` は JSON として妥当で、`> 0` の比較も
  // 文字列強制で通ってしまう——検査が typeof を見ていなければ、数でない
  // 値がそのまま許容として使われる。
  const overrides = new Map([
    ["sci-000019", { ...override(), rel: "2e-9" }],
  ]) as unknown as Map<string, Override>;
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/rel/);
});

test("an override carrying a field the reader never looks at is refused", () => {
  // **この層が一度塞いだ穴と同型**である。`abs` を書いた人は「期待値 0 側も
  // 緩めた」と思い、`overrides.json` を読んだレビュアも「効いている」と読む。
  // どちらも間違っている——`resolveTolerance` は abs を base から取るので、
  // 書かれた abs は完全に無視される。`assertNoCaseTolerance` が拒んでいる
  // 「効いているように見えて効かないつまみ」を、上書きの側に作らない
  // (設計書 §3.3 の「未知のフィールドは名指しして throw する」)。
  const overrides = new Map([
    ["sci-000019", { ...override(), abs: 1e-6 }],
  ]) as unknown as Map<string, Override>;
  let message = "";
  try {
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS);
  } catch (cause) {
    message = String(cause);
  }
  // ケース id と、余分な鍵の名前の両方が出ること。
  expect(message).toContain("sci-000019");
  expect(message).toContain('"abs"');
});

test("an override without an expr is refused", () => {
  const overrides = new Map([
    ["sci-000019", { rel: 2e-9, reason: "式を書き忘れた" }],
  ]) as unknown as Map<string, Override>;
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).toThrow(/expr/);
});

test("an override whose expr does not match the corpus is refused", () => {
  // 上書きは id ではなく**式**に結びつく。段階 3b/3c がコーパスを再生成すると
  // 同じ id が別の式に化けうる(設計書 §11: `UNARY_FNS` に 1 つ足すだけで
  // 既存 4000 件が総入れ替え)。化けた後の id がたまたま別の理由でシャードの
  // rel を超えれば、腐り検出にも掛からないまま上書きが効き続け、レポートは
  // もう存在しない式の説明を印字する。
  const overrides = new Map([
    ["sci-000019", override({ expr: "tan(rad((999 * (1)^2)))" })],
  ]);
  let message = "";
  try {
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS);
  } catch (cause) {
    message = String(cause);
  }
  expect(message).toContain("sci-000019");
  // 上書きが言っている式と、コーパスの実際の式の両方が出ること。
  expect(message).toContain("tan(rad((999 * (1)^2)))");
  expect(message).toContain(EXPR);
});

test("every complaint is reported, not just the first", () => {
  // 実装は不満を全部集めてから 1 回 throw する。1 件目で投げると、直しては
  // 走らせ直す往復が違反の数だけ要る。**両方の不満がメッセージに出る**こと。
  const overrides = new Map([
    ["sci-000019", { ...override(), rel: -1, reason: "   " }],
  ]) as unknown as Map<string, Override>;
  let message = "";
  try {
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS);
  } catch (cause) {
    message = String(cause);
  }
  expect(message).toContain("reason");
  expect(message).toContain("rel");
  // 同じケースについて 2 行出ているはず(reason の行と rel の行)。
  expect(message.split("sci-000019").length - 1).toBe(2);
});

test("a sound override passes", () => {
  const overrides = new Map([["sci-000019", override()]]);
  expect(() =>
    assertOverridesAreSound(overrides, EXPRS, EQUIVALENCE_IDS),
  ).not.toThrow();
});

test("a file that forgets the overrides table is refused, not a raw TypeError", () => {
  // ファイルの不在には手本のようなメッセージがある一方、ここは
  // `Object.entries(undefined)` の生 TypeError になっていた。**手で書く
  // ファイルの最もありふれた壊し方**だけが読めない例外になるのは、
  // 防御の非対称である。
  expect(() => parseOverridesFile('{"schema": 1}')).toThrow(/overrides/);
  expect(() => parseOverridesFile('{"schema": 1, "overrides": []}')).toThrow(
    /オブジェクト/,
  );
  expect(() =>
    parseOverridesFile('{"schema": 1, "overrides": {}}'),
  ).not.toThrow();
});

test("a top-level key the reader never looks at is refused", () => {
  let message = "";
  try {
    parseOverridesFile('{"schema": 1, "overrides": {}, "tolerance": 1e-3}');
  } catch (cause) {
    message = String(cause);
  }
  expect(message).toContain('"tolerance"');
});

test("a schema this code does not know how to read is refused", () => {
  expect(() => parseOverridesFile('{"schema": 2, "overrides": {}}')).toThrow(
    /schema/,
  );
});

test("an override whose case now passes without it is refused", () => {
  const overrides = new Map([
    ["sci-000019", override({ reason: "もう要らない上書き" })],
  ]);
  expect(() => assertNoStaleOverrides(["sci-000019"], overrides)).toThrow(
    /sci-000019/,
  );
});

test("a stale id with no override at all is a broken invariant, said out loud", () => {
  // 呼び出し側は `overrides.has(id)` を満たしたものしか渡さない。ここへ
  // 来たら不変条件が壊れている。黙って「(理由が読めない)」で埋めると、
  // **理由についての嘘**を印字したうえで、起こりえない状態に説明を与えて
  // しまう(このリポジトリの作法は「黙って埋めずに大きな声で落とす」)。
  expect(() => assertNoStaleOverrides(["sci-000019"], new Map())).toThrow(
    /不変条件/,
  );
});

test("no stale overrides is quiet", () => {
  const overrides = new Map([["sci-000019", override({ reason: "まだ要る" })]]);
  expect(() => assertNoStaleOverrides([], overrides)).not.toThrow();
});
