import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { HeavyUiRun } from "../ui/presses";
import { buildRun as buildUiRun } from "../ui/presses";
import { CERTIFICATES } from "./certificates";
import type {
  CallCase,
  DisplayCase,
  DisplayEquivalenceCase,
  ToleranceBand,
} from "./corpus";
import {
  type CallBreakdown,
  type Coverage,
  type CoverageExclusion,
  type CoverageRequirement,
  countSequencesWithoutEq,
  displaySequences,
  loadCallShards,
  loadDisplayShards,
  loadShards,
  needsPrecedence,
  partitionCases,
  summarizeCallShard,
} from "./corpus";
import {
  ASSOCIATIVITY_SHARD,
  areaOfShard,
  buildRun,
  CERTIFICATE_PROBES,
  CERTIFICATE_PROBES_BROKEN_BY_TAX_MUTATION,
  corpusDigest,
  type DetectionPower,
  ENTRY_SHARD,
  ERRORS_SHARD,
  type ErrorPathId,
  errorCaseCount,
  errorPaths,
  expectedSummaryNames,
  generatorDigest,
  type HeavyRun,
  PRECEDENCE_CHANGES_MEANING,
  PRECEDENCE_SHARD,
  type Provenance,
  parseReproducibility,
  type RecordedShard,
  type Reproducibility,
  type ReproducibilitySignal,
  renderCallBreakdowns,
  renderCoverage,
  renderDetectionPower,
  renderReport,
  renderReproducibility,
  renderScienceCoverage,
  reproducibilityHealth,
  runHealth,
  type ShardSummary,
  SPEC_TRANSCRIPTION_MARK,
  summaryName,
  uiHealth,
  verdictOf,
  verificationFrameOf,
  verificationFrames,
} from "./report";

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

/**
 * エラー経路の枠の見出し行を 1 本だけ取り出す。
 *
 * **見出しごと取り出すのが肝である。** `toContain("270 件")` で済ませると、
 * 6 枠を 1 つに畳んだ実装——どこかに 270 と書いてあるだけの実装——でも緑に
 * なる。枠の名前の付いた行に、その枠の数が乗っていることを見る。
 */
function onlyLine(markdown: string, needle: string): string {
  const lines = markdown.split("\n").filter((line) => line.includes(needle));
  expect(
    lines.length,
    `「${needle}」を含む行が 1 本ではない(${lines.length} 本)`,
  ).toBe(1);
  return lines[0] ?? "";
}

function errorPathLine(markdown: string, title: string): string {
  return onlyLine(markdown, title);
}

/** 但し書き(「この節の件数は…」以降)だけを切り出す。 */
function disclaimerOf(markdown: string): string {
  return markdown.slice(
    markdown.indexOf("この節の件数は、この走行の実データから"),
  );
}

/** 期待値として持っているエラー種別ごとの件数(実コーパスから数えるとき用)。 */
function kindsOf(
  cases: (CallCase | DisplayCase | DisplayEquivalenceCase)[],
): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const testCase of cases) {
    const error = (testCase as { expect?: { error?: unknown } }).expect?.error;
    if (typeof error === "string") {
      kinds[error] = (kinds[error] ?? 0) + 1;
    }
  }
  return kinds;
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
    appliedOverrides: [],
    relUndefinedCases: [],
    relMeasured: 2000,
    relUndefinedNonZeroAbs: 0,
    looserThanDisplay: 0,
    precedenceCases: 0,
    exponentDisplayCases: 0,
    errorKinds: {},
    // 見本のシャードは `tokens.eq: 2000`——2000 本すべてが `=` を押している。
    sequencesWithoutEq: 0,
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

  expect(markdown).toContain("どうやって確かめているか");
  expect(markdown).toContain("mpmath");
  expect(markdown).toContain("キー列");
  // 同値ケースが期待値を持たないことも書く。
  expect(markdown).toContain("期待値を持たない");
});

