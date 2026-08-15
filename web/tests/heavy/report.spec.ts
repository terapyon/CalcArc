import { expect, test } from "@playwright/test";
import type { ToleranceBand } from "./corpus";
import { type Provenance, renderReport, type ShardSummary } from "./report";

const TOLERANCE = { abs: 1e-9, rel: 1e-9 };

const PROVENANCE: Provenance = {
  ranAt: "2026-08-16T00:00:00.000Z",
  commit: "abc1234",
  coreVersion: "0.1.0",
  browser: "chromium 140.0.0",
};

function bands(counts: Partial<Record<ToleranceBand, number>>) {
  return {
    display: 0,
    "1e-9": 0,
    "1e-7": 0,
    "1e-5": 0,
    worse: 0,
    undefined: 0,
    ...counts,
  };
}

/** 見出し以外の欄は既定で埋める。個々のテストは見たい欄だけ上書きする。 */
function summary(overrides: Partial<ShardSummary> = {}): ShardSummary {
  return {
    name: "scientific-000.json (values)",
    total: 2000,
    values: 2000,
    equivalences: 0,
    generatedBy: "mpmath 1.3.0 (50 dps), Python 3.14",
    mismatches: [],
    maxRelativeError: 3.4e-12,
    maxAbsoluteError: 1.1e-11,
    absOnlyCases: [],
    relUndefinedCases: [],
    relMeasured: 2000,
    relUndefinedNonZeroAbs: 0,
    looserThanDisplay: 0,
    worstEffectiveRelTolerance: 1e-9,
    bands: bands({ display: 2000 }),
    shape: {
      sequences: 2000,
      // 「一度も押されていないキー」はこの集計から導かれるので、既定の
      // 見本も KEY_TOKENS の一部だけを踏んだ形にしておく。
      tokens: {
        add: 500,
        sub: 400,
        mul: 300,
        div: 200,
        sqrt: 100,
        eq: 2000,
        lparen: 1500,
        rparen: 1500,
        "1": 900,
      },
      depths: { "0": 100, "1": 900, "2": 1000 },
    },
    magnitudes: { count: 2000, min: 0, p25: 1, median: 10, p75: 100, max: 1e9 },
    tolerance: TOLERANCE,
    ...overrides,
  };
}

test("the report says what was checked, not just that it passed", () => {
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("2000");
  expect(markdown).toContain("scientific-000.json (values)");
  // 観測された最大誤差が読めること。
  expect(markdown).toContain("3.4");
  // 表示精度の但し書きは必ず載る(設計書 §11)。
  expect(markdown).toContain("表示");
});

test("the report explains what the two routes are, so it stands on its own", () => {
  // これ一枚を読む外の人は、コーパスの作り方も設計書も知らない。件数だけ
  // 見せて「何を確かめたのか」を書かないと、判断する材料にならない。
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("何をどう確かめたか");
  expect(markdown).toContain("mpmath");
  expect(markdown).toContain("キー列");
  // 同値ケースが期待値を持たないことも書く。
  expect(markdown).toContain("期待値を持たない");
});

test("failures are listed, not summarised away", () => {
  const markdown = renderReport(
    [
      summary({
        total: 2,
        values: 2,
        mismatches: ["sci-000001: sqrt(2) → 1.41, expected 1.4142135624"],
        maxRelativeError: 0.003,
        maxAbsoluteError: 0.004,
      }),
    ],
    PROVENANCE,
  );

  expect(markdown).toContain("sci-000001");
});

test("cases that pass only through the abs side of the OR are disclosed with id and numbers", () => {
  // sci-001332 の裁定(2026-08-15): 絶対誤差でしか通らなかった実例をコーパスから
  // 除外せず開示する。ここではその開示が id と数値つきで載ることだけを確かめる。
  const markdown = renderReport(
    [
      summary({
        maxRelativeError: 1.34e-9,
        maxAbsoluteError: 2.32e-10,
        absOnlyCases: [
          "sci-001332: cos(rad(((815 * 412) * (747 + 422)))) → -0.173648177899..., " +
            "expected -0.17364817766693036 (rel 1.34e-9, abs 2.32e-10)",
        ],
      }),
    ],
    PROVENANCE,
  );

  // 総件数(1 件)と、その 1 件の id・数値の両方が読めること。
  expect(markdown).toContain("絶対誤差の側だけで通った");
  expect(markdown).toContain("sci-001332");
  expect(markdown).toContain("1.34e-9");
  expect(markdown).toContain("2.32e-10");
});

