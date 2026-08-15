import { expect, type Page, test } from "@playwright/test";
import {
  assertNoCaseTolerance,
  assertShardIsSound,
  assertSupportedMode,
  assertToleranceIsSane,
  type Classification,
  classify,
  countInjectedTokens,
  loadShards,
  partitionCases,
  quantiles,
  type Shard,
  summarizeShape,
  TOLERANCE_BANDS,
  type Tolerance,
  type ToleranceBand,
  withinTolerance,
} from "./corpus";
import { parseDisplay } from "./display";
import { coreVersion, openHarness, runAll } from "./harness";
import { noteRuntime, record } from "./report";

// **1 度だけ読む。** モジュールのトップレベルで 3 回呼ぶと 1.6MB の JSON を
// 3 回パースすることになる(レビュー修正ラウンド 2)。
// loadShards() は読んだその場で schema・tolerance・kind・空を検証する。
// 壊れたシャードはここで例外になり、テストが 1 本も生成されない——**黙って
// ケースが消える**より、収集の時点で全体が落ちる方がよい。
const shards = loadShards();

// **種別に分けるのも 1 度だけ。** 分けた結果の合計が元の件数と一致しない
// 状態を作れないようにする(partitionCases が突き合わせる)。レポートの
// 「総ケース数」はこの分割の合計なので、ここが一致していれば見出しの数字が
// シャードの実件数より小さくなることがない。
const partitions = shards.map(({ name, shard }) => ({
  name,
  shard,
  ...partitionCases(name, shard.cases),
}));

test("withinTolerance compares against the numbers it is handed", () => {
  // ここのリテラルは **withinTolerance 自身の入力**であって、コーパスの
  // 許容誤差ではない。実際の比較(下の test)は shard.tolerance だけを使う。
  // CLAUDE.md が禁じているのは後者をコードに書くことである。
  const tolerance = { abs: 1e-9, rel: 1e-9 };
  expect(withinTolerance(1, 1 + 1e-12, tolerance)).toBe(true);
  expect(withinTolerance(1, 1.5, tolerance)).toBe(false);
  // 相対誤差が効く大きさ。
  expect(withinTolerance(1e8, 1e8 + 1, tolerance)).toBe(false);
  // **rel は超えたが abs で通る経路。** 実運用で実際に起きている経路なのに
  // 未テストだった(レビュー修正ラウンド 2)。相対誤差は 4e-2 で rel の
  // 4000 万倍だが、絶対誤差は 4e-10 で abs に収まるので「通った」になる。
  expect(withinTolerance(1e-8, 1e-8 + 4e-10, tolerance)).toBe(true);
});

test("classify says how loosely the OR actually checked the case", () => {
  const tolerance = { abs: 1e-9, rel: 1e-9 };
  // |期待値| ≥ 1: abs の側は rel より厳しいので、実効的な相対許容は rel。
  const big = classify(10, 10, tolerance);
  expect(big.effectiveRelTolerance).toBeCloseTo(1e-9, 20);
  expect(big.bucket).toBe("display");
  // |期待値| < 1: abs の側が緩い方になる。1e-9 / 1e-3 = 1e-6。
  const small = classify(1e-3, 1e-3, tolerance);
  expect(small.effectiveRelTolerance).toBeCloseTo(1e-6, 12);
  expect(small.bucket).toBe("1e-5");
  // 期待値が厳密に 0 のときは相対の保証が無い。
  const zero = classify(0, 0, tolerance);
  expect(zero.bucket).toBe("undefined");
  expect(zero.effectiveRelTolerance).toBe(Number.POSITIVE_INFINITY);
});

test("at least one shard is present", () => {
  expect(shards.length).toBeGreaterThan(0);
});