test("the report says mpmath evaluated the tree, not the printed expression", () => {
  // **検証ラウンド(2026-08-15)の C5。** ここには「数式(`(3 + 4)`)は Python の
  // mpmath が 50 桁の精度で独立に評価し」と書いてあった。実装は違う——Python は
  // **式木を直接**評価しており、印字されている `expr` は式木から描き出した
  // 人間向けの説明で、それを読んで値を出す経路はどこにも無い(設計書 §5 の訂正)。
  // 二経路が独立という主張自体は変わらないが、外の読み手が「印字されている数式が
  // 検証された経路だ」と受け取るのは誤りである。
  const markdown = renderReport([summary()], PROVENANCE);

  // 評価されたのは式木。
  expect(markdown).toContain("mpmath が 50 桁の精度で評価したのは式木の方");
  // expr が検証に使われていないことを明言する。
  expect(markdown).toContain("検証に使われていない");
  expect(markdown).toContain("`expr` の記法に誤りがあっても");
  // **設計書の節番号を本文に書かない(2026-08-17 の整理)。** 外の読み手には
  // 辿れない参照で、意味の分からない記号として残るだけである。
  expect(markdown).not.toContain("§7.4");
  expect(markdown).not.toContain("設計書");
  // 古い言い方が残っていないこと。
  expect(markdown).not.toContain("数式(`(3 + 4)`)は Python の mpmath");
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

test("the report counts and quotes every override", () => {
  const markdown = renderReport(
    [
      summary({
        appliedOverrides: [
          {
            id: "sci-001332",
            rel: 2e-9,
            baseRel: 5e-10,
            reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
          },
        ],
      }),
    ],
    PROVENANCE,
  );
  // 件数が見出しに出る。
  expect(markdown).toContain("上書き");
  // id と緩めた倍率と理由の全文が出る。
  expect(markdown).toContain("sci-001332");
  expect(markdown).toContain("4 倍");
  expect(markdown).toContain("引数の刻み幅が結果の精度を縛る");
  // **上限があることも言う。** 倍率だけ並べると「上書きは何倍でも書けるのでは」
  // という当然の疑いに答えられない(修正ラウンド)。
  expect(markdown).toContain("上書きにも上限がある");
  expect(markdown).toContain("1e-6");
});

test("no overrides is stated as zero, not omitted", () => {
  const markdown = renderReport(
    [summary({ appliedOverrides: [] })],
    PROVENANCE,
  );
  expect(markdown).toContain("上書きされたケース: **0**");
});

test("the report discloses the known limit of huge-angle trig functions", () => {
  // **実例があるときに**出る説明である。以前これは「この結果が主張して
  // いないこと」の固定文字列で、上書き 0 件の走行でも「上の『名指しで
  // 緩めたケース』に挙がっているのはその実例であり」と印字していた
  // ——直前の「**0 件。**」と正面から矛盾する(修正ラウンド)。
  const markdown = renderReport(
    [
      summary({
        appliedOverrides: [
          {
            id: "sci-001332",
            rel: 2e-9,
            baseRel: 5e-10,
            reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
          },
        ],
      }),
    ],
    PROVENANCE,
  );

  expect(markdown).toContain("この結果が主張していないこと");
  expect(markdown).toContain("引数還元");
});

test("with no override, the report does not claim examples it has none of", () => {
  const markdown = renderReport(
    [summary({ appliedOverrides: [] })],
    PROVENANCE,
  );

  // 0 件と言った直後に「上に挙がっているのはその実例であり」と書かない。
  //
  // **この言い回しは `renderCaveats` の説明文にも(行を跨いで)登場する**
  // ——renderCaveats はこの旧バグを引用の形で説明しており、その引用文が
  // 「実例が無い走行で「上に挙がっている」+「のはその実例であり」…」と、
  // renderReport が行を `\n` で join する前提でたまたま 2 つの配列要素に
  // 割れている。生の文字列一致で「無い」と確かめようとすると、その折り返し
  // 位置の偶然に依存する——`renderCaveats` の散文を 1 行にまとめ直せば
  // (実際には何も壊れていないのに)ここが赤くなり、逆に `renderOverrides`
  // の段落を行の途中で折り返せば、本当に出ているのにここが緑のまま見逃す。
  // そこで、`renderOverrides` の段落だけが使う語句——`renderCaveats` 側は
  // 同じ話を「巨大角度の三角関数という既知の領域」という別の言い回しで
  // 語っている——で判定する。隣の assert が使っている「引数還元の限界で
  // 表示精度に届かない」も同じ理由で堅い(両段落で語が異なる)。
  expect(markdown).toContain("**0 件。**");
  expect(markdown).not.toContain("巨大な角度を三角関数に渡した");
  expect(markdown).not.toContain("引数還元の限界で表示精度に届かない");
  // 但し書きの節そのものは残る(主張が弱まりうることは常に書く)。
  expect(markdown).toContain("この結果が主張していないこと");
});

test("named overrides are not conflated with expected-zero exact matches", () => {
  // 修正ラウンド 1 のレビュー指摘: 名指しの上書き(rel を測定できた本物の
  // 精度限界、sci-001332 相当)と、期待値が厳密に 0 で rel が定義できない
  // だけの完全一致(sci-000023 相当)を混ぜて数えると、「精度低下が n 件
  // あった」という誤読を招く。二つの節・二つの見出し数字に分かれて出ることを
  // 確かめる。
  const markdown = renderReport(
    [
      summary({
        maxRelativeError: 1.34e-9,
        maxAbsoluteError: 2.32e-10,
        appliedOverrides: [
          {
            id: "sci-001332",
            rel: 2e-9,
            baseRel: 5e-10,
            reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
          },
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
  expect(markdown).toContain("上書きされたケース: **1**");
  expect(markdown).toContain("厳密に 0): **2**");
  // 各節にそれぞれの id が載る。
  expect(markdown).toContain("sci-001332");
  expect(markdown).toContain("sci-000023");
  expect(markdown).toContain("sci-001717");
  // 完全一致の節は「精度低下の実例ではない」と明言する。
  expect(markdown).toContain("精度低下の実例ではない");
});

test("headline numbers aggregate correctly across multiple shards", () => {
  // 見出しの total / 最大相対誤差 / 最大絶対誤差 / 上書き件数 / rel 未定義件数は
  // 読み手が最初に信じる数字なので、複数シャードにわたる合算・最大化を確かめる。
  const markdown = renderReport(
    [
      summary({
        maxRelativeError: 1.34e-9,
        maxAbsoluteError: 4.36e-2,
        appliedOverrides: [
          {
            id: "sci-001332",
            rel: 1.34e-9,
            baseRel: 5e-10,
            reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
          },
        ],
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

  // 合計は 2 シャードの合算(2000 + 2000)だが、**検証の強さごとに分けて**出る。
  expect(markdown).toContain(
    "外部参照——Python の独立実装と突き合わせたケース: 2000**",
  );
  expect(markdown).toContain(
    "自己同値——二つのキー列が同じ表示に着くことを見たケース: 2000**",
  );
  expect(markdown).toContain("合計: **4000**");
  // 最大相対誤差・最大絶対誤差は 2 シャードのうち大きい方(シャード 1)を拾う。
  expect(markdown).toContain("観測された最大相対誤差: **1.34e-9**");
  expect(markdown).toContain("観測された最大絶対誤差: **4.36e-2**");
  // 上書き件数は合算(1 + 0 = 1)、rel 未定義件数は合算(2 + 1 = 3)。
  expect(markdown).toContain("上書きされたケース: **1**");
  expect(markdown).toContain("厳密に 0): **3**");
  // 表示分解能より緩く検査された件数は合算(653 + 100)、最悪の実効相対許容は
  // 大きい方(4.15e-4)。
  expect(markdown).toContain("表示分解能より緩く検査されたケース: 753**");
  expect(markdown).toContain("最悪の実効相対許容: 4.15e-4**");
});

test("the headline discloses how loosely overrides actually checked, not just that it passed", () => {
  // 判定を rel だけに締めたので、シャードの rel より緩い帯に落ちるケースが
  // あるとすれば、それは名指しの上書きが効いているときだけである。件数と
  // 最悪値を見出しに出し、分布を節に出す。この節が「絶対誤差の側だけで
  // 通った」を語っていた OR 時代とは違い、緩みの理由は上書きの節を指す。
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
  // 緩みの理由は「名指しで緩めたケース」の節を指す — 開示であって設計変更ではない。
  expect(markdown).toContain("名指しで緩めたケース");
  // 「主張していないこと」も上書きの分だけ弱いと書く。
  expect(markdown).toContain(
    "名指しで緩めたケースの分だけ、この層の主張は弱い",
  );
});

test("an incomplete run says so before it says anything else", () => {
  // **検証ラウンド(2026-08-15)の C2。** 1 件の expect.re を壊すと、Playwright が
  // ワーカーを再起動し、モジュールスコープの集計が失われ、新しいワーカーが
  // 「値: 0 / 不一致: 0 / 最大相対誤差 0.00e+0」で同じファイルを上書きした。
  // 赤い走行のあとに緑の顔が残る、という壊れ方である。
  //
  // 集計はディスクに持つようにしたが、それでも揃わない走行はありうる。
  // そのとき数字を結果として読ませない。
  const markdown = renderReport(
    [summary({ name: "equivalence-000.json (equivalences)" })],
    PROVENANCE,
    ["scientific-000.json (values)"],
  );

  // 欠落の宣言が、結果の見出しより**先**に出ること。
  expect(markdown.indexOf("この走行は不完全である")).toBeGreaterThanOrEqual(0);
  expect(markdown.indexOf("この走行は不完全である")).toBeLessThan(
    markdown.indexOf("# CalcArc 計算検証レポート"),
  );
  // 何が欠けているかを名指しすること。
  expect(markdown).toContain("scientific-000.json (values)");
  // 「不一致: 0」を通ったという意味に読ませないこと。
  expect(markdown).toContain("通ったという意味では");

  // 揃っている走行にはこの見出しが出ない。
  expect(renderReport([summary()], PROVENANCE)).not.toContain(
    "この走行は不完全である",
  );
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

  expect(markdown).toContain("同じ値を返すだけの");
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

  // **N5 (review round 3): the heading itself used to say "一度も" (never,
  // even once), directly contradicting the bullet under it once that bullet
  // reports a nonzero count.** The heading now moves with the lead-in
  // I2 already fixed.
  expect(markdown).toContain(
    "まだ踏んでいない、または限定的にしか踏んでいない領域",
  );
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
  // 導出であることは、下の 2 つの走行で**出力が変わる**ことが示す
  // ——文言そのものを固定しても「手書きでないこと」の証拠にはならない。
  expect(markdown).toContain("実データから導いている");

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

test("the report reads as a result, not as a change log", () => {
  // **利用者の指摘(2026-08-17)。** 「過去の経緯で修正した物を言い訳して
  // いたり、このレポートを初めて見た人に意味がわかりにくい表現が入っている」。
  //
  // この文書は**外の読み手に結果を伝えるためのもの**で、開発の経緯を残す
  // ためのものではない。経緯はコード側のコメントと `docs/` に置く
  // ——そこは保守する人が読む場所で、こちらは初めて見る人が読む場所である。
  //
  // 語彙で見張る。ここに挙げた語が本文に出たら、それは「読み手には辿れない
  // 内部の話」が漏れた印である。
  const forbidden = [
    "敵対者レビュー",
    "修正ラウンド",
    "レビュー修正",
    "設計書",
    "段階 3",
    "段階 5",
    "Layer 1",
    "Layer 5",
    "実在したバグ",
    "fix round",
    "review round",
  ];
  // 上書きが有る走行・無い走行の両方を見る(理由の全文が載る経路が違う)。
  for (const entry of [
    summary(),
    summary({
      appliedOverrides: [
        {
          id: "sci-001332",
          rel: 2e-9,
          baseRel: 5e-10,
          reason: "巨大角度の三角関数。引数の刻み幅が結果の精度を縛る。",
        },
      ],
    }),
  ]) {
    const markdown = renderReport([entry], PROVENANCE);
    for (const word of forbidden) {
      expect(
        markdown,
        `report still says ${JSON.stringify(word)}`,
      ).not.toContain(word);
    }
  }
});

test("the real corpus and its overrides carry no development history either", () => {
  // 上のテストは見本のシャードで見ている。**理由の全文はコーパス側の
  // `overrides.json` から来る**ので、実物も見る——`sci-000019` の理由には
  // 「再計算して半 ulp を使うと下の数字とは一致しないが、それは意図した
  // 安全マージンである」という、過去の訂正の言い訳が入っていた。
  const overrides = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../corpus/overrides.json", import.meta.url)),
      "utf-8",
    ),
  ) as { overrides: Record<string, { reason: string }> };
  const reasons = Object.entries(overrides.overrides);
  expect(
    reasons.length,
    "no override was read, so this test asserted nothing",
  ).toBeGreaterThan(0);
  for (const [id, { reason }] of reasons) {
    expect(reason, `${id} の理由`).not.toContain("意図した安全マージン");
    expect(reason, `${id} の理由`).not.toContain("下の数字とは一致しない");
    expect(reason, `${id} の理由`).not.toContain("レビュー");
  }
});

test("the caveats section says its counts come from the run", () => {
  // **以前ここは「この節は手で保守されている」を確かめていた。** その時点では
  // 本当にほとんどが手書きだった。いまは件数がすべて実データ由来で、固定なのは
  // 「1 件も踏んでいないので数える対象が無い」項目だけである
  // ——読み手に伝えるべきことが逆になったので、確かめることも入れ替える。
  const markdown = renderReport([summary()], PROVENANCE);

  expect(markdown).toContain("実データから導いている");
  // 開発の経緯や設計書の節番号を本文に残さない。
  expect(markdown).not.toContain("段階 3");
  expect(markdown).not.toContain("レビュー");
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

test("a sequence with two precedence levels in one parenthesis group needs precedence", () => {
  // 1 + 2 × 3。トップレベルの組に優先順位 1 と 2 が並ぶ。
  expect(needsPrecedence(["1", "add", "2", "mul", "3", "eq"])).toBe(true);
});

test("parentheses separate the groups, so precedence is not needed", () => {
  // (1 + 2) × 3。add は括弧の中の組、mul はトップレベルの組——別の組なので
  // 合わせて数えない(M3 rename, review round 2 — this pair happens to have
  // group and depth coincide, so the vocabulary matters more than the values).
  expect(
    needsPrecedence(["lparen", "1", "add", "2", "rparen", "mul", "3", "eq"]),
  ).toBe(false);
});

test("one operator alone never needs precedence", () => {
  expect(needsPrecedence(["1", "add", "2", "eq"])).toBe(false);
});

test("operators in different parenthesis groups at the same depth do not need precedence", () => {
  // **Regression for the depth-based bug (fix round 1).** `div` and `sub` in
  // `377 - ((553 / 982) / (189 - 996))` both sit at bracket depth 3, but in two
  // *different* groups — `(553 / 982)` and `(189 - 996)`. A depth-only rule
  // wrongly called this "needs precedence" (191 false positives measured on
  // `scientific-000.json` alone). Pull the key sequence verbatim from the real
  // shard on disk rather than hand-authoring it, so this test tracks the actual
  // case that exposed the bug rather than a stand-in for it.
  const scientific = loadShards().find(
    ({ name }) => name === "scientific-000.json",
  );
  if (scientific === undefined) {
    throw new Error("scientific-000.json is not present in corpus/generated/");
  }
  const { values } = partitionCases(scientific.name, scientific.shard.cases);
  const sci000025 = values.find((c) => c.id === "sci-000025");
  if (sci000025 === undefined) {
    throw new Error(
      "sci-000025 is not present in scientific-000.json — this test needs " +
        "that exact case (or an equivalent regression fixture) to guard the " +
        "same-depth-different-group bug",
    );
  }
  expect(sci000025.expr).toBe("(377 - ((553 / 982) / (189 - 996)))");
  expect(needsPrecedence(sci000025.keys)).toBe(false);
});

test("an unmatched rparen fails loudly instead of silently under-counting", () => {
  // **M1 (review round 2).** The original `?.`-guarded pop let an unmatched
  // `rparen` empty the stack and then silently drop every operator that
  // followed at the top level, returning `false` where the answer is
  // actually undefined for malformed input. The Python twin
  // (`_needs_precedence`) raises on the same input; this makes the TS side
  // fail loudly too, matching this project's convention of being noisy on
  // malformed input rather than quietly wrong.
  //
  // **All four malformed shapes the round-3 review probed, not just the one
  // a prior round happened to name (N4).** The topLevel/stack split fixes
  // all of them at once, but only one had a regression test.
  //
  // **These four are one guard, not four (fix round 4).** All four pin the
  // same single `throw` in `needsPrecedence`; removing it reddens all four at
  // once, and no edit reddens one alone. They are kept as *shape* coverage —
  // two of these shapes used to be silently `false` on the Python twin while
  // the other two raised, so what the extra three catch is a future rewrite
  // that reintroduces a shape-dependent path. Do not count them as
  // independent guards.
  expect(() =>
    needsPrecedence(["1", "rparen", "add", "2", "mul", "3", "eq"]),
  ).toThrow(/unmatched "rparen"/);
  expect(() => needsPrecedence(["1", "rparen", "eq"])).toThrow(
    /unmatched "rparen"/,
  );
  expect(() =>
    needsPrecedence(["lparen", "1", "add", "2", "rparen", "rparen", "eq"]),
  ).toThrow(/unmatched "rparen"/);
  expect(() =>
    needsPrecedence(["rparen", "1", "add", "2", "mul", "3", "eq"]),
  ).toThrow(/unmatched "rparen"/);
  // An unclosed `lparen` is not malformed in this sense — the open group is
  // still inspected.
  expect(needsPrecedence(["lparen", "1", "add", "2", "mul", "3", "eq"])).toBe(
    true,
  );
});

test("the report says how many cases exercised precedence", () => {
  // **N1 (review round 3): the elaboration (1101, the associativity caveat)
  // is specific to `precedence-000.json`, so the entry here must actually be
  // that shard** — a synthetic entry named e.g. `scientific-000.json` would
  // no longer render it. See the paired test below for the absence case.
  const markdown = renderReport(
    [
      summary({
        name: summaryName(PRECEDENCE_SHARD, "values"),
        precedenceCases: 1500,
      }),
    ],
    PROVENANCE,
  );
  expect(markdown).toContain("1500");
  // 踏んだことを書いても、結合方向は踏んでいないと言い続ける。
  expect(markdown).toContain("結合方向");
});

test("the precedence-specific elaboration is absent when that shard is not in the run", () => {
  // **N1 (review round 3).** The old version of this sentence rendered
  // whenever the *aggregate* precedence count was non-zero, regardless of
  // which shard(s) were actually summarised. Reproduce the reviewer's exact
  // probe: a run containing only `scientific-000.json`, with a nonzero
  // precedence count on it (as if some future non-parens-dropping shard
  // could still exercise precedence). The count itself is legitimately
  // data-derived and must still show; the `precedence-000.json`-specific
  // claims (its own total, the 1101 figure, the associativity caveat) must
  // not, because they are not true of this run.
  const markdown = renderReport(
    [
      summary({
        name: summaryName("scientific-000.json", "values"),
        precedenceCases: 7,
      }),
    ],
    PROVENANCE,
  );
  expect(markdown).toContain("7 件が踏んでいる");
  expect(markdown).not.toContain(PRECEDENCE_SHARD);
  expect(markdown).not.toContain(String(PRECEDENCE_CHANGES_MEANING));
  // **「結合方向」という語そのもので判定しない。** 段階 3b-A で `xʸ` の
  // 但し書き(「`pow` は押されるが右結合も優先順位 4 も踏んでいない」)が
  // 別の項目として入り、**この語は無関係な 2 箇所に出るようになった**。
  // ゲートされた段落に固有の言い回しで見る——ここが緩いと、優先順位
  // シャードが走行に無いのにその段落が出ていても緑になる。
  expect(markdown).not.toContain("同順位の入れ子は括弧を残して生成して");
});

test("the detection-power section is written from the argument, not from a file on disk", () => {
  // **2026-08-19 の回帰。** `renderReport` は自分で `detection-power.json` を
  // 読んでいた。変異ごとの `expect` が短い言い回し("precedence only")から
  // シャード名の列挙に変わった時点で、**測定が済んでいる作業ツリーでだけ**
  // 「優先順位シャードが走行に無い」検査が落ちるようになった——文書の中身が
  // 引数に無いものに依存していたからである。CI は `heavy:power` の直後に
  // `heavy` を回すので、これは毎回落ちる形だった。
  const measured = renderReport([summary()], PROVENANCE, [], {
    results: [
      {
        id: "precedence-collapse",
        what: "× ÷ の優先順位を + − と同じに落とす",
        expect: `${PRECEDENCE_SHARD} (values)`,
        caught: { [`${PRECEDENCE_SHARD} (values)`]: 1099 },
        total: 1099,
        ok: true,
        why: "期待したシャードだけが反応した",
      },
    ],
  });
  expect(measured).toContain(PRECEDENCE_SHARD);

  // 渡さなければ、ディスクに測定が在っても「測っていない」と書く。
  const unmeasured = renderReport([summary()], PROVENANCE);
  expect(unmeasured).toContain("測っていない");
  expect(unmeasured).not.toContain(PRECEDENCE_SHARD);
});

test("zero precedence cases reads as never touched", () => {
  // **C1 fix (review round 2).** `toContain("一度も踏んでいない")` alone was
  // satisfied by the section *heading*, which at the time literally read
  // "### まだ一度も踏んでいない領域" and rendered unconditionally regardless
  // of which branch of `parenthesisItem` ran — deleting the zero branch
  // outright still left this green. (The heading text itself has since
  // changed under N5, review round 3, for an unrelated reason — see "the
  // report lists the ground it has never touched" — but that is not what
  // makes this assertion meaningful; the fix below is.) Assert on text
  // unique to the zero branch, and assert the non-zero branch's count phrase
  // is absent.
  const markdown = renderReport([summary({ precedenceCases: 0 })], PROVENANCE);
  expect(markdown).toContain("キー列は二項演算を必ず括弧で囲む");
  expect(markdown).not.toContain("件が踏んでいる");
});

/**
 * `reference/tests/test_generate_corpus.py` が固定している「優先順位が無いと
 * 別の木になる」件数を、テストのソースそのものから読み出す。
 */
function pinnedChangesMeaning(): number {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        "../../../reference/tests/test_generate_corpus.py",
        import.meta.url,
      ),
    ),
    "utf-8",
  );
  const match = /^\s*assert changes_meaning == (\d+)\s*$/m.exec(source);
  const figure = match?.[1];
  if (figure === undefined) {
    throw new Error(
      "reference/tests/test_generate_corpus.py no longer contains an " +
        "`assert changes_meaning == <n>` line — the report's figure for how " +
        "many precedence cases change meaning is pinned to that assert, so " +
        "either restore it or move the pin somewhere this test can read",
    );
  }
  return Number(figure);
}

test("the changes-meaning figure is pinned to the number the reference test asserts", () => {
  // **F2 (fix round 4). この数字を制約しているものが一つも無かった。**
  // 1101 は報告書のいちばん具体的で強い数字なのに、`report.ts` の中に
  // 文字列リテラルとして**2 か所**書かれているだけだった。実測(review
  // round 3): 片方を 9999 に変えてもレポートのテストは **30 passed** の
  // まま。しかも round 3 が分母だけをデータ由来にしたので、シャードを
  // 再生成すると「2300 件のうち 1101 件」——別々の時代の 2 つの数字が
  // 1 つの文に並ぶ、という壊れ方に**近づいて**いた。
  //
  // ここで閉じる。描画側の複製は `PRECEDENCE_CHANGES_MEANING` 1 つに畳み、
  // その値を reference のテストの assert から実際に読み出して照合する。
  // Python 側だけを直しても、TypeScript 側だけを直しても赤くなる。
  const pinned = pinnedChangesMeaning();
  expect(PRECEDENCE_CHANGES_MEANING).toBe(pinned);

  const markdown = renderReport(
    [
      summary({
        name: summaryName(PRECEDENCE_SHARD, "values"),
        precedenceCases: 2000,
      }),
    ],
    PROVENANCE,
  );
  // 本文と但し書きの両方に出る。両方が同じ 1 つの定数から来ていること。
  expect(markdown).toContain(`無いと別の木になる件数は **${pinned} 件**`);
  expect(markdown).toContain(`> ${pinned} 件が意味を変える`);
});

test("the precedence shard's own total is read from the summary, not written in", () => {
  // **F2b (fix round 4).** Round 3 replaced a literal `2000` in this sentence
  // with `${precedenceShard.total}` — a real fix that no test could see,
  // because every fixture in this file defaults to `total: 2000`, exactly the
  // literal it replaced. Measured by the round-3 review: putting the literal
  // back left **30 passed**. Use a total that is *not* 2000, so the two are
  // distinguishable.
  const markdown = renderReport(
    [
      summary({
        name: summaryName(PRECEDENCE_SHARD, "values"),
        total: 1234,
        values: 1234,
        precedenceCases: 1234,
        relMeasured: 1234,
        bands: bands({ display: 1234 }),
      }),
    ],
    PROVENANCE,
  );
  expect(markdown).toContain(`\`${PRECEDENCE_SHARD}\` の 1234 件のうち`);
  expect(markdown).toContain(`\`${PRECEDENCE_SHARD}\` の 1234 件中`);
  // The two positive assertions above are what catch a literal, in both the
  // body and the disclaimer. (A blanket `not.toContain("2000 件中")` would
  // catch the historical adversarial-fake sentence, which legitimately names
  // the 2000 value cases of 2026-08-15.)
  expect(markdown).not.toContain("2000 件のうち");
});

test("the parenthesis item and its disclaimer never describe different things", () => {
  // **F3 (fix round 4).** The item branched on `precedence === 0`; the
  // disclaimer branched on `precedenceShard === undefined`. Three states
  // exist. In `(0, undefined)` — every run that does not include the
  // precedence shard, which is the state this project was in for its whole
  // life before this task — the item was 100% fixed prose containing no count
  // at all, while the disclaimer described it as 「見出しの件数だけの、
  // 完全にデータ由来の行である」. Both now read one `parenthesis.kind`.
  // **確かめるのは 3 状態が食い違わないことである。** 但し書きは、固定された
  // 数値(1101)を伴う段落が出る走行でだけ、その数値の出どころを言う。
  const untouched = renderReport([summary({ precedenceCases: 0 })], PROVENANCE);
  expect(untouched).toContain("キー列は二項演算を必ず括弧で囲む");
  expect(untouched).not.toContain("件が意味を変える");
  expect(untouched).not.toContain(
    "Python 側のテストが構文木で数えて固定した値",
  );

  const counted = renderReport(
    [
      summary({
        name: summaryName("scientific-000.json", "values"),
        precedenceCases: 7,
      }),
    ],
    PROVENANCE,
  );
  expect(counted).toContain("7 件が踏んでいる");
  // 内訳の元になるシャードがこの走行に無いので、固定された数値は出ない。
  expect(counted).not.toContain("件が意味を変える");
  expect(counted).not.toContain("Python 側のテストが構文木で数えて固定した値");

  const pinned = renderReport(
    [
      summary({
        name: summaryName(PRECEDENCE_SHARD, "values"),
        precedenceCases: 2000,
      }),
    ],
    PROVENANCE,
  );
  // ここでだけ、固定された数値とその出どころが両方出る。
  expect(pinned).toContain(`${PRECEDENCE_CHANGES_MEANING} 件`);
  expect(pinned).toContain("件が意味を変える");
  expect(pinned).toContain("Python 側のテストが構文木で数えて固定した値");
});

test("the qualification stays attached to the precedence claim in every branch", () => {
  // **F6 (fix round 4).** 「engine は括弧ではなく優先順位で構造を決めた」 is
  // true for all `precedence` cases, but the reader hears "these 2000 cases
  // would have been wrong without precedence" — which is true for only 1101
  // of them. Round 3's gate moved the paragraph that says so behind the
  // shard's presence, leaving the unqualified sentence standing alone in
  // every shard-absent run. The qualification now sits in the head sentence,
  // where it renders in *both* non-zero branches; only the figure is gated.
  for (const entry of [
    summary({
      name: summaryName("scientific-000.json", "values"),
      precedenceCases: 7,
    }),
    summary({
      name: summaryName(PRECEDENCE_SHARD, "values"),
      precedenceCases: 2000,
    }),
  ]) {
    const markdown = renderReport([entry], PROVENANCE);
    expect(markdown).toContain("優先順位から復元した");
    expect(markdown).toContain("「優先順位が無ければ誤答になる」件数ではない");
  }
});

test("the gate name is one the corpus actually produces", () => {
  // **F9 (fix round 4).** The gate used to compare against a hand-written
  // `"precedence-000.json (values)"`. `record()` and `expectedSummaryNames()`
  // build that string from the same `${name} (values)` template, so changing
  // the format would move those two together — `missing` stays empty,
  // `writeReport` stays silent — and only the gate would stop matching: the
  // figure paragraph would vanish from the real report while this file, which
  // builds the string itself, stayed green. All three now call `summaryName`,
  // and this asserts the gate's name is one the real corpus on disk produces.
  expect(expectedSummaryNames()).toContain(
    summaryName(PRECEDENCE_SHARD, "values"),
  );
});

test("the completeness guard covers the call shards too", () => {
  // **実在したバグ(2026-08-17)。** `expectedSummaryNames` は `loadShards()` を
  // 使っており、そちらが call シャードを除外した結果、**金融とデータスケールが
  // 「揃うはずの集計」から丸ごと外れていた**——それらのテストが走らなくても
  // 報告書は「完全である」と名乗り、判定表は「検証していない」と出て、
  // その食い違いを誰も咎めない。完全性ガードが存在する理由そのものが抜けていた。
  //
  // このテストを赤くする編集: `expectedSummaryNames` の
  // `for (const { name } of loadCallShards())` のループを消す。
  const expected = expectedSummaryNames();
  const callShards = loadCallShards();
  expect(
    callShards.length,
    "no call shard on disk — this test would pass vacuously",
  ).toBeGreaterThan(0);
  for (const { name } of callShards) {
    expect(expected).toContain(summaryName(name, "calls"));
  }
});

test("the exponent-notation count is reported, and says zero means never left the band", () => {
  // 段階 3b-A の前はこの数が 0 だった。0 と 0 でないときで文が変わる。
  const none = renderReport([summary({ exponentDisplayCases: 0 })], PROVENANCE);
  expect(none).toContain("平坦表示の帯を一度も出ていない");
  const some = renderReport(
    [summary({ exponentDisplayCases: 1940 })],
    PROVENANCE,
  );
  expect(some).toContain("1940 件が読んでいる");
  expect(some).not.toContain("平坦表示の帯を一度も出ていない");
});

test("the report says the associativity shard is exercised, and by how many cases", () => {
  // **踏んだと言い続ける。** 以前ここは「踏んでいないと言い続ける」だった
  // (`xʸ` はこのプロジェクト唯一の右結合だが、キー列が二項を必ず括弧で囲む
  // ので踏めなかった)。`associativity-000.json`(設計書 2026-08-19 §6)が
  // その否定を撤回させる——**シャードと期待とレポートの 3 つは同時に動く。**
  const markdown = renderReport(
    [
      summary({
        name: summaryName(ASSOCIATIVITY_SHARD, "values"),
        total: 2000,
      }),
    ],
    PROVENANCE,
  );
  expect(markdown).toContain("結合方向——2000 件が踏んでいる");
  expect(markdown).not.toContain("右結合も優先順位 4 も踏んでいない");
  // **優先順位 4 は撤回しない。** 連鎖は 1 本が同じ段に収まっているので、
  // `2 ^ 3 × 4` のように段をまたぐ列はこのシャードにも無い。
  expect(markdown).toContain("優先順位 4 はまだ踏んでいない");
});

test("the report keeps saying so when the associativity shard is not in the run", () => {
  // **走行に無いものを踏んだと書かない。** 件数だけを実データから出して
  // 文章を固定にすると、シャードを持たない走行(部分走行・将来の分割)で
  // 報告書が自分の走行について嘘をつく。
  const markdown = renderReport([summary()], PROVENANCE);
  expect(markdown).toContain("`xʸ` の右結合と優先順位 4");
  expect(markdown).toContain("結合方向を反転する変異で 1 件も赤くならない");
  expect(markdown).not.toContain("件が踏んでいる。優先順位 4 はまだ");
});

test("a disclosure of two cases in six thousand is not rounded away to 0.0%", () => {
  // **F11 (fix round 4).** `toFixed(1)` printed 2/6000 as "0.0%" — a
  // disclosure rounded to the same字面 as "none".
  const markdown = renderReport(
    [
      summary({
        total: 6000,
        values: 6000,
        relMeasured: 6000,
        looserThanDisplay: 2,
        bands: bands({ display: 5998, "1e-9": 2 }),
      }),
    ],
    PROVENANCE,
  );
  expect(markdown).toContain("全 6000 件中 0.033%");
  expect(markdown).not.toContain("0.0%");
});

test("the adversarial-fake measurement says when it was taken and over what", () => {
  // **F5 (fix round 4).** 「値ケースは 2000 件中 1996 件が不一致になった」 was a
  // one-off 2026-08-15 measurement rendered in the present tense, four lines
  // under a headline that now says 4000 value cases.
  const markdown = renderReport([summary()], PROVENANCE);
  expect(markdown).toContain("**当時の値ケース 2000 件中 1996 件**");
  expect(markdown).toContain("この走行で測り直した数字ではない");
});

test("the input-display caveat quotes the headline's own number", () => {
  // **F6b (fix round 4).** 「上の「4000 件通った」」 was a literal — it said
  // 4000 for a 2000-case run, and the phrase it claimed to quote never
  // appeared above (the headline now reads
  // 「外部参照——Python の独立実装と突き合わせたケース: 4000」).
  const markdown = renderReport(
    [
      summary({
        total: 1234,
        values: 1234,
        relMeasured: 1234,
        bands: bands({ display: 1234 }),
      }),
    ],
    PROVENANCE,
  );
  const headline = "外部参照——Python の独立実装と突き合わせたケース: 1234";
  expect(markdown).toContain(`**${headline}**`);
  expect(markdown).toContain(`上の「${headline}」`);
  expect(markdown).not.toContain("4000 件通った");
});

test("the injected-token share is derived from the same counts the table renders", () => {
  // **F7 (fix round 4).** 「`neg` 2122 回のうち 74.2%(1574 回)」 was hand
  // written, sat directly above the table that renders those same quantities
  // from data, and would rot on any regeneration of `equivalence-000.json`.
  const markdown = renderReport(
    [
      summary({
        name: summaryName("equivalence-000.json", "equivalences"),
        values: 0,
        equivalences: 2000,
        shape: {
          sequences: 2000,
          tokens: { neg: 10, eq: 2000, "1": 900 },
          depths: { "0": 2000 },
        },
        addedByTransform: { neg: 30 },
      }),
    ],
    PROVENANCE,
  );
  // 10 pressed on the left, 30 injected into the right, so both sides hold
  // 10 + (10 + 30) = 50 and the injected share is 30/50.
  expect(markdown).toContain(
    "この走行では左辺の `neg` が 10 回、変換が右辺に足した `neg` が 30 回。",
  );
  expect(markdown).toContain(
    "左右を合わせた 50 回のうち **60.0%** が注入分になる",
  );
  expect(markdown).not.toContain("2122");
  expect(markdown).not.toContain("74.2%");
});

test("without a detection-power measurement, the report says so plainly", () => {
  // **「測ったが 0 件」と「測っていない」を同じ見た目にしない。**
  // 黙って節を省くと、読み手は「不一致 0 件」を額面どおり受け取る。
  const markdown = renderDetectionPower(null).join("\n");
  expect(markdown).toContain("測っていない");
  expect(markdown).toContain("heavy:power");
});

test("a mutation that was expected to be caught, and was, reads as such", () => {
  const markdown = renderDetectionPower({
    results: [
      {
        id: "x",
        what: "優先順位を潰す",
        expect: "precedence only",
        caught: { "precedence-000.json": 1099 },
        total: 1099,
        ok: true,
        why: "括弧を省いたシャードだけが反応した",
      },
    ],
  }).join("\n");
  expect(markdown).toContain("1099");
  expect(markdown).toContain("期待どおり");
});

test("a mutation nothing caught is shown as a zero, not hidden", () => {
  // **0 件の行こそ載せる価値がある。** それが「この領域は踏んでいない」と
  // いう主張の裏付けだからである。省くと主張が裏付けを失う。
  const markdown = renderDetectionPower({
    results: [
      {
        id: "assoc",
        what: "結合方向を反転する",
        expect: "nothing",
        caught: {},
        total: 0,
        ok: true,
        why: "赤くならなかった",
      },
    ],
  }).join("\n");
  expect(markdown).toContain("結合方向を反転する");
  expect(markdown).toContain("**0**");
});

test("a mutation that came out against expectation is called out", () => {
  const markdown = renderDetectionPower({
    results: [
      {
        id: "assoc",
        what: "結合方向を反転する",
        expect: "nothing",
        caught: { "scientific-000.json": 5 },
        total: 5,
        ok: false,
        why: "赤くなった。レポートの「踏んでいない」が嘘である",
      },
    ],
  }).join("\n");
  expect(markdown).toContain("**期待と違う**");
});

test("the report never says a region is untouched while also counting cases in it", () => {
  // **読み手が実際に見つけた矛盾(2026-08-17)。** 動的な集計を足しながら
  // 固定文を放置したため、12 行しか離れていない場所で
  // 「指数表記を 1940 件読んだ」と「指数表記に切り替わる領域は踏んでいない」が
  // 同居していた。エラー経路と UI(別走行が 500 件を実打鍵)も同じ形だった。
  //
  // **数を報告している領域について「踏んでいない」と書かない**、を固定する。
  const markdown = renderReport(
    [
      summary({ exponentDisplayCases: 1940 }),
      summary({
        name: "finance-000.json (calls)",
        errorKinds: { SyntaxError: 270, Overflow: 91 },
      }),
    ],
    PROVENANCE,
  );
  expect(markdown).toContain("1940 件が読んでいる");
  expect(markdown).not.toContain(
    "表示が指数表記に切り替わる領域は踏んでいない",
  );
  expect(errorPathLine(markdown, "金融の `SyntaxError`")).toContain("270 件");
  expect(errorPathLine(markdown, "金融の `Overflow`")).toContain("91 件");
});

test("with nothing counted, the untouched wording comes back", () => {
  // 逆向きも固定する。**0 件のときに件数を書いてはいけない。**
  const markdown = renderReport(
    [summary({ exponentDisplayCases: 0, errorKinds: {} })],
    PROVENANCE,
  );
  expect(markdown).toContain("平坦表示の帯を一度も出ていない");
  for (const title of [
    "科学計算の定義域エラー",
    "金融の `SyntaxError`",
    "金融の `Overflow`",
    "データスケールの入力エラー",
    // **枠が 6 つ目になったので、ここも 1 行増える。** 0 件の枠が
    // 「検証していない」と書くことは、どの枠でも同じ規則である。
    "打鍵の途中の構文エラー",
  ]) {
    expect(errorPathLine(markdown, title)).toContain("1 件も検証していない");
  }
});

test("a run that counts one error path and not another says both, each on its own line", () => {
  // **枠を分けた意味は、全部 0 でも全部非 0 でも検査されない。** 0 件の枠と
  // 非 0 の枠が同時に出る走行でだけ、6 つを 1 つの数字に畳んだ実装と区別が
  // 付く——畳んだ実装は「エラー経路——7 件は照合済み」と書き、どの経路を
  // 踏んでいないのかを 1 行も持たない。
  const markdown = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        errorKinds: { SyntaxError: 7 },
      }),
      summary({ name: "data-scale-000.json (calls)", errorKinds: {} }),
    ],
    PROVENANCE,
  );
  expect(errorPathLine(markdown, "金融の `SyntaxError`")).toContain("7 件");
  for (const untouched of [
    "科学計算の定義域エラー",
    "金融の `Overflow`",
    "データスケールの入力エラー",
    "打鍵の途中の構文エラー",
  ]) {
    expect(errorPathLine(markdown, untouched)).toContain(
      "1 件も検証していない",
    );
  }
  // **一括の否定が残っていないこと。** 7 件を数えている走行で「エラー経路は
  // 生成の時点で範囲外にしている」と書けば、その場で自己矛盾する。
  expect(markdown).not.toContain("生成の時点で範囲外にしている");
  expect(markdown).not.toContain("件は照合済み");
});

test("the SyntaxError frame and the Overflow frame are not interchangeable", () => {
  // **エラーは種別で見る。** 電卓の表示はどちらも `Math ERROR` なので、
  // 種別を取り違えた集計は表示を見ても分からない。数を別々に入れて、
  // 別々の行に出ることを見る。
  const markdown = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        errorKinds: { SyntaxError: 11, Overflow: 29 },
      }),
    ],
    PROVENANCE,
  );
  const syntax = errorPathLine(markdown, "金融の `SyntaxError`");
  const overflow = errorPathLine(markdown, "金融の `Overflow`");
  expect(syntax).toContain("11 件");
  expect(syntax).not.toContain("29");
  expect(overflow).toContain("29 件");
  expect(overflow).not.toContain("11");
});

test("an error expectation that fits none of the six frames is named, not folded into one", () => {
  // **既定の枠へ落とすと、新しい経路の件数が既存の枠に加算されて見えなく
  // なる。** 落とさずに数え上げ、名前と件数を本文に出す。
  //
  // **見本は `display-000.json` に変えた。** 以前ここは `entry-000.json`
  // だったが、そのシャードは「打鍵の途中の構文エラー」の枠を持つように
  // なったので、番兵の見本にならない。`display-` は確定した値をトグルで
  // 見せ直すシャードで、エラー期待値を持てばどの枠にも入らない——番兵が
  // 見張るのは**まさにこれから生えてくる経路**である。
  const entries = [
    summary({
      name: "display-000.json (displays)",
      errorKinds: { SyntaxError: 1 },
    }),
  ];
  const paths = errorPaths(entries);
  expect(paths.frames.every((frame) => frame.cases === 0)).toBe(true);
  expect(paths.unclassified).toEqual([
    { shard: "display-000.json (displays)", kind: "SyntaxError", cases: 1 },
  ]);
  const markdown = renderReport(entries, PROVENANCE);
  expect(markdown).toContain("上のどの経路にも入らないものが 1 件ある");
  expect(markdown).toContain(
    "`display-000.json (displays)` の `SyntaxError` 1 件",
  );
});

test("the entry shard has a frame of its own, and it is not the display frame", () => {
  // **打鍵の途中で構文が壊れる経路は、名前のある枠である。** 件数 1 でも、
  // 名前のある 1 は番兵の中の 1 より読者に多くを語る——番兵は「どこにも
  // 入らなかった」としか言えず、何が起きた入力なのかを言えない。
  //
  // **枠はシャード名で選ぶ。** `entry-000.json` の領域は `display` なので、
  // 領域で選ぶと `display-000.json` と同じ枠に落ちる。落ちれば「確定した
  // 表示のエラー」と「確定に届かなかった打鍵」が 1 つの数字になる。
  expect(areaOfShard(ENTRY_SHARD)).toBe("display");
  const entries = [
    summary({
      name: summaryName(ENTRY_SHARD, "displays"),
      errorKinds: { SyntaxError: 1 },
    }),
    summary({
      name: "display-000.json (displays)",
      errorKinds: { SyntaxError: 4 },
    }),
  ];
  const paths = errorPaths(entries);
  expect(paths.frames.find((frame) => frame.id === "entry-syntax")?.cases).toBe(
    1,
  );
  // **`display-000.json` の 4 件が枠へ混ざっていないこと。** 混ざれば枠は
  // 5 件になり、番兵は空になる。
  expect(paths.unclassified).toEqual([
    { shard: "display-000.json (displays)", kind: "SyntaxError", cases: 4 },
  ]);
  const markdown = renderReport(entries, PROVENANCE);
  expect(errorPathLine(markdown, "打鍵の途中の構文エラー")).toContain("1 件");
  expect(markdown).toContain("エラーは確定の前に出る");
});

test("the scientific domain frame is fed by the errors shard, whose area is not scientific", () => {
  // **エラー経路の軸と `AREAS` の軸は一致しない。** `errors-000.json` は
  // 表示文字列を比べるシャードなので領域は `display` である。領域で枠を
  // 選ぶと、科学計算の定義域エラーの枠は**どんな走行でも 0 件**になり、
  // 「この走行は 1 件も検証していない」と書き続ける。
  expect(areaOfShard(ERRORS_SHARD)).toBe("display");
  const entries = [
    summary({
      name: summaryName(ERRORS_SHARD, "displays"),
      errorKinds: { DomainError: 17, TrigPole: 3 },
    }),
  ];
  const paths = errorPaths(entries);
  expect(
    paths.frames.find((frame) => frame.id === "scientific-domain")?.cases,
  ).toBe(20);
  expect(paths.unclassified).toEqual([]);
  const markdown = renderReport(entries, PROVENANCE);
  expect(errorPathLine(markdown, "科学計算の定義域エラー")).toContain("20 件");
  expect(markdown).toContain("`DomainError` 17 件");
});

test("the sixth frame watches the run itself, and an unreadable summary is not a clean one", () => {
  // **最後の枠だけ出どころの種類が違う。** シャードの集計ではなく、走行
  // そのものの要約(`heavy-run.json`)を読む。ビルドが落ちても、集計が
  // ディスクに届かなくても、電卓の不一致は 0 件になる。
  const clean: HeavyRun = {
    schema: 1,
    ranTests: true,
    expected: ["scientific-000.json (values)"],
    shards: [
      { name: "scientific-000.json (values)", total: 2000, mismatches: 0 },
    ],
  };
  expect(runHealth(clean)).toEqual({ state: "clean" });
  expect(runHealth(null)).toEqual({ state: "unreadable" });
  expect(runHealth({ ...clean, ranTests: false }).state).toBe("failed");

  const lost: HeavyRun = { ...clean, shards: [] };
  const failed = renderReport([summary()], PROVENANCE, [], null, lost);
  expect(errorPathLine(failed, "走行そのものの失敗")).toContain("1 件");
  expect(failed).toContain(
    "`scientific-000.json (values)` の集計がディスクに届かなかった",
  );

  const ok = renderReport([summary()], PROVENANCE, [], null, clean);
  expect(errorPathLine(ok, "走行そのものの失敗")).toContain("0 件");

  // **読めない要約を「失敗が無かった」と書かない。**
  const unknown = renderReport([summary()], PROVENANCE);
  expect(errorPathLine(unknown, "走行そのものの失敗")).toContain(
    "読めていない",
  );
  expect(errorPathLine(unknown, "走行そのものの失敗")).not.toContain("0 件");
});

test("every error expectation in the committed corpus lands in one of the six frames", () => {
  // **枠 6 つ + 番兵 = 総数、そして番兵は 0。** 実物のコーパスが持つエラー
  // 期待値は、名前のある 6 つの枠のどれかに入る。見本ではなく実物で見る。
  //
  // **番兵が 0 でも消さない。** 枠の集合が完全であることは証明できない
  // ——いまのコーパスで空だというだけである。0 を固定するのは、新しい経路が
  // 生えた日にここが赤くなるためである。
  const entries = [
    ...loadCallShards().map(({ name, shard }) =>
      summary({
        name: summaryName(name, "calls"),
        errorKinds: kindsOf(shard.cases),
      }),
    ),
    ...loadDisplayShards().map(({ name, shard }) =>
      summary({
        name: summaryName(name, "displays"),
        errorKinds: kindsOf(shard.cases),
      }),
    ),
  ];
  const total = entries.reduce((sum, entry) => sum + errorCaseCount(entry), 0);
  expect(
    total,
    "コーパスがエラー期待値を 1 件も持っていないなら、このテストは何も比べていない",
  ).toBeGreaterThan(300);

  const paths = errorPaths(entries);
  const framed = paths.frames.reduce((sum, frame) => sum + frame.cases, 0);
  const named = paths.unclassified.reduce((sum, one) => sum + one.cases, 0);
  expect(framed + named, "枠にも番兵にも入らないエラー期待値がある").toBe(
    total,
  );

  // **番兵は 0 である。** どこにも入らないエラー期待値がコーパスに在れば、
  // ここが名前ごと印字して落ちる。**0 を主張する検査は、何も見ていなくても
  // 緑になる常連である**——だから下の 2 つと組にする。上の等式が総数を
  // 覆っていること、下の走査が 6 つの枠すべてに実物が流れていることが、
  // この 0 が「枠が実物と繋がった結果の 0」であることを支えている。
  expect(
    paths.unclassified,
    "どの枠にも入らないエラー期待値が在る——枠を足すか、番兵の理由を書く",
  ).toEqual([]);

  for (const id of [
    "scientific-domain",
    "finance-syntax",
    "finance-overflow",
    "data-scale-input",
    "entry-syntax",
  ] as ErrorPathId[]) {
    expect(
      paths.frames.find((frame) => frame.id === id)?.cases ?? 0,
      `${id} の枠がこのコーパスで 0 件——枠が実物と繋がっていない`,
    ).toBeGreaterThan(0);
  }

  // **枠は 6 つ、番兵は本文に出ていない。** エラー期待値の枠 5 つに、
  // 走行そのものの失敗を見る枠を足して 6 つ。数だけでなく本文に 6 本の
  // 見出しが立っていることを見る——枠を足して描き忘れた実装は、上の
  // 算術だけなら緑で通る。
  const markdown = renderReport(entries, PROVENANCE);
  for (const title of [
    "科学計算の定義域エラー",
    "金融の `SyntaxError`",
    "金融の `Overflow`",
    "データスケールの入力エラー",
    "打鍵の途中の構文エラー",
    "走行そのものの失敗",
  ]) {
    expect(errorPathLine(markdown, title)).toContain("——");
  }
  expect(markdown).toContain("エラー経路——6 つに分けて数える");
  expect(markdown).not.toContain("上のどの経路にも入らないものが");
});

test("the in-progress display item is counted from the corpus, not written by hand", () => {
  // **この項目は手書きの否定だった。** 「全ケースが `=` で終わるので、確定した
  // 値の表示しか踏んでいない」——`entry-000.json`(打鍵の途中の表示)が入った
  // 日に**両方の半分**が偽になり、走行のたびに嘘を印字していた。いまは走行が
  // 数える。**見本ではなく実物のコーパスで見る。**
  //
  // 数える基準は**末尾のキーではなく `=` の有無**である。`=` を押して値を
  // 確定させてから `ENG`/`°'\"` を押して終わるキー列がコーパスに 3 千本余り
  // あり、そちらが読んでいるのは確定した値の表示だから結論には反しない。
  // 末尾で数える実装に変えると、下の内訳がその 3 千本を拾って赤くなる。
  const entries = [
    ...loadShards().flatMap(({ name, shard }) => {
      const { values, equivalences } = partitionCases(name, shard.cases);
      return [
        ...(values.length > 0
          ? [
              summary({
                name: summaryName(name, "values"),
                sequencesWithoutEq: countSequencesWithoutEq(
                  values.map((c) => c.keys),
                ),
              }),
            ]
          : []),
        ...(equivalences.length > 0
          ? [
              summary({
                name: summaryName(name, "equivalences"),
                sequencesWithoutEq: countSequencesWithoutEq(
                  equivalences.map((c) => c.left),
                ),
              }),
            ]
          : []),
      ];
    }),
    ...loadDisplayShards().map(({ name, shard }) =>
      summary({
        name: summaryName(name, "displays"),
        sequencesWithoutEq: countSequencesWithoutEq(
          displaySequences(shard.cases),
        ),
      }),
    ),
    ...loadCallShards().map(({ name }) =>
      summary({ name: summaryName(name, "calls"), sequencesWithoutEq: 0 }),
    ),
  ];

  const withoutEq = entries.reduce((sum, e) => sum + e.sequencesWithoutEq, 0);
  // **番兵。** 1 本も無ければ項目は「踏んでいない」側の固定文になり、この
  // テストは何も見ていない。
  expect(
    withoutEq,
    "コーパスに `=` を押さないキー列が 1 本も無い——この検査は何も見ていない",
  ).toBeGreaterThan(0);

  // **実測を焼き付ける。** ここが動いたら、まず直すのはこの数字ではなく
  // 報告書が外の読み手に対してしている主張のほうである。
  const byShard = Object.fromEntries(
    entries
      .filter((e) => e.sequencesWithoutEq > 0)
      .map((e) => [e.name, e.sequencesWithoutEq]),
  );
  expect(byShard).toEqual({
    // 打鍵の途中の表示。全 36 件が `=` に届かない。
    "entry-000.json (displays)": 36,
    // 単項関数が `=` を待たずにその場で撥ねるケース(`0 recip` / `0 ln` など)。
    "errors-000.json (displays)": 19,
  });

  const markdown = renderReport(entries, PROVENANCE);
  // **行を 1 本だけ取り出して主張する。** 「どこかに数字が書いてある」検査は、
  // 項目を畳んだ実装でも緑になる。
  const line = onlyLine(markdown, "入力中の表示");
  expect(line).toContain(`${withoutEq} 本のキー列が`);
  expect(line).not.toContain("全ケースが");
  expect(line).not.toContain("踏んでいない");
  expect(markdown).toContain("`entry-000` 36 本・`errors-000` 19 本");
  // **数がある項目は但し書きの一覧から外れる**——項目と一覧は同じ述語から出る。
  expect(disclaimerOf(markdown)).not.toContain("入力中の表示");

  // **逆向きも見る。** `=` を押さない列が 1 本も無い走行では、項目は否定に
  // 戻り、一覧にも載る。入力を変えて出力が変わらないなら、この項目は
  // データ由来ではない。
  const allConfirmed = renderReport([summary()], PROVENANCE);
  expect(onlyLine(allConfirmed, "- **入力中の表示。**")).toContain(
    "どれも `=` を押しているので",
  );
  expect(onlyLine(allConfirmed, "確定した値の表示しか")).toContain(
    "踏んでいない",
  );
  expect(disclaimerOf(allConfirmed)).toContain("入力中の表示");
});

test("the hand-maintained disclaimer lists only the items that really are fixed", () => {
  // 但し書き自身が腐っていた——「エラー経路・指数表記…は完全に固定の文章」と
  // 書いてあったが、その 2 つはデータ由来になっていた。
  //
  // **そして、それを見張っていたはずのこのテスト自身も腐っていた。**
  // 以前ここは `toContain("複素数・角度モード・UI・入力中の表示")` の 1 行で、
  // **但し書きに書いてある文字列が但し書きに書いてあること**しか確かめて
  // いなかった。段階 H が `angle_toggle` を 2000 本のキー列で押し、
  // 段階 I が `eng`/`dms` を押しても、この行は緑のままだった——項目の側は
  // データ由来に切り替わっているのに、但し書きは「角度モードは完全に固定の
  // 文章」と言い続けていた(2026-08-17)。
  //
  // いまは**入力を変えて、出力が変わることを見る**。押した集計を持つ走行と
  // 持たない走行で、但し書きの一覧が動かなければ嘘である。
  const untouched = renderReport([summary()], PROVENANCE);

  expect(disclaimerOf(untouched)).toContain("角度モード");
  expect(disclaimerOf(untouched)).toContain("表示の記法");

  const pressed = summary();
  pressed.shape = {
    ...pressed.shape,
    tokens: { ...pressed.shape.tokens, angle_toggle: 7, eng: 3, dms: 4 },
  };
  const touched = renderReport([pressed], PROVENANCE);
  // 踏んだ走行では、その 2 項目は「完全に固定」の一覧から外れる。
  expect(disclaimerOf(touched)).not.toContain("角度モード");
  expect(disclaimerOf(touched)).not.toContain("表示の記法");
  // 外れたぶん、一覧は短くなる(数え上げも同じ述語から出ている)。
  expect(disclaimerOf(touched)).toContain(
    "エラー経路・複素数・結合方向・UI・入力中の表示の 5 行",
  );
  expect(disclaimerOf(untouched)).toContain(
    "エラー経路・複素数・角度モード・表示の記法・結合方向・UI・入力中の表示の 7 行",
  );

  // **エラー経路も同じ形である。** 6 つの枠のどれか 1 つでも数を出していれば、
  // その行はデータ由来になるので一覧から外れる。以前この項目は一覧に一度も
  // 載らず、枠すべてが空の走行で数え落としになっていた。
  const withErrors = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        errorKinds: { SyntaxError: 3 },
      }),
    ],
    PROVENANCE,
  );
  expect(disclaimerOf(withErrors)).not.toContain("エラー経路");
});