test("zero abs-only cases is stated as zero, not omitted", () => {
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("絶対誤差の側だけで通ったケース");
  expect(markdown).toContain("0 件");
});

test("the report discloses the known limit of huge-angle trig functions", () => {
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("この結果が主張していないこと");
  expect(markdown).toContain("引数還元");
});

test("real precision-limit hits are not conflated with expected-zero exact matches", () => {
  // 修正ラウンド 1 のレビュー指摘: 「絶対誤差の側だけで通ったケース」の見出しが
  // rel を測定できた本物の精度限界(sci-001332 相当)と、期待値が厳密に 0 で
  // rel が定義できないだけの完全一致(sci-000023 相当)を混ぜて数えると、
  // 「精度低下が n 件あった」という誤読を招く。二つの節・二つの見出し数字に
  // 分かれて出ることを確かめる。
  const markdown = renderReport(
    [
      summary({
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
      }),
    ],
    PROVENANCE,
  );

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
  const markdown = renderReport(
    [
      summary({
        maxRelativeError: 1.34e-9,
        maxAbsoluteError: 4.36e-2,
        absOnlyCases: ["sci-001332: ... (rel 1.34e-9, abs 2.33e-10)"],
        relUndefinedCases: [
          "sci-000023: ... (abs 0.00e+0)",
          "sci-001717: ... (abs 0.00e+0)",
        ],
        looserThanDisplay: 653,
        worstEffectiveRelTolerance: 4.15e-4,
      }),
      summary({
        name: "equivalence-000.json (equivalences)",
        values: 0,
        equivalences: 2000,
        // どちらの最大値もシャード 1 より小さい — 合算後の最大がシャード 1 の
        // 値のままであることを確かめる。
        maxRelativeError: 9.9e-11,
        maxAbsoluteError: 5.0e-3,
        relUndefinedCases: ["eqv-000074: 0 vs 0 (abs 0.00e+0)"],
        looserThanDisplay: 100,
        worstEffectiveRelTolerance: 1e-6,
      }),
    ],
    PROVENANCE,
  );

  // 合計は 2 シャードの合算(2000 + 2000)だが、**経路ごとに分けて**出る。
  expect(markdown).toContain("二経路で照合したケース(値): 2000**");
  expect(markdown).toContain("電卓の自己整合を見たケース(同値): 2000**");
  expect(markdown).toContain("合計: **4000**");
  // 最大相対誤差・最大絶対誤差は 2 シャードのうち大きい方(シャード 1)を拾う。
  expect(markdown).toContain("観測された最大相対誤差: **1.34e-9**");
  expect(markdown).toContain("観測された最大絶対誤差: **4.36e-2**");
  // abs のみ件数は合算(1 + 0 = 1)、rel 未定義件数は合算(2 + 1 = 3)。
  expect(markdown).toContain("精度限界の実例): **1**");
  expect(markdown).toContain("厳密に 0): **3**");
  // 表示分解能より緩く検査された件数は合算(653 + 100)、最悪の実効相対許容は
  // 大きい方(4.15e-4)。
  expect(markdown).toContain("表示分解能より緩く検査されたケース: 753**");
  expect(markdown).toContain("最悪の実効相対許容: 4.15e-4**");
});

test("the headline discloses how loosely the OR actually checked, not just that it passed", () => {
  // 修正ラウンド 2 の Critical: abs/rel の OR は |期待値| < 1 のところで
  // rel より緩い検査になる。件数と最悪値を見出しに出し、分布を節に出す。
  const markdown = renderReport(
    [
      summary({
        looserThanDisplay: 653,
        worstEffectiveRelTolerance: 4.15e-4,
        bands: bands({
          display: 1347,
          "1e-9": 287,
          "1e-7": 257,
          "1e-5": 83,
          worse: 22,
          undefined: 4,
        }),
      }),
    ],
    PROVENANCE,
  );

  expect(markdown).toContain("表示分解能より緩く検査されたケース: 653**");
  expect(markdown).toContain("最悪の実効相対許容: 4.15e-4**");
  expect(markdown).toContain("## 実効的な相対許容の分布");
  // 帯ごとの件数が読めること。
  expect(markdown).toContain("1347");
  expect(markdown).toContain("| 257 |");
  expect(markdown).toContain("| 22 |");
  // abs の下駄が何をしているかも一緒に書く — 開示であって設計変更ではない。
  expect(markdown).toContain("abs の下駄は何を救っているか");
  // 「主張していないこと」が実態に合っている。
  expect(markdown).toContain("有効数字 4 桁");
});