test("the half that is checked against an outside reference is still here", () => {
  // 敵対者レビュー(2026-08-15、検証ラウンド)の実証: `scientific-000.json` を
  // 退避して `pnpm heavy` を回すと **42 passed / EXIT=0**。外の基準(Python が
  // 独立に出した期待値)を持つ半分が丸ごと消えても緑だった。
  //
  // 「シャードが 1 枚以上ある」では足りない。値ケースが 0 件の走行は、
  // **同値ケースだけ**——電卓が自分自身と矛盾しないことしか見ていない走行で
  // あり、どんなキー列にも定数を返す偽物に対して全件通る(同じレビューが
  // 偽ハーネスで実証済み)。この層の主張の半分が消えた状態を緑にしない。
  //
  // 値ケースが**実際に走った**ことは、走行の最後に `writeReport()` が
  // ディスクに残った集計から確かめる(そちらは記録が 0 件でも落ちる)。
  const values = partitions.reduce(
    (sum, partition) => sum + partition.values.length,
    0,
  );
  expect(
    values,
    "no value case is present in corpus/generated/ — this run would verify " +
      "only the calculator's agreement with itself, never against the " +
      "expectations Python produced independently",
  ).toBeGreaterThan(0);
});

/** 検証を試すための、最小限だが正しい 1 件を持つシャード。 */
function soundShard(): Shard {
  return {
    schema: 1,
    generated_by: "made up for this test",
    tolerance: { abs: 5e-10, rel: 5e-10 },
    cases: [
      {
        kind: "value",
        id: "x-000",
        mode: "Deg",
        keys: ["1"],
        expr: "1",
        expect: { re: 1, im: 0 },
      },
    ],
  };
}

test("a case whose kind this suite does not run is named, not dropped", () => {
  // 敵対者レビュー(2026-08-15)の実証: 正しい 1 件と、`kind` を "vaue" に
  // 綴り違えたうえで expect を 999999 にした 1 件を同じシャードに入れて
  // 実行すると、**緑になり、総ケース数が 1 になった**。フィルタは
  // kind === "value" の文字列リテラルで絞るので、当たらないケースは警告も
  // エラーも無く捨てられ、レポートの総件数からも消える。
  const shard = soundShard();
  shard.cases.push({
    kind: "vaue",
    id: "x-001",
    mode: "Deg",
    keys: ["1"],
    expr: "1",
    expect: { re: 999999, im: 0 },
  } as unknown as (typeof shard.cases)[number]);

  // シャード名・ケース id・見つかった kind の三つとも名指しされること。
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(
    /made-up\.json/,
  );
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/x-001/);
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/"vaue"/);
});

test("an empty shard is refused instead of running green", () => {
  const shard = soundShard();
  shard.cases = [];
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/no cases/);
});

test("a case that writes its own tolerance is refused, not silently ignored", () => {
  // 設計書 §4.3 が約束している挙動。実測(2026-08-15 の検証ラウンド)では
  // 1 件に {abs: 1e30, rel: 1e30} を足しても 43 passed / EXIT=0、無警告だった
  // ——比較はシャード単位の tolerance しか読まないので、書いた側は効いている
  // と思い込む。段階 3 で実装されるまでは、名指しして落ちる。
  const shard = soundShard();
  const overriding = {
    ...shard.cases[0],
    id: "x-009",
    tolerance: { abs: 1e30, rel: 1e30 },
  };
  shard.cases.push(overriding as unknown as (typeof shard.cases)[number]);

  // シャード名・ケース id・書かれていた値の三つとも名指しされること。
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(
    /made-up\.json/,
  );
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/x-009/);
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/1e\+30/);
  // 「いまは未実装で、段階 3 で入る」と読めること。
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(
    /NOT implemented/,
  );
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/stage 3/);
  // 直接呼んでも同じ。
  expect(() =>
    assertNoCaseTolerance("made-up.json", [
      { id: "x-009", tolerance: { abs: 1e30, rel: 1e30 } },
    ]),
  ).toThrow(/silently ignored/);
  // 素直なケースは通る。
  expect(() =>
    assertNoCaseTolerance("made-up.json", [{ id: "x-000" }]),
  ).not.toThrow();
});

test("a schema this code does not know how to read is refused", () => {
  // `schema` はこれまで型に宣言されているだけで一度も読まれていなかった。
  const shard = soundShard();
  shard.schema = 2;
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(/schema/);
});