test("the angle-mode and notation items say what the run actually pressed", () => {
  // **項目の側も、押した集計から出ていること。** 但し書きだけを直しても、
  // 本文が「一度も押していない」と言い続けたら矛盾は残る(読み手が実際に
  // 指摘したのはこの形の矛盾である)。
  const untouched = renderReport([summary()], PROVENANCE);
  expect(untouched).toContain("`angle_toggle` を一度も");
  expect(untouched).toContain("`ENG` も `°'\"` も一度も押していない");

  const pressed = summary();
  pressed.shape = {
    ...pressed.shape,
    tokens: { ...pressed.shape.tokens, angle_toggle: 7, eng: 3, dms: 4 },
  };
  const touched = renderReport([pressed], PROVENANCE);
  expect(touched).toContain("7 本のキー列が `angle_toggle` を押している");
  // eng と dms は合算して数える(どちらも「値を変えない表示のキー」である)。
  expect(touched).toContain("7 本のキー列が `ENG` か `°'\"` を押している");
  expect(touched).not.toContain("`angle_toggle` を一度も");
});

test("an area with no cases is never called correct", () => {
  // **これが判定でいちばん重い嘘になりうる。** 3 領域のうち 2 領域が
  // 現に 0 件なので、0 件が「完全に正しい」に落ちると報告書が破綻する。
  //
  // このテストを赤くする編集: verdictOf の `caseCount === 0` の枝を消す
  // (誤差 0 として扱われ「完全に正しい」になる)。
  expect(verdictOf(0, 0, 0)).toBe("検証していない");
});