test("the abs floor's justification is written from what this run measured", () => {
  // 敵対者レビュー(2026-08-15): 以前ここには「1e9 級から 1e-6 級への桁落ちが
  // 起きたケースの偽陽性を abs の下駄が防いでいる」と固定文字列で書いてあった。
  // 実測がこれを否定した——{abs: 0, rel: 1.5e-9} で全 4000 件が通る。
  // 同じ嘘を二度書かないために、この節は走行の実測から判定を導く。
  const noFloorNeeded = renderReport(
    [
      summary({
        maxRelativeError: 1.34e-9,
        relMeasured: 1996,
        relUndefinedNonZeroAbs: 0,
        relUndefinedCases: ["sci-000023: (0)^2 → 0, expected 0 (abs 0.00e+0)"],
      }),
    ],
    PROVENANCE,
  );
  expect(noFloorNeeded).toContain("abs の下駄は一件も救っていない");
  expect(noFloorNeeded).toContain("1.34e-9");
  // 裏付けの無い主張は落ちている。
  expect(noFloorNeeded).not.toContain("その偽陽性を防いでいる");
  // 想定の領域であることは明記する。
  expect(noFloorNeeded).toContain("観測されていない想定の領域");

  // 期待値 0 のケースに 0 でない絶対誤差が出たら、判定が反転する。
  const floorEarnsIt = renderReport(
    [
      summary({
        maxRelativeError: 1.34e-9,
        relMeasured: 1996,
        relUndefinedNonZeroAbs: 3,
        relUndefinedCases: [
          "sci-000023: (0)^2 → 1e-12, expected 0 (abs 1e-12)",
        ],
      }),
    ],
    PROVENANCE,
  );
  expect(floorEarnsIt).toContain("abs の側は実際に効いている");
});

test("a run with nothing to measure relatively says so instead of printing zero", () => {
  // 敵対者レビュー(2026-08-15): 期待値が全部 0 の走行で見出しが
  // 「最悪の実効相対許容: 0.00e+0」と出た。相対の保証が一切無い走行なのに、
  // **完璧に厳しい**と読める。集計から非有限を外し、Math.max(0, ...) が
  // 下駄を履かせるためである。
  const markdown = renderReport(
    [
      summary({
        relMeasured: 0,
        maxRelativeError: 0,
        maxAbsoluteError: 0,
        worstEffectiveRelTolerance: 0,
        bands: bands({ undefined: 2000 }),
        relUndefinedCases: ["sci-000023: 0 vs 0 (abs 0.00e+0)"],
      }),
    ],
    PROVENANCE,
  );

  expect(markdown).toContain("最悪の実効相対許容: 定義できない**");
  expect(markdown).toContain("観測された最大相対誤差: **定義できない**");
  expect(markdown).not.toContain("最悪の実効相対許容: 0.00e+0");
  expect(markdown).toContain("相対誤差を測定できたケースが 1 件も無い");
});

test("the equivalence blind spot is disclosed, not implied by the headline", () => {
  // 同値ケースは「定数を返すだけのもの」に対して全件通る。それを捕まえるのは
  // 値ケースの側である。見出しの 4000 が二経路の証拠を 2 倍に見せないよう、
  // 件数を経路ごとに分けたうえで、この性質を本文に書く。
  const markdown = renderReport(
    [summary({ name: "equivalence-000.json (equivalences)" })],
    PROVENANCE,
  );

  expect(markdown).toContain("定数を返すだけのものが自明に満たす");
  expect(markdown).toContain("それを捕まえるのは値ケースの側である");
  // 同値ケースの誤差 0 が構造的な必然であることも書く。
  expect(markdown).toContain("選んだ形の必然");
});