test("a tolerance loose enough to pass anything is refused", () => {
  // 敵対者レビュー(2026-08-15)の実証: コミット済み JSON の tolerance を
  // {abs: 1e30, rel: 1e30} に書き換えると、期待値が桁違いでも全件緑。
  // CLAUDE.md の「許容誤差をテストコードに書かない」を守った結果、合否基準が
  // データ側に完全に移り、そのデータを検査するものが無くなっていた。
  // ここでするのは閾値の決め打ちではなく、**データが正気かを見る**ことである。
  expect(() =>
    assertToleranceIsSane("made-up.json", { abs: 1e30, rel: 1e30 }),
  ).toThrow(/sane range/);
  expect(() =>
    assertToleranceIsSane("made-up.json", { abs: 5e-10, rel: 1e30 }),
  ).toThrow(/rel/);
  // 0 以下も弾く(何も通らない、あるいは比較が意味を失う)。
  expect(() =>
    assertToleranceIsSane("made-up.json", { abs: 0, rel: 5e-10 }),
  ).toThrow(/abs/);
  // 実際のコーパスの許容は通る。
  expect(() =>
    assertToleranceIsSane("made-up.json", { abs: 5e-10, rel: 5e-10 }),
  ).not.toThrow();
});

test("the report's total cannot be smaller than what the shard holds", () => {
  // 種別に分けた結果の合計が元の件数と一致しない状態を作れないようにする。
  const cases = soundShard().cases;
  expect(partitionCases("made-up.json", cases).values).toHaveLength(1);
  const withStranger = [
    ...cases,
    { kind: "scalar", id: "x-002" } as unknown as (typeof cases)[number],
  ];
  expect(() => partitionCases("made-up.json", withStranger)).toThrow(
    /understate/,
  );
});

test("every shard on disk holds exactly the cases the report will count", () => {
  for (const { name, shard, values, equivalences } of partitions) {
    expect(values.length + equivalences.length, name).toBe(shard.cases.length);
  }
});

test("every case in every shard declares the one mode this stage runs", () => {
  // 段階 2 は Deg だけ。ハーネスは angle_toggle を押さない。
  for (const { name, shard } of shards) {
    assertSupportedMode(name, shard.cases);
  }
  // 宣言が守られていないコーパスを渡したら、黙って既定のモードで回さずに落ちる。
  expect(() =>
    assertSupportedMode("made-up.json", [
      {
        kind: "value",
        id: "x-000",
        mode: "Rad",
        keys: ["1"],
        expr: "1",
        expect: { re: 1, im: 0 },
      },
    ]),
  ).toThrow(/Rad/);
});

/**
 * 1 シャード分の集計。**値ケースと同値ケースが同じものを使う。**
 * 比較の記録を二箇所に書くと、片方だけ直す事故が起きる。
 * 段階 3 で両者は分岐するので、ここは分岐しない部分だけを持つ。
 */
interface Tally {
  mismatches: string[];
  absOnlyCases: string[];
  relUndefinedCases: string[];
  /**
   * **相対誤差を測定できたケース数**(期待値 ≠ 0)。0 のとき、最大相対誤差も
   * 最悪の実効相対許容も数学的に定義できない。集計から非有限を外して
   * `Math.max(0, ...)` を掛けると、その走行が「0.00e+0 = 完璧に厳しい」と
   * 読める見出しになる(敵対者レビュー 2026-08-15)。件数を持ち回って、
   * レポート側が「定義できない」と書けるようにする。
   */
  relMeasured: number;
  /** 期待値が 0 のケースのうち、絶対誤差が 0 でなかったもの。 */
  relUndefinedNonZeroAbs: number;
  maxRelativeError: number;
  maxAbsoluteError: number;
  looserThanDisplay: number;
  worstEffectiveRelTolerance: number;
  bands: Record<ToleranceBand, number>;
  magnitudes: number[];
}

function newTally(): Tally {
  const bands = {} as Record<ToleranceBand, number>;
  for (const band of TOLERANCE_BANDS) {
    bands[band] = 0;
  }
  return {
    mismatches: [],
    absOnlyCases: [],
    relUndefinedCases: [],
    relMeasured: 0,
    relUndefinedNonZeroAbs: 0,
    maxRelativeError: 0,
    maxAbsoluteError: 0,
    looserThanDisplay: 0,
    worstEffectiveRelTolerance: 0,
    bands,
    magnitudes: [],
  };
}