test("the verdict ladder cuts where the display cuts", () => {
  // 表示は有効数字 10 桁なので、境界は 5e-10。
  expect(verdictOf(100, 0, 0)).toBe("完全に正しい");
  expect(verdictOf(100, 5e-10, 0)).toBe("完全に正しい");
  // f64 由来のずれ。**警告であって不合格ではない**(ユーザ裁定 2026-08-16)。
  expect(verdictOf(100, 1.34e-9, 0)).toBe("ある程度正しい");
  expect(verdictOf(100, 9.9e-7, 0)).toBe("ある程度正しい");
  // 有効数字の上位が違う。
  expect(verdictOf(100, 1e-6, 0)).toBe("多少疑問がある");
  expect(verdictOf(100, 0.5, 0)).toBe("多少疑問がある");
  // 桁が違う。
  expect(verdictOf(100, 1, 0)).toBe("間違っている");
  expect(verdictOf(100, 1e6, 0)).toBe("間違っている");
});

test("a structural failure outweighs a small numeric error", () => {
  // 不一致が 1 件でもあれば、誤差がいくら小さくても「間違っている」。
  // 有限の答があるのに inf/NaN/エラーになった場合がこれに当たる。
  //
  // このテストを赤くする編集: verdictOf の structuralFailures の条件を外す。
  expect(verdictOf(100, 0, 1)).toBe("間違っている");
});

