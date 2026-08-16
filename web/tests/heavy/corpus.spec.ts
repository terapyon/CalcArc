import { expect, type Page, test } from "@playwright/test";
import {
  assertNoCaseTolerance,
  assertShardIsSound,
  assertSupportedMode,
  assertToleranceIsSane,
  type Classification,
  classify,
  countInjectedTokens,
  type EquivalenceCase,
  equivalenceNeedsPrecedence,
  loadShards,
  needsPrecedence,
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
import {
  assertNoStaleOverrides,
  assertOverridesAreSound,
  loadOverrides,
  resolveTolerance,
} from "./overrides";
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

// **上書きも 1 度だけ読む。** 判定を rel だけに締めた結果、精度の物理的な
// 上限に当たるケースが落ちる。それを許容全体の緩和で救うと 4000 件全部が
// 緩むので、**名指しで、理由を添えて**許す(設計書 §3)。
const overrides = loadOverrides();

// 上書きが指す id がコーパスに実在するか、reason が書かれているかを
// **走行の頭で**確かめる。あとで「なぜか緩い」と気づくより、その場で
// 名指しで落ちる方が原因に近い。
//
// **値ケースの id だけを「実在する」とみなす。** 同値ケースは上書きの対象外
// (下の比較ループのコメントを見よ)で、同値ループは overrides を一切見ない。
// ここで同値ケースの id も許してしまうと、同値ケースを指す上書きが受理
// されたまま何もせず、腐り検出(assertNoStaleOverrides、値ループの中でしか
// 呼ばれない)にも掛からず永久に残る——`shards` からではなく、値ケースだけに
// 絞った `partitions` から集める。
//
// **id ではなく式を渡す。** 上書きは `expr` を必須で持ち、コーパス側の式と
// 一致することを確かめる。段階 3b/3c はコーパスを再生成する予定で、設計書 §11
// が警告しているとおり `UNARY_FNS` に 1 つ足すだけで既存 4000 件が総入れ替えに
// なる。入れ替わった後の同じ id がたまたま別の理由でシャードの rel を超えると、
// 腐り検出にも掛からないまま上書きが効き続け、レポートはもう存在しない式の
// 説明を印字する。式に結びつけておけば、入れ替わりは必ず赤くなる。
const allCaseExprs = new Map(
  partitions.flatMap(({ values }) =>
    values.map((c) => [c.id, c.expr] as const),
  ),
);
// 「id が同値ケースとして存在するのに『コーパスに無い』と言われる」誤りを
// 避けるため、同値ケースの id 集合も別に渡す(assertOverridesAreSound が
// 二つの拒否理由を区別する)。
const equivalenceCaseIds = new Set(
  partitions.flatMap(({ equivalences }) => equivalences.map((c) => c.id)),
);
assertOverridesAreSound(overrides, allCaseExprs, equivalenceCaseIds);

test("withinTolerance judges by relative error alone", () => {
  // ここのリテラルは withinTolerance 自身の入力であって、コーパスの許容ではない。
  // 実際の比較(下の test)は shard.tolerance だけを使う。
  // CLAUDE.md が禁じているのは後者をコードに書くことである。
  const tolerance = { abs: 5e-10, rel: 5e-10 };

  // 相対で収まれば通る。
  expect(withinTolerance(1, 1 + 4e-10, tolerance)).toBe(true);
  // 相対で外れれば、絶対誤差がどれだけ小さくても落ちる。
  // **これが今回の変更の本体である**——以前は abs の OR が救っていた。
  expect(withinTolerance(1e-6, 1e-6 + 4e-10, tolerance)).toBe(false);
  // 大きさに依らず同じ相対で見る。
  expect(withinTolerance(1, 1.5, tolerance)).toBe(false);
  expect(withinTolerance(1e8, 1e8 + 1, tolerance)).toBe(false);
});

test("abs is only for an expectation of exactly zero", () => {
  const tolerance = { abs: 5e-10, rel: 5e-10 };
  expect(withinTolerance(0, 0, tolerance)).toBe(true);
  expect(withinTolerance(4e-10, 0, tolerance)).toBe(true);
  expect(withinTolerance(6e-10, 0, tolerance)).toBe(false);
});

test("classify reports the relative tolerance as the effective one", () => {
  const tolerance = { abs: 5e-10, rel: 5e-10 };
  const small = classify(1e-6, 1e-6, tolerance);
  // 以前はここが abs / |期待値| = 5e-4 に膨らんでいた。
  expect(small.effectiveRelTolerance).toBe(5e-10);
  expect(small.bucket).toBe("display");
  // |期待値| ≥ 1 でも同じ。マグニチュードに依らない。
  const big = classify(10, 10, tolerance);
  expect(big.effectiveRelTolerance).toBe(5e-10);
  expect(big.bucket).toBe("display");
  // 期待値が厳密に 0 のときだけ、相対の保証が無い。
  const zero = classify(0, 0, tolerance);
  expect(zero.bucket).toBe("undefined");
  expect(zero.effectiveRelTolerance).toBe(Number.POSITIVE_INFINITY);
});

test("an overridden case lands in a looser band", () => {
  const overridden = { abs: 5e-10, rel: 2e-9 };
  const c = classify(1, 1, overridden, 5e-10);
  expect(c.effectiveRelTolerance).toBe(2e-9);
  expect(c.bucket).not.toBe("display");
});

test("at least one shard is present", () => {
  expect(shards.length).toBeGreaterThan(0);
});

test("an override pointing at an equivalence case is refused, not silently accepted", () => {
  // 同値ケースは上書きの対象外である(外の期待値を持たないので「どこまで
  // 緩めるか」の基準が無い、比較ループのコメントを見よ)。しかし同値ループは
  // overrides を一切見ないので、同値ケースを指す上書きは何もしないまま
  // 受理され、腐り検出(assertNoStaleOverrides は値ループの中でしか呼ばれない)
  // にも掛からず**永久に残る**。allCaseExprs が値ケースだけに絞られていれば、
  // 走行の頭で名指しして落ちる——実際のコーパスから取った同値ケース id で
  // 確かめる。
  const equivalenceId = partitions
    .flatMap(({ equivalences }) => equivalences.map((c) => c.id))
    .at(0);
  if (equivalenceId === undefined) {
    throw new Error(
      "no equivalence case found in the loaded corpus to test against",
    );
  }
  const bogus = new Map([
    [
      equivalenceId,
      {
        rel: 2e-9,
        expr: "(1) + (1)",
        reason: "同値ケースを指す上書き(受理されてはならない)",
      },
    ],
  ]);
  let message = "";
  try {
    assertOverridesAreSound(bogus, allCaseExprs, equivalenceCaseIds);
  } catch (cause) {
    message = String(cause);
  }
  expect(message).toContain(equivalenceId);
  // この id は実在する——同値ケースとして。「コーパスに無い」は事実誤認
  // なので言ってはならない。「値ケースにしか効かない」が正しい理由である。
  expect(message).not.toContain("コーパスに無い");
  expect(message).toContain("値ケース");
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
  // と思い込む。**行き先が無いのではなく、行き先が別にある**——ケース単位の
  // 緩和は `corpus/overrides.json` に書く(3a 設計書 §3.3)。メッセージが
  // そこを指していること自体を押さえる。以前ここは「段階 3 で実装される」を
  // 固定していたが、段階 3a がマグニチュード依存を否定した時点でその文言は
  // 嘘になった(3a 設計書 §2)。
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
  // 正しい行き先(`corpus/overrides.json`)を指していること。
  expect(() => assertShardIsSound("made-up.json", shard)).toThrow(
    /overrides\.json/,
  );
  // 「待てばシャードに書けるようになる」と読めてはならない。
  let message = "";
  try {
    assertShardIsSound("made-up.json", shard);
  } catch (cause) {
    message = String(cause);
  }
  expect(message).not.toContain("NOT implemented");
  expect(message).not.toContain("stage 3 together with magnitude");
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
  /**
   * このシャードで実際に適用された、名指しの上書き。
   * report.ts の `ShardSummary.appliedOverrides` にそのまま渡す
   * (詳しい経緯はそちらの doc コメントを見よ——以前は「絶対誤差の側だけで
   * 通ったケース」という名前のフィールドで、値だけを詰めていた場所である)。
   */
  appliedOverrides: {
    id: string;
    rel: number;
    baseRel: number;
    reason: string;
  }[];
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
    appliedOverrides: [],
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
    // 表示分解能(rel)より緩く検査されたケース。判定は rel だけで行うので、
    // ここに来るのは名指しの上書きが効いているときだけである。
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
  // withinTolerance は rel だけで判定する(期待値が厳密に 0 のときだけ abs を
  // 使う——rel が数学的に定義できない場合の専用経路であって、rel の代わりでは
  // ない)。だから、相対誤差を測定できて(期待値 ≠ 0)シャードの rel は超えた
  // のに合格する経路は、名指しの上書きしか無い。上書きが適用されたケースを
  // 黙って合格に混ぜると、「rel の許容に収まっている」という主張が実態より
  // 緩くなる(sci-001332 の裁定、設計書 §3.5)。
  //
  // 期待値が厳密に 0 のケースは rel が数学的に定義できないだけで、
  // 上書きとは別物(修正ラウンド 1 のレビュー指摘)。別に集計する。
  if (result.passed && result.bucket === "undefined") {
    into.relUndefinedCases.push(
      `${id}: ${description} (abs ${result.absoluteError.toExponential(2)})`,
    );
  } else if (result.passed && result.relativeError > tolerance.rel) {
    // rel だけの判定でここに来るのは、この id に上書きが登録されていて、
    // 上書き後の rel で通ったときだけである。overrides に登録が無いのに
    // ここへ来たら、判定のどこかが名指しの上書き以外の経路で緩んでいる
    // ——黙って通さず、その場で落とす。
    const override = overrides.get(id);
    if (override === undefined) {
      throw new Error(
        `${id}: shard の rel を超えて合格したが、overrides に登録が無い。` +
          "rel だけで判定しているので、上書き以外にこれが起こる経路は無いはずである。",
      );
    }
    into.appliedOverrides.push({
      id,
      rel: override.rel,
      baseRel: tolerance.rel,
      reason: override.reason,
    });
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
    // 上書きが**もう要らない**もの。上書きなしのシャードの rel で通るように
    // なったケースを集め、ループの後で赤にする(設計書 §3.4)。
    const stale: string[] = [];
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
      // 上書きがあれば rel だけ差し替える。帯の目盛りには**上書き前**の rel を
      // 渡すので、緩めたケースは緩い帯に落ちる——実際に緩く検査したのだから、
      // 報告書がその件数を数えられなければならない。
      const effective = resolveTolerance(
        testCase.id,
        shard.tolerance,
        overrides,
      );
      const verdict = classify(
        actual,
        expected,
        effective,
        shard.tolerance.rel,
      );
      if (overrides.has(testCase.id)) {
        // 上書き**なし**でも通るなら、その上書きは理由が嘘になっている。
        const withoutOverride = classify(actual, expected, shard.tolerance);
        if (withoutOverride.passed) {
          stale.push(testCase.id);
        }
      }
      tally(
        into,
        shard.tolerance,
        testCase.id,
        `${testCase.expr} → ${result.main}, expected ${expected}`,
        verdict,
      );
    }

    // **expect より先に記録する。** 落ちたときこそレポートが要るのに、
    // 先に expect を書くとそこで打ち切られてレポートが空になる。
    const precedenceCases = values.filter((c) =>
      needsPrecedence(c.keys),
    ).length;
    record({
      name: `${name} (values)`,
      total: values.length,
      values: values.length,
      equivalences: 0,
      generatedBy: shard.generated_by,
      mismatches: into.mismatches,
      maxRelativeError: into.maxRelativeError,
      maxAbsoluteError: into.maxAbsoluteError,
      appliedOverrides: into.appliedOverrides,
      relUndefinedCases: into.relUndefinedCases,
      relMeasured: into.relMeasured,
      relUndefinedNonZeroAbs: into.relUndefinedNonZeroAbs,
      looserThanDisplay: into.looserThanDisplay,
      precedenceCases,
      worstEffectiveRelTolerance: into.worstEffectiveRelTolerance,
      bands: into.bands,
      shape: summarizeShape(values.map((c) => c.keys)),
      magnitudes: quantiles(into.magnitudes),
      tolerance: shard.tolerance,
    });

    // **記録の後、mismatch の expect より前。** 腐った上書きは合否とは
    // 別の欠陥なので、不一致が 0 でも赤くする。record() の後に置くのは、
    // ここで throw してもレポートは残したいからである。
    assertNoStaleOverrides(stale, overrides);

    // 先頭 20 件だけ読ませる。端末で読める量に上限を置き、全件は
    // Task 8 のレポートが持つ(設計書 §8)。
    expect(
      into.mismatches.slice(0, 20).join("\n"),
      `${into.mismatches.length} of ${values.length} cases disagree`,
    ).toBe("");
  });
}