function tally(
  into: Tally,
  tolerance: Tolerance,
  id: string,
  description: string,
  result: Classification,
): void {
  into.maxAbsoluteError = Math.max(into.maxAbsoluteError, result.absoluteError);
  into.maxRelativeError = Math.max(into.maxRelativeError, result.relativeError);
  into.bands[result.bucket] += 1;
  if (result.bucket !== "display" && result.bucket !== "undefined") {
    // 表示分解能(rel)より緩く検査されたケース。abs の下駄が効いている。
    into.looserThanDisplay += 1;
  }
  if (Number.isFinite(result.effectiveRelTolerance)) {
    into.relMeasured += 1;
    into.worstEffectiveRelTolerance = Math.max(
      into.worstEffectiveRelTolerance,
      result.effectiveRelTolerance,
    );
  } else if (result.absoluteError > 0) {
    into.relUndefinedNonZeroAbs += 1;
  }
  // withinTolerance は abs/rel を OR で判定する。abs の側だけで通った
  // ケースを黙って合格に混ぜると、「rel の許容に収まっている」という
  // 主張が実態より緩くなる(sci-001332 の裁定、設計書 §11)。
  //
  // 期待値が厳密に 0 のケースは rel が数学的に定義できないだけで、
  // 精度限界とは別物(修正ラウンド 1 のレビュー指摘)。別に集計する。
  if (result.passed && result.bucket === "undefined") {
    into.relUndefinedCases.push(
      `${id}: ${description} (abs ${result.absoluteError.toExponential(2)})`,
    );
  } else if (result.passed && result.relativeError > tolerance.rel) {
    into.absOnlyCases.push(
      `${id}: ${description} (rel ${result.relativeError.toExponential(2)}, ` +
        `abs ${result.absoluteError.toExponential(2)})`,
    );
  }
  if (!result.passed) {
    into.mismatches.push(`${id}: ${description}`);
  }
}

function browserLabel(page: Page): string {
  const browser = page.context().browser();
  return browser
    ? `${browser.browserType().name()} ${browser.version()}`
    : "unknown";
}