test("a shard whose area is unknown is refused instead of guessed", () => {
  // **黙って scientific に落とすと、新しい領域の結果が科学計算の判定に
  // 混ざって見えなくなる。**
  expect(areaOfShard("scientific-000.json")).toBe("scientific");
  expect(areaOfShard("combinatorics-000.json")).toBe("scientific");
  expect(areaOfShard("finance-000.json")).toBe("finance");
  expect(areaOfShard("data-scale-000.json")).toBe("data_scale");
  expect(() => areaOfShard("something-new-000.json")).toThrow();
});

test("the verdict table names every area, including the untested ones", () => {
  const markdown = renderReport(
    [summary({ name: "scientific-000.json" })],
    PROVENANCE,
  );
  expect(markdown).toContain("scientific");
  // **試していない領域を表から省かない。** 省くと「載っている領域が全部」に見える。
  expect(markdown).toContain("data_scale");
  expect(markdown).toContain("finance");
  expect(markdown).toContain("検証していない");
});

function recorded(
  name: string,
  total: number,
  mismatches: number,
): RecordedShard {
  return {
    summary: summary({
      name,
      total,
      mismatches: Array.from({ length: mismatches }, (_, i) => `${name}#${i}`),
    }),
    runtime: { coreVersion: "0.2.1", browser: "chromium" },
  };
}

test("the run summary carries every shard that ran, including the quiet ones", () => {
  // **不一致 0 のシャードも載る。** ここが載らないと「0 件」と「走らなかった」が
  // 区別できず、欠陥注入の判定が「ビルド失敗」を「検出なし」と呼ぶ。
  const run = buildRun(
    [
      recorded("a-000.json (values)", 2000, 0),
      recorded("b-000.json (values)", 2000, 7),
    ],
    ["a-000.json (values)", "b-000.json (values)"],
  );
  expect(run.ranTests).toBe(true);
  expect(run.shards).toEqual([
    { name: "a-000.json (values)", total: 2000, mismatches: 0 },
    { name: "b-000.json (values)", total: 2000, mismatches: 7 },
  ]);
  expect(run.expected).toEqual(["a-000.json (values)", "b-000.json (values)"]);
});

test("a run where nothing was recorded says so instead of looking empty and calm", () => {
  const run = buildRun([], ["a-000.json (values)"]);
  expect(run.ranTests).toBe(false);
  expect(run.shards).toEqual([]);
  // **期待は残る。** 何が居るはずだったかを、走らなかった走行こそが持っている。
  expect(run.expected).toEqual(["a-000.json (values)"]);
});

/**
 * `docs/corpus-measurements.md` の「Heavy の逆算証明書」節から、実測された
 * 数を読み出す。**報告書に手で書いた数は、一次資料に釘で留める**
 * (`PRECEDENCE_CHANGES_MEANING` と同じ仕掛け)。
 */
function measurementsDoc(): string {
  return readFileSync(
    fileURLToPath(
      new URL("../../../docs/corpus-measurements.md", import.meta.url),
    ),
    "utf-8",
  );
}

test("the certificate figures in the report are pinned to the measurement they came from", () => {
  const doc = measurementsDoc();
  // 「対象件数と、実際に発行した wasm 呼び出し回数(実測)」の表の合計行。
  const totals = /^\| 合計 \| [\d,]+ \| [\d,]+ \| ([\d,]+) \|$/m.exec(doc);
  const probes = totals?.[1];
  if (probes === undefined) {
    throw new Error(
      "docs/corpus-measurements.md no longer has the certificate probe table's " +
        "total row — the report's probe count has lost its primary source",
    );
  }
  expect(Number(probes.replace(/,/g, ""))).toBe(CERTIFICATE_PROBES);

  const broken = /合わせて (\d+) 個のプローブが赤くなった/.exec(doc);
  const count = broken?.[1];
  if (count === undefined) {
    throw new Error(
      "docs/corpus-measurements.md no longer records how many probes the " +
        "`tax-combined-rate` mutation broke — the report's example has lost " +
        "its primary source",
    );
  }
  expect(Number(count)).toBe(CERTIFICATE_PROBES_BROKEN_BY_TAX_MUTATION);
});

test("the detection-power table says the certificates are not in its counts", () => {
  // **検出数を「コーパスが見つけた件数」として出す以上、そこに含まれない
  // ものは名指しで書く。** 証明書(`certificates.ts`)は `record()` を呼ばない
  // ので、その失敗は `mismatchesByShard` にも `detection-power.json` にも
  // 現れない——**見逃しではなく過小計上**である。
  const power: DetectionPower = {
    results: [
      {
        id: "tax-combined-rate",
        what: "国税・地方税を合計 20.315% の一括計算にする",
        expect: "finance-000.json (calls)",
        caught: { "finance-000.json (calls)": 406 },
        total: 406,
        ok: true,
        why: "期待どおり",
      },
    ],
  };
  const markdown = renderDetectionPower(power).join("\n");
  // **本数と名前はコードから出ていること。** 手で「4 本」と書いた報告書は、
  // 5 本目を足した日に静かに古くなる。
  expect(markdown).toContain(`逆算の境界証明書 ${CERTIFICATES.length} 本`);
  expect(CERTIFICATES.length).toBeGreaterThan(0);
  for (const { op } of CERTIFICATES) {
    expect(markdown).toContain(`\`${op}\``);
  }
  expect(markdown).toContain(
    `${CERTIFICATE_PROBES.toLocaleString("en-US")} プローブ`,
  );
  expect(markdown).toContain(
    `${CERTIFICATE_PROBES_BROKEN_BY_TAX_MUTATION} プローブ落ちている`,
  );
  // **「見逃し」と読ませない。**
  expect(markdown).toContain("過小計上");
  expect(markdown).toContain("`record()` を呼ばない");
});

test("the finance shard is broken down by op, kind and stratum, not left as one number", () => {
  // **実物のコーパスで見る。** シャード別の表は `finance-000.json (calls)` を
  // 「3500」の 1 行に畳むので、それだけでは 3500 回の正常な金融計算に見える。
  const shards = loadCallShards();
  const entries = shards.map(({ name, shard }) =>
    summary({
      name: summaryName(name, "calls"),
      total: shard.cases.length,
      values: shard.cases.length,
      callBreakdown: summarizeCallShard(shard),
    }),
  );
  const finance = entries.find((e) => e.name === "finance-000.json (calls)");
  if (finance?.callBreakdown === undefined) {
    throw new Error("finance-000.json is not among the call shards");
  }
  const { byOp, byStratum, gaveUp } = finance.callBreakdown;

  // **番兵。** op が 0 個・層が 0 個なら、下の走査は 0 周で緑になる。
  expect(Object.keys(byOp).length, "op が 1 つも無い").toBeGreaterThan(0);
  expect(Object.keys(byStratum).length, "層が 1 つも無い").toBeGreaterThan(0);

  // **実測を焼き付ける(2026-08-20、2026-08-29 に更新)。** 3500 件の内訳が
  // 動いたら、報告書が外の読み手にしている主張のほうを先に見直すこと。
  //
  // **2026-08-29(空間モデル Task 5・6)で動いた。** `loan_term` の 7 行が
  // 構成できずコーパスから出て、`compound_deposit_for` の 11 行が救われた
  // ——**総数は 3500 のまま**で、乱択の尾が差を吸収している。
  // **正常が 11 件増え、SyntaxError が 11 件減った。** 消えた 11 件は 1 件
  // 残らず `loan_term` で、**エラーは逆算側**である(この op は月額から期間を
  // 求めるので、`expect.error` は逆算の結果)。内訳は **7 件が `target_n=1201`**
  // (**正算は通っている**——月額が作れているのがその証拠。逆算が 1201 を
  // 返せないだけ)と、**4 件が `target_n=1200`**(逆算がエラーだった行が
  // 月額 +1 円の構成行に置き換わった)。詳しくは `docs/corpus-measurements.md`。
  // **エラー経路の件数が減った**ことは、`docs/corpus-measurements.md` に
  // 記録する(検出力の測定とは別の量である)。
  const totals: Record<string, number> = {};
  for (const counts of Object.values(byOp)) {
    for (const [kind, n] of Object.entries(counts)) {
      totals[kind] = (totals[kind] ?? 0) + n;
    }
  }
  expect(totals).toEqual({ ok: 3150, SyntaxError: 259, Overflow: 91 });
  expect(
    Object.fromEntries(
      Object.entries(byOp).map(([op, counts]) => [
        op,
        Object.values(counts).reduce((sum, n) => sum + n, 0),
      ]),
    ),
  ).toEqual({
    loan_forward: 599,
    loan_bonus_forward: 456,
    compound_grow: 437,
    loan_principal: 432,
    compound_deposit_for: 431,
    loan_term: 418,
    loan_bonus_principal: 412,
    compound_periods_for: 315,
  });
  // **`rejections` はシャードが持っている。走行は読むだけである。**
  expect(gaveUp).toEqual({
    dup: 0,
    reasons: {
      compound_deposit_search_limit: 0,
      near_yen_boundary: 7,
      other: 0,
    },
  });

  const markdown = renderReport(entries, PROVENANCE);
  // **行を 1 本だけ取り出して主張する(Task 7 の実測)。** 「どこかに 270 と
  // 書いてある」検査は、枠を畳んだ実装でも緑になる。
  expect(onlyLine(markdown, "3500 件のうち")).toContain(
    "3150 件が正常で、350 件",
  );
  // **needle に件数を含める(2026-08-29)。** 空間モデルの網羅表が同じ op 名を
  // 先頭列に持つので、`| \`loan_bonus_forward\` |` だけでは 2 本に当たる
  // ——**主張は行の全体一致のままで、探す手がかりだけを狭めた。**
  expect(onlyLine(markdown, "| `loan_bonus_forward` | 456 |")).toBe(
    "| `loan_bonus_forward` | 456 | 301 | 0 | 155 |",
  );
  expect(onlyLine(markdown, "| **合計** | **3500** |")).toBe(
    "| **合計** | **3500** | **3150** | **91** | **259** |",
  );
  expect(onlyLine(markdown, "の層から引かれている")).toContain(
    "3500 件は 1191 の層から引かれている",
  );
  expect(onlyLine(markdown, "- `near_yen_boundary`:")).toBe(
    "- `near_yen_boundary`: 7",
  );
  // **その 3500 が全部正常な計算だとは読ませない。**
  expect(markdown).toContain("電卓が計算を拒むことを期待値として");
});

test("a call shard that declares no rejections is not reported as zero rejections", () => {
  // **`null` は「宣言していない」であって「0 件捨てた」ではない。**
  // 実物の `data-scale-000.json` が `rejections` を持たない。
  const shard = loadCallShards().find(
    ({ name }) => name === "data-scale-000.json",
  );
  if (shard === undefined) {
    throw new Error("data-scale-000.json is not among the call shards");
  }
  expect(summarizeCallShard(shard.shard).gaveUp).toBeNull();

  const markdown = renderReport(
    [
      summary({
        name: summaryName(shard.name, "calls"),
        callBreakdown: summarizeCallShard(shard.shard),
      }),
    ],
    PROVENANCE,
  );
  expect(onlyLine(markdown, "棄却の数(`rejections`)")).toContain(
    "宣言していない",
  );
  expect(markdown).toContain("0 件だったという意味");
  // 層を持たないことも、0 層と書かずに名指しする。
  expect(onlyLine(markdown, "層の宣言を持たない")).toContain(
    "どの境界から引かれたか",
  );
});

test("an error kind the design did not name gets a column of its own", () => {
  // **設計書の 3 欄(`ok` / `SyntaxError` / `Overflow`)に閉じない。** 閉じると、
  // 金融に 4 つ目の種別が入った日にその件数がどの欄にも入らず**黙って消える**。
  const markdown = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        total: 5,
        values: 5,
        callBreakdown: {
          byOp: { loan_forward: { ok: 2, DivisionByZero: 3 } },
          byStratum: {},
          gaveUp: null,
          coverage: null,
        },
      }),
    ],
    PROVENANCE,
  );
  expect(onlyLine(markdown, "| `loan_forward` |")).toBe(
    "| `loan_forward` | 5 | 2 | 3 |",
  );
  expect(onlyLine(markdown, "| op | 総数 |")).toContain("`DivisionByZero`");
  expect(onlyLine(markdown, "5 件のうち")).toContain("2 件が正常で、3 件");
});

test("a run with no call shard has no call breakdown section at all", () => {
  // **空の表を出さない。** 「op が 1 つも無い」と「記録し損ねた」が同じ
  // 見た目になる。
  expect(renderReport([summary()], PROVENANCE)).not.toContain(
    "## 関数呼び出しの内訳",
  );
  expect(renderCallBreakdowns([summary()])).toEqual([]);
});

/**
 * 実物のコーパスから、素性(`generated_by`)を持ったままの集計を組み立てる。
 *
 * **素性を見本の `mpmath 1.3.0 …` で埋めない。** 検証の強さの枠を決めて
 * いるのは素性そのものなので、埋めた瞬間に全シャードが「外部参照」に落ち、
 * この検査は何も見なくなる。
 */