test("an equivalence case counts once even when both its sequences need precedence", () => {
  // **M4 (review round 2), fixed for real in N2 (review round 3).** The
  // round-2 version of this test applied its **own inline copy** of
  // `left || right` rather than calling the production path — measured by
  // mutation: replacing the production expression (then at `corpus.spec.ts`'s
  // equivalence loop) with a per-sequence sum left this test green,
  // unchanged (1 passed → 1 passed). It was a tautology about a literal
  // written three lines above it, not a test of production code.
  //
  // Fixed by extracting the decision into `equivalenceNeedsPrecedence`
  // (`corpus.ts`) and having **both** the production loop below and this
  // test call the same function — see that function's doc comment for the
  // mutation numbers before and after this fix.
  const needsIt = ["1", "add", "2", "mul", "3", "eq"]; // true, see tests above
  const doesNot = ["1", "add", "2", "eq"]; // false, see tests above
  const synthetic: EquivalenceCase[] = [
    {
      kind: "equivalence",
      id: "synthetic-left-only",
      mode: "Deg",
      left: needsIt,
      right: doesNot,
    },
    {
      kind: "equivalence",
      id: "synthetic-right-only",
      mode: "Deg",
      left: doesNot,
      right: needsIt,
    },
    {
      kind: "equivalence",
      id: "synthetic-both",
      mode: "Deg",
      left: needsIt,
      right: ["4", "mul", "5", "add", "6", "eq"], // also true
    },
  ];
  const precedenceCases = synthetic.filter(equivalenceNeedsPrecedence).length;
  // Per-case OR: all three cases qualify once each.
  expect(precedenceCases).toBe(3);
  // Not the sequence-sum a `(left ? 1 : 0) + (right ? 1 : 0)` reduction would
  // give (2 left-matches + 2 right-matches = 4, double-counting "both").
  // This alternate computation is deliberately *not* routed through
  // `equivalenceNeedsPrecedence` — it exists only to give the assertion
  // below something concrete to differ from.
  const wrongSequenceSum = synthetic.reduce(
    (sum, c) =>
      sum +
      (needsPrecedence(c.left) ? 1 : 0) +
      (needsPrecedence(c.right) ? 1 : 0),
    0,
  );
  expect(wrongSequenceSum).toBe(4);
  expect(precedenceCases).not.toBe(wrongSequenceSum);
});

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
      // **同値ケースは上書きの対象外である。** 外の期待値を持たないので
      // 「どこまで緩めるか」の基準が無い——ここで緩めても、何に対して
      // 緩めたのかを誰も言えない。シャードの rel をそのまま使う。
      tally(
        into,
        shard.tolerance,
        testCase.id,
        `${left.main} vs ${right.main}`,
        classify(actual, expected, shard.tolerance),
      );
    }

    // **expect より先に記録する。** 理由は値ケース側と同じ。
    //
    // 左右のキー列を合わせて 1 件として数える——同値ケースは 1 件が左右
    // 二本のキー列を持つので、どちらか一方でも優先順位が無ければ解釈できない
    // なら、そのケースは「優先順位を踏んだ」でよい。左右を別々に数えて
    // 足すと 1 件が 2 件に化ける。
    const precedenceCases = equivalences.filter(
      equivalenceNeedsPrecedence,
    ).length;
    record({
      name: `${name} (equivalences)`,
      total: equivalences.length,
      values: 0,
      equivalences: equivalences.length,
      generatedBy: shard.generated_by,
      mismatches: into.mismatches,
      maxRelativeError: into.maxRelativeError,
      maxAbsoluteError: into.maxAbsoluteError,
      // **同値ケースは上書きの対象外**(上の tally 呼び出しが shard.tolerance を
      // そのまま使っていることを見よ)。overrides を見ないので rel だけの判定で
      // シャードの rel を超えて合格することが無く、into.appliedOverrides は
      // 常に空になる——ここで [] を書かずに into.appliedOverrides を渡すのは、
      // その不変条件を tally() の中で言わせるためである。
      appliedOverrides: into.appliedOverrides,
      relUndefinedCases: into.relUndefinedCases,
      relMeasured: into.relMeasured,
      relUndefinedNonZeroAbs: into.relUndefinedNonZeroAbs,
      looserThanDisplay: into.looserThanDisplay,
      precedenceCases,
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