for (const { name, shard, values } of partitions) {
  if (values.length === 0) {
    continue;
  }
  test(`every case in ${name} matches the reference`, async ({ page }) => {
    assertSupportedMode(name, values);
    await openHarness(page);
    noteRuntime(await coreVersion(page), browserLabel(page));
    // 1 シャード = 1 往復。ケースごとに evaluate すると往復が計算を覆い隠す。
    const results = await runAll(
      page,
      values.map((c) => c.keys),
    );

    const into = newTally();
    for (const [index, testCase] of values.entries()) {
      const result = results[index];
      if (result === undefined) {
        into.mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (result.error !== null) {
        into.mismatches.push(
          `${testCase.id}: ${testCase.expr} → error ${result.error}`,
        );
        continue;
      }
      if (testCase.expect.im !== 0) {
        // 型に im があるのに比較していない、では「虚部も確かめた」と読まれる。
        // このシャードは実数しか扱わない。虚部があるケースが混ざったら、
        // 黙って実部だけ見ずに落とす(レビュー修正ラウンド 2)。
        into.mismatches.push(
          `${testCase.id}: ${testCase.expr} expects a non-zero imaginary part ` +
            `(${testCase.expect.im}), which this stage does not compare`,
        );
        continue;
      }
      let actual: number;
      try {
        actual = parseDisplay(result.main);
      } catch (cause) {
        // parseDisplay が投げる条件は「電卓が実数以外を表示するようになった」
        // ——**まさにこの層が捕まえるべき回帰**である。生の例外でスイートが
        // 落ちると 20 件上限の読める報告もレポートも失われる(修正ラウンド 2)。
        into.mismatches.push(
          `${testCase.id}: ${testCase.expr} → ${JSON.stringify(result.main)} ` +
            `cannot be read as a number (${String(cause)})`,
        );
        continue;
      }
      const expected = testCase.expect.re;
      into.magnitudes.push(Math.abs(expected));
      tally(
        into,
        shard.tolerance,
        testCase.id,
        `${testCase.expr} → ${result.main}, expected ${expected}`,
        classify(actual, expected, shard.tolerance),
      );
    }

    // **expect より先に記録する。** 落ちたときこそレポートが要るのに、
    // 先に expect を書くとそこで打ち切られてレポートが空になる。
    record({
      name: `${name} (values)`,
      total: values.length,
      values: values.length,
      equivalences: 0,
      generatedBy: shard.generated_by,
      mismatches: into.mismatches,
      maxRelativeError: into.maxRelativeError,
      maxAbsoluteError: into.maxAbsoluteError,
      absOnlyCases: into.absOnlyCases,
      relUndefinedCases: into.relUndefinedCases,
      relMeasured: into.relMeasured,
      relUndefinedNonZeroAbs: into.relUndefinedNonZeroAbs,
      looserThanDisplay: into.looserThanDisplay,
      worstEffectiveRelTolerance: into.worstEffectiveRelTolerance,
      bands: into.bands,
      shape: summarizeShape(values.map((c) => c.keys)),
      magnitudes: quantiles(into.magnitudes),
      tolerance: shard.tolerance,
    });

    // 先頭 20 件だけ読ませる。端末で読める量に上限を置き、全件は
    // Task 8 のレポートが持つ(設計書 §8)。
    expect(
      into.mismatches.slice(0, 20).join("\n"),
      `${into.mismatches.length} of ${values.length} cases disagree`,
    ).toBe("");
  });
}

for (const { name, shard, equivalences } of partitions) {
  if (equivalences.length === 0) {
    continue;
  }
  test(`both routes agree in ${name}`, async ({ page }) => {
    assertSupportedMode(name, equivalences);
    await openHarness(page);
    noteRuntime(await coreVersion(page), browserLabel(page));
    // 左右をまとめて 1 往復で流す。前半が左、後半が右。
    const results = await runAll(page, [
      ...equivalences.map((c) => c.left),
      ...equivalences.map((c) => c.right),
    ]);

    const into = newTally();
    for (const [index, testCase] of equivalences.entries()) {
      const left = results[index];
      const right = results[index + equivalences.length];
      if (left === undefined || right === undefined) {
        into.mismatches.push(`${testCase.id}: the harness returned nothing`);
        continue;
      }
      if (left.error !== null || right.error !== null) {
        into.mismatches.push(
          `${testCase.id}: error ${left.error ?? "none"} / ${right.error ?? "none"}`,
        );
        continue;
      }
      let actual: number;
      let expected: number;
      try {
        // 理由は値ケース側の注記と同じ。生の例外で全体を落とさない。
        actual = parseDisplay(left.main);
        expected = parseDisplay(right.main);
      } catch (cause) {
        into.mismatches.push(
          `${testCase.id}: ${JSON.stringify(left.main)} vs ` +
            `${JSON.stringify(right.main)} cannot be read as numbers ` +
            `(${String(cause)})`,
        );
        continue;
      }
      into.magnitudes.push(Math.abs(expected));
      tally(
        into,
        shard.tolerance,
        testCase.id,
        `${left.main} vs ${right.main}`,
        classify(actual, expected, shard.tolerance),
      );
    }

    // **expect より先に記録する。** 理由は値ケース側と同じ。
    record({
      name: `${name} (equivalences)`,
      total: equivalences.length,
      values: 0,
      equivalences: equivalences.length,
      generatedBy: shard.generated_by,
      mismatches: into.mismatches,
      maxRelativeError: into.maxRelativeError,
      maxAbsoluteError: into.maxAbsoluteError,
      absOnlyCases: into.absOnlyCases,
      relUndefinedCases: into.relUndefinedCases,
      relMeasured: into.relMeasured,
      relUndefinedNonZeroAbs: into.relUndefinedNonZeroAbs,
      looserThanDisplay: into.looserThanDisplay,
      worstEffectiveRelTolerance: into.worstEffectiveRelTolerance,
      bands: into.bands,
      // **左辺だけを数える。** 右辺は左辺に恒等変換を被せて作られているので、
      // 左右をまとめて数えると変換が注入したキーが「電卓に与えた式の多様性」
      // として計上される(実測では neg 2122 回のうち 74.2% が注入分)。
      // 注入分は addedByTransform に分けて、読み手が区別できる形で出す。
      shape: summarizeShape(equivalences.map((c) => c.left)),
      addedByTransform: countInjectedTokens(equivalences),
      magnitudes: quantiles(into.magnitudes),
      tolerance: shard.tolerance,
    });

    expect(
      into.mismatches.slice(0, 20).join("\n"),
      `${into.mismatches.length} of ${equivalences.length} pairs disagree`,
    ).toBe("");
  });
}