function realSummaries(): ShardSummary[] {
  return [
    ...loadShards().flatMap(({ name, shard }) => {
      const { values, equivalences } = partitionCases(name, shard.cases);
      return [
        ...(values.length > 0
          ? [
              summary({
                name: summaryName(name, "values"),
                total: shard.cases.length,
                values: values.length,
                equivalences: 0,
                generatedBy: shard.generated_by,
              }),
            ]
          : []),
        ...(equivalences.length > 0
          ? [
              summary({
                name: summaryName(name, "equivalences"),
                total: shard.cases.length,
                values: 0,
                equivalences: equivalences.length,
                generatedBy: shard.generated_by,
              }),
            ]
          : []),
      ];
    }),
    ...loadDisplayShards().map(({ name, shard }) => {
      const displays = shard.cases.filter((c) => c.kind === "display").length;
      return summary({
        name: summaryName(name, "displays"),
        total: shard.cases.length,
        values: displays,
        equivalences: shard.cases.length - displays,
        generatedBy: shard.generated_by,
      });
    }),
    ...loadCallShards().map(({ name, shard }) =>
      summary({
        name: summaryName(name, "calls"),
        total: shard.cases.length,
        values: shard.cases.length,
        equivalences: 0,
        generatedBy: shard.generated_by,
      }),
    ),
  ];
}

test("the entry shard is counted as a spec transcription, never as an outside reference", () => {
  // **これがこの節の主眼である(設計書 §8.3)。** `entry-000.json` の期待値は
  // Python が独立に計算したものではなく、電卓の仕様書
  // (`engine_table.rs` / `state.rs`)から起こした写しである。1 枠目に混ぜると
  // 「Python の独立実装と突き合わせた件数」が 36 件ぶん水増しされ、しかも
  // それを見ているものが何も無い——**静かに増えるだけになる。**
  //
  // **見本ではなく実物のコーパスの素性で見る。**
  const entries = realSummaries();
  expect(
    entries.length,
    "コーパスから 1 枚も読めなかった——この検査は何も見ていない",
  ).toBeGreaterThan(0);

  const frames = verificationFrames(entries);
  expect(frames.map((f) => f.id)).toEqual([
    "external",
    "self-equivalence",
    "spec-transcription",
  ]);
  const external = verificationFrameOf(frames, "external");
  const transcription = verificationFrameOf(frames, "spec-transcription");

  // **3 枠目に居るのは打鍵の途中の表示だけである。** 名前で選んでいるのでは
  // なく素性で選んでいるので、ここが増えたら素性が増えたということ。
  expect(transcription.shards).toEqual([summaryName(ENTRY_SHARD, "displays")]);
  expect(transcription.cases).toBe(36);

  // **1 枠目に混ざっていない。** シャードの名前としても、件数としても。
  expect(external.shards).not.toContain(summaryName(ENTRY_SHARD, "displays"));
  const allValues = entries.reduce((sum, e) => sum + e.values, 0);
  expect(external.cases).toBe(allValues - transcription.cases);
  expect(
    external.cases,
    "外部参照の枠が空——この検査は 1 枠目について何も見ていない",
  ).toBeGreaterThan(0);

  // **行を 1 本だけ取り出して主張する。** 「どこかに 36 と書いてある」検査は、
  // 3 枠を 1 つに畳んだ実装でも緑になる。
  const markdown = renderReport(entries, PROVENANCE);
  expect(
    onlyLine(markdown, "- **外部参照——Python の独立実装と突き合わせたケース"),
  ).toContain(`: ${external.cases}**`);
  expect(
    onlyLine(markdown, "- **仕様書からの写し——電卓の仕様書から起こした期待値"),
  ).toContain(`: ${transcription.cases}**`);
  // 畳んだ数字がどこにも出ていないこと。
  expect(markdown).not.toContain(
    `外部参照——Python の独立実装と突き合わせたケース: ${allValues}`,
  );
});

test("no other shard claims to be a spec transcription", () => {
  // **番兵。** 枠を決めているのは素性の中の 1 語なので、その語が別のシャードの
  // 素性に紛れ込めば、外部参照が静かに写しの枠へ落ちる。**`errors-000.json` は
  // 実際に危ない**——その素性は「`engine_table.rs` / `state.rs` /
  // `expr/parse.rs` を**見ずに**数学だけから決めた」と書いており、ファイル名で
  // 選ぶ実装ならここで写しの枠に落ちる。落ちても件数の合計は変わらないので、
  // 表を読まない限り誰も気付かない。
  const pedigrees = [
    ...loadShards().map(({ name, shard }) => [name, shard.generated_by]),
    ...loadDisplayShards().map(({ name, shard }) => [name, shard.generated_by]),
    ...loadCallShards().map(({ name, shard }) => [name, shard.generated_by]),
  ] as [string, string][];
  expect(
    pedigrees.length,
    "コーパスから 1 枚も読めなかった——この検査は何も見ていない",
  ).toBeGreaterThan(1);

  const transcriptions = pedigrees
    .filter(([, by]) => by.includes(SPEC_TRANSCRIPTION_MARK))
    .map(([name]) => name);
  expect(transcriptions).toEqual([ENTRY_SHARD]);

  // `errors-000.json` は外部参照の側に居ること。**名前で選ぶ実装なら赤くなる。**
  const errors = pedigrees.find(([name]) => name === ERRORS_SHARD);
  expect(errors?.[1]).toContain("engine_table.rs");
  expect(errors?.[1]).not.toContain(SPEC_TRANSCRIPTION_MARK);
});

/**
 * `reference/tests/test_corpus_entry.py` が固定している「仕様書の写しですら
 * ない」件数を、テストのソースそのものから読み出す。
 */
function pinnedWeakerEntryCases(): number {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../../reference/tests/test_corpus_entry.py", import.meta.url),
    ),
    "utf-8",
  );
  const match = /^\s*assert weaker == (\d+)\s*$/m.exec(source);
  const figure = match?.[1];
  if (figure === undefined) {
    throw new Error(
      "reference/tests/test_corpus_entry.py no longer contains an " +
        "`assert weaker == <n>` line — the report's figure for how many " +
        "entry cases are not even transcriptions is pinned to that assert, " +
        "so either restore it or move the pin somewhere this test can read",
    );
  }
  return Number(figure);
}

test("the report says which cases are not even transcriptions", () => {
  // **3 枠目の中身は一様ではない。** 36 件のうち 10 件は仕様書に対応する規則が
  // 無く、実装から導いて電卓を走らせた値をそのまま期待値にしている。**電卓の
  // 欠陥はその期待値にも写るので、その 10 件は欠陥を見つけられない。**
  // 枠の件数だけを出すと、36 件すべてが仕様書に裏打ちされているように読める。
  //
  // 件数は報告書が数え直しているものではなく、シャード自身の素性から読む。
  // その素性が正しいことは Python 側の
  // `test_the_provenance_names_the_calculator_spec_not_an_independent_reference`
  // が実物のケース列から数えて固定している。**片方だけを直しても赤くなる。**
  const entries = realSummaries();
  const transcription = verificationFrameOf(
    verificationFrames(entries),
    "spec-transcription",
  );
  expect(
    transcription.weakerUnknown,
    "素性から内訳が読めなかった——報告書は件数を書けない",
  ).toEqual([]);
  expect(transcription.weaker).toBe(pinnedWeakerEntryCases());
  expect(transcription.weaker).toBeGreaterThan(0);
  expect(transcription.weaker).toBeLessThan(transcription.cases);

  const markdown = renderReport(entries, PROVENANCE);
  // **付録の「走行の環境」にも同じ語が出る**(シャードの素性そのものが
  // そう書いている)。本文の項目の側の行を取る。
  const line = onlyLine(markdown, "件は、仕様書の写しですらない。**");
  expect(line).toContain(`${transcription.weaker} 件`);
  expect(markdown).toContain("欠陥を見つけられない");
});

test("a run of nothing but spec transcriptions leaves the outside-reference frame empty", () => {
  // **番兵の側も見る。** 「外の基準と突き合わせたケースが 1 件も無い走行は
  // 報告書を書かない」という門が、値ケースの合計を数えていた時期には、
  // `entry-000.json` だけの走行を通してしまう。通れば「不一致 0」の緑の
  // 報告書が出る——外の基準に一度も当てていない走行について、である。
  const entry = summary({
    name: summaryName(ENTRY_SHARD, "displays"),
    total: 36,
    values: 36,
    equivalences: 0,
    generatedBy: `${SPEC_TRANSCRIPTION_MARK}である`,
  });
  const frames = verificationFrames([entry]);
  expect(verificationFrameOf(frames, "external").cases).toBe(0);
  expect(verificationFrameOf(frames, "spec-transcription").cases).toBe(36);

  // **`writeReport()` の門はこの枠の件数を読む**ので、この走行は報告書を
  // 書かずに落ちる。

  // 枠が空であることが報告書の上でも読めること(0 件を黙って落とさない)。
  const markdown = renderReport([entry], PROVENANCE);
  expect(
    onlyLine(markdown, "- **外部参照——Python の独立実装と突き合わせたケース"),
  ).toContain(": 0**");
  expect(markdown).toContain("**この走行には 1 件も無い。**");

  // **内訳を宣言しない素性は、黙って「弱いケース 0 件」にならない。**
  expect(
    verificationFrameOf(frames, "spec-transcription").weakerUnknown,
  ).toEqual([summaryName(ENTRY_SHARD, "displays")]);
  expect(onlyLine(markdown, "の内訳は読めなかった")).toContain(
    summaryName(ENTRY_SHARD, "displays"),
  );
  expect(markdown).toContain("**0 件という意味ではない。**");
});

// ---------------------------------------------------------------------------
// **矛盾を見張る。** 報告書は状態によって文が入れ替わる。入れ替わりを
// 見張らないと、**数を出している走行と、何も踏んでいない走行が同じ文を持つ**
// ——固定文が腐る、というこの文書で 3 度起きた壊れ方である。
//
// 見張る状態は 6 つ: 指数表示・金融のエラー・**盤面を通る走行(3 状態)**・
// core だけが通った走行・集計が揃わなかった走行・参照実装が捨てた件数。
// ---------------------------------------------------------------------------

/** 盤面を通る走行の要約の見本。**見たい欄だけ上書きする。** */
function uiRunFixture(overrides: Partial<HeavyUiRun> = {}): HeavyUiRun {
  return {
    schema: 1,
    pressedAnything: true,
    ok: true,
    totalPresses: 12345,
    totalTypedCases: 1266,
    byToken: {},
    casesTyped: {},
    required: [],
    findings: [],
    ...overrides,
  };
}

const UI_PASSED = "盤面を通る走行——通っている";
const UI_FAILED = "盤面を通る走行——失敗している";
const UI_NO_PRESSES = "盤面を通る走行——キーを 1 つも押していない";
const UI_NOT_RUN = "盤面を通る走行——記録が無い";
const UI_STATES = [UI_PASSED, UI_FAILED, UI_NO_PRESSES, UI_NOT_RUN];

/**
 * 盤面の状態の行を 1 本だけ取り出す。**他の 3 状態が同居していないことも見る**
 * ——「どこかに『通っている』と書いてある」検査では、4 つの状態を同じ段落に
 * 並べた実装(つまり何も区別していない実装)でも緑になる。
 */
function uiLine(markdown: string, state: string): string {
  expect(UI_STATES, "見張る状態の一覧に無い").toContain(state);
  expect(UI_STATES.length, "状態の一覧が痩せている").toBe(4);
  for (const other of UI_STATES) {
    if (other === state) {
      continue;
    }
    expect(markdown.includes(other), `「${other}」も同時に出ている`).toBe(
      false,
    );
  }
  return onlyLine(markdown, state);
}

test("state 1: the exponent line never holds both the count and the denial", () => {
  // **0 と 非 0 で文が入れ替わる。** 以前この 2 つは 12 行しか離れていない
  // 場所で同居していた(「1940 件読んだ」と「一度も出ていない」)。
  const none = renderReport([summary({ exponentDisplayCases: 0 })], PROVENANCE);
  expect(onlyLine(none, "指数表記の表示")).not.toContain("件が読んでいる");
  expect(onlyLine(none, "平坦表示の帯")).toContain("一度も出ていない");

  const some = renderReport(
    [summary({ exponentDisplayCases: 1940 })],
    PROVENANCE,
  );
  expect(onlyLine(some, "指数表記の表示")).toContain("1940 件が読んでいる");
  expect(some.includes("平坦表示の帯")).toBe(false);
});

test("state 2: the finance error frames swap wording with the data, each on its own line", () => {
  const some = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        errorKinds: { SyntaxError: 3, Overflow: 5 },
      }),
    ],
    PROVENANCE,
  );
  expect(errorPathLine(some, "金融の `SyntaxError`")).toContain("3 件");
  expect(errorPathLine(some, "金融の `SyntaxError`")).not.toContain(
    "1 件も検証していない",
  );
  expect(errorPathLine(some, "金融の `Overflow`")).toContain("5 件");

  const none = renderReport(
    [summary({ name: "finance-000.json (calls)", errorKinds: {} })],
    PROVENANCE,
  );
  for (const frame of ["金融の `SyntaxError`", "金融の `Overflow`"]) {
    expect(errorPathLine(none, frame)).toContain("1 件も検証していない");
  }
});

test("state 3: with no heavy-ui-run.json the report says the keypad run left no record", () => {
  // **ここが肝である。** `pnpm heavy` と `pnpm heavy:ui` は別の走行で集計を
  // 共有しない。読まなければ、**盤面を一度も走らせていない走行**と
  // **盤面が落ちた走行**が同じ顔になり、報告書は「UI も通した」と読める。
  const markdown = renderReport([summary()], PROVENANCE);
  expect(uiLine(markdown, UI_NOT_RUN)).toContain("記録が無い");
  expect(markdown).toContain("「UI も確かめた」と");
  expect(uiHealth(null)).toEqual({ state: "not-run" });
});

test("state 3: a heavy-ui run that failed is named as failed, with its findings counted", () => {
  const markdown = renderReport(
    [summary()],
    PROVENANCE,
    [],
    null,
    null,
    uiRunFixture({
      ok: false,
      totalPresses: 40,
      totalTypedCases: 3,
      findings: [
        { kind: "never-pressed", message: "a" },
        { kind: "never-pressed", message: "b" },
        { kind: "too-few-cases", message: "c" },
      ],
    }),
  );
  const line = uiLine(markdown, UI_FAILED);
  expect(line).toContain("指摘 3 件");
  // **種類ごとに数える。** 1 つの数字に畳むと、どの主張が崩れたのか読めない。
  expect(markdown).toContain("`never-pressed` 2 件・`too-few-cases` 1 件");
  expect(markdown).toContain("40 回キーを押し");
  // **この報告書の緑がその失敗を打ち消さないと書く。**
  expect(markdown).toContain("この報告書の緑は、その失敗を打ち消さない");
});

test("state 3: a heavy-ui run that passed is the only state that says so", () => {
  const markdown = renderReport(
    [summary()],
    PROVENANCE,
    [],
    null,
    null,
    uiRunFixture({ totalPresses: 30000, totalTypedCases: 1266 }),
  );
  expect(uiLine(markdown, UI_PASSED)).toContain("通っている");
  expect(markdown).toContain("30000 回キーを押し");
  expect(markdown).toContain("1266 件のケースを盤面から打鍵して");
  // **同時の走行ではない**——最後に残された記録である、と断る。
  expect(markdown).toContain("この報告書と同時の走行ではない");
  // 通っていても、この報告書の件数は盤面を通っていない。
  expect(markdown).toContain("この報告書の件数は、いまも盤面を通っていない");
  expect(uiHealth(uiRunFixture())).toEqual({
    state: "passed",
    presses: 12345,
    typed: 1266,
  });
});

