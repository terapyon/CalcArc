import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type {
  CallCase,
  DisplayCase,
  DisplayEquivalenceCase,
  ToleranceBand,
} from "./corpus";
import {
  loadCallShards,
  loadDisplayShards,
  loadShards,
  needsPrecedence,
  partitionCases,
} from "./corpus";
import {
  ASSOCIATIVITY_SHARD,
  areaOfShard,
  buildRun,
  ERRORS_SHARD,
  type ErrorPathId,
  errorCaseCount,
  errorPaths,
  expectedSummaryNames,
  type HeavyRun,
  PRECEDENCE_CHANGES_MEANING,
  PRECEDENCE_SHARD,
  type Provenance,
  type RecordedShard,
  renderDetectionPower,
  renderReport,
  runHealth,
  type ShardSummary,
  summaryName,
  verdictOf,
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
 * 5 枠を 1 つに畳んだ実装——どこかに 270 と書いてあるだけの実装——でも緑に
 * なる。枠の名前の付いた行に、その枠の数が乗っていることを見る。
 */
function errorPathLine(markdown: string, title: string): string {
  const lines = markdown.split("\n").filter((line) => line.includes(title));
  expect(
    lines.length,
    `エラー経路「${title}」の行が 1 本ではない(${lines.length} 本)`,
  ).toBe(1);
  return lines[0] ?? "";
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

  // 合計は 2 シャードの合算(2000 + 2000)だが、**経路ごとに分けて**出る。
  expect(markdown).toContain("二経路で照合したケース(値): 2000**");
  expect(markdown).toContain("電卓の自己整合を見たケース(同値): 2000**");
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
  // appeared above (the headline reads 「二経路で照合したケース(値): 4000」).
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
  expect(markdown).toContain("**二経路で照合したケース(値): 1234**");
  expect(markdown).toContain("上の「二経路で照合したケース(値): 1234」");
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
  ]) {
    expect(errorPathLine(markdown, title)).toContain("1 件も検証していない");
  }
});

test("a run that counts one error path and not another says both, each on its own line", () => {
  // **枠を分けた意味は、全部 0 でも全部非 0 でも検査されない。** 0 件の枠と
  // 非 0 の枠が同時に出る走行でだけ、5 つを 1 つの数字に畳んだ実装と区別が
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

test("an error expectation that fits none of the four paths is named, not folded into one", () => {
  // **既定の枠へ落とすと、新しい経路の件数が既存の枠に加算されて見えなく
  // なる。** 落とさずに数え上げ、名前と件数を本文に出す。
  const entries = [
    summary({
      name: "entry-000.json (displays)",
      errorKinds: { SyntaxError: 1 },
    }),
  ];
  const paths = errorPaths(entries);
  expect(paths.frames.every((frame) => frame.cases === 0)).toBe(true);
  expect(paths.unclassified).toEqual([
    { shard: "entry-000.json (displays)", kind: "SyntaxError", cases: 1 },
  ]);
  const markdown = renderReport(entries, PROVENANCE);
  expect(markdown).toContain("上のどの経路にも入らないものが 1 件ある");
  expect(markdown).toContain(
    "`entry-000.json (displays)` の `SyntaxError` 1 件",
  );
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

test("the fifth frame watches the run itself, and an unreadable summary is not a clean one", () => {
  // **5 つ目の枠だけ出どころの種類が違う。** シャードの集計ではなく、走行
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

test("every error expectation in the committed corpus lands in a frame or is named", () => {
  // **番兵。** 枠に入らなかったエラー期待値が黙って消えないことを、見本では
  // なく実物で見る。
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

  for (const id of [
    "scientific-domain",
    "finance-syntax",
    "finance-overflow",
    "data-scale-input",
  ] as ErrorPathId[]) {
    expect(
      paths.frames.find((frame) => frame.id === id)?.cases ?? 0,
      `${id} の枠がこのコーパスで 0 件——枠が実物と繋がっていない`,
    ).toBeGreaterThan(0);
  }

  // **実物には 4 つの枠のどれにも入らないものが在る。** 打鍵の途中で構文
  // エラーになるケース(`entry-000.json`)がそれで、定義域のエラーでも金融
  // でもデータスケールでもない。**在ることを固定する**——黙ってどれかの枠へ
  // 混ぜた実装はここで赤くなる。
  expect(paths.unclassified.map((one) => one.shard)).toEqual([
    "entry-000.json (displays)",
  ]);
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
  const disclaimerOf = (markdown: string) =>
    markdown.slice(markdown.indexOf("この節の件数は、この走行の実データから"));

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

  // **エラー経路も同じ形である。** 5 つの枠のどれか 1 つでも数を出していれば、
  // その行はデータ由来になるので一覧から外れる。以前この項目は一覧に一度も
  // 載らず、5 枠すべてが空の走行で数え落としになっていた。
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