test("keys the transform injected are not counted as the calculator's diversity", () => {
  // 同値シャードの neg 2122 回のうち 74.2% が `neg neg` の注入分だった。
  // 分布表がそれを式の多様性として数えると、「同じような式を大量に試した
  // だけか」への回答が水増しになる(敵対者レビュー 2026-08-15)。
  const markdown = renderReport(
    [
      summary({
        name: "equivalence-000.json (equivalences)",
        values: 0,
        equivalences: 2000,
        shape: {
          sequences: 2000,
          tokens: { neg: 548, add: 1183, eq: 2000 },
          depths: { "0": 955, "1": 1045 },
        },
        addedByTransform: { neg: 1574, add: 800 },
      }),
    ],
    PROVENANCE,
  );

  expect(markdown).toContain("うち変換で付加");
  expect(markdown).toContain("1574");
  // 左辺だけを数えていることが読み手に伝わる。
  expect(markdown).toContain("左辺のキー列だけを数えている");
});

test("the distribution of the corpus itself is in the report", () => {
  // 設計書 §11:「分布そのものを報告書に載せて、外から検証可能にする。」
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("## コーパスの分布");
  // 演算子・関数の出現回数。
  expect(markdown).toContain("| 500 | 400 | 300 | 200 |");
  // 括弧深さの分布。
  expect(markdown).toContain("深さ 2");
  // マグニチュードの分位。
  expect(markdown).toContain("値の大きさ");
});

test("the report says what was run, when, and with what", () => {
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("2026-08-16T00:00:00.000Z");
  expect(markdown).toContain("abc1234");
  expect(markdown).toContain("0.1.0");
  expect(markdown).toContain("chromium 140.0.0");
  // シャード自身の素性も載る。
  expect(markdown).toContain("mpmath 1.3.0 (50 dps)");
});

test("the report lists the ground it has never touched", () => {
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("まだ一度も踏んでいない領域");
  expect(markdown).toContain("優先順位");
  expect(markdown).toContain("指数表記");
  expect(markdown).toContain("angle_toggle");
});

test("the unused key tokens are derived from the run, not hand-written", () => {
  // 敵対者レビュー(2026-08-15): この節が完全に静的な文字列だったので、
  // 段階 3 で複素数・指数表記・Rad が入っても、誰かが手で消すまでレポートは
  // 古い否定を出し続ける。信憑性を目的とした文書として最悪の壊れ方である。
  const markdown = renderReport([summary()], PROVENANCE);

  // 見本の shape が踏んでいないキーが名指しされる。
  expect(markdown).toContain("`pi`");
  expect(markdown).toContain("`angle_toggle`");
  // 踏んだキーは載らない(既定の見本は add / eq / lparen / 1 を踏んでいる)。
  expect(markdown).not.toContain("`add` `sub`");
  expect(markdown).toContain("`KEY_TOKENS` の差分から導いている");

  // 押されたキーが増えれば、その分だけ「使っていない」から消える。
  const withPi = renderReport(
    [
      summary({
        shape: {
          sequences: 2000,
          tokens: { add: 500, eq: 2000, pi: 7 },
          depths: { "0": 2000 },
        },
      }),
    ],
    PROVENANCE,
  );
  expect(withPi).not.toContain("`pi`");

  // 同値シャードの右辺が注入したキーも「押された」に数える
  // (分布表では分けるが、踏んだかどうかは合わせて見る)。
  const injectedOnly = renderReport(
    [
      summary({
        shape: { sequences: 2000, tokens: { eq: 2000 }, depths: { "0": 2000 } },
        addedByTransform: { pi: 3 },
      }),
    ],
    PROVENANCE,
  );
  expect(injectedOnly).not.toContain("`pi`");
});

test("the hand-maintained half of the caveats says it is hand-maintained", () => {
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("この節は手で保守されている");
  expect(markdown).toContain("段階 3");
});

test("the report tells the reader how to check it themselves", () => {
  // 「みんなで確認する」が目的なのに、読み手が自分で確かめに行く入口が
  // 書かれていなかった(敵対者レビュー 2026-08-15)。
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("自分で確かめるには");
  expect(markdown).toContain("corpus/generated/*.json");
  expect(markdown).toContain("pnpm heavy");
});

test("an empty run refuses to render as a green-looking report", () => {
  // 「総ケース数 0 / 不一致 0」は緑に見える。一件も回っていないことと、
  // 全件通ったことが同じ見た目になってはならない(修正ラウンド 2)。
  expect(() => renderReport([], PROVENANCE)).toThrow(/no shard/);
});