test("a heavy-ui run that pressed nothing is not reported as a keypad failure", () => {
  // **設計書が想定していなかった 4 つ目の状態(2026-08-20 実測)。**
  // ディスクに在る `heavy-ui-run.json` が `pressedAnything: false` だった
  // ——盤面を叩く spec を含まない**部分走行**の残骸である。これを「失敗」と
  // 同じ行に出すと、**盤面の主張が崩れた走行**と**盤面を一度も叩いていない
  // 走行**が同じ顔になる。前者は電卓の欠陥を指しうるが、後者が指しているのは
  // 走行の組み方だけである。
  const residue = uiRunFixture({
    pressedAnything: false,
    ok: false,
    totalPresses: 0,
    totalTypedCases: 0,
    findings: [
      { kind: "no-presses", message: "a" },
      { kind: "too-few-cases", message: "b" },
      { kind: "planned-but-not-typed", message: "c" },
    ],
  });
  expect(uiHealth(residue).state).toBe("no-presses");
  const markdown = renderReport(
    [summary()],
    PROVENANCE,
    [],
    null,
    null,
    residue,
  );
  expect(uiLine(markdown, UI_NO_PRESSES)).toContain(
    "キーを 1 つも押していない",
  );
  expect(markdown).toContain("`planned-but-not-typed` 1 件");
  expect(markdown).toContain("崩れる前に、");

  // **`ok` を先に見ると、押していない走行が「通った」になる。** 指摘が
  // 1 件も無い押下 0 の記録——検査そのものが外れた走行——で確かめる。
  expect(
    uiHealth(
      uiRunFixture({
        pressedAnything: false,
        ok: true,
        totalPresses: 0,
        totalTypedCases: 0,
      }),
    ).state,
  ).toBe("no-presses");
});

test("the shape the keypad run writes is the shape this report reads", () => {
  // **書く側と読む側は別のモジュールである。** `presses.ts` が欄の名前を
  // 変えた日に `readUiRunJson()` が `null` を返すようになれば、報告書は
  // 黙って「記録が無い」と書き続ける——**盤面が緑でも、である。**
  // 見本を手で書かず、**書く側の純関数から作る**ことでそこを繋ぐ。
  const empty = buildUiRun(
    { byToken: {}, casesTyped: {} },
    {
      cases: {},
      inCorpus: [],
      inSample: [],
      totalCases: 0,
    },
    [{ kind: "no-presses", message: "nothing was pressed" }],
  );
  expect(uiHealth(empty).state).toBe("no-presses");

  const green = buildUiRun(
    {
      byToken: {
        ac: { case: 0, harness: 1266 },
        dot: { case: 400, harness: 0 },
      },
      casesTyped: { "scientific-000.json": 1266 },
    },
    { cases: {}, inCorpus: [], inSample: [], totalCases: 1266 },
    [],
  );
  expect(uiHealth(green)).toEqual({
    state: "passed",
    presses: 1666,
    typed: 1266,
  });
});

test("state 4: a run where only the core passed does not read as a run that also passed the keypad", () => {
  // **core が緑で盤面が未実行**、という一番ありふれた状態。走行そのものの
  // 失敗は 0 件と書けるが、盤面については何も書けない。**2 つを同じ緑で
  // 並べない。**
  const clean: HeavyRun = {
    schema: 1,
    ranTests: true,
    expected: ["scientific-000.json (values)"],
    shards: [
      { name: "scientific-000.json (values)", total: 2000, mismatches: 0 },
    ],
  };
  const markdown = renderReport([summary()], PROVENANCE, [], null, clean, null);
  expect(errorPathLine(markdown, "走行そのものの失敗")).toContain("0 件");
  expect(uiLine(markdown, UI_NOT_RUN)).toContain("記録が無い");
});

test("with neither summary on disk, the report calls both of them unread", () => {
  // **2 枚とも無い走行では、両方を未実行と書く。** 片方を「異常なし」に
  // 畳むのが、この種の報告書がいちばん静かに嘘をつく道である。
  const markdown = renderReport([summary()], PROVENANCE);
  expect(errorPathLine(markdown, "走行そのものの失敗")).toContain(
    "読めていない",
  );
  expect(errorPathLine(markdown, "走行そのものの失敗")).not.toContain("0 件");
  expect(uiLine(markdown, UI_NOT_RUN)).toContain("記録が無い");
});

test("state 5: a report missing part of its own summaries is not a result, even with a green keypad run", () => {
  // **盤面が通っていることは、欠けた集計の代わりにならない。**
  const markdown = renderReport(
    [summary()],
    PROVENANCE,
    ["errors-000.json (displays)"],
    null,
    null,
    uiRunFixture(),
  );
  expect(onlyLine(markdown, "# この走行は不完全である")).toContain(
    "結果として読まないこと",
  );
  expect(markdown.indexOf("この走行は不完全である")).toBeLessThan(
    markdown.indexOf("# CalcArc 計算検証レポート"),
  );
  expect(onlyLine(markdown, "- `errors-000.json (displays)`")).toBe(
    "- `errors-000.json (displays)`",
  );
  expect(markdown).toContain("記録が残った分だけの数字");
  // 盤面の側は緑のまま——**その 2 つは別の主張である。**
  expect(uiLine(markdown, UI_PASSED)).toContain("通っている");
});

test("state 6: zero rejections, some rejections and no declaration are three different sentences", () => {
  // **「0 件捨てた」と「捨てた数を宣言していない」を混ぜない。** 実物では
  // `finance-000.json` が理由別の数を宣言し、`data-scale-000.json` は
  // `rejections` そのものを持たない。
  const withReasons = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        callBreakdown: {
          byOp: { loan_forward: { ok: 2000 } },
          byStratum: {},
          gaveUp: { dup: 2, reasons: { near_yen_boundary: 7, other: 0 } },
          coverage: null,
        },
      }),
    ],
    PROVENANCE,
  );
  expect(onlyLine(withReasons, "捨てた件数")).toContain("件数: 7");
  expect(onlyLine(withReasons, "- `near_yen_boundary`:")).toBe(
    "- `near_yen_boundary`: 7",
  );
  expect(onlyLine(withReasons, "- 重複による棄却")).toContain("2");

  const noneGaveUp = renderReport(
    [
      summary({
        name: "finance-000.json (calls)",
        callBreakdown: {
          byOp: { loan_forward: { ok: 2000 } },
          byStratum: {},
          gaveUp: { dup: 0, reasons: { near_yen_boundary: 0, other: 0 } },
          coverage: null,
        },
      }),
    ],
    PROVENANCE,
  );
  expect(onlyLine(noneGaveUp, "捨てた件数")).toContain("件数: 0");
  expect(noneGaveUp.includes("宣言していない")).toBe(false);

  const undeclared = renderReport(
    [
      summary({
        name: "data-scale-000.json (calls)",
        callBreakdown: {
          byOp: { to_bytes: { ok: 2000 } },
          byStratum: {},
          gaveUp: null,
          coverage: null,
        },
      }),
    ],
    PROVENANCE,
  );
  expect(onlyLine(undeclared, "棄却の数(`rejections`)")).toContain(
    "宣言していない",
  );
  expect(undeclared.includes("捨てた件数")).toBe(false);
});

// ---------------------------------------------------------------------------
// **報告書の土台**——期待値そのものが生成器の出力なのか(2026-08-29)。
//
// `uiHealth` と同じ形で状態を持たせている。**畳まないのが要点**である:
// 「確かめていない」「古い」「途中で落ちた」「食い違っている」「通った」は、
// 読む人の次の一手が全部違う。
// ---------------------------------------------------------------------------

/** 通った信号。個々のテストは、崩したいところだけを上書きする。 */
function signalFixture(
  overrides: Partial<ReproducibilitySignal> = {},
): ReproducibilitySignal {
  return {
    schema: 1,
    corpusDigest: "deadbeef",
    generatorDigest: "cafe",
    generatorFiles: ["scripts/generate_corpus.py"],
    fileSetChecked: true,
    extra: [],
    missing: [],
    bytesChecked: 18,
    mismatched: [],
    ok: true,
    ...overrides,
  };
}

test("state 1: with no signal the report says the foundation was never checked", () => {
  // **「無い」は「健全」ではない。** ここを黙って省くと、再現性検査を
  // 一度も走らせていない作業ツリーの報告書が、走らせた走行と同じ顔になる。
  expect(reproducibilityHealth(null, "abc")).toEqual({ state: "not-run" });
  const markdown = renderReproducibility({ state: "not-run" }).join("\n");
  expect(markdown).toContain("確かめていない");
  expect(markdown).toContain("何も保証していない");
});

test("state 2: a signal about other bytes is stale, not green", () => {
  // **これが指紋を持たせた理由である。** 検査を通したあとで期待値を書き
  // 換えると、ディスクには「緑」と書かれた信号だけが残る。
  const state = reproducibilityHealth(
    signalFixture({ corpusDigest: "old" }),
    "new",
  );
  expect(state).toEqual({
    state: "stale",
    what: "corpus",
    signed: "old",
    actual: "new",
  });
  const markdown = renderReproducibility(state).join("\n");
  expect(markdown).toContain(
    "いまここに在るコーパスについて書かれたものではない",
  );
});

test("state 2: a corpus that cannot be read is not called stale", () => {
  // **比べられなかったことと、比べて違ったことを混ぜない。**
  expect(reproducibilityHealth(signalFixture(), null).state).toBe("passed");
});

test("state 3: half a run is incomplete, which is not the same as red", () => {
  expect(
    reproducibilityHealth(signalFixture({ bytesChecked: null }), "deadbeef")
      .state,
  ).toBe("incomplete");
  expect(
    reproducibilityHealth(signalFixture({ fileSetChecked: false }), "deadbeef")
      .state,
  ).toBe("incomplete");
  expect(renderReproducibility({ state: "incomplete" }).join("\n")).toContain(
    "赤いのではなく、分からない",
  );
});

test("state 4: drift names every kind of drift separately", () => {
  const state = reproducibilityHealth(
    signalFixture({
      mismatched: ["scientific-000.json"],
      extra: ["handwritten-001.json"],
      missing: ["loan-000.json"],
    }),
    "deadbeef",
  );
  expect(state.state).toBe("drifted");
  const markdown = renderReproducibility(state).join("\n");
  expect(markdown).toContain("`scientific-000.json`");
  expect(markdown).toContain("`handwritten-001.json`");
  expect(markdown).toContain("`loan-000.json`");
  // **下の件数を結果として読ませない。**
  expect(markdown).toContain("「不一致 0 件」を結果として読まないこと");
});

test("state 5: a clean run says how many files it compared", () => {
  const state = reproducibilityHealth(signalFixture(), "deadbeef");
  expect(state).toEqual({ state: "passed", checked: 18 });
  expect(renderReproducibility(state).join("\n")).toContain("18 枚");
});

test("the report believes the parts, not the signal's own ok flag", () => {
  // **要約のフラグを信じない。** 書く側が壊れた日に、報告書が「緑」と
  // 書いてしまう経路をここで塞ぐ——`openOutcome` が「知らない形を黙って
  // 通さない」のと同じ姿勢である。
  const forged = signalFixture({
    ok: true,
    mismatched: ["scientific-000.json"],
  });
  expect(reproducibilityHealth(forged, "deadbeef").state).toBe("drifted");
});

test("★ 「測っていない」の 2 つの理由が、報告書の上で別物になる", () => {
  // **これが段階 1 の目的そのものである。**
  //
  // `detection-power.json` が無いとき、理由は 2 つある——回していないか、
  // **土台が赤くて飛ばされたか**である(CI ではこの段は再現性検査の後ろに
  // 在り、`if:` を持たない)。同じ文で両方を指すと、読む人は「回し忘れ」だと
  // 思い、**この報告書のすべてが宙に浮いていることに気づかない。**
  const forgot = renderDetectionPower(null, { state: "not-run" }).join("\n");
  const skipped = renderDetectionPower(null, {
    state: "drifted",
    extra: [],
    missing: [],
    mismatched: ["scientific-000.json"],
    checked: 18,
  }).join("\n");

  expect(forgot).toContain("測っていない");
  expect(skipped).toContain("測っていない");
  // **同じ文字列では終わらない。**
  expect(forgot).not.toBe(skipped);
  expect(forgot.includes("回し忘れではない")).toBe(false);
  expect(skipped).toContain("回し忘れではない");
  expect(skipped).toContain("先に直すのは土台のほう");
});

test("土台が古い・途中で落ちたときも、飛ばされた側として読める", () => {
  // 「赤い」だけを特別扱いすると、**古い信号のまま測定が飛んだ走行**が
  // 「回し忘れ」の顔で出る。3 つとも土台が通っていない状態である。
  for (const state of [
    { state: "stale", signed: "a", actual: "b" },
    { state: "incomplete" },
  ] as Reproducibility[]) {
    expect(renderDetectionPower(null, state).join("\n")).toContain(
      "回し忘れではない",
    );
  }
  // **通った走行では、その但し書きは出ない。**
  expect(
    renderDetectionPower(null, { state: "passed", checked: 18 }).join("\n"),
  ).not.toContain("回し忘れではない");
});

test("報告書の本体に土台の節が出て、読む順にも載っている", () => {
  const markdown = renderReport([summary()], PROVENANCE, [], null, null, null, {
    state: "passed",
    checked: 18,
  });
  expect(markdown).toContain("## 期待値そのものは、生成器の出力なのか");
  expect(markdown).toContain("結論の土台");
});

test("既定の renderReport は土台について何も知らないと言う", () => {
  // **引数を渡さない呼び出しが「緑」を書かない。** 既定が
  // `{ state: "not-run" }` であることの意味はこれである。
  const markdown = renderReport([summary()], PROVENANCE);
  expect(markdown).toContain("確かめていない");
});

test("2 つの言語が同じ指紋を出す(Python 側と同じ数字に留める)", () => {
  // 相方は `reference/tests/test_corpus_reproducibility.py` の
  // `DIGEST_OF_THE_SHARED_FIXTURE`。**片方だけ手順を変えると、報告書は
  // 正しい走行でも「この記録は古い」と言い続ける。**
  // **割れうる差を狙って入れてある**(Python 側の `write_shared_fixture` と
  // 同じ 4 枚): `a` / `ab` / `b` は並べ替えが割れうる形、`Z` は大文字が
  // 小文字より前に来ること、そして**非 ASCII の中身**。
  const dir = mkdtempSync(join(tmpdir(), "calcarc-digest-"));
  writeFileSync(join(dir, "Z.json"), '{"ラベル": "度分秒"}\n', "utf-8");
  writeFileSync(join(dir, "a.json"), '{"x": 1}\n');
  writeFileSync(join(dir, "ab.json"), '["b.json1"]\n');
  writeFileSync(join(dir, "b.json"), "[]\n");
  expect(corpusDigest(dir)).toBe(
    "ca21c606610226a41e841fbc2a63b89e1e4eb7470d13604c5ff8bc888bb4cb82",
  );
  rmSync(dir, { recursive: true, force: true });
});

test("読めないディレクトリの指紋は null(「一致しなかった」ではない)", () => {
  expect(corpusDigest(join(tmpdir(), "calcarc-does-not-exist-9e3f"))).toBe(
    null,
  );
});

/**
 * **報告書が読む欄の一覧。Python 側が同じ綴りを持っている**
 * (`test_corpus_reproducibility.py` の `SIGNAL_FIELDS`)。
 */
const SIGNAL_FIELDS = [
  "bytesChecked",
  "corpusDigest",
  "extra",
  "fileSetChecked",
  "generatorDigest",
  "generatorFiles",
  "mismatched",
  "missing",
  "ok",
  "schema",
] as const;

test("書き手と読み手の欄が揃っている(欠けたら読み手は信号を捨てる)", () => {
  // **これが「計器自身を見張る」テストである。** 書き手と読み手で欄がずれると、
  // 読み手は黙って「信号が無い」に落ちる——**信号の仕組みが壊れたまま、
  // 報告書は「土台を確かめていない」と書き続ける。** 静かな壊れ方なので、
  // 欄の綴りそのものを両側から同じ一覧に留める。
  const full = signalFixture() as unknown as Record<string, unknown>;
  expect(Object.keys(full).sort()).toEqual([...SIGNAL_FIELDS].sort());

  // **1 欄でも欠ければ、読み手は受け取らない。**
  for (const field of SIGNAL_FIELDS) {
    const missing = { ...full };
    delete missing[field];
    expect(
      parseReproducibility(missing),
      `${field} が欠けても読めてしまう`,
    ).toBe(null);
  }
});

test("生成器が変わっていれば、期待値が動いていなくても古いと言う", () => {
  // **コーパスの指紋だけでは足りない。** 検査を通したあとで参照実装を
  // 直した作業ツリーでは、期待値が 1 バイトも動いていなくても
  // 「今日書くはずのもの」は変わっている。
  const state = reproducibilityHealth(
    signalFixture({ generatorDigest: "old" }),
    "deadbeef",
    "new",
  );
  expect(state).toEqual({
    state: "stale",
    what: "generator",
    signed: "old",
    actual: "new",
  });
  const markdown = renderReproducibility(state).join("\n");
  expect(markdown).toContain("いまここに在る生成器ではない");
  // **期待値が動いたときとは別の文である。**
  expect(markdown.includes("期待値が書き換えられている")).toBe(false);
});

test("生成器の指紋は、信号が名指しした一式だけを数える", () => {
  const dir = mkdtempSync(join(tmpdir(), "calcarc-gen-"));
  writeFileSync(join(dir, "one.py"), "x = 1\n");
  writeFileSync(join(dir, "two.py"), "y = 2\n");
  const both = generatorDigest(["one.py", "two.py"], dir);
  expect(generatorDigest(["one.py"], dir)).not.toBe(both);
  // **1 枚でも消えていれば指紋は無い(= 古い)。**
  rmSync(join(dir, "two.py"));
  expect(generatorDigest(["one.py", "two.py"], dir)).toBe(null);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// **試験空間の表**(設計書 §12、計画 Task 11)。
//
// **数はシャードが宣言したものをそのまま出す。割合も率も足さない**
// ——「網羅率」を作ると、**有限のモデルに対する被覆が、入力空間全体に
// 対する被覆に見える。** 注意文を必ず添えるのはそのためである。
// ---------------------------------------------------------------------------

const coverageRequirement = (
  over: Partial<CoverageRequirement> = {},
): CoverageRequirement => ({
  id: "op/a/all",
  scope: "op",
  strength: "all",
  required_cells: 10,
  covered_cells: 10,
  excluded_cells: 0,
  unmet_cells: 0,
  status: "complete",
  ...over,
});

const coverageExclusion = (
  over: Partial<CoverageExclusion> = {},
): CoverageExclusion => ({
  cell_id: "op/a=1",
  scope: "op",
  reason: "duplicate_equivalent",
  disposition: "safe",
  detail: "x",
  covered_elsewhere: [],
  ...over,
});

const coverageOf = (
  requirements: CoverageRequirement[],
  excluded: CoverageExclusion[],
  rejections: Record<string, number> = { candidate_duplicate: 0 },
): Coverage => ({
  schema: 1,
  model: "finance-v1",
  requirements,
  excluded_cells: excluded,
  generation_rejections: rejections,
});

const withCoverage = (coverage: Coverage | null): CallBreakdown => ({
  byOp: { op: { ok: 1 } },
  byStratum: {},
  gaveUp: null,
  coverage,
});

test("1. 全セル被覆・除外 0 は「完全網羅」と書く", () => {
  const lines = renderCoverage(
    withCoverage(coverageOf([coverageRequirement()], [])),
  );
  expect(lines.join("\n")).toContain("| 10 | 10 | 0 | 0 | 完全網羅 |");
});

test("2. 安全な重複除外は safe として並ぶ", () => {
  const lines = renderCoverage(
    withCoverage(
      coverageOf(
        [
          coverageRequirement({
            covered_cells: 9,
            excluded_cells: 1,
            status: "accounted_with_exclusions",
          }),
        ],
        [
          coverageExclusion({
            reason: "duplicate_equivalent",
            disposition: "safe",
          }),
        ],
      ),
    ),
  );
  expect(lines.join("\n")).toContain("`duplicate_equivalent`");
  expect(lines.join("\n")).toContain("safe");
  // **注意文にも「未検証空間」という語が出る。** 見たいのは判断区分の欄なので
  // 印そのもので見る——素の「未検証」だと注意文に当たって常に緑になる。
  expect(lines.join("\n")).not.toContain("(**未検証**)");
});

test("3. reasonable の除外は「理由付き未実行あり」になる（完全網羅とは書かない）", () => {
  const lines = renderCoverage(
    withCoverage(
      coverageOf(
        [
          coverageRequirement({
            covered_cells: 9,
            excluded_cells: 1,
            status: "accounted_with_exclusions",
          }),
        ],
        [
          coverageExclusion({
            reason: "source_overflow",
            disposition: "reasonable",
          }),
        ],
      ),
    ),
  );
  expect(lines.join("\n")).toContain("理由付き未実行あり");
  // **注意文が「完全網羅は…を意味しない」と書いている。** 状態の欄を見る。
  expect(lines.join("\n")).not.toContain("| 完全網羅 |");
});

test("4. accepted risk は「未検証」と書く", () => {
  const lines = renderCoverage(
    withCoverage(
      coverageOf(
        [
          coverageRequirement({
            covered_cells: 9,
            excluded_cells: 1,
            status: "accounted_with_exclusions",
          }),
        ],
        [
          coverageExclusion({
            reason: "oracle_near_yen_boundary",
            disposition: "accepted_risk",
          }),
        ],
      ),
    ),
  );
  expect(lines.join("\n")).toContain("(**未検証**)");
});

test("5. 未達があれば「不足」と書く", () => {
  const lines = renderCoverage(
    withCoverage(
      coverageOf(
        [
          coverageRequirement({
            covered_cells: 9,
            unmet_cells: 1,
            status: "incomplete",
          }),
        ],
        [],
      ),
    ),
  );
  expect(lines.join("\n")).toContain("不足");
});

test("6. coverage が無いシャードは「測定していない」と書き、表を出さない", () => {
  const lines = renderCoverage(withCoverage(null)).join("\n");
  expect(lines).toContain("測定していない");
  expect(lines).not.toContain("| 対象 |");
});

test("7. 未知理由は行を落とさずそのまま出す", () => {
  // **読み手(`assertCoverageIsSound`)が拒否済みでも、表示は落とさない。**
  // 落とすと、表の合計と行の数が食い違ったまま読まれる。
  const lines = renderCoverage(
    withCoverage(
      coverageOf(
        [
          coverageRequirement({
            covered_cells: 9,
            excluded_cells: 1,
            status: "accounted_with_exclusions",
          }),
        ],
        [coverageExclusion({ reason: "made_up", disposition: "safe" })],
      ),
    ),
  );
  expect(lines.join("\n")).toContain("`made_up`");
});

test("8. 合計が合わないときはその旨を書く", () => {
  const lines = renderCoverage(
    withCoverage(
      coverageOf(
        [coverageRequirement({ required_cells: 10, covered_cells: 9 })],
        [],
      ),
    ),
  );
  expect(lines.join("\n")).toContain("合計が合わない");
});

test("9. 候補棄却 0 のときも節を出す", () => {
  // **0 件は「無かった」であって「測っていない」ではない。** 節ごと消すと
  // 区別が付かなくなる。
  const lines = renderCoverage(
    withCoverage(
      coverageOf([coverageRequirement()], [], {
        candidate_duplicate: 0,
        oracle_near_yen_boundary: 0,
        oracle_search_limit: 0,
      }),
    ),
  );
  expect(lines.join("\n")).toContain("生成候補の棄却");
  expect(lines.join("\n")).toContain("`candidate_duplicate`: 0");
});

test("10. 候補棄却があるとき、単位が「生成候補」と書かれる", () => {
  const lines = renderCoverage(
    withCoverage(
      coverageOf([coverageRequirement()], [], {
        candidate_duplicate: 12,
        oracle_near_yen_boundary: 7,
        oracle_search_limit: 0,
      }),
    ),
  );
  // **「生成候補」だけを見ない**(2026-08-29 の厳格レビュー F5)。その語は
  // 節見出し「生成候補の棄却」に常に含まれるので、**`coverage` が非 null なら
  // 任意の入力で緑になる**——行の単位を落としても赤くならない。
  // **見たいのは、数のとなりに単位が付いていること**である。
  const text = lines.join("\n");
  expect(text).toContain("- `candidate_duplicate`: 12 生成候補");
  expect(text).toContain("- `oracle_near_yen_boundary`: 7 生成候補");
  expect(text).toContain("未検証空間の大きさではない");
});

test("網羅率を書かない（有限のモデルへの被覆を、入力空間への被覆に見せない）", () => {
  const lines = renderCoverage(
    withCoverage(coverageOf([coverageRequirement()], [])),
  ).join("\n");
  expect(lines).not.toMatch(/\d+(\.\d+)?\s*%/);
  expect(lines).toContain("金融入力全体を数学的に全列挙したことを意味しない");
});

test("実物の finance-000.json でも表が出る", () => {
  const finance = loadCallShards().find((e) => e.name === "finance-000.json");
  if (finance === undefined) {
    throw new Error("finance-000.json is not among the call shards");
  }
  const lines = renderCoverage(summarizeCallShard(finance.shard)).join("\n");
  expect(lines).toContain("`finance-v1`");
  expect(lines).toContain("loan_term");
  // **実物の数がそのまま出ている。**
  expect(lines).toContain("| 150 | 126 | 24 | 0 | 理由付き未実行あり |");
  expect(lines).toContain("`source_overflow`");
});

// ---------------------------------------------------------------------------
// **科学計算の試験空間の節**（2026-08-30、`scientific-v1`）。
//
// **未達を 1 つの数に畳まない。** 3 つが区別して読めること——**本当の穴**
// （門が落とすのはこれだけ）／**測れない軸に起因する未達**／**9 領域の外が
// 踏んでいるもの**。**畳むと、埋める判断を誤る。**
// ---------------------------------------------------------------------------

const scienceCoverage = (over: Partial<Coverage> = {}): Coverage => ({
  schema: 1,
  model: "scientific-v1",
  requirements: [
    {
      id: "op/a/one_way",
      scope: "op",
      strength: "one_way",
      required_cells: 6,
      covered_cells: 3,
      excluded_cells: 0,
      unmet_cells: 3,
      status: "incomplete",
      unmet_from_unmeasured_axes: 2,
      unmet_real_cells: ["op/band=zero"],
    },
  ],
  excluded_cells: [],
  generation_rejections: {},
  not_measured_axes: [{ scope: "op", axis: "band", why: "引数の値が要る" }],
  covered_outside_model: [{ cell_id: "op/x=1", where: "errors-000.json" }],
  ...over,
});

test("科学: 本当の穴は、セル id ごと名指しされる", () => {
  const text = renderScienceCoverage(scienceCoverage()).join("\n");
  // **注意文に含まれない綴りで見る。** 「データに無い」は見出しにも表にも
  // 出るので、**行の全体一致**で当てる（第 1 段階で 3 回踏んだ型）。
  expect(text).toContain("- `op/band=zero`");
  expect(text).toContain("**データに 1 件も入力が無いセルが 1 件ある。**");
});

test("科学: 測れない軸は、理由つきで別の表に出る", () => {
  const text = renderScienceCoverage(scienceCoverage()).join("\n");
  expect(text).toContain("| `op` | `band` | 引数の値が要る |");
  expect(text).toContain(
    "**この経路では読めない軸に起因する未達が 2 件ある。**",
  );
});

test("科学: 外が踏んでいるものは、被覆と混ぜずに別の節へ", () => {
  const text = renderScienceCoverage(scienceCoverage()).join("\n");
  expect(text).toContain("### モデルの外が踏んでいるもの");
  expect(text).toContain("| `op/x=1` | errors-000.json |");
  // **被覆の表には現れない。**
  expect(text).not.toContain("| `op` | 6 | 4 |");
});

test("科学: 穴が無い走行では、そう書く", () => {
  const clean = scienceCoverage({
    requirements: [
      {
        id: "op/a/one_way",
        scope: "op",
        strength: "one_way",
        required_cells: 6,
        covered_cells: 6,
        excluded_cells: 0,
        unmet_cells: 0,
        status: "complete",
        unmet_from_unmeasured_axes: 0,
        unmet_real_cells: [],
      },
    ],
    covered_outside_model: [],
  });
  const text = renderScienceCoverage(clean).join("\n");
  expect(text).toContain("**データに無いセルは 1 つも無い。**");
  expect(text).not.toContain("### モデルの外が踏んでいるもの");
});

test("科学: 読めなかった走行を「全部覆った」と書かない", () => {
  const text = renderScienceCoverage(null).join("\n");
  expect(text).toContain("この走行は科学計算のモデルを読んでいない");
  expect(text).toContain("**「全部覆った」ではない。**");
  expect(text).not.toContain("| 対象 | 必須セル |");
});

test("科学: 実物の報告書に、9 領域の表が出て、名指しは 0 件になる", () => {
  const finance = loadCallShards().find((s) => s.name === "finance-000.json");
  const shards = loadShards();
  const science = shards.find((s) => s.name === "angle-mode-000.json");
  const coverage = (science?.shard as unknown as { coverage?: Coverage })
    ?.coverage;
  expect(coverage?.model).toBe("scientific-v1");
  const markdown = renderReport(
    [summary()],
    PROVENANCE,
    [],
    null,
    null,
    null,
    { state: "passed", checked: 18 },
    coverage ?? null,
  );
  expect(markdown).toContain("## 科学計算の試験空間 `scientific-v1`");
  // **2026-08-30、名指しは 0 件になった。** 段 C を通しながら 7 → 0 へ
  // 減った——埋めたもの（`Rad × 逆三角` / `asin(1)` / `acos(1)` / `e^0` /
  // `e^-5` / `(j5 - j5)` / 組合せの誤入力 13 件）、理由を貼ったもの
  // （複素の冪は engine が拒む）、**射影の誤りだったもの**（`Overflow 近傍`）
  // の 3 通りが混ざっている。
  expect(markdown).toContain("**データに無いセルは 1 つも無い。**");
  // **消えたことを見る**——名指しの一覧が古いまま残ると、**報告書が
  // 「まだ空だ」と言い続ける。**
  for (const gone of [
    "- `combinatorics/path=domain`",
    "- `combinatorics/path=overflow_near`",
    "- `complex/zero_part=both_zero`",
    "- `complex/operation=power`",
  ]) {
    expect(markdown).not.toContain(gone);
  }
  // **「測れない軸」はまだ 16 件ある。** 穴が 0 件であることと、
  // **全部を測れていることは別**である——混ぜて読ませない。
  expect(markdown).toContain("うち測れない軸");
  // **金融の表を壊していない。**
  expect(finance).toBeDefined();
  expect(markdown).toContain("## 期待値そのものは、生成器の出力なのか");
});
